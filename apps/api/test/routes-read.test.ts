// POST /api/read end to end: athlete tokens from a fake Supabase REST server,
// Strava activities and OpenAI drafts from a fetch guard that blocks every
// other host. Checks the validators run on the route itself (CLAUDE.md §3.2)
// and the plan's Today line (§3.3).

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
const run = (daysAgo: number, mins: number, hr = 140) => {
  const at = new Date(now - daysAgo * DAY).toISOString();
  return { type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, distance: mins * 170, moving_time: mins * 60, elapsed_time: mins * 60, average_heartrate: hr };
};
// Four steady weeks: 4 runs a week, one long.
const steady = () => Array.from({ length: 4 }, (_, w) => [run(w * 7 + 1, 50), run(w * 7 + 3, 50), run(w * 7 + 4, 50), run(w * 7 + 6, 100, 145)]).flat();

const connected = () => rest.answer('athletes', {
  body: [{ strava_access_token: 'tok-a1', strava_refresh_token: 'ref-a1', strava_expires_at: Math.floor(now / 1000) + 3600 }],
});
const read = (body: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/api/read', payload: { athleteId: '42', today, ...body } });
const llmCalls = () => guard.calls.filter((c) => c.host === 'api.openai.com');
const CLEAN = 'Training has been even across the last four weeks. Nothing in the record stands out this morning.';

test('no stored Strava tokens: 401 before any outside call', async () => {
  const r = await read();
  assert.equal(r.statusCode, 401);
  assert.equal(guard.calls.length, 0);
});

test('a clean draft is the read; Strava is asked with the stored token', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi(CLEAN);
  const r = await read();
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.read.voice, CLEAN);
  assert.equal(typeof body.read.numbers, 'string');
  assert.ok(body.read.numbers.length > 0, 'numbers first (CLAUDE.md §3.3)');
  assert.ok(!('today' in body.read), 'no plan, no Today line');
  const strava = guard.calls.find((c) => c.host === 'www.strava.com')!;
  assert.equal((strava.init?.headers as any).Authorization, 'Bearer tok-a1');
  assert.equal(rest.requests.find((q) => q.table === 'athletes')!.params.get('strava_id'), 'eq.42');
  assert.equal(llmCalls().length, 1);
  // The prompt carries the drivers and the rules, never a workout to give.
  const prompt = llmCalls()[0].body.messages;
  assert.match(prompt[0].content, /never prescribe/);
  assert.match(prompt[1].content, /^DRIVERS \(the only values you may cite\):/);
});

test('banned phrasing twice: the read is the deterministic fallback, and it passes the validator', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi('You should do an easy run today.', 'You need to go for a long run.');
  const r = await read();
  assert.equal(r.statusCode, 200, r.body);
  const { read: out, drivers } = r.json();
  assert.equal(llmCalls().length, 2);
  assert.match(llmCalls()[1].body.messages[1].content, /Your previous draft was rejected for: banned phrasing/);
  assert.doesNotMatch(out.voice, /you should|you need to|go for/i);
  assert.ok(validateVoice(out.voice, drivers).ok, out.voice);
});

test('an invented number is caught and the retry is used', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi('HRV is 97ms and climbing.', CLEAN);
  const r = await read();
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().read.voice, CLEAN);
  assert.match(llmCalls()[1].body.messages[1].content, /numbers not in the drivers \(97/);
});

test('no recent activity: the plain reply, no model call', async () => {
  connected();
  guard.stravaActivities([]);
  const r = await read();
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.json().read.voice, /^Not enough recent activity to read yet\./);
  assert.equal(llmCalls().length, 0);
});

const tempoToday = () => ({
  id: 'w-today', scheduled_date: today, planned_type: 'run', planned_intensity: 'tempo', planned_duration_min: 45,
  planned_distance_km: null, planned_description: null, athlete_completed: null, training_plans: { current_status: 'active' },
  workout_structure_json: [
    { type: 'warmup', duration_min: 10, intensity: 'easy' },
    { type: 'steady', duration_min: 25, intensity: 'tempo' },
    { type: 'cooldown', duration_min: 10, intensity: 'easy' },
  ],
});

