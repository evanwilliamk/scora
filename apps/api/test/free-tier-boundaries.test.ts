// CLAUDE.md §5.1 Free-tier boundaries, pinned as the API behaves today.
// There is no tier column yet (Q30), so every athlete is treated alike: these
// tests pin what already matches the Free spec, and the places where a flag,
// not a tier, decides. Findings table: docs/free-tier-boundaries.md.
// Supabase is a local fake (helpers/fake-rest); outside hosts go through
// helpers/fetch-guard, so nothing leaves the machine.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';
import { FREE_CDV_DAILY_LIMIT } from '../src/usage';
import { dueDeliveries, localClock, defaultPrefs } from '../src/delivery';
import { fetchOuraSummary } from '../src/oura';
import { buildDriverSeries, parseHealthNights } from '../src/driver-links';

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
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const run = (daysAgo: number, mins: number, hr = 140) => {
  const at = new Date(now - daysAgo * DAY).toISOString();
  return { type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, distance: mins * 170, moving_time: mins * 60, elapsed_time: mins * 60, average_heartrate: hr };
};
const steady = () => Array.from({ length: 4 }, (_, w) => [run(w * 7 + 1, 50), run(w * 7 + 3, 50), run(w * 7 + 4, 50), run(w * 7 + 6, 100, 145)]).flat();

const connected = (extra: Record<string, unknown> = {}) => rest.answer('athletes', {
  body: [{ strava_access_token: 'tok-a1', strava_refresh_token: 'ref-a1', strava_expires_at: Math.floor(now / 1000) + 3600, ...extra }],
});
const ouraRow = () => rest.answer('athletes', {
  body: [{ oura_access_token: 'oura-tok', oura_refresh_token: 'oura-ref', oura_expires_at: Math.floor(now / 1000) + 3600 }],
});
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });
const get = (url: string) => app.inject({ method: 'GET', url });
const llmCalls = () => guard.calls.filter((c) => c.host === 'api.openai.com');
const stravaAfter = () => Number(new URL(guard.calls.find((c) => c.host === 'www.strava.com')!.url).searchParams.get('after'));
const daysBack = (afterSec: number) => Math.round((now / 1000 - afterSec) / 86400);
const CLEAN = 'Training has been even across the last four weeks. Nothing in the record stands out this morning.';
const withEnv = async (name: string, fn: () => Promise<void>) => {
  process.env[name] = 'on';
  try { await fn(); } finally { delete process.env[name]; }
};

// --- Chat-driven viz: 3 queries a day, reset at the athlete's midnight ---

test('free cdv: the limit is 3 a day; the third is answered, the fourth is a 429 with no model call', async () => {
  assert.equal(FREE_CDV_DAILY_LIMIT, 3);
  connected({ cdv_count: 2, cdv_count_date: today });
  connected({ cdv_count: 2, cdv_count_date: today });
  guard.stravaActivities(steady());
  guard.openAi('Runs have held steady across the last four weeks.\nCHART: none');
  const third = await post('/api/cdv', { athleteId: '42', message: 'How steady have I been?', today });
  assert.equal(third.statusCode, 200, third.body);
  assert.deepEqual({ remaining: third.json().remaining, limit: third.json().limit }, { remaining: 0, limit: 3 });

  rest.reset();
  guard.reset();
  connected({ cdv_count: 3, cdv_count_date: today });
  connected({ cdv_count: 3, cdv_count_date: today });
  guard.stravaActivities(steady());
  const fourth = await post('/api/cdv', { athleteId: '42', message: 'And now?', today });
  assert.equal(fourth.statusCode, 429, fourth.body);
  assert.equal(fourth.json().limit, 3);
  assert.equal(llmCalls().length, 0);
});

test('free cdv: the count resets at the athlete\'s local midnight from the stored zone, and the app cannot pick the day', async () => {
  const tz = 'America/Los_Angeles';
  const zoneToday = localClock(new Date(), tz).date;
  // Spent yesterday (their day): today is a fresh quota, counted on their date.
  connected({ cdv_count: 3, cdv_count_date: addDays(zoneToday, -1) });
  rest.answer('athlete_preferences', { body: [{ timezone: tz }] });
  connected({ cdv_count: 3, cdv_count_date: addDays(zoneToday, -1) });
  guard.stravaActivities(steady());
  guard.openAi('Runs have held steady across the last four weeks.\nCHART: none');
  const fresh = await post('/api/cdv', { athleteId: '42', message: 'How steady have I been?', today: zoneToday });
  assert.equal(fresh.statusCode, 200, fresh.body);
  const count = rest.requests.find((q) => q.method === 'PATCH' && q.table === 'athletes')!;
  assert.deepEqual({ n: count.body.cdv_count, d: count.body.cdv_count_date }, { n: 1, d: zoneToday });

  // Spent today (their day): an app date of tomorrow buys nothing.
  rest.reset();
  guard.reset();
  connected({ cdv_count: 3, cdv_count_date: zoneToday });
  rest.answer('athlete_preferences', { body: [{ timezone: tz }] });
  connected({ cdv_count: 3, cdv_count_date: zoneToday });
  guard.stravaActivities(steady());
  const spent = await post('/api/cdv', { athleteId: '42', message: 'And now?', today: addDays(zoneToday, 1) });
  assert.equal(spent.statusCode, 429, spent.body);
});

