// Shared by the merge rehearsal tests: rows like production's, and a
// fingerprint of the catalog and the data to compare two databases by.

import type { PGlite } from '@electric-sql/pglite';

// Rows the tables on main can hold today, awkward ones included: an athlete
// with no Strava id, a device whose athlete has no row, two devices on one
// athlete, null readings, an old quota date.
export async function seedMainRows(db: PGlite): Promise<void> {
  await db.exec(`
    insert into users (id, email) values
      ('00000000-0000-0000-0000-000000000001', 'a@example.com'),
      ('00000000-0000-0000-0000-000000000002', 'b@example.com');
    insert into athletes (id, user_id, name, strava_id, oura_id, strava_access_token, strava_refresh_token, strava_expires_at,
      oura_access_token, oura_refresh_token, oura_expires_at, cdv_count, cdv_count_date) values
      ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Both Linked', '1001', 'o1', 'sa', 'sr', 4102444800, 'oa', 'or', 4102444800, 3, '2026-11-01'),
      ('00000000-0000-0000-0000-00000000000b', null, 'Strava Only', '1002', null, 'sa2', 'sr2', 1000, null, null, null, 0, null),
      ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000002', 'No Strava', null, null, null, null, null, null, null, null, 0, null),
      ('00000000-0000-0000-0000-00000000000d', null, 'Unknown', '1003', null, null, null, null, null, null, null, 0, null);
    insert into activities (athlete_id, strava_activity_id, activity_type, duration_seconds, distance_meters, elevation_meters, activity_date) values
      ('00000000-0000-0000-0000-00000000000a', 's1', 'Run', 2700, 8000.5, 40, '2026-10-30'),
      ('00000000-0000-0000-0000-00000000000a', null, null, null, null, null, null);
    insert into workouts (athlete_id, workout_type, duration_minutes, intensity_level, scheduled_date) values
      ('00000000-0000-0000-0000-00000000000a', 'tempo', 45, 'hard', '2026-11-03'),
      (null, null, null, null, null);
    insert into health_data (athlete_id, data_type, value, recorded_date) values
      ('00000000-0000-0000-0000-00000000000a', 'hrv', 52, '2026-10-31'),
      ('00000000-0000-0000-0000-00000000000a', 'sleep', null, null);
    insert into device_tokens (id, athlete_id, token) values
      ('00000000-0000-0000-0000-0000000000d1', '1001', 'dev-1001-phone'),
      ('00000000-0000-0000-0000-0000000000d2', '1001', 'dev-1001-ipad'),
      ('00000000-0000-0000-0000-0000000000d3', '1002', 'dev-1002'),
      ('00000000-0000-0000-0000-0000000000d4', '9999', 'dev-orphan');
  `);
}

const template = {
  slug: 'rehearsal', version: '0.0.1', sport: 'run', goal_type: '10k', duration_weeks: 4, experience_level: 'regular',
  weekly_volume_range_km: [30, 45], author: 'Fixture', status: 'draft', reviewed_by: null, reviewed_on: null,
};
const rows = (date: string, description: string) => JSON.stringify([
  { date, type: 'run', intensity: 'easy', duration_min: 30, distance_km: null, description },
]);

