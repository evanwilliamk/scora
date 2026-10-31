import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDriverSeries, linkDrivers, parseHealthNights } from '../src/driver-links';
import type { SeriesKey } from '../src/driver-links';
import type { Driver } from '../src/metrics';

const all = new Set<SeriesKey>(['load', 'volume', 'sleep', 'hrv', 'resting_hr']);
const drivers: Driver[] = [
  { metric: 'Sleep', value: '7:12', trend: 'Oura 84' },
  { metric: 'Load', value: '412 min', trend: '+8% wk' },
  { metric: 'HRV', value: '52ms', trend: '+8% vs wk' },
  { metric: 'Peak avg HR (7d)', value: '161 bpm' },
];
const span = (voice: string, l: { start: number; end: number }) => voice.slice(l.start, l.end);

test('links the quoted value first, the name when no number is quoted, one link per series', () => {
  const voice = 'Sleep held at 7:12 for the second night and HRV is climbing at 52 ms. Load is where it should be, and load matters.';
  const links = linkDrivers(voice, drivers, all);
  assert.deepEqual(links.map((l) => [l.key, span(voice, l)]), [
    ['sleep', '7:12'],
    ['hrv', '52 ms'],
    ['load', 'Load'],
  ]);
});

test('no series, no link; drivers without a chart are never linked', () => {
  const voice = 'Sleep came in at 7:12 and peak HR was 161 bpm.';
  assert.deepEqual(linkDrivers(voice, drivers, new Set<SeriesKey>(['load'])), []);
  assert.deepEqual(linkDrivers('Peak HR was 161 bpm.', drivers, all), []);
});

test('a number inside a longer number is not a match', () => {
  const voice = 'Load sits at 1412 minutes over the month.';
  const [l] = linkDrivers(voice, [{ metric: 'Load', value: '412 min' }], all);
  assert.equal(span(voice, l), 'Load'); // fell back to the name
});

test('spans are UTF-16 offsets, so text after an emoji-free curly quote still lines up', () => {
  const voice = 'It’s a settled week: HRV 52ms.';
  const [l] = linkDrivers(voice, drivers, all);
  assert.equal(span(voice, l), '52ms');
});

test('load and volume: 28 rolling 7-day totals on the read\'s own window, rest days count as 0', () => {
  const now = Date.UTC(2026, 9, 18, 20); // 20:00 UTC on the 18th
  const at = (iso: string) => ({ start_date: iso, start_date_local: iso });
  const acts = [
    { type: 'Run', ...at('2026-10-17T07:00:00Z'), moving_time: 1800, distance: 5000 },
    { type: 'Run', ...at('2026-10-17T18:00:00Z'), moving_time: 1200, distance: 3000 },
    { type: 'Run', ...at('2026-10-18T07:00:00Z'), moving_time: 3600, distance: 10000 },
    { type: 'Ride', ...at('2026-10-18T09:00:00Z'), moving_time: 7200, distance: 50000 },
    { type: 'Run', ...at('2026-10-11T19:00:00Z'), moving_time: 2400, distance: 6000 }, // 7 days + 1 hour before now
    { type: 'Run', ...at('2026-09-01T07:00:00Z'), moving_time: 3600, distance: 10000 }, // outside the window
  ];
  const s = buildDriverSeries(acts, null, '2026-10-18', 28, now);
  assert.equal(s.load!.points.length, 28);
  assert.equal(s.load!.points[0].date, '2026-09-21');
  // The newest point is the read's Load: the 168 hours before now.
  assert.deepEqual(s.load!.points.slice(-3), [{ date: '2026-10-16', value: 40 }, { date: '2026-10-17', value: 90 }, { date: '2026-10-18', value: 110 }]);
  assert.deepEqual(s.volume!.points.slice(-1), [{ date: '2026-10-18', value: 11.2 }]);
  // Against last week's total, as "+x% wk" in the read.
  assert.equal(s.load!.baseline, s.load!.points[20].value);
  assert.equal(s.load!.baselineLabel, 'last week');
  assert.equal(s.sleep, undefined); // no Oura, no sleep chart
});

