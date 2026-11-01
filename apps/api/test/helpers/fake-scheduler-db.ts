// Stateful device_tokens, athlete_preferences and athletes tables behind the
// fake Supabase REST server, for scheduler tests that run many ticks. Applies
// the PostgREST filters the scheduler and the prefs store send (eq, neq, is,
// in, or), honors offset/limit, and caps every answer at `maxRows` the way a
// Supabase project's API "max rows" setting (default 1000) does.

import type { FakeRest, RestRequest } from './fake-rest';

export type Row = Record<string, any>;

export interface SchedulerDb {
  devices: Row[];
  prefs: Map<string, Row>;
  // Athletes whose Strava token lookup answers with no row (read fails).
  disconnected: Set<string>;
  // Rows per answer at most, like PostgREST's max-rows.
  maxRows: number;
}

const RESERVED = new Set(['select', 'on_conflict', 'offset', 'limit', 'order', 'columns']);

function splitList(s: string): string[] {
  // a,b,"c,d" -> [a, b, c,d]; keeps parenthesised groups whole.
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function test(row: Row, col: string, expr: string): boolean {
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const v = expr.slice(dot + 1);
  const cell = row[col] ?? null;
  switch (op) {
    case 'eq': return cell !== null && String(cell) === v;
    case 'neq': return cell !== null && String(cell) !== v;
    case 'is': return v === 'null' ? cell === null : String(cell) === v;
    case 'in': return cell !== null && splitList(v.replace(/^\(|\)$/g, '')).includes(String(cell));
    default: throw new Error(`fake db: no operator ${op}`);
  }
}

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue;
    if (k === 'or') {
      const parts = splitList(v.replace(/^\(|\)$/g, ''));
      if (!parts.some((p) => { const i = p.indexOf('.'); return test(row, p.slice(0, i), p.slice(i + 1)); })) return false;
    } else if (!test(row, k, v)) return false;
  }
  return true;
}

function project(row: Row, select: string | null): Row {
  if (!select || select === '*') return { ...row };
  return Object.fromEntries(select.split(',').map((c) => c.trim()).map((c) => [c, row[c] ?? null]));
}

function page<T>(rows: T[], params: URLSearchParams, maxRows: number): T[] {
  const offset = Number(params.get('offset') ?? 0);
  const limit = params.has('limit') ? Number(params.get('limit')) : Infinity;
  return rows.slice(offset, offset + Math.min(limit, maxRows));
}

export const MISSING_DUE_RPC = {
  code: 'PGRST202',
  message: 'Could not find the function public.scora_due_deliveries(p_after, p_limit, p_now, p_window_minutes) in the schema cache',
  details: 'Searched for the function public.scora_due_deliveries with parameters p_after, p_limit, p_now, p_window_minutes',
  hint: null,
};

export function installSchedulerDb(rest: FakeRest, opts: { maxRows?: number } = {}): SchedulerDb {
  const db: SchedulerDb = { devices: [], prefs: new Map(), disconnected: new Set(), maxRows: opts.maxRows ?? 1000 };

  rest.handle('device_tokens', (req: RestRequest) => {
    if (req.method === 'GET') {
      const rows = db.devices.filter((r) => matches(r, req.params)).map((r) => project(r, req.params.get('select')));
      return { body: page(rows, req.params, db.maxRows) };
    }
    if (req.method === 'DELETE') {
      db.devices = db.devices.filter((r) => !matches(r, req.params));
      return { status: 204, body: [] };
    }
    throw new Error(`fake db: device_tokens ${req.method}`);
  });

  rest.handle('athlete_preferences', (req: RestRequest) => {
    const select = req.params.get('select');
    if (req.method === 'GET') {
      const rows = [...db.prefs.values()].filter((r) => matches(r, req.params)).map((r) => project(r, select));
      return { body: page(rows, req.params, db.maxRows) };
    }
    if (req.method === 'POST') {
      // Upsert on athlete_id; ignore-duplicates leaves an existing row alone.
      const ignore = String(req.headers.prefer ?? '').includes('ignore-duplicates');
      for (const b of [].concat(req.body)) {
        const row: Row = b;
        const prev = db.prefs.get(row.athlete_id);
        if (prev && ignore) continue;
        db.prefs.set(row.athlete_id, {
          timezone: 'America/New_York', delivery_minute: 360, onboarded_at: null,
          last_daily_sent_on: null, last_weekly_sent_on: null, ...prev, ...row,
        });
      }
      return { status: 201, body: [] };
    }
    if (req.method === 'PATCH') {
      const hit = [...db.prefs.values()].filter((r) => matches(r, req.params));
      for (const r of hit) Object.assign(r, req.body);
      return { body: select ? hit.map((r) => project(r, select)) : [] };
    }
    throw new Error(`fake db: athlete_preferences ${req.method}`);
  });

  // scora_due_deliveries as on a project without migration 20261101010000:
  // PostgREST's "not in the schema cache". sqlDue() answers it from PGlite.
  rest.handle('rpc/scora_due_deliveries', () => ({ status: 404, body: MISSING_DUE_RPC }));

  // A connected Strava token for every athlete but the disconnected ones.
  rest.handle('athletes', (req: RestRequest) => {
    const id = (req.params.get('strava_id') ?? req.params.get('id') ?? '').replace(/^eq\./, '');
    if (db.disconnected.has(id)) return { body: [] };
    return { body: [{ strava_access_token: `tok-${id}`, strava_refresh_token: `ref-${id}`, strava_expires_at: Math.floor(Date.now() / 1000) + 86400 * 400 }] };
  });

  return db;
}

// Requests per table, for query counts.
export function countByTable(requests: RestRequest[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of requests) out[`${r.method} ${r.table}`] = (out[`${r.method} ${r.table}`] ?? 0) + 1;
  return out;
}
