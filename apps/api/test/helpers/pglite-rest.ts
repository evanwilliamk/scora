// A small PostgREST stand-in over PGlite with the real migrations, for the
// fake REST server: supabase-js select / insert / upsert / update / delete
// with eq, neq, is, gte, lte, gt, lt, in and or filters run as SQL, so the
// production store code is tested against the real schema and constraints.
// Not a full PostgREST: embeds only the inner joins the stores use (a row's
// training_plans status, a plan's plan_templates), ordering is `order=col` with
// .asc or .desc, no ranges.
// `rpc/<fn>` runs the function with named arguments, and a table or function
// the schema lacks answers as PostgREST does (404, PGRST205 or PGRST202), so
// code can be run against an older schema.
//
// `hold` lets a race test line requests up: matching requests wait until
// `count` of them have arrived, then all run, in arrival order.

import type { PGlite } from '@electric-sql/pglite';
import type { FakeRest, RestAnswer, RestRequest } from './fake-rest';

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};

function parseCondition(col: string, expr: string, params: unknown[]): string {
  const c = ident(col);
  if (expr.startsWith('not.')) return `not (${parseCondition(col, expr.slice(4), params)})`;
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  switch (op) {
    case 'eq': return `${c}::text = ${p(val)}`;
    case 'neq': return `${c}::text <> ${p(val)}`;
    case 'gt': return `${c} > ${p(val)}`;
    case 'gte': return `${c} >= ${p(val)}`;
    case 'lt': return `${c} < ${p(val)}`;
    case 'lte': return `${c} <= ${p(val)}`;
    case 'is':
      if (val === 'null') return `${c} is null`;
      if (val === 'true' || val === 'false') return `${c} is ${val}`;
      throw new Error(`is.${val}`);
    case 'in': {
      const items = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      return `${c}::text = any(${p(items)}::text[])`;
    }
    default: throw new Error(`unsupported filter ${op}`);
  }
}

function where(params: URLSearchParams, values: unknown[]): string {
  const parts: string[] = [];
  for (const [k, v] of params) {
    if (['select', 'on_conflict', 'columns', 'order', 'limit', 'offset'].includes(k)) continue;
    if (k === 'training_plans.current_status') {
      const dot = v.indexOf('.');
      if (v.slice(0, dot) !== 'eq') throw new Error(`unsupported embedded filter ${v}`);
      values.push(v.slice(dot + 1));
      parts.push(`exists (select 1 from training_plans tp where tp.id = training_plan_id and tp.current_status = $${values.length})`);
      continue;
    }
    if (k === 'or') {
      const inner = v.replace(/^\(|\)$/g, '').split(',').map((term) => {
        const d = term.indexOf('.');
        return parseCondition(term.slice(0, d), term.slice(d + 1), values);
      });
      parts.push(`(${inner.join(' or ')})`);
      continue;
    }
    parts.push(parseCondition(k, v, values));
  }
  return parts.length ? `where ${parts.join(' and ')}` : '';
}

// The select without its `name!inner(a, b)` embeds, and those embeds' columns.
const EMBED = /([a-z_]+)!inner\(([^)]*)\)/g;
const plainColumns = (select: string) => select.replace(EMBED, '').split(',').map((c) => c.trim()).filter(Boolean);
const embedsOf = (select: string | null) =>
  [...(select ?? '').matchAll(EMBED)].map((m) => ({ table: m[1], cols: m[2].split(',').map((c) => c.trim()) }));

function pick(rows: any[], select: string | null): any[] {
  if (!select || select.trim() === '*') return rows;
  const cols = plainColumns(select);
  if (cols.includes('*')) return rows;
  const embeds = /training_plans!inner/.test(select);
  return rows.map((r) => ({
    ...Object.fromEntries(cols.map((c) => [c, r[c]])),
    ...(embeds ? { training_plans: { current_status: 'active' } } : {}),
    ...(r.plan_templates ? { plan_templates: r.plan_templates } : {}),
  }));
}

async function runRpc(pg: PGlite, name: string, args: Record<string, unknown>): Promise<RestAnswer> {
  const keys = Object.keys(args ?? {});
  const found = await pg.query<{ retset: boolean }>(
    `select p.proretset as retset from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1 and p.pronargs >= $2
       and (select count(*) from unnest($3::text[]) k where k = any(p.proargnames)) = $2
       and p.pronargs - p.pronargdefaults <= $2
     limit 1`,
    [name, keys.length, keys]);
  if (found.rows.length === 0) {
    return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } };
  }
  const named = keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ');
  try {
    const r = await pg.query<Record<string, unknown>>(`select * from ${ident(name)}(${named})`, keys.map((k) => args[k]));
    return { status: 200, body: found.rows[0].retset ? r.rows : (r.rows[0] ? Object.values(r.rows[0])[0] : null) };
  } catch (e: any) {
    return { status: 400, body: { code: e?.code ?? 'XX000', message: e?.message ?? String(e) } };
  }
}