test('free cdv: a failed quota lookup lets the query through (fail-open, documented)', async () => {
  connected();
  // No row for the quota read: the lookup throws and the route allows the chat.
  guard.stravaActivities(steady());
  guard.openAi('Runs have held steady across the last four weeks.\nCHART: none');
  const r = await post('/api/cdv', { athleteId: '42', message: 'How steady have I been?', today });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().remaining, undefined);
});

// --- 90-day data history ---

test('free history: the read, chat and weekly ask Strava for well under 90 days', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi(CLEAN);
  assert.equal((await post('/api/read', { athleteId: '42', today })).statusCode, 200);
  assert.equal(daysBack(stravaAfter()), 35);

  rest.reset(); guard.reset();
  connected({ cdv_count: 0, cdv_count_date: today });
  connected({ cdv_count: 0, cdv_count_date: today });
  guard.stravaActivities(steady());
  guard.openAi('Runs have held steady across the last four weeks.\nCHART: weekly_miles');
  assert.equal((await post('/api/cdv', { athleteId: '42', message: 'How steady have I been?', today })).statusCode, 200);
  assert.equal(daysBack(stravaAfter()), 56);

  rest.reset(); guard.reset();
  connected();
  guard.stravaActivities(steady());
  guard.openAi('The week held its shape.');
  assert.equal((await post('/api/weekly', { athleteId: '42', today })).statusCode, 200);
  assert.equal(daysBack(stravaAfter()), 15);
});

test('free history: Oura is asked for at most 30 days, HealthKit nights and chart series stop at 35 and 28', async () => {
  guard.oura({});
  await fetchOuraSummary('oura-tok', { localToday: today });
  const starts = guard.calls.filter((c) => c.host === 'api.ouraring.com').map((c) => new URL(c.url).searchParams.get('start_date')!);
  assert.ok(starts.length > 0);
  for (const s of starts) {
    const back = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / DAY;
    assert.ok(back <= 30, `Oura start_date ${s} is ${back} days back`);
  }

  const nights = Array.from({ length: 120 }, (_, i) => ({ day: addDays(today, -119 + i), sleepSeconds: 25000, hrvMs: 50, restingHr: 50 }));
  assert.equal(parseHealthNights(nights).length, 35);

  const series = buildDriverSeries(steady(), null, today);
  for (const s of Object.values(series)) assert.ok(s!.points.length <= 28, `${s!.key} has ${s!.points.length} points`);
});

// --- Sunday weekly read, delayed 24 hours ---

test('free weekly: the push is due Monday at the delivery time, never Sunday (24 hours late)', () => {
  const p = { ...defaultPrefs(), timezone: 'America/New_York', delivery_minute: 360 };
  // 2026-11-01 is a Sunday; 06:30 New York is 11:30 UTC (EST).
  const sunday = new Date(Date.UTC(2026, 10, 1, 11, 30));
  const monday = new Date(Date.UTC(2026, 10, 2, 11, 30));
  assert.equal(localClock(sunday, p.timezone).weekday, 0);
  assert.equal(dueDeliveries(p, sunday).weekly, false);
  assert.deepEqual(dueDeliveries(p, monday), { daily: true, weekly: true, localDate: '2026-11-02' });
});

test('free weekly (gap): POST /api/weekly has no weekday gate, so the app can pull it on Sunday', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi('The week held its shape.');
  const r = await post('/api/weekly', { athleteId: '42', today });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().read.voice.length > 0, 'answered whatever weekday today is');
});

// --- Card-level expansion vs word-level inline chart links ---

test('free expansion: with INLINE_CHARTS off the read has no word links, and card expand answers', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi(CLEAN);
  const r = await post('/api/read', { athleteId: 'free-1', today });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(!('links' in r.json().read) && !('series' in r.json().read));
  const card = await post('/api/card-expand', { athleteId: 'free-1', cardId: 'training_load' });
  assert.equal(card.statusCode, 200, card.body);
  assert.equal(card.json().cardId, 'training_load');
});

