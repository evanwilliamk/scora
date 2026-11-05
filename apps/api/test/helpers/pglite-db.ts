// An in-process Postgres (PGlite with pgvector) with every Supabase migration
// applied in filename order. No network, no Supabase project.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { RestAnswer, RestRequest } from './fake-rest';
import type { SchedulerDb } from './fake-scheduler-db';

export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');

// What production has today: the migrations on origin/main when the
// integration branch was cut. Everything else in the folder is unapplied.
export const MAIN_MIGRATIONS = [
  '20260701000000_init.sql',
  '20260703000000_strava_tokens.sql',
  '20260703120000_oura_tokens.sql',
  '20260705000000_cdv_usage.sql',
  '20260717000000_device_tokens.sql',
];

export const allMigrations = (): string[] => readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort();
export const newMigrations = (): string[] => allMigrations().filter((f) => !MAIN_MIGRATIONS.includes(f));
export const migrationSql = (file: string): string => readFileSync(join(migrationsDir, file), 'utf8');

// A database with exactly the migrations on main, as production is before the merge.
export async function mainSchemaPglite(): Promise<PGlite> {
  const db = new PGlite({ extensions: { vector } });
  for (const f of MAIN_MIGRATIONS) await db.exec(migrationSql(f));
  return db;
}

export async function migratedPglite(opts: { skip?: (file: string) => boolean } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { vector } });
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    if (opts.skip?.(f)) continue;
    await db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  }
  return db;
}

// Copy the fake scheduler tables into PGlite's device_tokens and
// athlete_preferences (only when they changed since the last copy).
export function pgliteMirror(pg: PGlite) {
  let last = '';
  return async (db: SchedulerDb) => {
    const devices = db.devices.map((d) => ({ athlete_id: String(d.athlete_id), token: String(d.token) }));
    const prefs = [...db.prefs.values()].map((p) => ({
      athlete_id: p.athlete_id, timezone: p.timezone, delivery_minute: p.delivery_minute,
      last_daily_sent_on: p.last_daily_sent_on ?? null, last_weekly_sent_on: p.last_weekly_sent_on ?? null,
    }));
    const snap = JSON.stringify([devices, prefs]);
    if (snap === last) return;
    last = snap;
    await pg.transaction(async (tx) => {
      await tx.query('delete from device_tokens');
      await tx.query('delete from athlete_preferences');
      await tx.query(
        `insert into device_tokens (athlete_id, token)
         select r.athlete_id, r.token from jsonb_to_recordset($1::jsonb) as r(athlete_id text, token text)`,
        [JSON.stringify(devices)]);
      await tx.query(
        `insert into athlete_preferences (athlete_id, timezone, delivery_minute, last_daily_sent_on, last_weekly_sent_on)
         select r.athlete_id, r.timezone, r.delivery_minute, r.last_daily_sent_on, r.last_weekly_sent_on
         from jsonb_to_recordset($1::jsonb)
           as r(athlete_id text, timezone text, delivery_minute smallint, last_daily_sent_on date, last_weekly_sent_on date)`,
        [JSON.stringify(prefs)]);
    });
  };
}

export async function callDue(pg: PGlite, args: { p_now: string; p_window_minutes?: number; p_after?: string | null; p_limit?: number }) {
  const r = await pg.query<Record<string, any>>(
    'select * from scora_due_deliveries($1::timestamptz, $2, $3, $4)',
    [args.p_now, args.p_window_minutes ?? 120, args.p_after ?? null, args.p_limit ?? 1000]);
  return r.rows;
}

// A responder for `rpc/scora_due_deliveries` on the fake REST server that runs
// the migrated function on PGlite over the fake tables' current rows.
export function sqlDue(pg: PGlite, db: SchedulerDb, onCall?: (args: any, rows: Record<string, any>[]) => void) {
  const mirror = pgliteMirror(pg);
  return async (req: RestRequest): Promise<RestAnswer> => {
    await mirror(db);
    const rows = await callDue(pg, req.body);
    onCall?.(req.body, rows);
    return { body: rows };
  };
}
