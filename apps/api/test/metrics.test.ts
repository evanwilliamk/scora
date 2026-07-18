import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, buildWeeklySummary } from '../src/metrics';
import type { OuraSummary } from '../src/oura';

const now = Date.now();
const day = 86400000;
const run = (daysAgo: number, meters: number, secs: number, hr?: number) => ({
  type: 'Run',
  name: `run-${daysAgo}`,
  start_date: new Date(now - daysAgo * day).toISOString(),
  start_date_local: new Date(now - daysAgo * day).toISOString(),
  distance: meters,
  moving_time: secs,
  average_heartrate: hr,
  total_elevation_gain: 40,
});

const activities = [
  run(2, 10000, 2700, 165),
  run(4, 8000, 2600, 140),
  run(6, 22000, 7200, 150),
  run(9, 9000, 2900, 138),
  run(11, 12000, 3900, 158),
];

const oura: OuraSummary = {
  sleepSeconds: 7 * 3600 + 12 * 60,
  sleepScore: 84,
  hrvMs: 52,
  restingHr: 44,
  readinessScore: 79,
  hrvWeekAvgMs: 48,
};

const conn = { strava: true, oura: false, healthKit: false };

test('dashboard always returns the six cards', () => {
  const { cards } = buildDashboard(activities, conn);
  const ids = cards.map((c) => c.id).sort();
  assert.deepEqual(ids, [
    'connections',
    'long_effort',
    'recent_intensity',
    'recovery_signal',
    'sleep',
    'training_load',
  ]);
});

test('without Oura, Sleep + Recovery are unavailable connect prompts (no fabricated data)', () => {
  const { cards } = buildDashboard(activities, conn);
  const sleep = cards.find((c) => c.id === 'sleep')!;
  const recovery = cards.find((c) => c.id === 'recovery_signal')!;
  assert.equal(sleep.available, false);
  assert.equal(recovery.available, false);
  assert.equal(sleep.value, undefined);
  assert.ok(sleep.cta && sleep.cta.length > 0);
});

test('Strava cards populate with real values', () => {
  const { cards, drivers } = buildDashboard(activities, conn);
  const load = cards.find((c) => c.id === 'training_load')!;
  assert.equal(load.available, true);
  assert.ok(Number(load.value) > 0);
  // long effort is the 22k run (13.7mi)
  const long = cards.find((c) => c.id === 'long_effort')!;
  assert.equal(long.trend, '13.7 mi');
  assert.ok(drivers.some((d) => d.metric === 'Load'));
});

test('with Oura, Sleep + Recovery populate and are labeled Oura', () => {
  const { cards, drivers } = buildDashboard(
    activities,
    { strava: true, oura: true, healthKit: false },
    oura
  );
  const sleep = cards.find((c) => c.id === 'sleep')!;
  const recovery = cards.find((c) => c.id === 'recovery_signal')!;
  assert.equal(sleep.available, true);
  assert.equal(sleep.value, '7:12');
  assert.equal(sleep.source, 'Oura');
  assert.equal(recovery.value, '52');
  assert.ok(drivers.some((d) => d.metric === 'HRV' && d.value === '52ms'));
});

test('recoverySource label flows through (Apple Health)', () => {
  const { cards } = buildDashboard(
    activities,
    { strava: true, oura: false, healthKit: true },
    { ...oura, sleepScore: null, readinessScore: null },
    'Apple Health'
  );
  assert.equal(cards.find((c) => c.id === 'sleep')!.source, 'Apple Health');
  assert.equal(cards.find((c) => c.id === 'recovery_signal')!.source, 'Apple Health');
});

test('empty athlete: no drivers, load unavailable', () => {
  const { cards, drivers } = buildDashboard([], conn);
  assert.equal(drivers.length, 0);
  assert.equal(cards.find((c) => c.id === 'training_load')!.available, false);
});

test('connections card counts linked sources', () => {
  const { cards } = buildDashboard(activities, { strava: true, oura: true, healthKit: false }, oura);
  assert.equal(cards.find((c) => c.id === 'connections')!.value, '2');
});

test('weekly summary: empty week has no data', () => {
  assert.equal(buildWeeklySummary([]).hasData, false);
});

test('weekly summary: stats + drivers with data', () => {
  const w = buildWeeklySummary(activities);
  assert.equal(w.hasData, true);
  const labels = w.stats.map((s) => s.label);
  assert.ok(labels.includes('Volume'));
  assert.ok(labels.includes('Long run'));
  assert.ok(labels.includes('Days run'));
  assert.ok(w.drivers.length > 0);
});

test('weekly summary: Oura fields only appear when a summary is passed', () => {
  const without = buildWeeklySummary(activities);
  const withOura = buildWeeklySummary(activities, oura);
  assert.ok(!without.stats.some((s) => s.label === 'HRV'));
  assert.ok(withOura.stats.some((s) => s.label === 'HRV'));
  assert.ok(withOura.stats.some((s) => s.label === 'Sleep'));
});

test('weekly volume is this-week only, not the prior week', () => {
  const w = buildWeeklySummary(activities);
  const vol = w.stats.find((s) => s.label === 'Volume')!;
  // this week = runs at day 2,4,6 = 10+8+22 km = 40km ≈ 24.9mi
  assert.equal(vol.value, '24.9 mi');
});
