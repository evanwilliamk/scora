// Manual plan paste, preferences, device registration, the weekly read and
// the chat quota, driven through the real routes. Supabase is a local fake
// (helpers/fake-rest); outside hosts go through helpers/fetch-guard.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';
import { validateVoice } from '../src/validator';

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

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });
const llmCalls = () => guard.calls.filter((c) => c.host === 'api.openai.com');

test('manual plan: numbers the text does not state are dropped before saving', async () => {
  const text = 'Tue: 45 min tempo\nThu: easy run';
  guard.openAi(JSON.stringify({ workouts: [
    { date: '2026-10-27', type: 'run', intensity: 'tempo', duration_min: 45, description: 'Tue: 45 min tempo' },
    { date: '2026-10-29', type: 'run', intensity: 'easy', duration_min: 40, description: 'Thu: easy run' },
  ] }));
  rest.answer('rpc/replace_manual_plan', { body: 'plan-1' });
  const r = await post('/api/plan/manual', { athleteId: 'a1', text, today: '2026-10-26' });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.planId, 'plan-1');
  const saved = rest.requests.find((q) => q.table === 'rpc/replace_manual_plan')!;
  assert.equal(saved.body.p_athlete_id, 'a1');
  assert.equal(saved.body.p_raw_text, text);
  const thu = saved.body.p_rows.find((w: any) => w.date === '2026-10-29');
  assert.equal(thu.duration_min, null, 'the model\'s 40 minutes is not in the text');
  assert.equal(saved.body.p_rows.find((w: any) => w.date === '2026-10-27').duration_min, 45);
  assert.ok(body.adjusted.some((a: string) => /duration 40 min is not written/.test(a)));
});

test('manual plan: nothing with a day is a 422 and nothing is saved', async () => {
  guard.openAi(JSON.stringify({ workouts: [] }));
  const r = await post('/api/plan/manual', { athleteId: 'a1', text: 'Run more this month', today: '2026-10-26' });
  assert.equal(r.statusCode, 422);
  assert.match(r.json().error, /No sessions with a day or date/);
  assert.equal(rest.requests.length, 0);
});

test('preferences: defaults for a new athlete; a save upserts and answers in app shape', async () => {
  const g = await app.inject({ method: 'GET', url: '/api/preferences?athleteId=a1' });
  assert.equal(g.statusCode, 200, g.body);
  assert.equal(g.json().onboarded, false);
  assert.equal(typeof g.json().deliveryMinute, 'number');

  rest.reset();
  // Read, upsert, read back what was saved.
  rest.answer('athlete_preferences', { body: [] }, { body: [] }, {
    body: [{ athlete_id: 'a1', timezone: 'America/Los_Angeles', delivery_minute: 390, onboarded_at: '2026-10-29T09:00:00Z' }],
  });
  const p = await app.inject({ method: 'PUT', url: '/api/preferences', payload: { athleteId: 'a1', timezone: 'America/Los_Angeles', deliveryMinute: 390, onboarded: true } });
  assert.equal(p.statusCode, 200, p.body);
  assert.equal(p.json().timezone, 'America/Los_Angeles');
  assert.equal(p.json().deliveryMinute, 390);
  assert.equal(p.json().onboarded, true);
  const upsert = rest.requests.find((q) => q.method === 'POST' && q.table === 'athlete_preferences')!;
  assert.equal(upsert.params.get('on_conflict'), 'athlete_id');
  assert.equal(upsert.body.delivery_minute, 390);
  assert.ok(typeof upsert.body.onboarded_at === 'string', 'first onboarding is stamped');

  const bad = await app.inject({ method: 'PUT', url: '/api/preferences', payload: { athleteId: 'a1', timezone: 'Mars/Olympus' } });
  assert.equal(bad.statusCode, 400);
});

