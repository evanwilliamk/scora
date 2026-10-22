import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import {
  numbersIn, validateParsedRows, parsePlanText, buildPlanParsePrompt, openAiPlanLlm, toScheduledWorkout, PlanParseError,
} from '../src/plan-parse';
import { sqlPlanStore, supabasePlanStore } from '../src/plan-store';

const TODAY = '2026-10-17'; // a Saturday
const PLAN = `Sun: long run 16 mi easy
Tue: 45 min tempo, 3x8 at threshold
Wed: rest
Thu 10/22: 6 km recovery
Sat: 1.5 h ride`;

// What a well-behaved model returns for PLAN.
const GOOD = {
  workouts: [
    { date: '2026-10-18', type: 'run', intensity: 'long', duration_min: null, distance: 16, distance_unit: 'mi', description: 'long run 16 mi easy' },
    { date: '2026-10-20', type: 'run', intensity: 'tempo', duration_min: 45, distance: null, distance_unit: null, description: '45 min tempo, 3x8 at threshold' },
    { date: '2026-10-21', type: 'other', intensity: 'rest', duration_min: null, distance: null, distance_unit: null, description: 'rest' },
    { date: '2026-10-22', type: 'run', intensity: 'recovery', duration_min: null, distance: 6, distance_unit: 'km', description: '6 km recovery' },
    { date: '2026-10-24', type: 'ride', intensity: null, duration_min: 90, distance: null, distance_unit: null, description: '1.5 h ride' },
  ],
};

test('numbersIn reads every number as written', () => {
  assert.deepEqual(numbersIn('3x8 at 4:30/km, 1,5 h'), [3, 8, 4, 30, 1.5]);
});

test('a faithful transcription keeps every row and converts miles', () => {
  const r = validateParsedRows(GOOD, PLAN, TODAY);
  assert.equal(r.rejected.length, 0, JSON.stringify(r.rejected));
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows[0].distance_km, 25.75); // 16 mi
  assert.equal(r.rows[3].distance_km, 6);
  assert.equal(r.rows[4].duration_min, 90); // 1.5 h written, 90 min stored
  assert.equal(r.rows[2].intensity, 'rest');
});

test('invented numbers are removed, the session stays', () => {
  const r = validateParsedRows({ workouts: [
    { date: '2026-10-20', type: 'run', intensity: 'tempo', duration_min: 60, description: '45 min tempo, 3x8 at threshold' },
    { date: '2026-10-18', type: 'run', intensity: 'long', distance: 18, distance_unit: 'mi', description: 'long run 16 mi easy' },
    { date: '2026-10-22', type: 'run', intensity: 'easy', distance: 10, description: '6 km recovery' },
    { date: '2026-10-22', type: 'run', intensity: 'easy', duration_min: 30, description: 'an easy 30 min jog' },
  ] }, PLAN, TODAY);
  assert.equal(r.rejected.length, 0);
  assert.equal(r.rows.length, 4);
  for (const row of r.rows) {
    assert.equal(row.duration_min, null);
    assert.equal(row.distance_km, null);
  }
  assert.equal(r.rows.find((x) => x.date === '2026-10-22' && x.description === '')?.intensity, 'easy', 'reworded day kept, words dropped');
  assert.deepEqual(r.adjusted.map((x) => x.reason), [
    'duration 60 min is not written for this session',
    'distance 18 mi is not written for this session',
    'distance 10 (no unit) is not written for this session',
    'description is not in the text; kept the day without numbers',
    'duration 30 min is not written for this session',
  ]);
});

test('numbers are checked against the session, not the whole paste (review findings)', () => {
  const text = 'Week 1\nTue: easy run 10 km\nThu: tempo';
  const r = validateParsedRows([
    { date: '2026-10-20', type: 'run', intensity: 'easy', duration_min: 60, distance: 10, distance_unit: 'mi', description: 'easy run 10 km' },
    { date: '2026-10-22', type: 'run', intensity: 'tempo', duration_min: 10, description: 'tempo' },
  ], text, TODAY);
  assert.deepEqual(r.rows.map((x) => [x.duration_min, x.distance_km]), [[null, null], [null, null]]);
});

