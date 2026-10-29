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

test('weekly long run names the athlete\'s weekday whatever the server time zone', () => {
  const was = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const now = Date.now();
    // 05:00 local on a known Sunday, recorded within the last week.
    const sunday = new Date(now - 2 * 86400000);
    sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
    const day = sunday.toISOString().slice(0, 10);
    const long = { type: 'Run', distance: 20000, moving_time: 6000, start_date: new Date(now - 86400000).toISOString(), start_date_local: `${day}T05:00:00Z` };
    const short = { type: 'Run', distance: 5000, moving_time: 1500, start_date: new Date(now - 2 * 3600000).toISOString(), start_date_local: `${day}T05:00:00Z` };
    const { drivers } = buildWeeklySummary([long, short]);
    assert.equal(drivers.find((d) => d.metric === 'Long run')!.trend, 'Sun');
  } finally {
    if (was === undefined) delete process.env.TZ; else process.env.TZ = was;
  }
});


test('pace rounds the whole value: 479.6 s/mi reads 8:00, never 7:60 (review 10-29)', () => {
  // 1 mile in 479.6 s, with HR so it is the hardest session.
  const fast = { ...run(1, 1609.34, 479.6, 175) };
  const { cards } = buildDashboard([fast, run(3, 8000, 2600, 140)], conn);
  const intensity = cards.find((c) => c.id === 'recent_intensity')!;
  assert.doesNotMatch(JSON.stringify(intensity), /:60/);
  assert.match(JSON.stringify(intensity), /8:00/);
});

test('virtual runs count as training load (review 10-29)', () => {
  const treadmill = { ...run(1, 16000, 6000, 150), type: 'VirtualRun', sport_type: 'VirtualRun' };
  const { drivers } = buildDashboard([treadmill], conn);
  assert.equal(drivers.find((d) => d.metric === 'Load')!.value, '100 min');
  const weekly = buildWeeklySummary([treadmill]);
  assert.equal(weekly.hasData, true);
});

test('no runs last week: Load and volume carry no trend, never "n/a wk" (review 10-29)', () => {
  const { drivers, cards } = buildDashboard([run(1, 8000, 2400)], conn);
  for (const m of ['Load', 'Weekly volume']) assert.equal(drivers.find((d) => d.metric === m)!.trend, undefined, m);
  assert.equal(cards.find((c) => c.id === 'training_load')!.trend, undefined);
  const weekly = buildWeeklySummary([run(1, 8000, 2400)]);
  assert.ok(weekly.drivers.every((d) => !String(d.trend ?? '').includes('n/a')));
});

test('long effort counts calendar days on the athlete\'s clock: last night is 1 day ago (review 10-29)', () => {
  // Ran 18:00 yesterday local; it is 08:00 today: 14 hours, but 1 calendar day.
  const today = '2026-10-29';
  const lastNight = { type: 'Run', distance: 16000, moving_time: 5400, start_date: new Date(now - 14 * 3600000).toISOString(), start_date_local: '2026-10-28T18:00:00Z' };
  const { cards } = buildDashboard([lastNight], conn, null, 'Oura', today);
  const long = cards.find((c) => c.id === 'long_effort')!;
  assert.equal(long.value, '1');
  assert.match(long.translation!, /1 day ago/);
  assert.doesNotMatch(long.translation!, /today/);
});

test('a long effort today reads "Today", never "0 days ago" (review 10-29)', () => {
  const today = new Date(now).toISOString().slice(0, 10);
  const thisMorning = { type: 'Run', distance: 16000, moving_time: 5400, start_date: new Date(now - 3600000).toISOString(), start_date_local: `${today}T06:00:00Z` };
  const long = buildDashboard([thisMorning], conn, null, 'Oura', today).cards.find((c) => c.id === 'long_effort')!;
  assert.equal(long.value, 'Today');
  assert.equal(long.unit, '');
});