test('register-device upserts on the token, so a phone moving accounts follows its athlete', async () => {
  const r = await post('/api/register-device', { athleteId: 'a1', deviceToken: 'abc123' });
  assert.equal(r.statusCode, 200, r.body);
  const q = rest.requests[0];
  assert.equal(q.table, 'device_tokens');
  assert.equal(q.method, 'POST');
  assert.equal(q.params.get('on_conflict'), 'token');
  assert.equal(q.body.athlete_id, 'a1');
  assert.equal(q.body.platform, 'ios');
});

const DAY = 86400000;
const now = Date.now();
const run = (daysAgo: number, mins: number) => {
  const at = new Date(now - daysAgo * DAY).toISOString();
  return { type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, distance: mins * 170, moving_time: mins * 60, elapsed_time: mins * 60, average_heartrate: 140 };
};
const twoWeeks = () => [1, 2, 4, 6, 8, 9, 11, 13].map((d, i) => run(d, i % 4 === 3 ? 100 : 50));
const connected = (extra: Record<string, unknown> = {}) => rest.answer('athletes', {
  body: [{ strava_access_token: 'tok-a1', strava_refresh_token: 'ref-a1', strava_expires_at: Math.floor(now / 1000) + 3600, ...extra }],
});

test('weekly read: banned phrasing never reaches the athlete', async () => {
  connected();
  guard.stravaActivities(twoWeeks());
  guard.openAi('Great week. You should take a rest day.', 'Crush it next week.');
  const r = await post('/api/weekly', { athleteId: '42' });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(llmCalls().length, 2);
  assert.ok(body.read.voice.length > 0);
  assert.doesNotMatch(body.read.voice, /you should|crush it|rest day/i);
  assert.ok(validateVoice(body.read.voice, body.drivers).ok, body.read.voice);
});

test('chat quota: a spent day is a 429 and the model is never asked', async () => {
  const today = new Date(now).toISOString().slice(0, 10);
  // Token lookup and quota both read the athlete row.
  connected({ cdv_count: 3, cdv_count_date: today });
  connected({ cdv_count: 3, cdv_count_date: today });
  guard.stravaActivities(twoWeeks());
  const r = await post('/api/cdv', { athleteId: '42', message: 'How has my long run changed?', today });
  assert.equal(r.statusCode, 429, r.body);
  assert.equal(r.json().remaining, 0);
  assert.equal(llmCalls().length, 0);
  assert.ok(!rest.requests.some((q) => q.method === 'PATCH'), 'a refused chat does not count');
});

test('chat: a clean answer counts one query and draws the chart from the activities', async () => {
  const today = new Date(now).toISOString().slice(0, 10);
  connected({ cdv_count: 1, cdv_count_date: today });
  connected({ cdv_count: 1, cdv_count_date: today });
  guard.stravaActivities(twoWeeks());
  guard.openAi('Runs have held steady across the last two weeks.\nCHART: weekly_miles');
  const r = await post('/api/cdv', { athleteId: '42', message: 'How steady have I been?', today });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.voice, 'Runs have held steady across the last two weeks.');
  assert.equal(body.remaining, 1);
  assert.ok(body.chart, 'the chart is built in code from the activities');
  const count = rest.requests.find((q) => q.method === 'PATCH' && q.table === 'athletes')!;
  assert.deepEqual({ n: count.body.cdv_count, d: count.body.cdv_count_date }, { n: 2, d: today });
});

test('chat: prescriptive drafts are replaced, never sent', async () => {
  const today = new Date(now).toISOString().slice(0, 10);
  connected({ cdv_count: 0, cdv_count_date: today });
  connected({ cdv_count: 0, cdv_count_date: today });
  guard.stravaActivities(twoWeeks());
  guard.openAi('You should go for a long run today.\nCHART: none', 'You need to do a hard session.\nCHART: none');
  const r = await post('/api/cdv', { athleteId: '42', message: 'What should I run today?', today });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(llmCalls().length, 2);
  assert.doesNotMatch(r.json().voice, /you should|you need to|go for|do a hard/i);
});
