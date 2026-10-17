import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todaysWorkout, planDriver, planForRead } from '../src/plan-read';
import { knowledgeForRead } from '../src/knowledge-retrieval';
import { validateVoice } from '../src/validator';
import type { StoredWorkout } from '../src/plan-store';

const w = (date: string, intensity: string | null, over: Partial<StoredWorkout> = {}): StoredWorkout => ({
  id: `${date}-${intensity}`, scheduled_date: date, planned_type: 'run', planned_intensity: intensity,
  planned_duration_min: null, planned_distance_km: null, planned_description: null, ...over,
});
const TODAY = '2026-10-20';

test('todaysWorkout picks the hardest session of the day, ignoring other days', () => {
  const rows = [w(TODAY, 'easy'), w(TODAY, 'threshold'), w('2026-10-21', 'long')];
  assert.equal(todaysWorkout(rows, TODAY)?.planned_intensity, 'threshold');
  assert.equal(todaysWorkout(rows, '2026-10-22'), null);
});

test('planDriver carries only stored values', () => {
  assert.deepEqual(planDriver(w(TODAY, 'tempo', { planned_duration_min: 45 })), { metric: 'Plan today', value: 'tempo, 45 min' });
  assert.deepEqual(planDriver(w(TODAY, null, { planned_type: 'ride', planned_distance_km: 25.75 })), { metric: 'Plan today', value: 'ride, 25.75 km' });
});

test('no plan at all adds nothing; a plan with nothing today says so', () => {
  assert.deepEqual(planForRead([], TODAY), { workout: null, scheduled: null, driver: null, promptLine: '' });
  assert.equal(planForRead([w('2026-10-21', 'easy')], TODAY).promptLine, 'PLAN TODAY: nothing scheduled.');
});

test('the plan line lets the voice name the plan, never change it', () => {
  const p = planForRead([w(TODAY, 'tempo', { planned_duration_min: 45, planned_description: '45 min tempo, 3x8 at threshold' })], TODAY);
  assert.match(p.promptLine, /never change, move or add to it/);
  assert.match(p.promptLine, /tempo, 45 min \("45 min tempo, 3x8 at threshold"\)$/);
  assert.deepEqual(p.scheduled, { planned_intensity: 'tempo', planned_description: '45 min tempo, 3x8 at threshold', planned_distance_km: undefined });
});

test('with a plan, the cornerstone pattern can finally fire in the read', async () => {
  const p = planForRead([w(TODAY, 'threshold', { planned_duration_min: 50 })], TODAY);
  const k = await knowledgeForRead({
    posture: 'back-off',
    drivers: { acwr: 1.3, hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 1 },
    completeness: 1,
    scheduled: p.scheduled,
  }, { enabled: false });
  assert.equal(k.mode, 'pattern');
  assert.equal(k.pattern?.id, 'plan-says-hard-body-says-back-off-v1');

  const without = await knowledgeForRead({
    posture: 'back-off',
    drivers: { acwr: 1.3, hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 1 },
    completeness: 1,
  }, { enabled: false });
  assert.equal(without.mode, 'none');
});

test('the plan driver lets the voice cite the planned minutes and nothing else', () => {
  const base = [{ metric: 'Load', value: '412 min', trend: '+8% wk' }];
  const p = planForRead([w(TODAY, 'tempo', { planned_duration_min: 45 })], TODAY);
  const voice = "Load is 412 min, up 8% on the week. Today's 45 min tempo is on the plan and the body reads settled.";
  assert.equal(validateVoice(voice, base).ok, false, '45 is unbacked without the plan driver');
  assert.equal(validateVoice(voice, [...base, p.driver!]).ok, true);
});
