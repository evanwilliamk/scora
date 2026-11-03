// A small PostgREST stand-in over PGlite with the real migrations, for the
// fake REST server: supabase-js select / insert / upsert / update / delete
// with eq, neq, is, gte, lte, gt, lt, in and or filters run as SQL, so the
// production store code is tested against the real schema and constraints.
// Not a full PostgREST: no embedding, no ordering beyond `order=col`, no ranges.
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

function pick(rows: any[], select: string | null): any[] {
  if (!select || select.trim() === '*') return rows;
  const cols = select.split(',').map((s) => s.trim()).filter(Boolean);
  if (cols.includes('*')) return rows;
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
}

export async function runRest(pg: PGlite, req: RestRequest): Promise<RestAnswer> {
  const t = ident(req.table);
  const values: unknown[] = [];
  const prefer = String(req.headers.prefer ?? '');
  const wantRows = prefer.includes('return=representation') || req.method === 'GET';
  const select = req.params.get('select');
  try {
    let rows: any[] = [];
    if (req.method === 'GET') {
      const order = req.params.get('order');
      const orderSql = order ? `order by ${order.split(',').map((o) => ident(o.split('.')[0])).join(', ')}` : '';
      const limit = req.params.get('limit');
      const r = await pg.query<{ r: any }>(
        `select to_jsonb(${t}.*) as r from ${t} ${where(req.params, values)} ${orderSql} ${limit ? `limit ${Number(limit)}` : ''}`, values);
      rows = r.rows.map((x) => x.r);
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
