// The plan routes past their input checks, against a local fake of
// Supabase's REST endpoint (helpers/fake-rest). No real service: only the
// Supabase URL points at 127.0.0.1; OpenAI and Strava keys stay blank.

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
beforeEach(() => rest.reset());

const ID = '11111111-2222-3333-4444-555555555555';
const get = (url: string) => app.inject({ method: 'GET', url });
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const serverDay = () => new Date().toISOString().slice(0, 10);
const range = (r: { params: URLSearchParams }) => r.params.getAll('scheduled_date');

const session = (date: string, intensity: string, over: Record<string, unknown> = {}) => ({
  id: `${date}-${intensity}`, scheduled_date: date, planned_type: 'run', planned_intensity: intensity,
  planned_duration_min: 45, planned_distance_km: null, planned_description: null, workout_structure_json: null,
  athlete_completed: null, training_plans: { current_status: 'active' }, ...over,
});

test('GET /api/plan: the next 26 weeks and the last 7 days, SCORA sessions described from their steps', async () => {
  const steps = [
    { type: 'warmup', duration_min: 10, intensity: 'easy' },
    { type: 'steady', duration_min: 25, intensity: 'tempo' },
    { type: 'cooldown', duration_min: 10, intensity: 'easy' },
  ];
  rest.answer('scheduled_workouts',
    { body: [session('2026-10-29', 'tempo', { workout_structure_json: steps }), session('2026-10-30', 'easy', { planned_description: 'Easy 30 min' })] },
    { body: [
      session('2026-10-26', 'easy'),
      session('2026-10-27', 'tempo', { athlete_completed: true }),
      session('2026-10-28', 'rest'),
    ] },
  );
  const r = await get('/api/plan?athleteId=a1&today=2026-10-29');
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.today, '2026-10-29');
  assert.match(body.workouts[0].planned_description, /^45-minute tempo\. 10 minutes easy, 25 minutes at tempo, 10 minutes easy\.$/);
  assert.equal(body.workouts[1].planned_description, 'Easy 30 min', 'pasted text is kept as written');
  assert.ok(!('training_plans' in body.workouts[0]), 'the join is not sent to the app');
  // Only unmarked, non-rest sessions wait to be acknowledged (CLAUDE.md §6.2).
  assert.deepEqual(body.recent.map((w: any) => w.scheduled_date), ['2026-10-26']);
  const [ahead, back] = rest.requests;
  assert.deepEqual(range(ahead), ['gte.2026-10-29', 'lte.2027-04-29']);
  assert.deepEqual(range(back), ['gte.2026-10-22', 'lte.2026-10-28']);
  for (const q of [ahead, back]) {
    assert.equal(q.params.get('athlete_id'), 'eq.a1');
    assert.equal(q.params.get('training_plans.current_status'), 'eq.active');
  }
});

test('GET /api/plan shows at most 14 sessions ahead', async () => {
  const many = Array.from({ length: 20 }, (_, i) => session(addDays('2026-10-29', i), 'easy'));
  rest.answer('scheduled_workouts', { body: many });
  const r = await get('/api/plan?athleteId=a1&today=2026-10-29');
  assert.equal(r.json().workouts.length, 14);
});

test('GET /api/plan: a storage error is a 500 with a plain message, no detail', async () => {
  rest.answer('scheduled_workouts', { status: 500, body: { code: 'XX000', message: 'secret internal detail', details: null, hint: null } });
  const r = await get('/api/plan?athleteId=a1&today=2026-10-29');
  assert.equal(r.statusCode, 500);
  assert.deepEqual(r.json(), { error: 'Loading the plan failed.' });
});

test('status: done marks the session; the app date is used only within a day of the server', async () => {
  rest.answer('scheduled_workouts', { body: [{ id: ID, training_plan_id: 'p1', training_plans: { current_status: 'active' } }] }, { body: [{ id: ID }] });
  const ok = await post(`/api/plan/workouts/${ID}/status`, { athleteId: 'a1', status: 'done', today: addDays(serverDay(), 1) });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { id: ID, status: 'done' });
  const [find, update] = rest.requests;
  assert.equal(find.params.get('scheduled_date'), `lte.${addDays(serverDay(), 1)}`);
  assert.equal(update.method, 'PATCH');
  assert.equal(update.body.athlete_completed, true);

  // A far-future "today" cannot mark sessions still ahead: the server's day is used.
  rest.reset();
  const far = await post(`/api/plan/workouts/${ID}/status`, { athleteId: 'a1', status: 'missed', today: addDays(serverDay(), 30) });
  assert.equal(far.statusCode, 404);
  assert.equal(rest.requests[0].params.get('scheduled_date'), `lte.${serverDay()}`);
  assert.equal(rest.requests.length, 1, 'nothing is written when the session is not found');
});

test('status: missed records false, never moves anything', async () => {
  rest.answer('scheduled_workouts', { body: [{ id: ID, training_plan_id: 'p1' }] }, { body: [{ id: ID }] });
  const r = await post(`/api/plan/workouts/${ID}/status`, { athleteId: 'a1', status: 'missed' });
  assert.equal(r.statusCode, 200);
  const writes = rest.requests.filter((q) => q.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.athlete_completed, false);
  assert.ok(!('scheduled_date' in writes[0].body), 'a miss never reschedules');
});