test('the newest load point equals the read\'s Load for the same activities (review 10-29)', async () => {
  const { buildDashboard } = await import('../src/metrics');
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3600000).toISOString();
  // Last Wednesday 18:00 is inside the 168 hours; a calendar week would drop it.
  const acts = [
    { type: 'Run', start_date: ago(7 * 24 - 13), start_date_local: ago(7 * 24 - 13), moving_time: 3600, distance: 10000 },
    { type: 'Run', start_date: ago(30), start_date_local: ago(30), moving_time: 1800, distance: 5000 },
  ];
  const today = new Date(now).toISOString().slice(0, 10);
  const load = buildDashboard(acts, { strava: true, oura: false, healthKit: false }, null, 'Oura', today).drivers.find((d) => d.metric === 'Load')!;
  const s = buildDriverSeries(acts, null, today, 28, now);
  assert.equal(`${s.load!.points.at(-1)!.value} min`, load.value);
});

test('Oura nights: only recorded values, oldest first, at least two points', () => {
  const s = buildDriverSeries([], {
    sleepSeconds: 25920, sleepScore: 84, hrvMs: 52, restingHr: 48, readinessScore: 80, hrvWeekAvgMs: 48,
    nights: [
      { day: '2026-10-18', sleepSeconds: 25920, hrvMs: 52, restingHr: 48 },
      { day: '2026-10-17', sleepSeconds: 23400, hrvMs: null, restingHr: 50 },
      { day: '2026-10-16', sleepSeconds: 27000, hrvMs: 44, restingHr: 49 },
      { day: '2026-08-01', sleepSeconds: 20000, hrvMs: 30, restingHr: 60 }, // outside the window
    ],
  }, '2026-10-18');
  assert.deepEqual(s.sleep!.points, [
    { date: '2026-10-16', value: 7.5 }, { date: '2026-10-17', value: 6.5 }, { date: '2026-10-18', value: 7.2 },
  ]);
  assert.deepEqual(s.hrv!.points.map((p) => p.date), ['2026-10-16', '2026-10-18']); // the gap stays a gap
  assert.equal(s.hrv!.baseline, 44); // the nights in the 7 days before the newest
  assert.equal(s.load, undefined); // no runs, no load chart
  const one = buildDriverSeries([], { sleepSeconds: 1, sleepScore: null, hrvMs: null, restingHr: null, readinessScore: null, hrvWeekAvgMs: null,
    nights: [{ day: '2026-10-18', sleepSeconds: 25920, hrvMs: 52, restingHr: 48 }] }, '2026-10-18');
  assert.deepEqual(Object.keys(one), []);
});

test('HealthKit nights from the app: malformed days and implausible values are dropped, not charted', () => {
  const nights = parseHealthNights([
    { day: '2026-10-16', sleepSeconds: 27000, hrvMs: 44, restingHr: 49 },
    { day: '2026-10-17', sleepSeconds: 999999, hrvMs: 51, restingHr: 5 },
    { day: '2026-10-17', sleepSeconds: 20000 }, // duplicate day
    { day: 'yesterday', sleepSeconds: 20000 },
    { day: '2026-02-31', sleepSeconds: 20000 },
    { day: '2026-10-18', hrvMs: 'high' },
    null,
  ]);
  assert.deepEqual(nights, [
    { day: '2026-10-16', sleepSeconds: 27000, hrvMs: 44, restingHr: 49 },
    { day: '2026-10-17', sleepSeconds: null, hrvMs: 51, restingHr: null },
  ]);
  assert.deepEqual(parseHealthNights('nope'), []);
  assert.equal(parseHealthNights(Array.from({ length: 50 }, (_, i) => ({ day: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, hrvMs: 40 }))).length, 28);
  const s = buildDriverSeries([], { sleepSeconds: null, sleepScore: null, hrvMs: null, restingHr: null, readinessScore: null, hrvWeekAvgMs: null, nights }, '2026-10-18');
  assert.deepEqual(s.hrv!.points, [{ date: '2026-10-16', value: 44 }, { date: '2026-10-17', value: 51 }]);
});

