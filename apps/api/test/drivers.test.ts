import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDriverRecord, percentile, postureForRead } from '../src/drivers';
import { computePosture } from '../../../packages/posture/src/index';
import type { OuraSummary } from '../src/oura';

const now = Date.UTC(2026, 9, 17, 12, 0, 0);
const day = 86400000;
const run = (daysAgo: number, mins: number, hr?: number, extra: Record<string, unknown> = {}) => ({
  type: 'Run',
  start_date: new Date(now - daysAgo * day).toISOString(),
  start_date_local: new Date(now - daysAgo * day).toISOString(),
  distance: mins * 170,
  moving_time: mins * 60,
  average_heartrate: hr,
  ...extra,
});

// Four steady weeks: 4 runs a week, 50 min each, easy HR, one 100 min long run.
const steadyWeeks = () => {
  const out: any[] = [];
  for (let w = 0; w < 4; w++) {
    const o = w * 7;
    out.push(run(o + 1, 50, 140), run(o + 3, 50, 142), run(o + 4, 50, 138), run(o + 6, 100, 145));
  }
  return out;
};

const oura = (over: Partial<OuraSummary> = {}): OuraSummary => ({
  sleepSeconds: 7 * 3600,
  sleepScore: 80,
  hrvMs: 50,
  restingHr: 50,
  readinessScore: 80,
  hrvWeekAvgMs: 50,
  restingHrHistory: [50, 50, 50, 50, 50, 50, 50],
  sleepScoreHistory: [70, 72, 74, 76, 78, 80, 82, 84, 86, 88],
  ...over,
});

test('percentile uses nearest rank', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([10, 20, 30, 40], 0.25), 10);
  assert.equal(percentile([10, 20, 30, 40], 0.75), 30);
  assert.equal(percentile([40, 10, 30, 20], 0.8), 40);
});

test('no data: every driver is null and posture reads steady', () => {
  const { drivers, baselines, completeness } = computeDriverRecord([], null, { now });
  for (const [k, v] of Object.entries(drivers)) assert.equal(v, null, k);
  assert.equal(baselines.sleep_score_p25, null);
  assert.equal(completeness, 0);
  assert.equal(computePosture(drivers, baselines).posture, 'steady');
});

test('load is run moving minutes over 7 and 28 days, acwr from them', () => {
  const { drivers } = computeDriverRecord(steadyWeeks(), null, { now });
  assert.equal(drivers.load_7d, 250);
  assert.equal(drivers.load_28d, 1000);
  assert.equal(drivers.acwr, 1);
  assert.equal(drivers.days_since_long_effort, 6);
});

test('non-run activities do not count toward load', () => {
  const acts = [...steadyWeeks(), { ...run(2, 120, 130), type: 'Ride' }];
  assert.equal(computeDriverRecord(acts, null, { now }).drivers.load_7d, 250);
});

test('acwr is null until history covers 21 days (new account does not read back-off)', () => {
  const acts = [run(1, 60, 140), run(3, 60, 140), run(5, 60, 140), run(9, 60, 140)];
  const { drivers } = computeDriverRecord(acts, null, { now });
  assert.equal(drivers.acwr, null);
  assert.equal(computePosture(drivers).posture, 'steady');
});

test('a load spike reads back-off through acwr', () => {
  const acts = [...steadyWeeks(), run(0, 120, 140), run(2, 120, 140)];
  const { drivers } = computeDriverRecord(acts, null, { now });
  assert.ok((drivers.acwr ?? 0) > 1.5, `acwr ${drivers.acwr}`);
  assert.equal(computePosture(drivers).posture, 'back-off');
});

test('consecutive hard days count back from today, or yesterday when today is empty', () => {
  const base = steadyWeeks(); // easy HRs ~138-145
  const hard = [run(1, 50, 175), run(2, 50, 172)];
  // Day 1 already has an easy run plus a hard one; any hard run makes it a hard day.
  const r1 = computeDriverRecord([...base, ...hard], null, { now });
  assert.equal(r1.drivers.consecutive_hard_days, 2);

  // An easy run today breaks the streak.
  const r2 = computeDriverRecord([...base, ...hard, run(0, 40, 135)], null, { now });
  assert.equal(r2.drivers.consecutive_hard_days, 0);
});

