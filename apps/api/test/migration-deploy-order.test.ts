// Deploy order, from the database's side (rehearsal of the merge of
// claude/integration-2026-10-28 into main, 2026-11-05). Evan applies the
// migrations by hand, so for a while the code and the schema can disagree:
//   - new API on the old schema: the merge deployed before the migrations ran;
//   - old API on the new schema: the migrations ran, main still deployed.
// docs/merge-checklist.md section 0 states these results. PGlite stands behind
// a local PostgREST stand-in with every flag off; nothing leaves the machine.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';
import { allMigrations, mainSchemaPglite, migratedPglite, migrationSql } from './helpers/pglite-db';
import { runRest } from './helpers/pglite-rest';
import { emulateSupabaseRoles, seedMainRows, tryExec } from './helpers/migration-rehearsal';

blankEnv();

const here = dirname(fileURLToPath(import.meta.url));
const ATHLETE = '4242';
const T = new Date().toISOString().slice(0, 10);
const NO_SUCH_WORKOUT = '11111111-2222-3333-4444-555555555555';
const TOKEN = 'ab'.repeat(32);
// 06:30 in New York on a Thursday: a default athlete's read is due.
const DUE_NOW = new Date('2026-11-05T11:30:00Z');

let app: any;
let rest: FakeRest;
let guard: FetchGuard;
let oldSchema: PGlite;
let newSchema: PGlite;
let pg: PGlite;
const opened: PGlite[] = [];

const TABLES = ['athletes', 'device_tokens', 'athlete_preferences', 'training_plans', 'scheduled_workouts', 'plan_adaptations',
  'plan_templates', 'knowledge_sources', 'knowledge_chunks', 'read_citations',
  'rpc/scora_due_deliveries', 'rpc/replace_manual_plan', 'rpc/replace_external_plan', 'rpc/refresh_ical_plan',
  'rpc/mark_scheduled_workout', 'rpc/mark_workout_watch_sent', 'rpc/create_scora_plan', 'rpc/apply_plan_adaptation'];

const seed = async (db: PGlite) => {
  await db.query(
    `insert into athletes (name, strava_id, strava_access_token, strava_refresh_token, strava_expires_at, cdv_count, cdv_count_date)
     values ('Existing Runner', $1, 'tok', 'ref', 4102444800, 1, $2)`, [ATHLETE, T]);
  await db.query(`insert into device_tokens (athlete_id, token) values ($1, $2)`, [ATHLETE, TOKEN]);
};
const copy = async (db: PGlite) => {
  const c = await db.clone();
  opened.push(c);
  return c;
};

before(async () => {
  rest = await fakeRest();
  guard = installFetchGuard(rest.url);
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  oldSchema = await mainSchemaPglite();
  newSchema = await migratedPglite();
  await seed(oldSchema);
  await seed(newSchema);
  app = (await import('../src/index')).default;
  await app.ready();
});
after(async () => {
  await app.close();
  guard.restore();
  await rest.close();
  for (const db of [oldSchema, newSchema, ...opened]) await db.close();
});
beforeEach(() => {
  rest.reset();
  guard.reset();
  for (const t of TABLES) rest.handle(t, (req) => runRest(pg, req));
});

type Call = { name: string; method: 'GET' | 'POST' | 'PUT'; url: string; payload?: unknown; llm?: string };
const PARSED = JSON.stringify({ workouts: [{ date: T, type: 'run', intensity: 'easy', duration_min: 30, description: 'Easy 30' }] });

// The unflagged routes that reach the database. Flagged routes answer 404
// before they touch it (last test below).
const CALLS: Call[] = [
  { name: 'GET /health', method: 'GET', url: '/health' },
  { name: 'GET /api/keepalive', method: 'GET', url: '/api/keepalive' },
  { name: 'POST /api/read', method: 'POST', url: '/api/read', payload: { athleteId: ATHLETE, today: T, timezone: 'America/New_York' } },
  { name: 'POST /api/weekly', method: 'POST', url: '/api/weekly', payload: { athleteId: ATHLETE, today: T } },
  { name: 'POST /api/cdv', method: 'POST', url: '/api/cdv', payload: { athleteId: ATHLETE, message: 'How steady have I been?', today: T } },
  { name: 'GET /api/preferences', method: 'GET', url: `/api/preferences?athleteId=${ATHLETE}` },
  { name: 'PUT /api/preferences', method: 'PUT', url: '/api/preferences', payload: { athleteId: ATHLETE, timezone: 'America/Chicago', deliveryMinute: 420 } },
  { name: 'GET /api/plan', method: 'GET', url: `/api/plan?athleteId=${ATHLETE}&today=${T}` },
  { name: 'POST /api/plan/manual', method: 'POST', url: '/api/plan/manual', payload: { athleteId: ATHLETE, text: 'Today: easy 30 min', today: T }, llm: PARSED },
  { name: 'POST status', method: 'POST', url: `/api/plan/workouts/${NO_SUCH_WORKOUT}/status`, payload: { athleteId: ATHLETE, status: 'done', today: T } },
  { name: 'POST watch-sent', method: 'POST', url: `/api/plan/workouts/${NO_SUCH_WORKOUT}/watch-sent`, payload: { athleteId: ATHLETE } },
  { name: 'POST /api/register-device', method: 'POST', url: '/api/register-device', payload: { athleteId: ATHLETE, deviceToken: TOKEN } },
  { name: 'POST /api/unregister-device', method: 'POST', url: '/api/unregister-device', payload: { athleteId: ATHLETE, deviceToken: 'cd'.repeat(32) } },
];