test('a SCORA session today adds the Today line, on a full read and on the no-activity reply', async () => {
  connected();
  guard.stravaActivities(steady());
  rest.answer('scheduled_workouts', { body: [tempoToday()] });
  guard.openAi(CLEAN);
  const full = await read();
  assert.equal(full.statusCode, 200, full.body);
  assert.equal(full.json().read.today, 'Today: 45-minute tempo. 10 minutes easy, 25 minutes at tempo, 10 minutes easy.');
  assert.equal(full.json().plan.today, 'tempo, 45 min');

  rest.reset();
  guard.reset();
  connected();
  guard.stravaActivities([]);
  rest.answer('scheduled_workouts', { body: [tempoToday()] });
  const empty = await read();
  assert.match(empty.json().read.voice, /^Not enough recent activity/);
  assert.equal(empty.json().read.today, 'Today: 45-minute tempo. 10 minutes easy, 25 minutes at tempo, 10 minutes easy.');
});

test('a pasted plan session gets no Today line (Free tier reads it in the voice)', async () => {
  connected();
  guard.stravaActivities(steady());
  rest.answer('scheduled_workouts', { body: [{ ...tempoToday(), workout_structure_json: null, planned_description: 'Tempo 45 min' }] });
  guard.openAi(CLEAN);
  const r = await read();
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(!('today' in r.json().read));
});

test('the model failing is a 500, never an unvalidated read', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi({ status: 503, body: { error: { message: 'overloaded' } } });
  const r = await read();
  assert.equal(r.statusCode, 500);
  assert.equal(r.json().error, 'Read generation failed');
});

// Card tap-to-expand reads the snapshot the last read left (10 min).
const expand = (cardId: string, athleteId = '42') => app.inject({ method: 'POST', url: '/api/card-expand', payload: { athleteId, cardId } });

test('card expand: no read yet is a 409; an unknown card is a 404', async () => {
  assert.equal((await expand('training_load', 'never-read')).statusCode, 409);
  connected();
  guard.stravaActivities(steady());
  guard.openAi(CLEAN);
  assert.equal((await read()).statusCode, 200);
  assert.equal((await expand('no-such-card')).statusCode, 404);
});

test('card expand: a generated expansion is validated like the read', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi(CLEAN);
  const r = await read();
  const cards: any[] = r.json().cards;
  const before = llmCalls().length;
  let checked = 0;
  for (const card of cards) {
    guard.openAi('You should go for a long run.', 'You need to do an easy run today.');
    const e = await expand(card.id);
    assert.equal(e.statusCode, 200, `${card.id}: ${e.body}`);
    const out = e.json();
    assert.equal(out.cardId, card.id);
    assert.doesNotMatch(out.reply, /you should|you need to|go for|do an easy/i, card.id);
    if (out.generated) {
      assert.ok(validateVoice(out.reply, out.drivers).ok, `${card.id}: ${out.reply}`);
      checked++;
    }
    guard.reset();
    guard.stravaActivities(steady());
  }
  assert.ok(checked > 0, 'at least one card asks the model');
  assert.ok(before >= 1);
});

test('card expand: the model down falls back to the card\'s own line', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi(CLEAN);
  const cards: any[] = (await read()).json().cards;
  // The training load card has data from the runs, so it asks the model.
  const card = cards.find((c) => c.id === 'training_load');
  assert.ok(card && card.available, 'training_load card is available');
  guard.openAi({ status: 503, body: {} });
  const e = await expand(card.id);
  assert.equal(e.statusCode, 200);
  assert.equal(llmCalls().length, 2, 'the read, then the failed expansion');
  assert.deepEqual(e.json(), { cardId: card.id, reply: card.translation ?? '', drivers: [], generated: false });
});
