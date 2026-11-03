// supabaseAdaptStore paths supabase-adapt.test.ts leaves out: dismissing a
// move takes its paired "gives way" change with it, empty results, and the
// error each call names. Fake supabase-js builder only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabaseAdaptStore, planChangeContext } from '../src/plan-adapt';
import { fakeSupabase } from './helpers/fake-supabase';

test('dismissing a move also dismisses the skip it paired with on the new date', async () => {
  const sb = fakeSupabase([
    { data: [{ id: 'm1', training_plan_id: 'p1', adaptation_type: 'moved', new_date: '2026-11-05' }] },
    { data: null },
  ]);
  assert.equal(await supabaseAdaptStore(sb).dismiss('a1', 'm1'), true);
  assert.equal(sb.queries.length, 2);
  const paired = sb.queries[1];
  assert.equal(paired.table, 'plan_adaptations');
  assert.equal(paired.calls[0][0], 'update');
  assert.deepEqual(paired.calls.slice(1), [
    ['eq', 'training_plan_id', 'p1'], ['eq', 'athlete_id', 'a1'], ['eq', 'adaptation_type', 'skipped'],
    ['eq', 'original_date', '2026-11-05'], ['is', 'dismissed_at', null],
  ]);
  assert.equal((paired.calls[0][1] as any).dismissed_at, (sb.queries[0].calls[0][1] as any).dismissed_at, 'one timestamp for both');
});

test('dismissing a downgrade, or a move with no new date, touches only that change', async () => {
  for (const m of [{ adaptation_type: 'downgraded', new_date: null }, { adaptation_type: 'moved', new_date: null }]) {
    const sb = fakeSupabase([{ data: [{ id: 'x', training_plan_id: 'p1', ...m }] }]);
    assert.equal(await supabaseAdaptStore(sb).dismiss('a1', 'x'), true);
    assert.equal(sb.queries.length, 1);
  }
});

test('a failed paired dismissal is reported', async () => {
  const sb = fakeSupabase([
    { data: [{ id: 'm1', training_plan_id: 'p1', adaptation_type: 'moved', new_date: '2026-11-05' }] },
    { error: { message: 'locked' } },
  ]);
  await assert.rejects(supabaseAdaptStore(sb).dismiss('a1', 'm1'), /^Error: Dismiss paired change: locked$/);
});

test('empty results: no coach plan, no SCORA plan, no rows, no adaptation id', async () => {
  const s = supabaseAdaptStore(fakeSupabase([{ data: null }, { data: [] }, { data: null }, { data: null }, { data: null }, { data: null }, { data: null }]));
  assert.equal(await s.hasActiveCoachPlan('a1'), false);
  assert.equal(await s.activeScoraPlan('a1'), null);
  assert.deepEqual(await s.workoutsBetween('p1', '2026-11-01', '2026-11-07'), []);
  assert.equal(await s.apply({} as any), null);
  assert.deepEqual(await s.recent('a1', 5), []);
  assert.deepEqual(await s.history('a1', 5), []);
  assert.deepEqual(await s.forDay('a1', '2026-11-03'), []);
});

test('every read and write names what failed', async () => {
  const s = () => supabaseAdaptStore(fakeSupabase([{ error: { message: 'denied' } }]));
  await assert.rejects(s().hasActiveCoachPlan('a1'), /^Error: Load coach plan: denied$/);
  await assert.rejects(s().activeScoraPlan('a1'), /^Error: Load plan: denied$/);
  await assert.rejects(s().workoutsBetween('p1', 'a', 'b'), /^Error: Load workouts: denied$/);
  await assert.rejects(s().apply({} as any), /^Error: Apply adaptation: denied$/);
  await assert.rejects(s().recent('a1', 5), /^Error: Load adaptations: denied$/);
  await assert.rejects(s().history('a1', 5), /^Error: Load adaptation history: denied$/);
  await assert.rejects(s().forDay('a1', '2026-11-03'), /^Error: Load plan changes: denied$/);
  await assert.rejects(s().dismiss('a1', 'x'), /^Error: Dismiss adaptation: denied$/);
});

test('history flags dismissed rows and normalises timestamps to ISO UTC', async () => {
  const sb = fakeSupabase([{ data: [
    { id: 'h1', triggered_at: '2026-11-02 06:00:00+00', dismissed_at: '2026-11-02T07:00:00Z', training_plans: {} },
    { id: 'h2', triggered_at: '2026-11-01T06:00:00+01:00', dismissed_at: null, training_plans: {} },
  ] }]);
  const rows = await supabaseAdaptStore(sb).history('a1', 10);
  assert.deepEqual(rows.map((r: any) => [r.id, r.triggered_at, r.dismissed, 'dismissed_at' in r, 'training_plans' in r]), [
    ['h1', '2026-11-02T06:00:00.000Z', true, false, false],
    ['h2', '2026-11-01T05:00:00.000Z', false, false, false],
  ]);
});

test('planChangeContext: a reason with no sentence end is kept whole', () => {
  const ctx = planChangeContext([{ reason_text: '  Tempo moved to Wednesday  ' } as any]);
  assert.deepEqual(ctx.drivers, [{ metric: 'Plan change', value: 'Tempo moved to Wednesday' }]);
  assert.match(ctx.promptLine, /never argue with it.*: Tempo moved to Wednesday$/);
});
