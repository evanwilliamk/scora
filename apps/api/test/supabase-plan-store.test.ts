import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabasePlanStore } from '../src/plan-store';
import { fakeSupabase } from './helpers/fake-supabase';

test('markCompleted is one locked rpc: theirs, on an active plan, not ahead (review 2026-11-03)', async () => {
  const sb = fakeSupabase([{ data: true }]);
  assert.equal(await supabasePlanStore(sb).markCompleted('a1', 'w1', false, '2026-10-22'), true);
  assert.deepEqual(sb.queries.map((q) => q.table), ['rpc:mark_scheduled_workout']);
  assert.deepEqual(sb.queries[0].calls[0][1], { p_athlete_id: 'a1', p_workout_id: 'w1', p_completed: false, p_today: '2026-10-22' });
  assert.equal(await supabasePlanStore(fakeSupabase([{ data: false }])).markCompleted('a1', 'w1', true, '2026-10-22'), false);
});

test('markWatchSent is one locked rpc: theirs and on an active plan (review 2026-11-03)', async () => {
  const sb = fakeSupabase([{ data: true }]);
  assert.equal(await supabasePlanStore(sb).markWatchSent('a1', 'w1'), true);
  assert.deepEqual(sb.queries.map((q) => q.table), ['rpc:mark_workout_watch_sent']);
  assert.deepEqual(sb.queries[0].calls[0][1], { p_athlete_id: 'a1', p_workout_id: 'w1' });
  assert.equal(await supabasePlanStore(fakeSupabase([{ data: false }])).markWatchSent('a1', 'w1'), false);
});

test('withDescriptions: SCORA sessions are said from their steps; pasted text is kept', async () => {
  const { withDescriptions } = await import('../src/plan-store');
  const { describeWorkout } = await import('../../../packages/plan-engine/src/index');
  const base = { id: 'w', scheduled_date: '2026-10-28', planned_type: 'run', planned_duration_min: 45, planned_distance_km: null };
  const rows = withDescriptions([
    { ...base, planned_intensity: 'tempo', planned_description: null, workout_structure_json: [
      { type: 'warmup', duration_min: 10, intensity: 'easy' }, { type: 'steady', duration_min: 25, intensity: 'tempo' }, { type: 'cooldown', duration_min: 10, intensity: 'easy' }] },
    { ...base, planned_intensity: 'easy', planned_description: 'Tue: 45 min easy with the club', workout_structure_json: null },
    { ...base, planned_intensity: 'easy', planned_description: null, workout_structure_json: null },
  ] as any, describeWorkout);
  assert.deepEqual(rows.map((r) => r.planned_description), [
    '45-minute tempo. 10 minutes easy, 25 minutes at tempo, 10 minutes easy.',
    'Tue: 45 min easy with the club',
    null,
  ]);
});
