// POST /api/weekly end to end (PRD 5.A.5): the Sunday review goes through the
// voice validators with its drivers (CLAUDE.md §3.2), retries then falls back,
// counts the 7 complete local days before the athlete's today, and an empty
// week is a short honest reply with no model call and no numbers.

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

const DAY = 86400000;
const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const dayOf = (daysAgo: number) => new Date(Date.parse(`${today}T00:00:00Z`) - daysAgo * DAY).toISOString().slice(0, 10);
const run = (daysAgo: number, mins: number, hr = 140) => {
  const at = `${dayOf(daysAgo)}T07:00:00Z`;
  return { type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, distance: mins * 170, moving_time: mins * 60, elapsed_time: mins * 60, average_heartrate: hr };
};
const week = () => [run(1, 50), run(3, 50), run(4, 40), run(6, 100, 145), run(9, 45), run(12, 90)];

const connected = () => rest.answer('athletes', {
  body: [{ strava_access_token: 'tok-a1', strava_refresh_token: 'ref-a1', strava_expires_at: Math.floor(now / 1000) + 3600 }],
});
const weekly = (body: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/api/weekly', payload: { athleteId: '42', today, ...body } });
const llmCalls = () => guard.calls.filter((c) => c.host === 'api.openai.com');
const CLEAN = 'The week held its shape. Four days of running, with the long effort carrying most of it.';
const stat = (stats: any[], label: string) => stats.find((s) => s.label === label)?.value;

test('weekly: a clean draft is the review, and the prompt carries only the drivers', async () => {
  connected();
  guard.stravaActivities(week());
  guard.openAi(CLEAN);
  const r = await weekly();
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().read.voice, CLEAN);
  assert.equal(llmCalls().length, 1);
  const prompt = llmCalls()[0].body.messages;
  assert.match(prompt[0].content, /never prescribe/);
  assert.match(prompt[1].content, /^DRIVERS \(the only values you may cite\):/);
});

test('weekly: banned phrasing twice falls back to a read that passes the validator', async () => {
  connected();
  guard.stravaActivities(week());
  guard.openAi('You should go for a long run next week.', 'As your coach, you need to do an easy week.');
  const r = await weekly();
  assert.equal(r.statusCode, 200, r.body);
  const { read, drivers } = r.json();
  assert.equal(llmCalls().length, 2);
  assert.match(llmCalls()[1].body.messages[1].content, /Your previous draft was rejected for/);
  assert.doesNotMatch(read.voice, /you should|you need to|coach|go for/i);
  assert.ok(validateVoice(read.voice, drivers).ok, read.voice);
});

test('weekly: the model failing is the validated fallback review, not a 500', async () => {
  connected();
  guard.stravaActivities(week());
  guard.openAi({ status: 429, body: { error: { message: 'rate limited' } } });
  const r = await weekly();
  assert.equal(r.statusCode, 200, r.body);
  const { read, drivers } = r.json();
  assert.equal(llmCalls().length, 1);
  assert.match(read.voice, /^This week: /);
  assert.ok(validateVoice(read.voice, drivers).ok, read.voice);
});

test('weekly: an invented number is caught and the retry is used', async () => {
  connected();
  guard.stravaActivities(week());
  guard.openAi('HRV averaged 97ms this week.', CLEAN);
  const r = await weekly();
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().read.voice, CLEAN);
  assert.equal(llmCalls().length, 2);
});

test('weekly: the 7 complete days before today, never today and never day 8', async () => {
  connected();
  guard.stravaActivities([run(0, 30), run(1, 50), run(7, 40), run(8, 60)]);
  guard.openAi(CLEAN);
  const r = await weekly();
  assert.equal(r.statusCode, 200, r.body);
  const { stats } = r.json();
  assert.equal(stat(stats, 'Days run'), '2/7');
  assert.equal(stat(stats, 'Load'), '90 min');
});

test('weekly: an empty week (no runs, no Oura) is a short honest reply, no model call, no numbers', async () => {
  connected();
  guard.stravaActivities([run(10, 60), run(12, 45)]);
  const r = await weekly();
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(llmCalls().length, 0);
  assert.match(body.read.voice, /^No runs logged in the last week\./);
  assert.doesNotMatch(body.read.voice, /\d/);
  assert.deepEqual(body.stats, []);
  assert.deepEqual(body.drivers, []);

  guard.reset();
  connected();
  guard.stravaActivities([]);
  const none = await weekly();
  assert.equal(none.statusCode, 200, none.body);
  assert.match(none.json().read.voice, /^No runs logged/);
});

test('weekly: a plan adds its line as a driver the voice may cite', async () => {
  connected();
  guard.stravaActivities(week());
  rest.answer('scheduled_workouts', {
    body: [1, 3, 4, 6].map((d) => ({
      id: `w${d}`, scheduled_date: dayOf(d), planned_type: 'run', planned_intensity: d === 6 ? 'long' : 'easy',
      planned_duration_min: d === 6 ? 100 : 50, planned_distance_km: null, planned_description: null,
      workout_structure_json: null, athlete_completed: null, training_plans: { current_status: 'active' },
    })),
  });
  guard.openAi('The week landed 240 of 250 planned run minutes.');
  const r = await weekly();
  assert.equal(r.statusCode, 200, r.body);
  const { read, drivers } = r.json();
  assert.deepEqual(drivers.find((d: any) => d.metric === 'Plan, last 7 full days'), { metric: 'Plan, last 7 full days', value: '240 of 250 planned run min' });
  assert.equal(read.voice, 'The week landed 240 of 250 planned run minutes.');
});