test('Strava race or workout tags count as hard without HR', () => {
  const acts = [run(1, 50, undefined, { workout_type: 3 }), run(2, 50, undefined, { workout_type: 1 })];
  assert.equal(computeDriverRecord(acts, null, { now }).drivers.consecutive_hard_days, 2);
});

test('hard days stay null with too few HR runs and no tags', () => {
  const acts = [run(1, 50, 170), run(2, 50, 170)];
  assert.equal(computeDriverRecord(acts, null, { now }).drivers.consecutive_hard_days, null);
});

test('sleep baselines, deltas and low-night streak come from Oura history', () => {
  const r = computeDriverRecord([], oura({ sleepScore: 60, sleepScoreHistory: [62, 65, 80, 82, 84, 86, 88, 90] }), { now });
  assert.equal(r.baselines.sleep_score_p25, 65);
  assert.equal(r.baselines.sleep_score_p75, 86);
  assert.equal(r.drivers.sleep_last_night_score, 60);
  // 60 minus mean of the prior 7 (62..88) = 60 - 78.1
  assert.equal(r.drivers.sleep_7d_avg_delta, -18.1);
  // 60 and 62 are below p25 (65); 65 is not.
  assert.equal(r.drivers.consecutive_low_sleep_nights, 2);
});

test('sleep baselines need a week of nights', () => {
  const r = computeDriverRecord([], oura({ sleepScoreHistory: [70, 72, 74] }), { now });
  assert.equal(r.baselines.sleep_score_p25, null);
  assert.equal(r.drivers.consecutive_low_sleep_nights, null);
  assert.equal(r.drivers.sleep_7d_avg_delta, 80 - 72);
});

test('HRV delta is percent, resting HR delta is bpm', () => {
  const r = computeDriverRecord([], oura({ hrvMs: 44, hrvWeekAvgMs: 50, restingHr: 56 }), { now });
  assert.equal(r.drivers.hrv_7d_avg_delta, -12);
  assert.equal(r.drivers.rhr_7d_avg_delta, 6);
  assert.equal(computePosture(r.drivers, r.baselines).posture, 'rest');
});

test('HealthKit-shaped summary with no history leaves history drivers null', () => {
  const hk: OuraSummary = {
    sleepSeconds: 7 * 3600, sleepScore: null, hrvMs: 48, restingHr: 52, readinessScore: null, hrvWeekAvgMs: 50,
  };
  const r = computeDriverRecord([], hk, { now });
  assert.equal(r.drivers.sleep_last_night_score, null);
  assert.equal(r.drivers.rhr_7d_avg_delta, null);
  assert.equal(r.drivers.hrv_7d_avg_delta, -4);
});

test('a settled, rested athlete with low load reads primed', () => {
  // Three normal weeks, then a light week: acwr well under 0.8.
  const acts = steadyWeeks().filter((a) => new Date(a.start_date).getTime() < now - 7 * day);
  acts.push(run(2, 40, 138));
  const r = computeDriverRecord(acts, oura({ sleepScore: 90, hrvMs: 55 }), { now });
  assert.ok((r.drivers.acwr ?? 9) < 0.8, `acwr ${r.drivers.acwr}`);
  assert.equal(r.drivers.consecutive_hard_days, 0);
  assert.equal(computePosture(r.drivers, r.baselines).posture, 'primed');
  assert.equal(r.completeness, 1);
});

test('race flag passes through from options', () => {
  assert.equal(computeDriverRecord([], null, { now, raceInNext7d: true }).drivers.race_in_next_7d, true);
});

test('postureForRead decides the posture and gives the prompt one line to name', () => {
  const acts = [...steadyWeeks(), run(0, 120, 140), run(2, 120, 140)];
  const p = postureForRead(acts, null, { now });
  assert.equal(p.result.posture, 'back-off');
  assert.equal(p.result.rule, 'back-off');
  assert.match(p.promptLine, /^POSTURE \(decided by SCORA's rules from the drivers, posture-v[\d.]+\): back-off$/);
  // No prescriptive language sneaks into the line the LLM sees.
  assert.doesNotMatch(p.promptLine, /should|need to|do a|go for/i);
});
