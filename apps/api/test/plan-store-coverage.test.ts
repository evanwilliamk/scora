// Plan-store paths the other suites leave out: the empty-rows guard on every
// save, the calendar refresh that finds nothing to refresh, storage errors,
// and the distance coercion on read. Fakes only; no database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlPlanStore, supabasePlanStore } from '../src/plan-store';
import { fakeSupabase } from './helpers/fake-supabase';

const row = { scheduled_date: '2026-11-04', planned_type: 'run' } as any;

function fakeDb(rows: any[][]) {
  const calls: { sql: string; params?: any[] }[] = [];
  return {
    calls,
    query: async (sql: string, params?: any[]) => { calls.push({ sql, params }); return { rows: rows.shift() ?? [] }; },
  };
}

test('sql store: every save refuses an empty plan before touching the database', async () => {
  const db = fakeDb([]);
  const s = sqlPlanStore(db);
  await assert.rejects(s.saveManualPlan('a1', 'text', []), /No workouts to save/);
  await assert.rejects(s.saveIcalPlan('a1', []), /No workouts to save/);
  await assert.rejects(s.refreshIcalPlan('a1', []), /No workouts to save/);
  assert.equal(db.calls.length, 0);
});

test('sql store: a calendar refresh with no active calendar plan returns null; one with a plan returns its id', async () => {
  const db = fakeDb([[{ id: null }], [{ id: 'p9' }]]);
  const s = sqlPlanStore(db);
  assert.equal(await s.refreshIcalPlan('a1', [row]), null);
  assert.deepEqual(await s.refreshIcalPlan('a1', [row]), { planId: 'p9' });
  assert.match(db.calls[0].sql, /refresh_ical_plan\(\$1, \$2::jsonb\)/);
  assert.deepEqual(db.calls[0].params, ['a1', JSON.stringify([row])]);
});

test('supabase store: every save refuses an empty plan before any rpc', async () => {
  const sb = fakeSupabase();
  const s = supabasePlanStore(sb);
  await assert.rejects(s.saveManualPlan('a1', 'text', []), /No workouts to save/);
  await assert.rejects(s.saveIcalPlan('a1', []), /No workouts to save/);
  await assert.rejects(s.refreshIcalPlan('a1', []), /No workouts to save/);
  assert.equal(sb.queries.length, 0);
});

test('supabase store: saves go through their one-transaction rpcs and return the plan id', async () => {
  const sb = fakeSupabase([{ data: 'p1' }, { data: 'p2' }]);
  const s = supabasePlanStore(sb);
  assert.deepEqual(await s.saveManualPlan('a1', 'Tue: easy 5k', [row]), { planId: 'p1' });
  assert.deepEqual(await s.saveIcalPlan('a1', [row]), { planId: 'p2' });
  assert.deepEqual(sb.queries.map((q) => q.table), ['rpc:replace_manual_plan', 'rpc:replace_external_plan']);
  assert.deepEqual(sb.queries[0].calls[0][1], { p_athlete_id: 'a1', p_raw_text: 'Tue: easy 5k', p_rows: [row] });
  assert.deepEqual(sb.queries[1].calls[0][1], { p_athlete_id: 'a1', p_external_source: 'ical', p_raw_text: null, p_rows: [row] });
});

test('supabase store: calendar refresh returns null with nothing refreshed, the id otherwise', async () => {
  const sb = fakeSupabase([{ data: null }, { data: 'p3' }]);
  const s = supabasePlanStore(sb);
  assert.equal(await s.refreshIcalPlan('a1', [row]), null);
  assert.deepEqual(await s.refreshIcalPlan('a1', [row]), { planId: 'p3' });
  assert.deepEqual(sb.queries[0].calls[0][1], { p_athlete_id: 'a1', p_rows: [row] });
});

test('supabase store: storage errors name what failed', async () => {
  const err = { error: { message: 'denied' } };
  const s = (n = 1) => supabasePlanStore(fakeSupabase(Array.from({ length: n }, () => err)));
  await assert.rejects(s().saveManualPlan('a1', 't', [row]), /^Error: Save plan: denied$/);
  await assert.rejects(s().saveIcalPlan('a1', [row]), /^Error: Save calendar plan: denied$/);
  await assert.rejects(s().refreshIcalPlan('a1', [row]), /^Error: Refresh calendar plan: denied$/);
  await assert.rejects(s().workoutsBetween('a1', '2026-11-01', '2026-11-07'), /^Error: Load workouts: denied$/);
  await assert.rejects(s().markCompleted('a1', 'w1', true, '2026-11-03'), /^Error: Mark workout: denied$/);
  await assert.rejects(s().markWatchSent('a1', 'w1'), /^Error: Record Watch send: denied$/);
});

test('supabase store: workoutsBetween drops the join, coerces numeric distance, keeps null', async () => {
  const sb = fakeSupabase([{ data: [
    { id: 'w1', scheduled_date: '2026-11-04', planned_distance_km: '10.5', training_plans: { current_status: 'active' } },
    { id: 'w2', scheduled_date: '2026-11-05', planned_distance_km: null, training_plans: { current_status: 'active' } },
  ] }]);
  const out = await supabasePlanStore(sb).workoutsBetween('a1', '2026-11-01', '2026-11-07');
  assert.deepEqual(out, [
    { id: 'w1', scheduled_date: '2026-11-04', planned_distance_km: 10.5 },
    { id: 'w2', scheduled_date: '2026-11-05', planned_distance_km: null },
  ]);
  const calls = sb.queries[0].calls;
  assert.deepEqual(calls.filter((c) => c[0] === 'order').map((c) => c[1]), ['scheduled_date', 'created_at', 'id']);
  assert.deepEqual(await supabasePlanStore(fakeSupabase([{ data: null }])).workoutsBetween('a1', 'x', 'y'), []);
});

test('supabase store: a mark that updates no row reports false', async () => {
  assert.equal(await supabasePlanStore(fakeSupabase([{ data: false }])).markCompleted('a1', 'w1', true, '2026-11-03'), false);
  assert.equal(await supabasePlanStore(fakeSupabase([{ data: null }])).markWatchSent('a1', 'w1'), false);
});