test('watch-sent stamps the session; someone else\'s session is a 404', async () => {
  rest.answer('scheduled_workouts', { body: [{ id: ID, training_plan_id: 'p1' }] }, { body: [{ id: ID }] });
  const r = await post(`/api/plan/workouts/${ID}/watch-sent`, { athleteId: 'a1' });
  assert.equal(r.statusCode, 200);
  assert.ok(typeof rest.requests[1].body.workout_kit_pushed_at === 'string');
  rest.reset();
  const none = await post(`/api/plan/workouts/${ID}/watch-sent`, { athleteId: 'someone-else' });
  assert.equal(none.statusCode, 404);
  assert.equal(rest.requests.length, 1);
});

test('adaptations: a coach plan hides SCORA\'s changes without listing them', async () => {
  process.env.PLAN_ADAPTATIONS = 'on';
  try {
    rest.answer('training_plans', { body: [{ id: 'coach-plan' }] }, { body: [{ id: 'coach-plan' }] });
    for (const url of ['/api/plan/adaptations?athleteId=a1', '/api/plan/adaptations/history?athleteId=a1']) {
      const r = await get(url);
      assert.equal(r.statusCode, 200, url);
      assert.deepEqual(r.json(), { adaptations: [] });
    }
    assert.ok(rest.requests.every((q) => q.table === 'training_plans'));
    assert.equal(rest.requests[0].params.get('source'), 'eq.coach');
  } finally {
    process.env.PLAN_ADAPTATIONS = '';
  }
});

test('adaptations: the list skips dismissed changes; history keeps them', async () => {
  process.env.PLAN_ADAPTATIONS = 'on';
  try {
    const row = { id: 'ad1', adaptation_type: 'moved', original_date: '2026-10-28', new_date: '2026-10-29', reason_code: 'posture_rest_hard_scheduled', reason_text: 'Moved to Wednesday.', triggered_at: '2026-10-27T13:00:00Z', training_plans: { current_status: 'active' } };
    rest.answer('plan_adaptations', { body: [row] });
    const list = await get('/api/plan/adaptations?athleteId=a1');
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().adaptations[0].reason_text, 'Moved to Wednesday.');
    assert.ok(!('training_plans' in list.json().adaptations[0]), 'the join is not sent to the app');
    const listQuery = rest.requests.find((q) => q.table === 'plan_adaptations')!;
    assert.equal(listQuery.params.get('dismissed_at'), 'is.null');

    rest.reset();
    rest.answer('plan_adaptations', { body: [{ ...row, dismissed_at: '2026-10-28T08:00:00Z' }] });
    const hist = await get('/api/plan/adaptations/history?athleteId=a1');
    assert.equal(hist.statusCode, 200);
    assert.equal(hist.json().adaptations.length, 1);
    assert.equal(rest.requests.find((q) => q.table === 'plan_adaptations')!.params.get('dismissed_at'), null);
  } finally {
    process.env.PLAN_ADAPTATIONS = '';
  }
});

test('adaptation dismiss: only the athlete\'s own open change', async () => {
  process.env.PLAN_ADAPTATIONS = 'on';
  try {
    rest.answer('plan_adaptations', { body: [{ id: ID, training_plan_id: 'p1', adaptation_type: 'downgraded', new_date: null }] });
    const ok = await post(`/api/plan/adaptations/${ID}/dismiss`, { athleteId: 'a1' });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json(), { dismissed: ID });
    const write = rest.requests[0];
    assert.equal(write.method, 'PATCH');
    assert.equal(write.params.get('athlete_id'), 'eq.a1');
    assert.equal(write.params.get('dismissed_at'), 'is.null');

    rest.reset();
    const none = await post(`/api/plan/adaptations/${ID}/dismiss`, { athleteId: 'a2' });
    assert.equal(none.statusCode, 404);
  } finally {
    process.env.PLAN_ADAPTATIONS = '';
  }
});

test('plan options and block: empty while a coach plan is active (CLAUDE.md §5.3)', async () => {
  process.env.PLAN_GENERATION = 'on';
  try {
    rest.answer('training_plans', { body: [{ id: 'coach-plan' }] });
    const opts = await get('/api/plan/options?athleteId=a1');
    assert.equal(opts.statusCode, 200);
    assert.deepEqual(opts.json(), { goals: [] });

    rest.reset();
    rest.answer('training_plans', { body: [{ id: 'coach-plan' }] });
    const block = await get('/api/plan/block?athleteId=a1&today=2026-10-29');
    assert.equal(block.statusCode, 200);
    assert.deepEqual(block.json(), { block: null });

    // No coach plan and no SCORA plan: still no block.
    rest.reset();
    const empty = await get('/api/plan/block?athleteId=a1&today=2026-10-29');
    assert.deepEqual(empty.json(), { block: null });
    assert.equal(rest.requests.length, 2);
  } finally {
    process.env.PLAN_GENERATION = '';
  }
});
