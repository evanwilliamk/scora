// supabaseAdaptStore is what production runs; the SQL twin is tested on
// PGlite in plan-adapt.test.ts. These pin the filters it sends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabaseAdaptStore } from '../src/plan-adapt';
import { fakeSupabase } from './helpers/fake-supabase';

test('a coach plan is looked up by source and active status only', async () => {
  const sb = fakeSupabase([{ data: [{ id: 'p' }] }]);
  assert.equal(await supabaseAdaptStore(sb).hasActiveCoachPlan('a1'), true);
  assert.deepEqual(sb.queries[0].calls.slice(1), [
    ['eq', 'athlete_id', 'a1'], ['eq', 'source', 'coach'], ['eq', 'current_status', 'active'], ['limit', 1],
  ]);
});

test("today's plan changes: active plan, not dismissed, either side of a move on that day", async () => {
  const sb = fakeSupabase([{ data: [{ id: 'x', reason_text: 'Moved.', triggered_at: '2026-10-22 06:00:00+00', training_plans: { current_status: 'active' } }] }]);
  const rows = await supabaseAdaptStore(sb).forDay('a1', '2026-10-22');
  const calls = sb.queries[0].calls;
  assert.equal(sb.queries[0].table, 'plan_adaptations');
  assert.deepEqual(calls[0], ['select', 'id, adaptation_type, original_date, new_date, reason_code, reason_text, triggered_at, training_plans!inner(current_status)']);
  assert.deepEqual(calls[1], ['eq', 'athlete_id', 'a1']);
  assert.ok(calls.some((c) => c[0] === 'is' && c[1] === 'dismissed_at' && c[2] === null));
  assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'training_plans.current_status' && c[2] === 'active'));
  assert.ok(calls.some((c) => c[0] === 'or' && c[1] === 'original_date.eq.2026-10-22,new_date.eq.2026-10-22'));
  assert.deepEqual(rows, [{ id: 'x', reason_text: 'Moved.', triggered_at: '2026-10-22T06:00:00.000Z' }], 'join dropped, time in ISO UTC');
});

test('an adaptation is written in one RPC call, and its id comes back', async () => {
  const sb = fakeSupabase([{ data: 'ad-1' }]);
  const write = { athlete_id: 'a1', reason_code: 'posture_rest_hard_no_window' } as any;
  assert.equal(await supabaseAdaptStore(sb).apply(write), 'ad-1');
  assert.deepEqual(sb.queries[0], { table: 'rpc:apply_plan_adaptation', calls: [['rpc', { p: write }]] });
  const failing = fakeSupabase([{ error: { message: 'check constraint' } }]);
  await assert.rejects(supabaseAdaptStore(failing).apply(write), /Apply adaptation: check constraint/);
});

test('recent changes: newest first with a stable tie-break, capped', async () => {
  const sb = fakeSupabase([{ data: [] }]);
  await supabaseAdaptStore(sb).recent('a1', 3);
  const calls = sb.queries[0].calls;
  assert.deepEqual(calls.filter((c) => c[0] === 'order' || c[0] === 'limit'), [
    ['order', 'triggered_at', { ascending: false }], ['order', 'id'], ['limit', 3],
  ]);
});

test('history: active plan, dismissed included and flagged, newest first', async () => {
  const sb = fakeSupabase([{ data: [{ id: 'x', triggered_at: '2026-10-28T06:00:00+00:00', dismissed_at: '2026-10-28T07:00:00+00:00', training_plans: { current_status: 'active' } }] }]);
  const [row] = await supabaseAdaptStore(sb).history('a1', 200);
  assert.deepEqual(row, { id: 'x', triggered_at: '2026-10-28T06:00:00.000Z', dismissed: true });
  const calls = sb.queries[0].calls;
  assert.equal(calls.some((c) => c[0] === 'is'), false, 'no dismissed filter');
  assert.deepEqual(calls.filter((c) => c[0] === 'eq').map((c) => c.slice(1)), [['athlete_id', 'a1'], ['training_plans.current_status', 'active']]);
});

test('the fake rejects builder methods supabase-js does not have', () => {
  const sb = fakeSupabase();
  assert.throws(() => (sb.from('x') as any).eqq('a', 1), /no builder method "eqq"/);
});

test('dismiss filters on the change, its athlete and not-yet-dismissed', async () => {
  const sb = fakeSupabase([{ data: [{ id: 'x' }] }]);
  assert.equal(await supabaseAdaptStore(sb).dismiss('a1', 'x'), true);
  const calls = sb.queries[0].calls;
  assert.equal(calls[0][0], 'update');
  assert.deepEqual(calls.slice(1, 4), [['eq', 'id', 'x'], ['eq', 'athlete_id', 'a1'], ['is', 'dismissed_at', null]]);
  assert.equal(await supabaseAdaptStore(fakeSupabase([{ data: [] }])).dismiss('a1', 'x'), false);
});