test('a value links only as a whole token: "45 mi" is not in "45 min", "7:12" is not in "7:12/mi" (review 10-29)', () => {
  const all = new Set<SeriesKey>(['volume', 'sleep', 'load']);
  const voice = "Today's 45 min tempo is on the plan. Volume sits at 45 mi, and the last run held 7:12/mi after 7:12 of sleep.";
  const links = linkDrivers(voice, [
    { metric: 'Weekly volume', value: '45 mi' },
    { metric: 'Sleep (last night)', value: '7:12' },
  ], all);
  const vol = links.find((l) => l.key === 'volume')!;
  const sleep = links.find((l) => l.key === 'sleep')!;
  assert.equal(span(voice, vol), '45 mi');
  assert.ok(vol.start > voice.indexOf('Volume'));
  assert.equal(voice.slice(sleep.start, sleep.end + 9), '7:12 of sleep');
});

test('body-signal baselines are the 7 nights before the newest, not the month (review 10-29)', () => {
  const nights = [
    { day: '2026-10-18', sleepSeconds: 25920, hrvMs: 60, restingHr: 48 },
    { day: '2026-10-16', sleepSeconds: 25920, hrvMs: 50, restingHr: 48 },
    { day: '2026-10-12', sleepSeconds: 25920, hrvMs: 40, restingHr: 48 },
    { day: '2026-09-25', sleepSeconds: 25920, hrvMs: 10, restingHr: 48 }, // in the chart, not in the baseline
  ];
  const s = buildDriverSeries([], { sleepSeconds: null, sleepScore: null, hrvMs: null, restingHr: null, readinessScore: null, hrvWeekAvgMs: null, nights }, '2026-10-18');
  assert.equal(s.hrv!.points.length, 4);
  assert.equal(s.hrv!.baseline, 45);
  assert.equal(s.hrv!.baselineLabel, undefined);
});

test('HRV and resting HR baselines are whole numbers, as the read rounds its week average (review 10-31)', () => {
  const nights = [
    { day: '2026-10-18', sleepSeconds: 25920, hrvMs: 52, restingHr: 47 },
    { day: '2026-10-17', sleepSeconds: 25000, hrvMs: 50, restingHr: 48 },
    { day: '2026-10-16', sleepSeconds: 26000, hrvMs: 47, restingHr: 49 },
    { day: '2026-10-15', sleepSeconds: 27000, hrvMs: 48, restingHr: 49 },
  ];
  const s = buildDriverSeries([], { sleepSeconds: null, sleepScore: null, hrvMs: null, restingHr: null, readinessScore: null, hrvWeekAvgMs: 48, nights }, '2026-10-18');
  assert.equal(s.hrv!.baseline, 48); // the read's week avg: Math.round(48.33)
  assert.equal(s.resting_hr!.baseline, 49); // Math.round(48.67)
});

// Five weeks of runs: daily easy runs, a hard workout on three recent days in
// a row, a 100-minute long run 4 days ago.
function fiveWeeks(now: number) {
  const acts: any[] = [];
  for (let k = 34; k >= 0; k--) {
    const iso = new Date(now - k * 86_400_000 - 3 * 3600000).toISOString();
    const hard = k <= 2;
    acts.push({
      type: 'Run', start_date: iso, start_date_local: iso, utc_offset: 0,
      moving_time: k === 4 ? 6000 : 2400 + (k % 5) * 120, distance: k === 4 ? 18000 : 7000,
      average_heartrate: hard ? 170 + k : 140 + (k % 7), workout_type: hard ? 3 : 0,
    });
  }
  return acts;
}

