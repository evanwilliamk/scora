import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todaysWorkout, planDriver, planForRead, weeklyPlanDriver } from '../src/plan-read';
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
  assert.match(p.promptLine, /: tempo, 45 min$/);
  assert.doesNotMatch(p.promptLine, /3x8/, 'description numbers are not drivers, so they stay out');
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

test('voice that talks the athlete out of the plan fails validation (review findings)', () => {
  const drivers = [{ metric: 'Load', value: '412 min' }, { metric: 'Plan today', value: 'tempo, 45 min' }];
  for (const v of [
    "Today's tempo can wait, and an easier day fits better.",
    'Load is 412 min, so skip the tempo.',
    'The 45 min tempo could move. Push it to Thursday.',
    'Hold off on the tempo until sleep comes back.',
    'Skipping the tempo would match the back-off read.',
    'Swapping the tempo for an easy run fits the numbers.',
    'Tomorrow looks like a better day for the tempo.',
    'An easy run would suit the body better today.',
    'Postponing the session is worth a thought.',
    'A shorter session, 30 min instead of 45 min, fits.',
    'Dial it back today.',
  ]) {
    assert.equal(validateVoice(v, drivers).bannedHits.includes('plan override'), true, v);
  }
  const ok = "Today's 45 min tempo is on the plan, and load sits at 412 min. Body and plan disagree this morning.";
  assert.equal(validateVoice(ok, drivers).ok, true);
  assert.equal(validateVoice('Your plan has rest today, and load sits at 412 min.', drivers).ok, true);
});

test('without a plan driver, descriptive phrases are not plan overrides', () => {
  const drivers = [{ metric: 'Load', value: '412 min' }];
  for (const v of ['Load has started to ease off after last week, now 412 min.', 'You tend to skip the Friday run; load is 412 min.']) {
    assert.equal(validateVoice(v, drivers).ok, true, v);
  }
});

test('a plan with nothing today says so', () => {
  const p = planForRead([w('2026-10-22', 'easy')], TODAY);
  assert.equal(p.promptLine, 'PLAN TODAY: nothing scheduled.');
});

test('plan override: a true description of an engine change passes; advice still fails (review 4)', () => {
  const drivers = [
    { metric: 'Plan today', value: 'easy run 40 min' },
    { metric: 'Plan change', value: "Tuesday's tempo moved to Wednesday." },
  ];
  for (const ok of [
    'The plan moved the tempo to Wednesday, and your body reads settled.',
  ]) assert.deepEqual(validateVoice(ok, drivers).bannedHits, [], ok);
  const downgrade = [drivers[0], { metric: 'Plan change', value: "Tuesday's tempo is now an endurance run at the same 40 minutes." }];
  assert.deepEqual(validateVoice("Tuesday's tempo is now an endurance run instead.", downgrade).bannedHits, []);
  // The same sentence against a move it does not describe fails.
  assert.ok(validateVoice("Tuesday's tempo is now an endurance run instead.", drivers).bannedHits.includes('plan override'));
  for (const bad of [
    'Move the tempo to Wednesday.',
    'Run the tempo instead.',
    'Easy miles instead of the tempo today.',
    'The plan moved the tempo to Wednesday, and you could skip today too.',
    'The plan moved the tempo to Wednesday. A better day for it would be Friday.',
    // Review of this fix: a shared word is not enough, the clause must match one change.
    'The tempo is now yours to run Saturday instead.',
    'Moved the tempo to Friday, which suits a body that is still settling.',
    'HRV is 52ms. Tuesday: moved the tempo to Friday, easy miles instead.',
    "Today's easy run is the plan, instead of the tempo that moved.",
  ]) assert.ok(validateVoice(bad, drivers).bannedHits.includes('plan override'), bad);
  // Without a recorded change there is nothing to observe.
  assert.ok(validateVoice('The plan moved the tempo to Wednesday.', drivers.slice(0, 1)).bannedHits.includes('plan override'));
  // A change to a different session does not vouch for this one.
  assert.ok(validateVoice('The plan moved the intervals to Sunday.', drivers).bannedHits.includes('plan override'));
});

test('weekly plan driver: run minutes against planned run minutes over the same 7 days', () => {
  const rows = [
    { scheduled_date: '2026-10-15', planned_type: 'run', planned_intensity: 'easy', planned_duration_min: 60 }, // before the window
    { scheduled_date: '2026-10-16', planned_type: 'run', planned_intensity: 'easy', planned_duration_min: 40 },
    { scheduled_date: '2026-10-18', planned_type: 'run', planned_intensity: 'long', planned_duration_min: 100 },
    { scheduled_date: '2026-10-19', planned_type: 'run', planned_intensity: 'rest', planned_duration_min: null },
    { scheduled_date: '2026-10-20', planned_type: 'strength', planned_intensity: null, planned_duration_min: 30 },
    { scheduled_date: '2026-10-21', planned_type: 'run', planned_intensity: 'tempo', planned_duration_min: 50 },
  ];
  const runs = [
    { type: 'Run', start_date_local: '2026-10-16T07:00:00Z', moving_time: 2400 },
    { type: 'Run', start_date_local: '2026-10-18T08:00:00Z', moving_time: 5700 },
    { type: 'Ride', start_date_local: '2026-10-20T08:00:00Z', moving_time: 3600 },
    { type: 'Run', start_date_local: '2026-10-14T08:00:00Z', moving_time: 3000 }, // before the window
  ];
  const d = weeklyPlanDriver(rows, runs, '2026-10-16', '2026-10-22');
  assert.deepEqual(d, { metric: 'Plan this week', value: '135 of 190 planned run min' });
  const v = validateVoice('You ran 135 of the 190 planned run minutes this week, with the long run in place.', [d!]);
  assert.deepEqual([v.bannedHits, v.unbackedNumbers], [[], []]);
  assert.equal(weeklyPlanDriver(rows.slice(3, 5), runs, '2026-10-16', '2026-10-22'), null, 'no planned run minutes: no driver');
});

test('weekly plan driver: a run with no duration means no driver (review 5)', () => {
  const rows = [
    { scheduled_date: '2026-10-16', planned_type: 'run', planned_intensity: 'easy', planned_duration_min: 40 },
    { scheduled_date: '2026-10-18', planned_type: 'run', planned_intensity: 'long', planned_duration_min: null },
  ];
  assert.equal(weeklyPlanDriver(rows, [], '2026-10-16', '2026-10-22'), null);
});