test('common plan formats are read (re-review findings)', () => {
  const lines = [
    ['45-min tempo', { duration_min: 45 }, 45, null],
    ['10-mile long run', { distance: 10, distance_unit: 'mi' }, null, 16.09],
    ['10 miler', { distance: 10, distance_unit: 'mi' }, null, 16.09],
    ['6M easy', { distance: 6, distance_unit: 'mi' }, null, 9.66],
    ['1:15 long run', { duration_min: 75 }, 75, null],
    ['1h30 long ride', { duration_min: 90 }, 90, null],
    ['1 hr 15 min long run', { duration_min: 75 }, 75, null],
    ['60’ easy', { duration_min: 60 }, 60, null],
    ['8x400m', { distance: 400, distance_unit: 'mi' }, null, null],
    ['5k parkrun', { distance: 5, distance_unit: 'km' }, null, 5],
    ['tempo at 4:30/km', { duration_min: 270 }, null, null],
  ] as const;
  const text = lines.map(([l]) => l).join('\n');
  const rows = lines.map(([l, extra], i) => ({ date: `2026-10-${18 + i}`, type: 'run', intensity: null, description: l, ...extra }));
  const r = validateParsedRows(rows, text, TODAY);
  assert.equal(r.rows.length, lines.length);
  r.rows.forEach((row, i) => {
    assert.equal(row.duration_min, lines[i][2], `${lines[i][0]} duration`);
    assert.equal(row.distance_km, lines[i][3], `${lines[i][0]} distance`);
  });
});

test('bad dates, past dates, far dates, unknown enums and duplicates are rejected', () => {
  const base = { type: 'run', intensity: 'easy', description: 'rest' };
  const r = validateParsedRows([
    { ...base, date: '2026-02-30' },
    { ...base, date: '20 Oct' },
    { ...base, date: '2026-10-10' },
    { ...base, date: '2027-06-01' },
    { ...base, date: '2026-10-19', type: 'yoga' },
    { ...base, date: '2026-10-19', intensity: 'sweet-spot' },
    { ...base, date: '2026-10-19' },
    { ...base, date: '2026-10-19' },
    'nope',
  ], PLAN, TODAY);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rejected.map((x) => x.reason), [
    'no valid date', 'no valid date', 'date is in the past', 'date is more than 182 days out',
    'unknown type "yoga"', 'unknown intensity "sweet-spot"', 'duplicate session', 'not an object',
  ]);
});

test('yesterday is still accepted (time zones), and rows come back in date order', () => {
  const r = validateParsedRows([
    { date: '2026-10-20', type: 'run', intensity: 'easy', description: 'tempo' },
    { date: '2026-10-16', type: 'run', intensity: 'easy', description: 'rest' },
  ], PLAN, TODAY);
  assert.deepEqual(r.rows.map((x) => x.date), ['2026-10-16', '2026-10-20']);
});

test('the parse prompt forbids planning and gives TODAY', () => {
  const p = buildPlanParsePrompt(PLAN, TODAY);
  assert.match(p.system, /do not plan, suggest, or fill gaps/);
  assert.match(p.system, /Never compute, convert, or estimate/);
  assert.match(p.user, /^TODAY: 2026-10-17/);
});

test('parsePlanText handles fenced JSON, empty text, and unreadable output', async () => {
  const fenced = async () => '```json\n' + JSON.stringify(GOOD) + '\n```';
  assert.equal((await parsePlanText(PLAN, TODAY, fenced)).rows.length, 5);
  await assert.rejects(parsePlanText('   ', TODAY, fenced), PlanParseError);
  await assert.rejects(parsePlanText(PLAN, TODAY, async () => 'Sure! Here is your plan'), /Could not read the plan/);
  await assert.rejects(parsePlanText('x'.repeat(9000), TODAY, fenced), /longer than/);
});