test('posture drivers and peak HR: the newest point is the number the read cites', async () => {
  const { postureForRead } = await import('../src/drivers');
  const { buildDashboard } = await import('../src/metrics');
  const now = Date.now();
  const acts = fiveWeeks(now);
  const today = new Date(now).toISOString().slice(0, 10);
  const s = buildDriverSeries(acts, null, today, 28, now);
  const rec = postureForRead(acts, null, { localToday: today, now }).record.drivers;
  assert.equal(s.acwr!.points.at(-1)!.value, rec.acwr);
  assert.equal(s.hard_days!.points.at(-1)!.value, rec.consecutive_hard_days);
  assert.equal(s.hard_days!.points.at(-1)!.value, 3);
  assert.equal(s.days_since_long_effort!.points.at(-1)!.value, rec.days_since_long_effort);
  assert.equal(s.days_since_long_effort!.points.at(-1)!.value, 4);
  // ACWR needs 27 days of history: early days are left out, not guessed.
  assert.ok(s.acwr!.points.length < 28 && s.acwr!.points.length > 0);
  assert.equal(s.acwr!.unit, 'ratio');
  const peak = buildDashboard(acts, { strava: true, oura: false, healthKit: false }, null, 'Oura', today).drivers.find((d) => d.metric === 'Peak avg HR (7d)')!;
  assert.equal(`${s.peak_hr!.points.at(-1)!.value} bpm`, peak.value);
  assert.equal(s.peak_hr!.points.length, 28);
});

test('posture drivers link by name; a bare count never links to another number', () => {
  const avail = new Set<SeriesKey>(['acwr', 'hard_days', 'days_since_long_effort', 'peak_hr', 'load', 'hrv']);
  const voice = "Today's plan is 3 × 8 min. That makes 3 hard days in a row, acute:chronic load at 1.32, and the long effort was 4 days ago.";
  const links = linkDrivers(voice, [
    { metric: 'Hard days in a row', value: '3' },
    { metric: 'Acute:chronic load', value: '1.32' },
    { metric: 'Days since long effort', value: '4' },
    { metric: 'HRV vs week', value: '+8%' },
  ], avail);
  assert.deepEqual(links.map((l) => [l.key, span(voice, l)]), [
    ['hard_days', 'hard days'],
    ['acwr', '1.32'],
    ['days_since_long_effort', 'long effort'],
  ]);
});

test('every driver the read can cite has a series or an explicit not-chartable entry', async () => {
  const { readFileSync } = await import('node:fs');
  const { METRIC_KEYS, NOT_CHARTABLE } = await import('../src/driver-links');
  // The files that build the read's drivers (metrics.ts dashboard and weekly,
  // drivers.ts posture evidence, plan-read.ts, plan-adapt.ts plan changes).
  const files = ['metrics.ts', 'drivers.ts', 'plan-read.ts', 'plan-adapt.ts'];
  const metrics = new Set<string>();
  for (const f of files) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /metric:\s*`/, `${f}: a template-literal metric name cannot be checked`);
    for (const m of src.matchAll(/metric:\s*'((?:[^'\\]|\\.)*)'/g)) metrics.add(m[1]);
  }
  assert.ok(metrics.size >= 20, `found only ${metrics.size} driver names`);
  const missing = [...metrics].filter((m) => !(m in METRIC_KEYS) && !(m in NOT_CHARTABLE));
  assert.deepEqual(missing, [], 'add these to METRIC_KEYS (with a series) or NOT_CHARTABLE (with a reason)');
  const both = Object.keys(METRIC_KEYS).filter((m) => m in NOT_CHARTABLE);
  assert.deepEqual(both, []);
  // Every mapped series is one buildDriverSeries can actually build.
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const nights = Array.from({ length: 5 }, (_, i) => ({ day: new Date(now - i * 86_400_000).toISOString().slice(0, 10), sleepSeconds: 25000 + i, hrvMs: 50 + i, restingHr: 48 + i }));
  const built = buildDriverSeries(fiveWeeks(now), { sleepSeconds: null, sleepScore: null, hrvMs: null, restingHr: null, readinessScore: null, hrvWeekAvgMs: null, nights }, today, 28, now);
  const unbuilt = [...new Set(Object.values(METRIC_KEYS))].filter((k) => !built[k]);
  assert.deepEqual(unbuilt, []);
});
