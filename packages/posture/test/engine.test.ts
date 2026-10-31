import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePosture, POSTURE_ENGINE_VERSION } from '../src/index';
import type { PostureDrivers, UserBaselines } from '../src/index';

// A settled athlete: nothing fires, reads steady.
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

test('settled drivers read steady via the default', () => {
  const r = computePosture(base, baselines);
  assert.equal(r.posture, 'steady');
  assert.equal(r.rule, 'default');
  assert.equal(r.engine_version, POSTURE_ENGINE_VERSION);
});

test('no data at all reads steady (no data, no claim)', () => {
  assert.equal(computePosture({}).posture, 'steady');
});

test('taper: race week, recent long effort, load still above 0.8x weekly chronic', () => {
  assert.equal(posture({ race_in_next_7d: true, days_since_long_effort: 3, load_7d: 330 }), 'taper');
  // load_7d must be strictly above (1600 / 4) * 0.8 = 320
  assert.equal(posture({ race_in_next_7d: true, days_since_long_effort: 3, load_7d: 320 }), 'steady');
  assert.equal(posture({ race_in_next_7d: true, days_since_long_effort: 5 }), 'steady');
  assert.equal(posture({ race_in_next_7d: false, days_since_long_effort: 3 }), 'steady');
});

test('rest: 3+ hard days with last night below the user p25', () => {
  assert.equal(posture({ consecutive_hard_days: 3, sleep_last_night_score: 65 }), 'rest');
  // 3 hard days alone is back-off, not rest
  assert.equal(posture({ consecutive_hard_days: 3, sleep_last_night_score: 75 }), 'back-off');
});

test('rest: HRV crash with elevated resting HR', () => {
  assert.equal(posture({ hrv_7d_avg_delta: -11, rhr_7d_avg_delta: 5 }), 'rest');
  // boundaries are strict: -10 / 4 do not fire; rhr 4 still trips moderate (> 2)
  assert.equal(posture({ hrv_7d_avg_delta: -10, rhr_7d_avg_delta: 5 }), 'moderate');
  assert.equal(posture({ hrv_7d_avg_delta: -11, rhr_7d_avg_delta: 4 }), 'moderate');
});

test('rest needs a baseline: without p25 the sleep clause cannot fire', () => {
  assert.equal(posture({ consecutive_hard_days: 3, sleep_last_night_score: 40 }, {}), 'back-off');
});

test('back-off: each of the three triggers', () => {
  assert.equal(posture({ acwr: 1.51 }), 'back-off');
  assert.equal(posture({ consecutive_hard_days: 2 }), 'back-off');
  assert.equal(posture({ sleep_7d_avg_delta: -6, consecutive_low_sleep_nights: 2 }), 'back-off');
  // poor sleep average alone, without the streak, is only moderate
  assert.equal(posture({ sleep_7d_avg_delta: -6, consecutive_low_sleep_nights: 1 }), 'moderate');
  assert.equal(posture({ acwr: 1.5 }), 'moderate');
});

test('moderate: each of the three triggers, strict boundaries', () => {
  assert.equal(posture({ acwr: 1.21 }), 'moderate');
  assert.equal(posture({ sleep_7d_avg_delta: -3.5 }), 'moderate');
  assert.equal(posture({ rhr_7d_avg_delta: 2.5 }), 'moderate');
  assert.equal(posture({ acwr: 1.2 }), 'steady');
  assert.equal(posture({ sleep_7d_avg_delta: -3 }), 'steady');
  assert.equal(posture({ rhr_7d_avg_delta: 2 }), 'steady');
});

test('primed: low acute load, great sleep, no hard days, HRV holding', () => {
  const primed = { acwr: 0.7, sleep_last_night_score: 90, consecutive_hard_days: 0, hrv_7d_avg_delta: 1 };
  assert.equal(posture(primed), 'primed');
  assert.equal(posture({ ...primed, hrv_7d_avg_delta: -1 }), 'steady');
  assert.equal(posture({ ...primed, sleep_last_night_score: 85 }), 'steady');
  assert.equal(posture({ ...primed, consecutive_hard_days: 1 }), 'steady');
  assert.equal(posture({ ...primed, acwr: 0.8 }), 'steady');
  // missing HRV (no Oura, no Watch HRV) means primed cannot be claimed
  assert.equal(posture({ ...primed, hrv_7d_avg_delta: null }), 'steady');
});