test('openAiPlanLlm asks gpt-4o-mini for JSON at temperature 0', async () => {
  let body: any;
  const f = (async (_u: string, init: any) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"workouts":[]}' } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await openAiPlanLlm('k', f)('s', 'u'), '{"workouts":[]}');
  assert.equal(body.model, 'gpt-4o-mini');
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('toScheduledWorkout gives the voice matcher its shape', () => {
  assert.deepEqual(
    toScheduledWorkout({ planned_intensity: 'tempo', planned_description: '45 min tempo', planned_distance_km: '8.00' }),
    { planned_intensity: 'tempo', planned_description: '45 min tempo', planned_distance_km: 8 }
  );
});

// ---- storage on PGlite ----

let db: PGlite;
const here = dirname(fileURLToPath(import.meta.url));
before(async () => {
  db = new PGlite({ extensions: { vector } });
  const dir = join(here, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
});
after(async () => { await db.close(); });

test('saving a plan stores its rows and reads them back by date range', async () => {
  const store = sqlPlanStore(db);
  const { rows } = validateParsedRows(GOOD, PLAN, TODAY);
  const { planId } = await store.saveManualPlan('111', PLAN, rows);
  assert.ok(planId);
  const week = await store.workoutsBetween('111', '2026-10-17', '2026-10-23');
  assert.deepEqual(week.map((w) => [w.scheduled_date, w.planned_intensity]), [
    ['2026-10-18', 'long'], ['2026-10-20', 'tempo'], ['2026-10-21', 'rest'], ['2026-10-22', 'recovery'],
  ]);
  assert.equal(week[0].planned_distance_km, 25.75);
  assert.equal(week[0].workout_structure_json, null, 'a pasted plan has no steps for the Watch');
  assert.deepEqual(await store.workoutsBetween('222', '2026-10-17', '2026-10-23'), [], 'other athletes see nothing');
});

test('a new paste replaces the active plan without deleting the old rows', async () => {
  const store = sqlPlanStore(db);
  const { rows } = validateParsedRows([{ date: '2026-10-20', type: 'run', intensity: 'easy', description: 'easy 30' }], 'Tue easy 30', TODAY);
  assert.equal(rows.length, 1);
  await store.saveManualPlan('111', 'Tue easy 30', rows);
  const week = await store.workoutsBetween('111', '2026-10-17', '2026-10-23');
  assert.deepEqual(week.map((w) => w.planned_description), ['easy 30']);
  const all = await db.query<{ n: number }>(`select count(*)::int as n from scheduled_workouts where athlete_id = '111'`);
  assert.equal(all.rows[0].n, 6);
  const statuses = await db.query<{ current_status: string }>(
    `select current_status from training_plans where athlete_id = '111' order by created_at`
  );
  assert.deepEqual(statuses.rows.map((r) => r.current_status), ['replaced', 'active']);
});

test('the schema rejects an unknown intensity even if code let it through', async () => {
  await assert.rejects(
    db.query(`insert into scheduled_workouts (athlete_id, scheduled_date, planned_type, planned_intensity, source)
              values ('1', '2026-10-20', 'run', 'sweet-spot', 'manual')`),
    /check constraint/i
  );
});

test('supabasePlanStore filters on the active plan and numbers come back as numbers', async () => {
  const calls: any[] = [];
  const q: any = new Proxy({}, {
    get: (_t, k: string) => {
      if (k === 'then') return (res: any) => res({ data: [{ id: 'w', scheduled_date: '2026-10-20', planned_distance_km: '8.00', training_plans: { current_status: 'active' } }], error: null });
      return (...a: any[]) => { calls.push([k, ...a]); return q; };
    },
  });
  const store = supabasePlanStore({ from: (t: string) => { calls.push(['from', t]); return q; }, rpc: () => q });
  const out = await store.workoutsBetween('111', '2026-10-17', '2026-10-30');
  assert.deepEqual(out, [{ id: 'w', scheduled_date: '2026-10-20', planned_distance_km: 8 }]);
  assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'training_plans.current_status' && c[2] === 'active'));
});

test('a failed replace changes nothing (one transaction)', async () => {
  const store = sqlPlanStore(db);
  const bad = [{ date: '2026-10-20', type: 'yoga', intensity: null, duration_min: null, distance_km: null, description: 'x' }] as any;
  await assert.rejects(store.saveManualPlan('111', 'bad', bad), /check constraint/i);
  const week = await store.workoutsBetween('111', '2026-10-17', '2026-10-23');
  assert.deepEqual(week.map((w) => w.planned_description), ['easy 30'], 'the active plan is untouched');
});

test('only one active manual plan per athlete', async () => {
  await assert.rejects(
    db.query(`insert into training_plans (athlete_id, source, external_source, start_date, end_date)
              values ('111', 'external', 'manual', '2026-10-20', '2026-10-21')`),
    /duplicate key|unique/i
  );
});

test('marking a session done or missed: only past or today, only the active plan, never moved (CLAUDE.md §6.2)', async () => {
  const store = sqlPlanStore(db);
  const { rows } = validateParsedRows([
    { date: '2026-10-20', type: 'run', intensity: 'tempo', description: 'tempo 40' },
    { date: '2026-10-24', type: 'run', intensity: 'long', description: 'long 90' },
  ], 'Tue tempo 40\nSat long 90', '2026-10-19');
  await store.saveManualPlan('mk1', 'x', rows);
  const week = await store.workoutsBetween('mk1', '2026-10-19', '2026-10-25');
  const [tue, sat] = week;
  assert.equal(tue.athlete_completed, null);
  assert.equal(await store.markCompleted('mk1', tue.id, false, '2026-10-22'), true);
  assert.equal(await store.markCompleted('mk1', sat.id, true, '2026-10-22'), false, 'still ahead');
  assert.equal(await store.markCompleted('other', tue.id, true, '2026-10-22'), false, "not another athlete's");
  const after = await store.workoutsBetween('mk1', '2026-10-19', '2026-10-25');
  assert.equal(after[0].athlete_completed, false);
  assert.equal(after[0].scheduled_date, '2026-10-20', 'a missed session stays where it was');
  // A replaced plan's sessions can no longer be marked.
  await store.saveManualPlan('mk1', 'y', rows.slice(0, 1));
  assert.equal(await store.markCompleted('mk1', tue.id, true, '2026-10-22'), false);
});