export async function runRest(pg: PGlite, req: RestRequest): Promise<RestAnswer> {
  if (req.table.startsWith('rpc/')) return runRpc(pg, req.table.slice(4), req.body);
  const known = await pg.query<{ r: string | null }>('select to_regclass($1)::text as r', [`public.${req.table}`]);
  if (!known.rows[0].r) {
    return { status: 404, body: { code: 'PGRST205', message: `Could not find the table 'public.${req.table}' in the schema cache` } };
  }
  const t = ident(req.table);
  const values: unknown[] = [];
  const prefer = String(req.headers.prefer ?? '');
  const wantRows = prefer.includes('return=representation') || req.method === 'GET';
  const select = req.params.get('select');
  // A named column the table lacks is an error, as in PostgREST, even with no rows to pick from.
  const named = plainColumns(select ?? '').filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
  if (named.length) {
    const have = await pg.query<{ c: string }>(
      `select column_name as c from information_schema.columns where table_schema = 'public' and table_name = $1`, [req.table]);
    const gone = named.find((c) => !have.rows.some((r) => r.c === c));
    if (gone) return { status: 400, body: { code: '42703', message: `column ${req.table}.${gone} does not exist` } };
  }
  try {
    let rows: any[] = [];
    if (req.method === 'GET') {
      const order = req.params.get('order');
      const orderSql = order
        ? `order by ${order.split(',').map((o) => `${ident(o.split('.')[0])}${o.split('.')[1] === 'desc' ? ' desc' : ''}`).join(', ')}`
        : '';
      const limit = req.params.get('limit');
      const r = await pg.query<{ r: any }>(
        `select to_jsonb(${t}.*) as r from ${t} ${where(req.params, values)} ${orderSql} ${limit ? `limit ${Number(limit)}` : ''}`, values);
      rows = r.rows.map((x) => x.r);
      // A plan's template, the one embed that returns columns.
      if (embedsOf(select).some((e) => e.table === 'plan_templates')) {
        const cols = embedsOf(select).find((e) => e.table === 'plan_templates')!.cols;
        for (const row of rows) {
          const tmpl = await pg.query<{ r: any }>('select to_jsonb(t.*) as r from plan_templates t where t.id = $1', [row.template_id]);
          row.plan_templates = tmpl.rows[0] ? Object.fromEntries(cols.map((c) => [c, tmpl.rows[0].r[c]])) : null;
        }
      }
    } else if (req.method === 'POST') {
      const body = Array.isArray(req.body) ? req.body : [req.body];
      const onConflict = req.params.get('on_conflict');
      for (const row of body) {
        const cols = Object.keys(row);
        const vals: unknown[] = [JSON.stringify(row)];
        const colList = cols.map(ident).join(', ');
        let sql = `insert into ${t} (${colList}) select ${colList} from jsonb_populate_record(null::${t}, $1::jsonb)`;
        if (onConflict) {
          const keys = onConflict.split(',').map((s) => s.trim());
          const target = keys.map(ident).join(', ');
          const sets = cols.filter((c) => !keys.includes(c)).map((c) => `${ident(c)} = excluded.${ident(c)}`);
          sql += prefer.includes('resolution=ignore-duplicates') || sets.length === 0
            ? ` on conflict (${target}) do nothing`
            : ` on conflict (${target}) do update set ${sets.join(', ')}`;
        }
        const r = await pg.query<{ r: any }>(`${sql} returning to_jsonb(${t}.*) as r`, vals);
        rows.push(...r.rows.map((x) => x.r));
      }
    } else if (req.method === 'PATCH') {
      const cols = Object.keys(req.body ?? {});
      values.push(JSON.stringify(req.body));
      const colList = cols.map(ident).join(', ');
      const r = await pg.query<{ r: any }>(
        `update ${t} set (${colList}) = (select ${colList} from jsonb_populate_record(null::${t}, $1::jsonb))
         ${where(req.params, values)} returning to_jsonb(${t}.*) as r`, values);
      rows = r.rows.map((x) => x.r);
    } else if (req.method === 'DELETE') {
      const r = await pg.query<{ r: any }>(`delete from ${t} ${where(req.params, values)} returning to_jsonb(${t}.*) as r`, values);
      rows = r.rows.map((x) => x.r);
    } else {
      return { status: 405, body: { message: req.method } };
    }
    return wantRows ? { status: req.method === 'POST' ? 201 : 200, body: pick(rows, select) } : { status: 200, body: [] };
  } catch (e: any) {
    return { status: 409, body: { code: e?.code ?? 'XX000', message: e?.message ?? String(e) } };
  }
}

export interface PgliteRest {
  // Hold requests that match until `count` of them have arrived.
  hold(match: (req: RestRequest) => boolean, count: number): void;
}

export function servePglite(rest: FakeRest, pg: PGlite, tables: string[]): PgliteRest {
  let gate: { match: (r: RestRequest) => boolean; count: number; waiting: (() => void)[] } | null = null;
  const handler = async (req: RestRequest): Promise<RestAnswer> => {
    if (gate && gate.match(req)) {
      const g = gate;
      await new Promise<void>((resolve) => {
        g.waiting.push(resolve);
        const open = () => {
          if (gate === g) gate = null;
          // Release in arrival order.
          g.waiting.splice(0).forEach((w) => w());
        };
        if (g.waiting.length >= g.count) open();
        // Never hang a test whose race did not line up: let them go after 1 s.
        else setTimeout(open, 1000).unref();
      });
    }
    return runRest(pg, req);
  };
  for (const t of tables) rest.handle(t, handler);
  return {
    hold(match, count) { gate = { match, count, waiting: [] }; },
  };
}