test('rule order: first match wins', () => {
  // taper beats rest
  assert.equal(posture({
    race_in_next_7d: true, days_since_long_effort: 2, load_7d: 400,
    hrv_7d_avg_delta: -15, rhr_7d_avg_delta: 6,
  }), 'taper');
  // rest beats back-off
  assert.equal(posture({ consecutive_hard_days: 4, sleep_last_night_score: 60, acwr: 1.8 }), 'rest');
  // back-off beats moderate
  assert.equal(posture({ acwr: 1.6, rhr_7d_avg_delta: 3 }), 'back-off');
});

test('reasoning records every rule up to the one that fired, with values', () => {
  const r = computePosture({ ...base, acwr: 1.3 }, baselines);
  assert.equal(r.posture, 'moderate');
  assert.deepEqual(r.reasoning.map((t) => t.rule), ['taper', 'rest', 'back-off', 'moderate']);
  const fired = r.reasoning.at(-1)!;
  assert.equal(fired.met, true);
  const acwr = fired.clauses.find((c) => c.driver === 'acwr')!;
  assert.deepEqual(acwr, { driver: 'acwr', value: 1.3, op: '>', threshold: 1.2, met: true });
});

test('non-finite values are treated as missing', () => {
  assert.equal(posture({ acwr: Number.NaN }), 'steady');
  assert.equal(posture({ acwr: Number.POSITIVE_INFINITY }), 'steady');
});

test('deterministic: same inputs, same output', () => {
  const d = { ...base, acwr: 1.25, sleep_7d_avg_delta: -4 };
  assert.deepEqual(computePosture(d, baselines), computePosture(d, baselines));
});

// Evidence is only the clauses that made the fired rule fire (review 10-31).
// A clause that was true on a branch that did not complete is not a reason.
const evidenceOf = (over: PostureDrivers, b: UserBaselines = baselines) => {
  const r = computePosture({ ...base, ...over }, b);
  const fired = r.reasoning.find((t) => t.rule === r.rule)!;
  return { posture: r.posture, drivers: fired.evidence.map((c) => c.driver) };
};

test('rest evidence: hard-days branch fired, a lone HRV drop is not listed', () => {
  const e = evidenceOf({ consecutive_hard_days: 3, sleep_last_night_score: 65, hrv_7d_avg_delta: -12, rhr_7d_avg_delta: 1 });
  assert.equal(e.posture, 'rest');
  assert.deepEqual(e.drivers, ['consecutive_hard_days', 'sleep_last_night_score']);
});

test('rest evidence: HRV branch fired, a lone hard-day streak is not listed', () => {
  const e = evidenceOf({ consecutive_hard_days: 3, sleep_last_night_score: 75, hrv_7d_avg_delta: -12, rhr_7d_avg_delta: 5 });
  assert.equal(e.posture, 'rest');
  assert.deepEqual(e.drivers, ['hrv_7d_avg_delta', 'rhr_7d_avg_delta']);
});

test('rest evidence: both branches fired, all four are listed', () => {
  const e = evidenceOf({ consecutive_hard_days: 3, sleep_last_night_score: 65, hrv_7d_avg_delta: -12, rhr_7d_avg_delta: 5 });
  assert.deepEqual(e.drivers, ['consecutive_hard_days', 'sleep_last_night_score', 'hrv_7d_avg_delta', 'rhr_7d_avg_delta']);
});

test('back-off evidence: acwr fired, a sleep dip without the streak is not listed', () => {
  const e = evidenceOf({ acwr: 1.6, sleep_7d_avg_delta: -6, consecutive_low_sleep_nights: 1 });
  assert.equal(e.posture, 'back-off');
  assert.deepEqual(e.drivers, ['acwr']);
});

test('moderate and taper/primed evidence: each met trigger, nothing unmet', () => {
  assert.deepEqual(evidenceOf({ acwr: 1.3, rhr_7d_avg_delta: 2.5 }).drivers, ['acwr', 'rhr_7d_avg_delta']);
  assert.deepEqual(
    evidenceOf({ race_in_next_7d: true, days_since_long_effort: 3, load_7d: 330 }).drivers,
    ['race_in_next_7d', 'days_since_long_effort', 'load_7d'],
  );
});

test('rules that did not fire, and the default, carry no evidence', () => {
  const r = computePosture({ ...base, acwr: 1.3 }, baselines);
  for (const t of r.reasoning.filter((t) => !t.met)) assert.deepEqual(t.evidence, []);
  assert.deepEqual(computePosture(base, baselines).reasoning.at(-1)!.evidence, []);
});
