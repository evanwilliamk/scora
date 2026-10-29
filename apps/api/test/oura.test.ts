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
  assert.equal(span(sleepUrl), 30, 'sleep periods cover ~29 nights for the inline charts');
  // Dated nights for the charts: one per night, newest first, nap excluded.
  assert.equal(s.nights!.length, 9);
  assert.equal(s.nights![0].day, day(17));
  assert.notEqual(s.nights![0].hrvMs, 99);
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

test('late naps, rests and deleted periods never stand in for a night', async () => {
  const sleep = [
    { day: day(17), type: 'late_nap', total_sleep_duration: 30000, average_hrv: 90, lowest_heart_rate: 40 },
    { day: day(17), type: 'long_sleep', total_sleep_duration: 26000, average_hrv: 50, lowest_heart_rate: 48 },
    { day: day(16), type: 'rest', total_sleep_duration: 27000, average_hrv: 80, lowest_heart_rate: 41 },
    { day: day(15), type: 'deleted', total_sleep_duration: 28000, average_hrv: 70, lowest_heart_rate: 42 },
  ];
  stubOura({ sleep: { data: sleep }, daily_sleep: { data: [] }, daily_readiness: { data: [] } });
  const s = await fetchOuraSummary('token');
  assert.equal(s.sleepSeconds, 26000);
  assert.deepEqual(s.restingHrHistory, []);
});

test('the Oura authorize URL asks for a code at the callback; state carries the athlete id unsigned today (Q18)', async () => {
  const { buildOuraAuthorizeUrl, OURA_REDIRECT_URI } = await import('../src/oura');
  const u = new URL(buildOuraAuthorizeUrl('12345'));
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('redirect_uri'), OURA_REDIRECT_URI);
  assert.match(OURA_REDIRECT_URI, /\/api\/auth\/oura\/callback$/);
  assert.ok(u.searchParams.get('scope'));
  // Pinned so the Q18 change (an HMAC-signed state) shows up as a deliberate test edit.
  assert.equal(u.searchParams.get('state'), '12345');
});

test('with the athlete\'s date, a stale newest night is not "last night" (review 10-29)', async () => {
  // Ring off for four nights: the newest night is the 13th, today is the 17th.
  const sleep = [13, 12, 11, 10].map((d, i) => ({ day: day(d), type: 'long_sleep', total_sleep_duration: 26000 + i, average_hrv: 55 + i, lowest_heart_rate: 47 + i }));
  stubOura({ sleep: { data: sleep }, daily_sleep: { data: [{ day: day(13), score: 88 }] }, daily_readiness: { data: [{ day: day(13), score: 80 }] } });
  const s = await fetchOuraSummary('token', { localToday: day(17) });
  assert.equal(s.sleepSeconds, null);
  assert.equal(s.hrvMs, null);
  assert.equal(s.restingHr, null);
  assert.equal(s.sleepScore, null);
  assert.equal(s.readinessScore, null);
  assert.equal(s.nights!.length, 4, 'the chart series keeps every night');
});

test('last night is the night dated today (Oura dates a night by its morning); the score is that night\'s (review 10-29)', async () => {
  const sleep = [17, 16].map((d, i) => ({ day: day(d), type: 'long_sleep', total_sleep_duration: 27000 + i, average_hrv: 60 + i, lowest_heart_rate: 45 + i }));
  const urls = stubOura({ sleep: { data: sleep }, daily_sleep: { data: [{ day: day(17), score: 86 }, { day: day(16), score: 70 }] }, daily_readiness: { data: [{ day: day(17), score: 79 }] } });
  const s = await fetchOuraSummary('token', { localToday: day(17) });
  assert.equal(s.sleepSeconds, 27000);
  assert.equal(s.sleepScore, 86);
  assert.equal(s.readinessScore, 79);
  assert.deepEqual(s.sleepScoreHistory, [70], 'the scored night stays out of the baseline');
  // Ranges end after the athlete's today, whatever the server's date.
  assert.ok(urls.every((u) => (new URL(u).searchParams.get('end_date') ?? '') > day(17)));
});

test('the night before last is not last night: ring off or not yet synced (review 10-29)', async () => {
  const sleep = [16, 15].map((d, i) => ({ day: day(d), type: 'long_sleep', total_sleep_duration: 27000 + i, average_hrv: 60 + i, lowest_heart_rate: 45 + i }));
  stubOura({ sleep: { data: sleep }, daily_sleep: { data: [{ day: day(16), score: 70 }] }, daily_readiness: { data: [{ day: day(16), score: 75 }] } });
  const s = await fetchOuraSummary('token', { localToday: day(17) });
  assert.equal(s.sleepSeconds, null);
  assert.equal(s.sleepScore, null);
  assert.equal(s.readinessScore, null);
  assert.equal(s.nights!.length, 2);
});