// Rows the new tables hold once the API has used them, through the migrated
// functions, so a re-run meets real data: every plan source, a mark, a Watch
// send, a named change, a knowledge passage with no author, preferences.
export async function seedNewRows(db: PGlite): Promise<void> {
  await db.query(`select replace_manual_plan('2001', 'pasted', $1::jsonb)`, [rows('2026-11-05', 'Pasted')]);
  await db.query(`select replace_external_plan('2002', 'ical', null, $1::jsonb)`, [rows('2026-11-05', 'From a calendar')]);
  await db.query(`select replace_external_plan('2003', 'runna', null, $1::jsonb)`, [rows('2026-11-05', 'From Runna')]);
  const plan = await db.query<{ id: string }>(`select create_scora_plan($1::jsonb) as id`, [JSON.stringify({
    athlete_id: '2004', template, goal_race_type: '10k', goal_race_date: '2026-12-20', start_date: '2026-11-03', end_date: '2026-12-20',
    weekly_volume_start_km: 32, planned_type: 'run',
    workouts: [
      { scheduled_date: '2026-11-03', planned_intensity: 'easy', planned_duration_min: 40, structure: null },
      { scheduled_date: '2026-11-05', planned_intensity: 'tempo', planned_duration_min: 45, structure: [] },
    ],
  })]);
  const ws = await db.query<{ id: string }>(
    `select id from scheduled_workouts where training_plan_id = $1 order by scheduled_date`, [plan.rows[0].id]);
  await db.query(`select mark_scheduled_workout('2004', $1, true, '2026-11-05')`, [ws.rows[0].id]);
  await db.query(`select mark_workout_watch_sent('2004', $1)`, [ws.rows[1].id]);
  await db.query(`select apply_plan_adaptation($1::jsonb)`, [JSON.stringify({
    athlete_id: '2004', training_plan_id: plan.rows[0].id, scheduled_workout_id: ws.rows[1].id, type: 'downgraded',
    new_workout: { planned_intensity: 'endurance', workout_structure_json: [] }, reason_code: 'posture_back_off_tempo',
    reason_text: 'Slept 5.5 hours Monday.', engine_version: 'adaptation-v1.0.0',
  })]);
  await db.exec(`
    insert into athlete_preferences (athlete_id, timezone, delivery_minute, onboarded_at, last_daily_sent_on)
      values ('1001', 'Europe/London', 420, '2026-11-01T00:00:00Z', '2026-11-04');
    insert into knowledge_sources (id, title, author) values
      ('00000000-0000-0000-0000-0000000000e1', 'Authorless Notes', null),
      ('00000000-0000-0000-0000-0000000000e2', 'Running Formula', 'Daniels');
    insert into knowledge_chunks (source_id, text, fieldcopy_entry_id) values
      ('00000000-0000-0000-0000-0000000000e2', 'Passage', 'fc-1');
  `);
}

// Every table, column, constraint, index, function, RLS flag and policy in
// public, in a stable order.
export async function catalog(db: PGlite): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const add = (key: string, value: string) => { out[key] = value; };
  const cols = await db.query<{ k: string; v: string }>(
    `select table_name || '.' || column_name as k, data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') as v
     from information_schema.columns where table_schema = 'public'`);
  for (const r of cols.rows) add(`column ${r.k}`, r.v);
  const cons = await db.query<{ k: string; v: string }>(
    `select c.relname || '.' || k.conname as k, pg_get_constraintdef(k.oid) as v
     from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`);
  for (const r of cons.rows) add(`constraint ${r.k}`, r.v);
  const idx = await db.query<{ k: string; v: string }>(`select indexname as k, indexdef as v from pg_indexes where schemaname = 'public'`);
  for (const r of idx.rows) add(`index ${r.k}`, r.v);
  const fns = await db.query<{ k: string; v: string }>(
    `select p.oid::regprocedure::text as k, pg_get_functiondef(p.oid) as v
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
     where n.nspname = 'public' and l.lanname in ('plpgsql', 'sql') and not exists (
       select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
  for (const r of fns.rows) add(`function ${r.k}`, r.v);
  const rls = await db.query<{ k: string; v: string }>(
    `select c.relname as k, c.relrowsecurity::text as v from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`);
  for (const r of rls.rows) add(`rls ${r.k}`, r.v);
  const pol = await db.query<{ k: string }>(`select tablename || '.' || policyname as k from pg_policies where schemaname = 'public'`);
  for (const r of pol.rows) add(`policy ${r.k}`, 'present');
  return out;
}

// Every row of every public table, as json, by table.
export async function dataOf(db: PGlite): Promise<Record<string, string[]>> {
  const tables = await db.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public' order by 1`);
  const out: Record<string, string[]> = {};
  for (const { t } of tables.rows) {
    const r = await db.query<{ j: string }>(`select to_jsonb(x)::text as j from "${t}" x`);
    out[t] = r.rows.map((x) => x.j).sort();
  }
  return out;
}

// Keys whose value differs between two catalogs.
export function catalogDiff(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
}

export async function tryExec(db: PGlite, sql: string): Promise<string | null> {
  try {
    await db.exec(sql);
    return null;
  } catch (e: any) {
    return `${e?.code ?? 'error'}: ${e?.message ?? e}`;
  }
}

// Supabase's roles as its default privileges set them up: anon and
// service_role can reach every table and function in public, and only
// service_role skips RLS. An emulation: PGlite's own user is a superuser, so
// RLS can only be seen through `set role`.
export async function emulateSupabaseRoles(db: PGlite): Promise<void> {
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public to anon, service_role;
    grant all on all tables in schema public to anon, service_role;
    grant all on all routines in schema public to anon, service_role;
  `);
}
