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
