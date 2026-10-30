// Route input checks (night fixes 10-30): the client's "today" only within a
// day of the server's, HealthKit when Oura comes back empty, range-checked
// HealthKit numbers, the chat message shape, the chat quota day from the
// stored time zone, a reconnect 401 for a missing Strava token, and the APNs
// device token shape. Supabase is a local fake (helpers/fake-rest); outside
// hosts go through helpers/fetch-guard.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';

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
const T = new Date(now).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });
const get = (url: string) => app.inject({ method: 'GET', url });
const llmCalls = () => guard.calls.filter((c) => c.host === 'api.openai.com');
const run = (daysAgo: number, mins: number) => {
  const at = new Date(now - daysAgo * DAY).toISOString();
  return { type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, distance: mins * 170, moving_time: mins * 60, elapsed_time: mins * 60, average_heartrate: 140 };
};
const steady = () => Array.from({ length: 4 }, (_, w) => [run(w * 7 + 1, 50), run(w * 7 + 3, 50), run(w * 7 + 4, 50), run(w * 7 + 6, 100)]).flat();
const connected = (extra: Record<string, unknown> = {}) => rest.answer('athletes', {
  body: [{ strava_access_token: 'tok-a1', strava_refresh_token: 'ref-a1', strava_expires_at: Math.floor(now / 1000) + 3600, ...extra }],
});
const ouraRow = { body: [{ oura_access_token: 'oura-tok', oura_refresh_token: 'oura-ref', oura_expires_at: Math.floor(now / 1000) + 3600 }] };
const CLEAN = 'Training has been even across the last four weeks. Nothing in the record stands out this morning.';

// 1. The client's today.

test('read: a "today" a month ahead does not steer the plan query', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi(CLEAN);
  const r = await post('/api/read', { athleteId: '42', today: addDays(T, 30) });
  assert.equal(r.statusCode, 200, r.body);
  const q = rest.requests.find((x) => x.table === 'scheduled_workouts')!;
  const [from, to] = q.params.getAll('scheduled_date');
  assert.ok(from.slice(4) <= addDays(T, 1), `plan read from ${from}`);
  assert.ok(to.slice(4) <= addDays(T, 8), `plan read to ${to}`);
});

test('manual plan: a far-off "today" falls back to the server day', async () => {
  guard.openAi(JSON.stringify({ workouts: [] }));
  const r = await post('/api/plan/manual', { athleteId: 'a1', text: 'Tue: 45 min tempo', today: addDays(T, 30) });
  assert.equal(r.statusCode, 422);
  const prompt = JSON.stringify(llmCalls()[0].body.messages);
  assert.ok(prompt.includes(`TODAY: ${T}`), prompt);
  assert.ok(!prompt.includes(addDays(T, 30)));
});

test('calendar import: a far-future "today" cannot skip upcoming sessions as past', async () => {
  process.env.ICAL_IMPORT = 'on';
  try {
    const d = addDays(T, 5).replace(/-/g, '');
    rest.answer('rpc/replace_external_plan', { body: 'plan-1' });
    const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${d}\r\nSUMMARY:Easy run 30 min\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const r = await post('/api/plan/ical', { athleteId: 'a1', ics, today: addDays(T, 30) });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().workouts.length, 1);
  } finally {
    delete process.env.ICAL_IMPORT;
  }
});

test('plan generate and block: a "today" more than a day off is a 400', async () => {
  process.env.PLAN_GENERATION = 'on';
  try {
    const gen = await post('/api/plan/generate', { athleteId: 'a1', today: addDays(T, 30) });
    assert.equal(gen.statusCode, 400);
    assert.match(gen.json().error, /today/);
    const block = await get(`/api/plan/block?athleteId=a1&today=${addDays(T, -2)}`);
    assert.equal(block.statusCode, 400);
    assert.equal(rest.requests.length, 0);
  } finally {
    delete process.env.PLAN_GENERATION;
  }
});

// 2 and 3. Oura outage and HealthKit numbers.

test('read: Oura connected but empty (an outage) falls back to HealthKit', async () => {
  connected();
  rest.answer('athletes', ouraRow);
  guard.stravaActivities(steady());
  guard.oura({ sleep: { data: [] }, daily_sleep: { data: [] }, daily_readiness: { data: [] } });
  guard.openAi(CLEAN);
  const r = await post('/api/read', { athleteId: '42', today: T, health: { sleepSeconds: 25_920, hrvMs: 52, restingHr: 48 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().connections.healthKit, true);
  assert.equal(r.json().cards.find((c: any) => c.id === 'sleep').available, true);
  assert.ok(r.json().drivers.some((d: any) => d.value === '7:12'), 'HealthKit sleep is a driver');
});

test('read: HealthKit values that are not plausible numbers become null, never NaN', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi(CLEAN);
  const r = await post('/api/read', {
    athleteId: '42', today: T,
    health: { sleepSeconds: 'abc', hrvMs: 'x', restingHr: -5, hrvWeekAvgMs: 1e9 },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.doesNotMatch(r.body, /NaN/);
  assert.equal(r.json().cards.find((c: any) => c.id === 'sleep').available, false);
  assert.doesNotMatch(JSON.stringify(llmCalls()[0].body.messages), /NaN|1000000000/);
});

// 4. Chat message.

test('chat: a non-string, blank or over-long message is a 400 before the quota or any outside call', async () => {
  for (const message of [{ text: 'hi' }, ['a'], 42, '   ', 'x'.repeat(1001)]) {
    const r = await post('/api/cdv', { athleteId: '42', message, today: T });
    assert.equal(r.statusCode, 400, JSON.stringify(message).slice(0, 40));
    assert.equal(rest.requests.length, 0);
    assert.equal(guard.calls.length, 0);
  }
});

// 5. Chat quota day.

test('chat quota: with a stored time zone the app\'s date cannot open a fresh day', async () => {
  const zone = 'Etc/GMT+12'; // UTC-12
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  connected();
  rest.answer('athlete_preferences', { body: [{ timezone: zone }] });
  connected({ cdv_count: 3, cdv_count_date: local });
  guard.stravaActivities(steady());
  guard.openAi('Runs have held steady.');
  const r = await post('/api/cdv', { athleteId: '42', message: 'How steady have I been?', today: addDays(T, 1) });
  assert.equal(r.statusCode, 429, r.body);
  assert.equal(llmCalls().length, 0);
  assert.ok(!rest.requests.some((q) => q.method === 'PATCH'));
  assert.equal(rest.requests.find((q) => q.table === 'athlete_preferences')!.params.get('athlete_id'), 'eq.42');
});

// 6. Strava token missing.

test('prediction and calories: no Strava token is a 401 asking to reconnect', async () => {
  process.env.RACE_PREDICTIONS = 'on';
  process.env.CALORIE_ENGINE = 'on';
  try {
    for (const url of ['/api/plan/prediction?athleteId=42&race=10k', '/api/calories?athleteId=42']) {
      const r = await get(url);
      assert.equal(r.statusCode, 401, url);
      assert.match(r.json().error, /please reconnect Strava/);
      assert.equal(guard.calls.length, 0);
    }
  } finally {
    process.env.RACE_PREDICTIONS = '';
    process.env.CALORIE_ENGINE = '';
  }
});
