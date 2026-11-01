import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePosture, POSTURE_THRESHOLDS as T } from '../src/index';
import type { PostureDrivers, UserBaselines } from '../src/index';

// Exact-threshold checks for every rule in constants.ts (doc 07 v1 §8.4).
// Each case sits exactly on a threshold, then one step past it, so a change
// from < to <= (or the reverse) in engine.ts fails here.

const base: PostureDrivers = {
  load_7d: 400,
  load_28d: 1600,
  acwr: 1.0,
  consecutive_hard_days: 1,
  sleep_last_night_score: 78,
  sleep_7d_avg_delta: 0,
  consecutive_low_sleep_nights: 0,
  hrv_7d_avg_delta: 0,
  rhr_7d_avg_delta: 0,
  days_since_long_effort: 6,
  race_in_next_7d: false,
};
const baselines: UserBaselines = { sleep_score_p25: 70, sleep_score_p75: 85 };
const posture = (over: PostureDrivers, b: UserBaselines = baselines) =>
  computePosture({ ...base, ...over }, b).posture;

test('thresholds are the documented values', () => {
  assert.equal(T.taper.max_days_since_long_effort, 5);
  assert.equal(T.taper.load_7d_vs_weekly_chronic, 0.8);
  assert.equal(T.rest.min_consecutive_hard_days, 3);
  assert.equal(T.rest.hrv_7d_avg_delta_below, -10);
  assert.equal(T.rest.rhr_7d_avg_delta_above, 4);
  assert.equal(T.backOff.acwr_above, 1.5);
  assert.equal(T.backOff.min_consecutive_hard_days, 2);
  assert.equal(T.backOff.sleep_7d_avg_delta_below, -5);
  assert.equal(T.backOff.min_consecutive_low_sleep_nights, 2);
  assert.equal(T.moderate.acwr_above, 1.2);
  assert.equal(T.moderate.sleep_7d_avg_delta_below, -3);
  assert.equal(T.moderate.rhr_7d_avg_delta_above, 2);
  assert.equal(T.primed.acwr_below, 0.8);
  assert.equal(T.primed.max_consecutive_hard_days, 0);
  assert.equal(T.primed.hrv_7d_avg_delta_min, 0);
});

const race = { race_in_next_7d: true, days_since_long_effort: 3, load_7d: 330 };

test('taper: days_since_long_effort 4 fires, 5 does not (strict <)', () => {
  assert.equal(posture({ ...race, days_since_long_effort: 4 }), 'taper');
  assert.equal(posture({ ...race, days_since_long_effort: 5 }), 'steady');
  assert.equal(posture({ ...race, days_since_long_effort: 0 }), 'taper');
});

test('taper: load_7d just above 0.8x weekly chronic fires, exactly 0.8x does not', () => {
  assert.equal(posture({ ...race, load_7d: 320.01 }), 'taper');
  assert.equal(posture({ ...race, load_7d: 320 }), 'steady');
});

test('taper: missing load_28d, load_7d or race flag means no taper', () => {
  assert.equal(posture({ ...race, load_28d: null }), 'steady');
  assert.equal(posture({ ...race, load_7d: null }), 'steady');
  assert.equal(posture({ ...race, race_in_next_7d: null }), 'steady');
  assert.equal(posture({ ...race, days_since_long_effort: null }), 'steady');
});

test('rest: last night exactly at p25 does not fire the hard-days branch (strict <)', () => {
  assert.equal(posture({ consecutive_hard_days: 3, sleep_last_night_score: 69.9 }), 'rest');
  // 3 hard days with sleep exactly at p25 falls through to back-off (>= 2 hard days)
  assert.equal(posture({ consecutive_hard_days: 3, sleep_last_night_score: 70 }), 'back-off');
  // 2 hard days with bad sleep is back-off, not rest (needs >= 3)
  assert.equal(posture({ consecutive_hard_days: 2, sleep_last_night_score: 60 }), 'back-off');
});

test('rest: HRV -10.01 with RHR 4.01 fires; either exactly on the line does not', () => {
  assert.equal(posture({ hrv_7d_avg_delta: -10.01, rhr_7d_avg_delta: 4.01 }), 'rest');
  assert.equal(posture({ hrv_7d_avg_delta: -10, rhr_7d_avg_delta: 4.01 }), 'moderate');
  assert.equal(posture({ hrv_7d_avg_delta: -10.01, rhr_7d_avg_delta: 4 }), 'moderate');
  // HRV crash with no RHR at all cannot fire rest
  assert.equal(posture({ hrv_7d_avg_delta: -20, rhr_7d_avg_delta: null }), 'steady');
});

test('back-off: acwr 1.5 is moderate, 1.501 is back-off', () => {
  assert.equal(posture({ acwr: 1.501 }), 'back-off');
  assert.equal(posture({ acwr: 1.5 }), 'moderate');
});

test('back-off: sleep delta exactly -5 with a 2-night streak is only moderate (strict <)', () => {
  assert.equal(posture({ sleep_7d_avg_delta: -5.01, consecutive_low_sleep_nights: 2 }), 'back-off');
  assert.equal(posture({ sleep_7d_avg_delta: -5, consecutive_low_sleep_nights: 2 }), 'moderate');
  assert.equal(posture({ sleep_7d_avg_delta: -5.01, consecutive_low_sleep_nights: null }), 'moderate');
});

test('moderate: just past each threshold fires', () => {
  assert.equal(posture({ acwr: 1.201 }), 'moderate');
  assert.equal(posture({ sleep_7d_avg_delta: -3.01 }), 'moderate');
  assert.equal(posture({ rhr_7d_avg_delta: 2.01 }), 'moderate');
});

const primed = { acwr: 0.7, sleep_last_night_score: 90, consecutive_hard_days: 0, hrv_7d_avg_delta: 1 };

test('primed: HRV delta exactly 0 counts as holding (>=)', () => {
  assert.equal(posture({ ...primed, hrv_7d_avg_delta: 0 }), 'primed');
  assert.equal(posture({ ...primed, hrv_7d_avg_delta: -0.01 }), 'steady');
});

test('primed: acwr 0.799 fires, sleep 85.01 over p75 fires', () => {
  assert.equal(posture({ ...primed, acwr: 0.799 }), 'primed');
  assert.equal(posture({ ...primed, sleep_last_night_score: 85.01 }), 'primed');
});

test('primed needs a p75 baseline and a known hard-day count', () => {
  assert.equal(posture(primed, { sleep_score_p25: 70 }), 'steady');
  assert.equal(posture({ ...primed, consecutive_hard_days: null }), 'steady');
});

test('a threshold clause records the threshold it was compared to', () => {
  const r = computePosture({ ...base, ...race, load_7d: 320 }, baselines);
  const taper = r.reasoning.find((t) => t.rule === 'taper')!;
  const load = taper.clauses.find((c) => c.driver === 'load_7d')!;
  assert.deepEqual(load, { driver: 'load_7d', value: 320, op: '>', threshold: 320, met: false });
  const noChronic = computePosture({ ...base, ...race, load_28d: null }, baselines);
  const c = noChronic.reasoning[0].clauses.find((x) => x.driver === 'load_7d')!;
  assert.equal(c.threshold, null);
  assert.equal(c.met, false);
});
