import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPatterns } from '../src/loader';
import { selectPattern, selectPatterns } from '../src/matcher';
import type { MatchContext } from '../src/types';

const LIB = loadPatterns();
const pick = (ctx: MatchContext) => selectPattern(ctx, LIB)?.id ?? null;

test('cornerstone fires: hard on the plan, body in debt', () => {
  const ctx: MatchContext = {
    posture: 'back-off',
    scheduledWorkout: { planned_intensity: 'threshold' },
    drivers: { acwr: 1.3, hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 1 },
  };
  assert.equal(pick(ctx), 'plan-says-hard-body-says-back-off-v1');
});

test('primed alignment fires when body is ready for a hard session', () => {
  const ctx: MatchContext = {
    posture: 'primed',
    scheduledWorkout: { planned_intensity: 'intervals' },
    drivers: { hrv_7d_avg_delta: 5, consecutive_hard_days: 0, sleep_7d_avg_delta: 0 },
  };
  assert.equal(pick(ctx), 'plan-says-hard-body-says-primed-v1');
});

test('easy-day-but-primed respects the plan', () => {
  const ctx: MatchContext = {
    posture: 'primed',
    scheduledWorkout: { planned_intensity: 'easy' },
    drivers: { hrv_7d_avg_delta: 4, consecutive_hard_days: 0 },
  };
  assert.equal(pick(ctx), 'plan-says-easy-body-says-primed-v1');
});

test('taper alignment uses the arithmetic load rule', () => {
  const ctx: MatchContext = {
    posture: 'taper',
    scheduledWorkout: { planned_intensity: 'easy' },
    drivers: { race_in_next_7d: true, load_7d: 20, load_28d: 100, hrv_7d_avg_delta: 1 },
  };
  assert.equal(pick(ctx), 'taper-week-plan-body-align-v1');
});

test('taper-stubborn (higher priority) wins over align when body is off', () => {
  const ctx: MatchContext = {
    posture: 'taper',
    scheduledWorkout: { planned_intensity: 'easy' },
    drivers: { race_in_next_7d: true, load_7d: 20, load_28d: 100, hrv_7d_avg_delta: -5 },
  };
  // align needs hrv>=0 (fails); stubborn needs hrv<-3 (fires) at priority 97
  assert.equal(pick(ctx), 'taper-week-body-not-coming-around-v1');
});

test('no scheduled workout -> nothing fires (all entries require one)', () => {
  const ctx: MatchContext = {
    posture: 'primed',
    scheduledWorkout: null,
    drivers: { hrv_7d_avg_delta: 5, consecutive_hard_days: 0 },
  };
  assert.equal(pick(ctx), null);
});

test('intensity filter excludes a mismatched workout', () => {
  // body says back-off + hard-debt, but today is an easy day -> cornerstone
  // (which filters to hard/threshold/intervals/tempo) must NOT fire.
  const ctx: MatchContext = {
    posture: 'back-off',
    scheduledWorkout: { planned_intensity: 'easy' },
    drivers: { acwr: 1.3, hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 1 },
  };
  assert.notEqual(pick(ctx), 'plan-says-hard-body-says-back-off-v1');
});

test('min_data_completeness gates a sparse record', () => {
  const ctx: MatchContext = {
    posture: 'back-off',
    scheduledWorkout: { planned_intensity: 'threshold' },
    drivers: { acwr: 1.3, hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 1 },
    dataCompleteness: 0.3, // below the cornerstone's 0.5
  };
  assert.equal(pick(ctx), null);
});

test('exclude_if_recently_fired suppresses a just-fired pattern', () => {
  const ctx: MatchContext = {
    posture: 'back-off',
    scheduledWorkout: { planned_intensity: 'threshold' },
    drivers: { acwr: 1.3, hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 1 },
    recentlyFired: { 'plan-says-hard-body-says-back-off-v1': 1 }, // exclude window is 2
  };
  assert.equal(pick(ctx), null);
});

test('a missing driver in the rule keeps the pattern from firing', () => {
  const ctx: MatchContext = {
    posture: 'back-off',
    scheduledWorkout: { planned_intensity: 'threshold' },
    // acwr absent and consecutive_hard_days below 2 -> first clause false
    drivers: { hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 1 },
  };
  assert.equal(pick(ctx), null);
});

test('selectPatterns returns a priority-ordered list and empty when none fire', () => {
  const firing = selectPatterns(
    {
      posture: 'back-off',
      scheduledWorkout: { planned_intensity: 'threshold' },
      drivers: { acwr: 1.3, hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 1 },
    },
    LIB
  );
  assert.ok(firing.length >= 1);
  assert.equal(firing[0].id, 'plan-says-hard-body-says-back-off-v1');
  for (let i = 1; i < firing.length; i++) {
    assert.ok(firing[i - 1].priority >= firing[i].priority);
  }

  const none = selectPatterns({ posture: 'steady', drivers: {} }, LIB);
  assert.deepEqual(none, []);
});
