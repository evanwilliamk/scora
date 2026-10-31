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

// ---- review findings (2026-10-17) ----

test('ACWR needs 27 days of runs: 22 steady days give no ratio, not a false moderate', () => {
  const acts = Array.from({ length: 22 }, (_, i) => run(i, 30, 140));
  const { drivers } = computeDriverRecord(acts, null, { now });
  assert.equal(drivers.acwr, null);
  assert.equal(computePosture(drivers).posture, 'steady');
});

test('a comeback ramp after a break still shows in ACWR (re-review finding)', () => {
  // A run 27 days ago, a two-week break, then 7 daily 60 min runs.
  const acts = [run(27, 60, 140), ...Array.from({ length: 7 }, (_, i) => run(i, 60, 140))];
  const { drivers } = computeDriverRecord(acts, null, { now });
  assert.equal(drivers.acwr, 3.5);
  assert.equal(computePosture(drivers).posture, 'back-off');
});

test('a Sydney morning run counts today (start_date is UTC, start_date_local is not)', () => {
  // 06:00 in Sydney (UTC+11) on Oct 18 is 19:00 UTC on Oct 17; read at 07:30 local.
  const readAt = Date.UTC(2026, 9, 17, 20, 30);
  const sydney = {
    type: 'Run', start_date: '2026-10-17T19:00:00Z', start_date_local: '2026-10-18T06:00:00Z',
    utc_offset: 39600, distance: 15000, moving_time: 93 * 60, average_heartrate: 150,
  };
  const { drivers } = computeDriverRecord([sydney], null, { now: readAt });
  assert.equal(drivers.load_7d, 93);
  assert.equal(drivers.days_since_long_effort, 0);
});

test('hard-day streak counts local calendar days, not 24h blocks', () => {
  // Hard on Oct 14 08:00, Oct 15 20:00, Oct 16 06:00; read Oct 17 07:00.
  const at = (iso: string, hr: number) => ({
    type: 'Run', start_date: iso, start_date_local: iso, distance: 8000, moving_time: 2700, average_heartrate: hr,
  });
  const acts = [
    at('2026-10-14T08:00:00Z', 175), at('2026-10-15T20:00:00Z', 176), at('2026-10-16T06:00:00Z', 177),
    ...Array.from({ length: 12 }, (_, i) => at(`2026-10-${String(12 - i).padStart(2, '0')}T08:00:00Z`, 140)),
  ];
  const { drivers } = computeDriverRecord(acts, null, { now: Date.UTC(2026, 9, 17, 7, 0) });
  assert.equal(drivers.consecutive_hard_days, 3);
});

test('a fired posture brings its evidence as citable drivers; steady brings none', () => {
  const spike = postureForRead([...steadyWeeks(), run(0, 120, 140), run(2, 120, 140)], null, { now });
  assert.equal(spike.result.posture, 'back-off');
  assert.deepEqual(spike.evidence.map((d) => d.metric), ['Acute:chronic load']);
  assert.equal(spike.evidence[0].value, String(spike.record.drivers.acwr));

  const rest = postureForRead([], oura({ hrvMs: 44, hrvWeekAvgMs: 50, restingHr: 56 }), { now });
  assert.equal(rest.result.posture, 'rest');
  assert.deepEqual(rest.evidence, [
    { metric: 'HRV vs week', value: '-12%' },
    { metric: 'Resting HR vs week', value: '+6 bpm' },
  ]);

  assert.deepEqual(postureForRead(steadyWeeks(), null, { now }).evidence, []);
});

test('an unbacked default posture gives the prompt no POSTURE line (night fixes 10-30)', () => {
  const none = postureForRead([], null, { now });
  assert.equal(none.result.rule, 'default');
  assert.equal(none.backed, false);
  assert.equal(none.promptLine, '');
  const spike = postureForRead([...steadyWeeks(), run(0, 120, 140), run(2, 120, 140)], null, { now });
  assert.equal(spike.backed, true);
  assert.match(spike.promptLine, /^POSTURE/);
});

