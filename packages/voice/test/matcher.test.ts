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

// ---- doc 06 §6.8 to §6.12 (ported 2026-10-17) ----

test('adaptation follow-up fires the morning after a named adaptation', () => {
  const ctx: MatchContext = {
    posture: 'steady',
    scheduledWorkout: { planned_intensity: 'tempo' },
    drivers: { yesterday_adaptation_triggered: true },
  };
  assert.equal(pick(ctx), 'plan-was-adapted-yesterday-follow-up-v1');
  assert.equal(pick({ ...ctx, recentlyFired: { 'plan-was-adapted-yesterday-follow-up-v1': 2 } }), null);
});

test('missed-yesterday fires for a short miss, not a long gap', () => {
  const ctx: MatchContext = {
    posture: 'steady',
    scheduledWorkout: { planned_intensity: 'easy' },
    drivers: { yesterday_workout_missed: true, consecutive_missed_days: 1 },
  };
  assert.equal(pick(ctx), 'plan-missed-yesterday-no-guilt-v1');
  assert.equal(pick({ ...ctx, drivers: { yesterday_workout_missed: true, consecutive_missed_days: 3 } }), null);
  assert.equal(pick({ ...ctx, posture: 'rest' }), null);
});

test('strong-adherence week fires only in the weekly read', () => {
  const drivers = { workouts_completed_this_week: 6, workouts_planned_this_week: 7 };
  assert.equal(pick({ posture: 'steady', context: 'weekly', drivers }), 'plan-adherence-strong-week-v1');
  assert.equal(pick({ posture: 'steady', context: 'daily', drivers }), null);
  // 5 of 7 is 71%, under the 85% bar.
  assert.equal(
    pick({ posture: 'steady', context: 'weekly', drivers: { workouts_completed_this_week: 5, workouts_planned_this_week: 7 } }),
    null
  );
});

test('coach note dominates the weekly read, Coach tier only', () => {
  const drivers = { coach_note_this_week: 'Good week. Hold the long run at 18.', workouts_completed_this_week: 7, workouts_planned_this_week: 7 };
  assert.equal(pick({ posture: 'back-off', context: 'weekly', tier: 'coach', drivers }), 'coach-note-preserve-verbatim-v1');
  assert.equal(pick({ posture: 'steady', context: 'weekly', tier: 'plan', drivers }), 'plan-adherence-strong-week-v1');
  assert.equal(
    pick({ posture: 'steady', context: 'weekly', tier: 'coach', drivers: { coach_note_this_week: null } }),
    null
  );
});

test('coach message acknowledgement fires in the daily read for Coach tier only', () => {
  const ctx: MatchContext = { posture: 'moderate', tier: 'coach', drivers: { coach_message_last_24h: true } };
  assert.equal(pick(ctx), 'coach-recent-message-acknowledge-v1');
  assert.equal(pick({ ...ctx, tier: 'plan' }), null);
  assert.equal(pick({ ...ctx, posture: 'rest' }), null);
});

test('strong-adherence week never fires on 0 of 0', () => {
  assert.equal(pick({ posture: 'steady', context: 'weekly', drivers: { workouts_completed_this_week: 0, workouts_planned_this_week: 0 } }), null);
});

test('a pattern does not fire when a numeric slot has no driver behind it (night fixes 10-30)', () => {
  // The cornerstone needs {{hrv_pct_change}}: a sleep-led back-off with HRV
  // missing passes the driver_rule but has no number to fill the slot with.
  const ctx: MatchContext = {
    posture: 'back-off',
    scheduledWorkout: { planned_intensity: 'threshold' },
    drivers: { acwr: 1.3, hrv_7d_avg_delta: null, sleep_7d_avg_delta: -5, consecutive_hard_days: 1 },
  };
  assert.notEqual(pick(ctx), 'plan-says-hard-body-says-back-off-v1');
  assert.equal(pick({ ...ctx, drivers: { ...ctx.drivers, hrv_7d_avg_delta: -6 } }), 'plan-says-hard-body-says-back-off-v1');
  // Same with the sleep slot: HRV alone does not back "Sleep {{sleep_hours}}".
  assert.notEqual(pick({ ...ctx, drivers: { acwr: 1.3, hrv_7d_avg_delta: -6, consecutive_hard_days: 1 } }), 'plan-says-hard-body-says-back-off-v1');
});
