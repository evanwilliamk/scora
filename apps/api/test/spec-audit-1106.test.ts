// Pins from the 2026-11-06 spec audit (docs/spec-audit-1106.md): behavior doc 02
// and doc 09 ask for that had no test of its own. No behavior changes here.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';
import { goalLabel } from '../src/plan-generate';
import { predictRace } from '../src/race-prediction';

blankEnv();

test('doc 09 §2.3: each goal race has its label for the plan setup screen', () => {
  const goals: Record<string, string> = {
    '5k': '5K', '10k': '10K', half_marathon: 'Half marathon', marathon: 'Marathon',
    '50k': '50K', '100k': '100K', '100mi': '100 miles', gravel_century: 'Gravel century',
    century: 'Century', olympic_tri: 'Olympic tri', sprint_tri: 'Sprint tri',
  };
  for (const [goal, label] of Object.entries(goals)) assert.equal(goalLabel(goal), label);
});

test('PRD §5.B.6 gap, pinned: only road distances get a prediction, longer and other-sport goals say no estimate', () => {
  for (const goal of ['50k', '100k', '100mi', 'gravel_century', 'century', 'olympic_tri', 'sprint_tri']) {
    assert.deepEqual(predictRace([], goal, '2026-10-20'), { ok: false, race: goal, reason: 'unknown_race' });
  }
  for (const goal of ['5k', '10k', 'half_marathon', 'marathon']) {
    assert.notEqual((predictRace([], goal, '2026-10-20') as any).reason, 'unknown_race', goal);
  }
});

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
const run = (daysAgo: number, mins: number) => {
  const at = new Date(now - daysAgo * DAY).toISOString();
  return { type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, distance: mins * 170, moving_time: mins * 60, elapsed_time: mins * 60, average_heartrate: 140 };
};
const steady = () => Array.from({ length: 4 }, (_, w) => [run(w * 7 + 1, 50), run(w * 7 + 3, 50), run(w * 7 + 4, 50), run(w * 7 + 6, 100)]).flat();
const connected = (extra: Record<string, unknown> = {}) => rest.answer('athletes', {
  body: [{ strava_access_token: 'tok-a1', strava_refresh_token: 'ref-a1', strava_expires_at: Math.floor(now / 1000) + 3600, ...extra }],
});
const CLEAN = 'Training has been even across the last four weeks. Nothing in the record stands out this morning.';
const read = () => app.inject({ method: 'POST', url: '/api/read', payload: { athleteId: '42', today } });
const pastedToday = () => ({
  id: '00000000-0000-4000-8000-000000000001',
  scheduled_date: today,
  planned_type: 'run',
  planned_intensity: 'tempo',
  planned_duration_min: 45,
  planned_distance_km: null,
  planned_description: 'Tempo 45 min',
  workout_structure_json: null,
});

test('PRD §5.A.3: the read returns the dashboard cards in the spec\'s order, with no Plan Today without a plan', async () => {
  connected();
  guard.stravaActivities(steady());
  guard.openAi(CLEAN);
  const r = await read();
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().cards.map((c: any) => c.id), ['sleep', 'training_load', 'recent_intensity', 'recovery_signal', 'long_effort', 'connections']);
});

test('PRD §5.A.3: with a plan, Plan Today sits right before Connections', async () => {
  connected();
  guard.stravaActivities(steady());
  rest.answer('scheduled_workouts', { body: [pastedToday()] });
  guard.openAi(CLEAN);
  const r = await read();
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().cards.map((c: any) => c.id).slice(-3), ['long_effort', 'plan_today', 'connections']);
});

test('PRD §5.A.4: the fourth chat of the day answers with its sentence and the counts (wording differs from the PRD, see the audit)', async () => {
  connected({ cdv_count: 3, cdv_count_date: today });
  const r = await app.inject({ method: 'POST', url: '/api/cdv', payload: { athleteId: '42', message: 'How was my week?', today } });
  assert.equal(r.statusCode, 429, r.body);
  assert.deepEqual(r.json(), { error: "You've used your 3 chats for today. Resets tomorrow.", used: 3, limit: 3, remaining: 0 });
});