test('days since long effort counts calendar days on the athlete\'s clock (review 10-29)', () => {
  // A 100-minute run at 18:00 local yesterday; now is 08:00 local, 14 hours later.
  const lastNight = { type: 'Run', start_date: new Date(now - 14 * 3600000).toISOString(), start_date_local: '2026-10-16T18:00:00Z', distance: 17000, moving_time: 6000, average_heartrate: 145 };
  const { drivers } = computeDriverRecord([...steadyWeeks().filter((a) => Date.parse(a.start_date) < now - 2 * day), lastNight], null, { now, localToday: '2026-10-17' });
  assert.equal(drivers.days_since_long_effort, 1);
});

test('virtual runs count toward load (review 10-29)', () => {
  const asVirtual = steadyWeeks().map((a) => ({ ...a, type: 'VirtualRun', sport_type: 'VirtualRun' }));
  const real = computeDriverRecord(steadyWeeks(), null, { now }).drivers;
  const virtual = computeDriverRecord(asVirtual, null, { now }).drivers;
  assert.equal(virtual.load_7d, real.load_7d);
  assert.ok((virtual.load_7d ?? 0) > 0);
});

test('raceWithinWeek: 0 to 7 days ahead on the athlete\'s calendar (night fixes 10-30)', async () => {
  const { raceWithinWeek } = await import('../src/drivers');
  assert.equal(raceWithinWeek('2026-10-30', '2026-10-30'), true);
  assert.equal(raceWithinWeek('2026-11-06', '2026-10-30'), true);
  assert.equal(raceWithinWeek('2026-11-07', '2026-10-30'), false);
  assert.equal(raceWithinWeek('2026-10-29', '2026-10-30'), false);
  assert.equal(raceWithinWeek(null, '2026-10-30'), null);
});

// The daily read may name only the posture SCORA's rules decided (review 10-31).
import { postureClaimHits } from '../src/drivers';

test('postureClaimHits: a posture the rules did not decide is a hit; the decided one is not', () => {
  assert.deepEqual(postureClaimHits('Load is high and the body reads back-off this morning.', 'back-off'), []);
  assert.deepEqual(postureClaimHits('The body reads primed this morning.', 'back-off'), ['posture primed']);
  assert.deepEqual(postureClaimHits('Taper week shows in the load.', 'steady'), ['posture taper']);
  // No backed posture: no posture word may be claimed at all.
  assert.deepEqual(postureClaimHits('Body reads primed.', null), ['posture primed']);
  // Everyday words count only when tied to the posture.
  assert.deepEqual(postureClaimHits('Load has been steady and sleep moderate.', 'back-off'), []);
  assert.deepEqual(postureClaimHits("Today's posture reads moderate.", 'back-off'), ['posture moderate']);
  assert.deepEqual(postureClaimHits("Today's posture reads moderate.", 'moderate'), []);
  assert.deepEqual(postureClaimHits('Posture is steady.', null), ['posture steady']);
});

import { postureEvidence } from '../src/drivers';
test('low sleep-score nights are named as scores, not as short sleep (review 10-31)', () => {
  const ev = postureEvidence({
    posture: 'back-off', rule: 'back-off', engine_version: 'test',
    reasoning: [{ rule: 'back-off', met: true, evidence: [{ driver: 'consecutive_low_sleep_nights', value: 3, op: '>=', threshold: 2, met: true }] }],
  } as any);
  assert.equal(ev.length, 1);
  assert.doesNotMatch(ev[0].metric, /short/i);
  assert.match(ev[0].metric, /sleep score/i);
});

test("postureClaimHits: the plan's own taper is the plan, not a posture claim", () => {
  assert.deepEqual(postureClaimHits("Your plan's taper starts Monday, and the body is settled.", 'steady'), []);
  assert.deepEqual(postureClaimHits('Two weeks out, the taper phase is next on the plan.', 'steady'), []);
  assert.deepEqual(postureClaimHits('Load has come down and the body reads like a taper.', 'steady'), ['posture taper']);
});

test('postureEvidence cites only the branch of the rest rule that fired (review 10-31)', async () => {
  const { computePosture } = await import('@scora/posture');
  const result = computePosture(
    { consecutive_hard_days: 3, sleep_last_night_score: 65, hrv_7d_avg_delta: -12, rhr_7d_avg_delta: 1 },
    { sleep_score_p25: 70, sleep_score_p75: 85 },
  );
  assert.equal(result.posture, 'rest');
  assert.deepEqual(postureEvidence(result).map((d) => d.metric), ['Hard days in a row', 'Sleep score']);
});
