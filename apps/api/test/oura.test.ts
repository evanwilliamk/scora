// fetchOuraSummary reduces three Oura routes into the summary the cards and
// the driver record read. global fetch is stubbed; nothing reaches Oura.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOuraSummary } from '../src/oura';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;

function stubOura(routes: Record<string, unknown | number>) {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(`/${k}?`));
    const body = key ? routes[key] : undefined;
    if (body === undefined) return new Response('{}', { status: 404 });
    if (typeof body === 'number') return new Response('err', { status: body });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return urls;
}

test('last night plus prior-night history, newest first, naps ignored', async () => {
  const sleep = [17, 16, 15, 14, 13, 12, 11, 10, 9].map((d, i) => ({
    day: day(d), type: 'long_sleep', total_sleep_duration: 25000 + i, average_hrv: 50 + i, lowest_heart_rate: 48 + i,
  }));
  sleep.push({ day: day(17), type: 'nap', total_sleep_duration: 1200, average_hrv: 99, lowest_heart_rate: 70 });
  const dailySleep = Array.from({ length: 29 }, (_, i) => ({ day: `2026-${i < 17 ? '10' : '09'}-${String(i < 17 ? 17 - i : 30 - (i - 17)).padStart(2, '0')}`, score: 90 - i }));
  const urls = stubOura({ sleep: { data: sleep.reverse() }, daily_sleep: { data: dailySleep }, daily_readiness: { data: [{ day: day(17), score: 81 }] } });

  const s = await fetchOuraSummary('token');
  assert.equal(s.sleepSeconds, 25000);
  assert.equal(s.hrvMs, 50);
  assert.equal(s.restingHr, 48);
  assert.equal(s.sleepScore, 90);
  assert.equal(s.readinessScore, 81);
  assert.equal(s.hrvWeekAvgMs, Math.round((51 + 52 + 53 + 54 + 55 + 56 + 57) / 7));
  assert.deepEqual(s.restingHrHistory, [49, 50, 51, 52, 53, 54, 55]);
  assert.equal(s.sleepScoreHistory!.length, 28);
  assert.equal(s.sleepScoreHistory![0], 89, 'history excludes last night');

  const dailyUrl = urls.find((u) => u.includes('/daily_sleep?'))!;
  const sleepUrl = urls.find((u) => u.includes('/sleep?'))!;
  const span = (u: string) => {
    const q = new URL(u).searchParams;
    return (Date.parse(q.get('end_date')!) - Date.parse(q.get('start_date')!)) / 86400000;
  };
  assert.equal(span(dailyUrl), 30, 'sleep scores cover ~29 nights for the baselines');
  assert.equal(span(sleepUrl), 9);
});

test('a failing route leaves its fields null and never throws', async () => {
  stubOura({ sleep: 500, daily_sleep: { data: [{ day: day(17), score: 77 }] }, daily_readiness: 500 });
  const s = await fetchOuraSummary('token');
  assert.equal(s.sleepSeconds, null);
  assert.equal(s.hrvMs, null);
  assert.equal(s.sleepScore, 77);
  assert.deepEqual(s.sleepScoreHistory, []);
  assert.equal(s.readinessScore, null);
  assert.equal(s.restingHrHistory, undefined);
});

test('a night split into long_sleep plus a short sleep counts once, by its longest period', async () => {
  const sleep = [
    { day: day(17), type: 'long_sleep', total_sleep_duration: 26000, average_hrv: 50, lowest_heart_rate: 48 },
    { day: day(17), type: 'sleep', total_sleep_duration: 1800, average_hrv: 30, lowest_heart_rate: 60 },
    { day: day(16), type: 'long_sleep', total_sleep_duration: 25000, average_hrv: 52, lowest_heart_rate: 49 },
    { day: day(15), type: 'sleep', total_sleep_duration: 900, average_hrv: 20, lowest_heart_rate: 70 },
    { day: day(15), type: 'long_sleep', total_sleep_duration: 24000, average_hrv: 54, lowest_heart_rate: 50 },
  ];
  stubOura({ sleep: { data: sleep }, daily_sleep: { data: [] }, daily_readiness: { data: [] } });
  const s = await fetchOuraSummary('token');
  assert.equal(s.sleepSeconds, 26000);
  assert.equal(s.restingHr, 48);
  assert.deepEqual(s.restingHrHistory, [49, 50]);
  assert.equal(s.hrvWeekAvgMs, 53);
});