async function statuses(db: PGlite): Promise<Record<string, number>> {
  pg = db;
  const out: Record<string, number> = {};
  for (const c of CALLS) {
    guard.reset();
    guard.stravaActivities([]);
    if (c.llm) guard.openAi(c.llm);
    const r = await app.inject({ method: c.method, url: c.url, payload: c.payload });
    out[c.name] = r.statusCode;
  }
  return out;
}
const failing = (s: Record<string, number>) => Object.keys(s).filter((k) => s[k] >= 500).sort();

const PLAN_AND_PREFS = ['GET /api/plan', 'GET /api/preferences', 'POST /api/plan/manual', 'POST status', 'POST watch-sent', 'PUT /api/preferences'].sort();

test('new API on the old schema: plan and preference routes answer 500, everything the app on phones uses keeps working', async () => {
  const db = await copy(oldSchema);
  const s = await statuses(db);
  assert.deepEqual(failing(s), PLAN_AND_PREFS);
  for (const k of ['GET /health', 'GET /api/keepalive', 'POST /api/read', 'POST /api/weekly', 'POST /api/cdv', 'POST /api/register-device', 'POST /api/unregister-device']) {
    assert.equal(s[k], 200, k);
  }
  // Nothing was lost: the athlete and the device are still there.
  const a = await db.query(`select 1 from athletes where strava_id = $1`, [ATHLETE]);
  assert.equal(a.rows.length, 1);
});

test('new API on the new schema: no route answers 500, and a pasted plan can be marked and sent to the Watch', async () => {
  const db = await copy(newSchema);
  const s = await statuses(db);
  assert.deepEqual(failing(s), []);
  assert.equal(s['POST status'], 404, 'an unknown session is a 404, not an error');
  const plan = await app.inject({ method: 'GET', url: `/api/plan?athleteId=${ATHLETE}&today=${T}` });
  const id = plan.json().workouts[0].id;
  const done = await app.inject({ method: 'POST', url: `/api/plan/workouts/${id}/status`, payload: { athleteId: ATHLETE, status: 'done', today: T } });
  assert.equal(done.statusCode, 200);
  const sent = await app.inject({ method: 'POST', url: `/api/plan/workouts/${id}/watch-sent`, payload: { athleteId: ATHLETE } });
  assert.equal(sent.statusCode, 200);
  const row = await db.query<{ athlete_completed: boolean; workout_kit_pushed_at: string | null }>(
    `select athlete_completed, workout_kit_pushed_at from scheduled_workouts where id = $1`, [id]);
  assert.equal(row.rows[0].athlete_completed, true);
  assert.ok(row.rows[0].workout_kit_pushed_at);
});

// Everything except one new migration: what the checklist calls "needed at merge".
test('new API with one migration left out: only migrations 2, 3, 4 and 14 are needed at merge with every flag off', async () => {
  const seen: Record<string, string[]> = {};
  const files = allMigrations().filter((f) => f >= '20261017');
  const base = await copy(oldSchema);
  for (const skip of files) {
    const db = await copy(base);
    for (const f of files) if (f !== skip) await tryExec(db, migrationSql(f));
    const broken = failing(await statuses(db));
    if (broken.length) seen[skip.slice(0, 14)] = broken;
  }
  assert.deepEqual(seen, {
    '20261017010000': PLAN_AND_PREFS.filter((k) => !k.includes('preferences')), // 2: training_plans, scheduled_workouts
    '20261017020000': ['GET /api/preferences', 'PUT /api/preferences'], // 3
    '20261018000000': ['GET /api/plan', 'POST watch-sent'].sort(), // 4: workout_structure_json, workout_kit_pushed_at
    '20261103010000': ['POST status', 'POST watch-sent'], // 14
  });
});

const quiet = () => {
  const errors: string[] = [];
  const infos: string[] = [];
  return { errors, infos, log: { info: (m: string) => { infos.push(m); }, warn() {}, error: (m: string) => { errors.push(m); } } };
};