test('free expansion (gap, needs Q30): with INLINE_CHARTS on every athlete gets word links', async () => {
  await withEnv('INLINE_CHARTS', async () => {
    connected();
    guard.stravaActivities(steady());
    guard.openAi(CLEAN);
    const r = await post('/api/read', { athleteId: 'free-2', today });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(Array.isArray(r.json().read.links));
    assert.equal(typeof r.json().read.series, 'object');
  });
});

// --- Plan-tier features absent for Free ---

test('free scope: plan generation, adaptations, race predictions, calories and WhatsApp are 404 with flags off', async () => {
  const routes: [string, string, unknown?][] = [
    ['POST', '/api/plan/generate', { athleteId: 'a1', today }],
    ['GET', `/api/plan/options?athleteId=a1&today=${today}`],
    ['GET', `/api/plan/block?athleteId=a1&today=${today}`],
    ['GET', '/api/plan/prediction?athleteId=a1'],
    ['GET', '/api/calories?athleteId=a1'],
    ['GET', '/api/plan/adaptations?athleteId=a1'],
    ['GET', '/api/plan/adaptations/history?athleteId=a1'],
    ['POST', '/api/plan/adaptations/0b7c1d2e-1111-2222-3333-444455556666/dismiss', { athleteId: 'a1' }],
    ['POST', '/api/whatsapp/inbound', { From: 'whatsapp:+15550000000', Body: 'why' }],
  ];
  for (const [method, url, payload] of routes) {
    const r = method === 'GET' ? await get(url) : await post(url, payload);
    assert.equal(r.statusCode, 404, `${method} ${url}`);
  }
  assert.equal(rest.requests.length, 0, 'no storage touched');
  assert.equal(guard.calls.length, 0, 'no outside call');
});

test('free scope: the read never queries a SCORA plan or runs adaptations with flags off', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi(CLEAN);
  const r = await post('/api/read', { athleteId: '42', today });
  assert.equal(r.statusCode, 200, r.body);
  const tables = rest.requests.map((q) => q.table);
  assert.ok(!tables.includes('training_plans'), tables.join(','));
  assert.ok(!tables.includes('plan_adaptations'), tables.join(','));
});

test('free scope (gap): WorkoutKit watch-sent has no flag, so any athlete can record a Watch push', async () => {
  const ID = '0b7c1d2e-1111-2222-3333-444455556666';
  rest.answer('rpc/mark_workout_watch_sent', { body: true });
  const r = await post(`/api/plan/workouts/${ID}/watch-sent`, { athleteId: 'free-1' });
  assert.equal(r.statusCode, 200, r.body);
});

// --- Plan-aware read from the athlete's own plan source ---

const pastedToday = () => ({
  id: 'w-today', scheduled_date: today, planned_type: 'run', planned_intensity: 'tempo', planned_duration_min: 45,
  planned_distance_km: null, planned_description: 'Tue: 45 min tempo', athlete_completed: null,
  training_plans: { current_status: 'active' }, workout_structure_json: null,
});

test('free plan-aware read: a pasted session today reaches the prompt as a driver, with no Plan-tier Today line', async () => {
  connected();
  guard.stravaActivities(steady());
  rest.answer('scheduled_workouts', { body: [pastedToday()] });
  guard.openAi(CLEAN);
  const r = await post('/api/read', { athleteId: '42', today });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.plan.today, 'tempo, 45 min');
  assert.ok(body.drivers.some((d: any) => d.metric === 'Plan today'));
  assert.ok(!('today' in body.read));
  assert.match(llmCalls()[0].body.messages[1].content, /PLAN TODAY \(the athlete's own plan/);
});

test('free plan source: manual paste is open; iCal import is 404 unless ICAL_IMPORT=on (gap: a flag, not a tier)', async () => {
  const off = await post('/api/plan/ical', { athleteId: 'a1', ics: 'BEGIN:VCALENDAR', today });
  assert.equal(off.statusCode, 404);
  await withEnv('ICAL_IMPORT', async () => {
    const d = addDays(today, 3).replace(/-/g, '');
    rest.answer('rpc/replace_external_plan', { body: 'plan-1' });
    const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${d}\r\nSUMMARY:Easy run 30 min\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const on = await post('/api/plan/ical', { athleteId: 'a1', ics, today });
    assert.equal(on.statusCode, 200, on.body);
  });

  guard.openAi(JSON.stringify({ workouts: [{ date: addDays(today, 1), type: 'run', intensity: 'easy', duration_min: 30, description: 'easy run 30 min' }] }));
  rest.answer('rpc/replace_manual_plan', { body: 'plan-2' });
  const pasted = await post('/api/plan/manual', { athleteId: 'a1', text: 'easy run 30 min tomorrow', today });
  assert.equal(pasted.statusCode, 200, pasted.body);
});
