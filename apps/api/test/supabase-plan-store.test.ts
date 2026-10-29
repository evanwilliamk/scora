import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabasePlanStore } from '../src/plan-store';
import { fakeSupabase } from './helpers/fake-supabase';

test('markCompleted checks the row is theirs, on an active plan and not ahead, then sets it', async () => {
  const sb = fakeSupabase([{ data: { id: 'w1' } }, { data: [{ id: 'w1' }] }]);
  assert.equal(await supabasePlanStore(sb).markCompleted('a1', 'w1', false, '2026-10-22'), true);
  const [find, update] = sb.queries;
  assert.deepEqual(find.calls.slice(1), [
    ['eq', 'id', 'w1'], ['eq', 'athlete_id', 'a1'], ['lte', 'scheduled_date', '2026-10-22'],
    ['eq', 'training_plans.current_status', 'active'], ['maybeSingle'],
  ]);
  assert.equal((update.calls[0][1] as any).athlete_completed, false);
  const none = fakeSupabase([{ data: null }]);
  assert.equal(await supabasePlanStore(none).markCompleted('a1', 'w1', true, '2026-10-22'), false);
  assert.equal(none.queries.length, 1, 'no update when the session is not found');
});

test('markWatchSent checks the row is theirs and on an active plan, then stamps it', async () => {
  const sb = fakeSupabase([{ data: { id: 'w1', training_plan_id: 'p1' } }, { data: [{ id: 'w1' }] }]);
  assert.equal(await supabasePlanStore(sb).markWatchSent('a1', 'w1'), true);
  const [find, update] = sb.queries;
  assert.deepEqual(find.calls.slice(1), [
    ['eq', 'id', 'w1'], ['eq', 'athlete_id', 'a1'], ['eq', 'training_plans.current_status', 'active'], ['maybeSingle'],
  ]);
  assert.ok(typeof (update.calls[0][1] as any).workout_kit_pushed_at === 'string');
  assert.deepEqual(update.calls.filter((c: any) => c[0] === 'eq').map((c: any) => c.slice(1)), [['id', 'w1'], ['athlete_id', 'a1'], ['training_plan_id', 'p1']]);
  const none = fakeSupabase([{ data: null }]);
  assert.equal(await supabasePlanStore(none).markWatchSent('a1', 'w1'), false);
  assert.equal(none.queries.length, 1);
});