async function tickOn(db: PGlite, times = 1) {
  pg = db;
  const sched = await import('../src/scheduler');
  const push = await import('../src/push');
  const { supabasePrefsStore } = await import('../src/preferences');
  const { createClient } = await import('@supabase/supabase-js');
  const l = quiet();
  const sent: string[] = [];
  const deps = sched.schedulerDeps('http://localhost:3000', l.log, supabasePrefsStore(createClient(rest.url, 'test-service-role')), {
    fetch: (async () => new Response(JSON.stringify({ read: { voice: 'Body is settled.', numbers: 'Sleep 7:12' } }), { status: 200 })) as typeof fetch,
    getDeviceTokens: push.getDeviceTokens,
    sendPush: async (token: string) => { sent.push(token); return { ok: true, status: 200 }; },
    removeDeviceToken: push.removeDeviceToken,
  });
  const results = [];
  for (let i = 0; i < times; i++) results.push(await sched.runTick(new Date(DUE_NOW.getTime() + i * 60_000), deps));
  return { ...l, sent, results };
}

test('scheduler, new API on the old schema: no push and no throw, an error each tick, until migration 3 exists', async () => {
  const r = await tickOn(await copy(oldSchema));
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.results, [{ daily: 0, weekly: 0 }]);
  assert.match(r.errors.join('\n'), /failed to load athletes/);
  assert.match(r.infos.join('\n'), /scora_due_deliveries not found/);
});

test('scheduler with migration 3 but not 12 reads every athlete and sends once', async () => {
  const db = await copy(oldSchema);
  assert.equal(await tryExec(db, migrationSql('20261017020000_athlete_preferences.sql')), null);
  const r = await tickOn(db, 2);
  assert.deepEqual(r.sent, [TOKEN]);
  assert.match(r.infos.join('\n'), /scora_due_deliveries not found/);
});

test('scheduler on the new schema uses the function and sends once to an existing device with no preferences row', async () => {
  const r = await tickOn(await copy(newSchema), 2);
  assert.deepEqual(r.sent, [TOKEN]);
  assert.deepEqual(r.errors, []);
  assert.ok(!r.infos.join('\n').includes('scora_due_deliveries not found'));
  assert.ok(rest.requests.some((q) => q.table === 'rpc/scora_due_deliveries' && q.method === 'POST'));
});

// Recorded from origin/main's own strava.ts, oura.ts, push.ts and usage.ts run
// against PGlite on 2026-11-05 (main's code is gone from this branch), so this
// is the whole of what the deployed API sends between the migrations and the merge.
const MAIN_REQUESTS: { method: string; table: string; query: string; prefer: string | null; body: any }[] =
  JSON.parse(readFileSync(join(here, 'fixtures', 'main-api-requests.json'), 'utf8'));

async function replay(db: PGlite) {
  const out: { status: number | undefined; body: unknown }[] = [];
  for (const r of MAIN_REQUESTS) {
    const a = await runRest(db, {
      method: r.method, table: r.table, params: new URLSearchParams(r.query), body: r.body,
      headers: r.prefer ? { prefer: r.prefer } : {},
    });
    out.push({ status: a.status, body: JSON.parse(JSON.stringify(a.body ?? null), (k, v) => (['id', 'created_at', 'updated_at'].includes(k) ? undefined : v)) });
  }
  return out;
}

test('old API on the new schema: every request main sends gets the same answer, as the service role with RLS on', async () => {
  assert.ok(MAIN_REQUESTS.length >= 20);
  assert.deepEqual([...new Set(MAIN_REQUESTS.map((r) => r.table))].sort(), ['athletes', 'device_tokens'], 'main touches only these two tables');
  const oldDb = await mainSchemaPglite();
  const newDb = await migratedPglite();
  opened.push(oldDb, newDb);
  await seedMainRows(oldDb);
  await seedMainRows(newDb);
  const before = await replay(oldDb);
  await emulateSupabaseRoles(newDb);
  await newDb.exec('set role service_role');
  const afterMigrations = await replay(newDb);
  await newDb.exec('reset role');
  assert.deepEqual(afterMigrations, before);
  assert.ok(before.every((a) => (a.status ?? 200) < 300), 'every replayed request succeeded');
});

test('old API with the anon key instead of the service role would read nothing once RLS is on (why the checklist checks the key)', async () => {
  const db = await copy(newSchema);
  await emulateSupabaseRoles(db);
  await db.exec('set role anon');
  const a = await runRest(db, { method: 'GET', table: 'athletes', params: new URLSearchParams('select=strava_id'), body: null, headers: {} });
  await db.exec('reset role');
  assert.deepEqual(a.body, []);
});

test('flagged routes answer before they reach the old schema', async () => {
  const db = await copy(oldSchema);
  pg = db;
  for (const url of [`/api/plan/options?athleteId=${ATHLETE}`, `/api/plan/adaptations?athleteId=${ATHLETE}`, `/api/calories?athleteId=${ATHLETE}`, `/api/plan/prediction?athleteId=${ATHLETE}`]) {
    const r = await app.inject({ method: 'GET', url });
    assert.equal(r.statusCode, 404, url);
  }
  const ical = await app.inject({ method: 'POST', url: '/api/plan/ical', payload: { athleteId: ATHLETE, ics: 'x' } });
  assert.equal(ical.statusCode, 404);
});

