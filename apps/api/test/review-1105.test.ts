// Second-pass review 2026-11-05: what per-branch tests missed. Routes go through
// a fake Supabase and a fetch guard; nothing here touches a network.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';
import { computeDriverRecord } from '../src/drivers';
import { buildDriverSeries } from '../src/driver-links';
import { usableRecovery } from '../src/metrics';
import { fetchOuraSummary, type OuraSummary } from '../src/oura';

blankEnv();

let app: any;
let rest: FakeRest;
let guard: FetchGuard;
before(async () => {
  rest = await fakeRest();
  guard = installFetchGuard(rest.url);
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  app = (await import('../src/index')).default;
  await app.ready();
});
after(async () => {
  await app.close();
  guard.restore();
  await rest.close();
});
beforeEach(() => {
  rest.reset();
  guard.reset();
});

const DAY = 86400000;
const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const dayAgo = (n: number) => new Date(now - n * DAY).toISOString().slice(0, 10);
const run = (daysAgo: number) => {
  const at = new Date(now - daysAgo * DAY).toISOString();
  return { name: 'Morning Run', type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, distance: 8000, moving_time: 2400, elapsed_time: 2400, average_heartrate: 140 };
};
const summary = (over: Partial<OuraSummary>): OuraSummary => ({
  sleepSeconds: 25000, sleepScore: 80, hrvMs: 50, restingHr: 50, readinessScore: 80, hrvWeekAvgMs: 50, ...over,
});

// Oura zeros: a 0 is no reading, in the prior nights as well as last night.

test('a 0 in the prior resting HR nights does not make last night look high', () => {
  const clean = computeDriverRecord([], summary({ restingHrHistory: [50, 50, 50, 50, 50, 50] }));
  const zeros = computeDriverRecord([], summary({ restingHrHistory: [50, 50, 0, 50, 50, 0, 50, 50] }));
  assert.equal(clean.drivers.rhr_7d_avg_delta, 0);
  assert.equal(zeros.drivers.rhr_7d_avg_delta, 0);
});

test('a 0 in the prior sleep scores counts in no baseline and no low streak', () => {
  const history = [70, 72, 74, 76, 78, 70, 72, 74];
  const clean = computeDriverRecord([], summary({ sleepScore: 75, sleepScoreHistory: history }));
  const zeros = computeDriverRecord([], summary({ sleepScore: 75, sleepScoreHistory: [0, 0, ...history] }));
  assert.equal(zeros.drivers.sleep_7d_avg_delta, clean.drivers.sleep_7d_avg_delta);
  assert.deepEqual(zeros.baselines, clean.baselines);
  assert.equal(zeros.drivers.consecutive_low_sleep_nights, clean.drivers.consecutive_low_sleep_nights);
});

test('a 0 night in the prior week leaves the HRV average, so a real drop still shows', async () => {
  const realFetch = globalThis.fetch;
  const days = [0, 1, 2, 3, 4, 5].map(dayAgo);
  const hrvs = [40, 60, 0, 60, 0, 60];
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify(
    String(url).includes('/sleep?') && !String(url).includes('daily_sleep')
      ? { data: days.map((day, i) => ({ day, type: 'long_sleep', total_sleep_duration: 25000, average_hrv: hrvs[i], lowest_heart_rate: 50 })) }
      : { data: [] },
  ), { status: 200 })) as typeof fetch;
  try {
    const s = await fetchOuraSummary('tok', { localToday: today });
    assert.equal(s.hrvWeekAvgMs, 60);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the charts behind the read plot no 0 and keep the read baseline', () => {
  const nights = [0, 1, 2, 3].map((n) => ({ day: dayAgo(n), sleepSeconds: n === 1 ? 0 : 25000, hrvMs: n === 1 ? 0 : 50, restingHr: n === 1 ? 0 : 50 }));
  const scores = [0, 1, 2, 3].map((n) => ({ day: dayAgo(n), score: n === 1 ? 0 : 80 }));
  const s = buildDriverSeries([], summary({ nights, sleepScoreNights: scores, sleepScoreHistory: [0, 80, 80, 80] }), today, 28, now);
  for (const key of ['sleep', 'hrv', 'resting_hr', 'sleep_score'] as const) {
    assert.ok(s[key], key);
    assert.ok(s[key]!.points.every((p) => p.value > 0), key);
  }
  assert.equal(s.sleep_score!.baseline, 80);
});

test('usableRecovery can run twice and keeps a history it was not given absent', () => {
  const once = usableRecovery(summary({ readinessScore: 0, restingHrHistory: [0, 50] }))!;
  assert.equal(once.readinessScore, null);
  assert.deepEqual(once.restingHrHistory, [50]);
  assert.deepEqual(usableRecovery(once), once);
  assert.equal('sleepScoreHistory' in once, false);
});

test('a ring reporting only zeros gives way to Apple Health on the read', async () => {
  // Sticky: the read looks the row up for Strava and for Oura.
  rest.handle('athletes', () => ({ body: [{
    strava_access_token: 'tok-a1', strava_refresh_token: 'ref-a1', strava_expires_at: Math.floor(now / 1000) + 3600,
    oura_access_token: 'oura-tok', oura_refresh_token: 'oura-ref', oura_expires_at: Math.floor(now / 1000) + 3600,
  }] }));
  guard.stravaActivities([run(1), run(3)]);
  guard.oura({
    sleep: { data: [{ day: today, type: 'long_sleep', total_sleep_duration: 0, average_hrv: 0, lowest_heart_rate: 0 }] },
    daily_sleep: { data: [{ day: today, score: 0 }] },
    daily_readiness: { data: [{ day: today, score: 0 }] },
  });
  guard.openAi('Load is 80 min this week.');
  const r = await app.inject({ method: 'POST', url: '/api/read', payload: { athleteId: '42', today, health: { sleepSeconds: 25920, hrvMs: 52 } } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().connections.healthKit, true);
  assert.ok(r.json().drivers.some((d: any) => d.metric === 'HRV' && d.value === '52ms'), r.body);
});
