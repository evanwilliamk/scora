// Plan write paths review (2026-11-03): each finding proved on PGlite with
// every real migration applied.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from './helpers/pglite-db';
import { importIcs } from '../src/plan-ical';
import { sqlPlanStore } from '../src/plan-store';

let db: PGlite;
before(async () => {
  db = await migratedPglite();
});

const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Plan//EN', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (uid: string, day: string, summary: string) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART;VALUE=DATE:${day}`, `SUMMARY:${summary}`, 'END:VEVENT'].join('\r\n');
// Synthetic feed. Test input, not training content.
const FEED = cal(
  ev('m', '20261019', 'Easy run 40 min'),
  ev('t', '20261020', 'Tempo 45 min'),
  ev('w', '20261021', 'Easy run 30 min'),
  ev('f', '20261023', 'Long run 90 min'),
);

test('a mid-week calendar refresh keeps the earlier sessions of the plan and their marks', async () => {
  const store = sqlPlanStore(db);
  await store.saveIcalPlan('pw1', importIcs(FEED, '2026-10-19', 'UTC').rows);
  const [mon] = await store.workoutsBetween('pw1', '2026-10-19', '2026-10-19');
  const [tue] = await store.workoutsBetween('pw1', '2026-10-20', '2026-10-20');
  assert.equal(await store.markCompleted('pw1', mon.id, true, '2026-10-19'), true);
  assert.equal(await store.markCompleted('pw1', tue.id, false, '2026-10-20'), true);
  assert.equal(await store.markWatchSent('pw1', tue.id), true);

  // Thursday: the importer leaves out sessions before yesterday (Monday, Tuesday).
  const today = '2026-10-22';
  const parsed = importIcs(FEED, today, 'UTC');
  assert.equal(parsed.skipped_past, 2);
  assert.ok(await store.refreshIcalPlan('pw1', parsed.rows, '2026-10-21'));

  const week = await store.workoutsBetween('pw1', '2026-10-19', '2026-10-25');
  assert.deepEqual(
    week.map((w) => [w.scheduled_date, w.athlete_completed ?? null]),
    [['2026-10-19', true], ['2026-10-20', false], ['2026-10-21', null], ['2026-10-23', null]],
    'Monday done and Tuesday missed are still on the active plan',
  );
  const sent = await db.query<{ n: number }>(
    `select count(*)::int as n from scheduled_workouts w join training_plans p on p.id = w.training_plan_id
     where w.athlete_id = 'pw1' and p.current_status = 'active' and w.workout_kit_pushed_at is not null`);
  assert.equal(sent.rows[0].n, 1, 'the Watch send came along');
  const plans = await db.query<{ s: string; n: number }>(
    `select to_char(start_date, 'YYYY-MM-DD') as s, (select count(*)::int from training_plans where athlete_id = 'pw1' and current_status = 'active') as n
     from training_plans where athlete_id = 'pw1' and current_status = 'active'`);
  assert.deepEqual(plans.rows, [{ s: '2026-10-19', n: 1 }], 'one active plan, starting where it did');
});

test('a refresh keeps nothing from before the cut that the feed sends again', async () => {
  const store = sqlPlanStore(db);
  await store.saveIcalPlan('pw2', importIcs(FEED, '2026-10-19', 'UTC').rows);
  // Rows reaching back past the cut (another caller): the old copy is not added twice.
  const rows = importIcs(FEED, '2026-10-19', 'UTC').rows;
  assert.ok(await store.refreshIcalPlan('pw2', rows, '2026-10-21'));
  const week = await store.workoutsBetween('pw2', '2026-10-19', '2026-10-25');
  assert.equal(week.length, 4);
});

test('the Supabase store sends the cut to the three-argument refresh', async () => {
  const { supabasePlanStore } = await import('../src/plan-store');
  const calls: any[] = [];
  const sb = { from: () => { throw new Error('unused'); }, rpc: async (fn: string, args: any) => { calls.push([fn, Object.keys(args)]); return { data: 'p1', error: null }; } };
  const row = { date: '2026-10-23', type: 'run', intensity: 'easy', duration_min: 30, distance_km: null, description: 'Easy run 30 min' } as any;
  await supabasePlanStore(sb).refreshIcalPlan('a1', [row], '2026-10-21');
  await supabasePlanStore(sb).refreshIcalPlan('a1', [row]);
  assert.deepEqual(calls, [
    ['refresh_ical_plan', ['p_athlete_id', 'p_rows', 'p_keep_before']],
    ['refresh_ical_plan', ['p_athlete_id', 'p_rows']],
  ]);
});
