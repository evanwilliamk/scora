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

test('load and volume: every local day for 28 days, rest days read 0, runs summed per day', () => {
  const acts = [
    { type: 'Run', start_date_local: '2026-10-17T07:00:00Z', moving_time: 1800, distance: 5000 },
    { type: 'Run', start_date_local: '2026-10-17T18:00:00Z', moving_time: 1200, distance: 3000 },
    { type: 'Run', start_date_local: '2026-10-18T07:00:00Z', moving_time: 3600, distance: 10000 },
    { type: 'Ride', start_date_local: '2026-10-18T09:00:00Z', moving_time: 7200, distance: 50000 },
    { type: 'Run', start_date_local: '2026-09-01T07:00:00Z', moving_time: 3600, distance: 10000 }, // outside the window
  ];
  const s = buildDriverSeries(acts, null, '2026-10-18');
  assert.equal(s.load!.points.length, 28);
  assert.equal(s.load!.points[0].date, '2026-09-21');
  assert.deepEqual(s.load!.points.slice(-2), [{ date: '2026-10-17', value: 50 }, { date: '2026-10-18', value: 60 }]);
  assert.deepEqual(s.volume!.points.slice(-1), [{ date: '2026-10-18', value: 6.2 }]);
  assert.equal(s.load!.baseline, Math.round((50 / 27) * 10) / 10);
  assert.equal(s.sleep, undefined); // no Oura, no sleep chart
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
  assert.equal(s.hrv!.baseline, 44);
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
