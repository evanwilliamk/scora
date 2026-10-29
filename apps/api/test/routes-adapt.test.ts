// The read drives the plan engine (PLAN_ADAPTATIONS=on): a back-off posture
// with intervals on tomorrow's SCORA session writes one named downgrade at
// the same duration (CLAUDE.md §6.2). Supabase is a local fake; outside hosts
// go through the fetch guard.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';
import { validateVoice } from '../src/validator';

blankEnv();

const here = dirname(fileURLToPath(import.meta.url));
// The fixture is a draft; drafts never adapt in production (doc 07 v2 §8.3).
const draft = parseYaml(readFileSync(join(here, '..', '..', '..', 'packages', 'plan-engine', 'test', 'fixtures', 'four-week.yaml'), 'utf8'));
const reviewed = { ...draft, status: 'reviewed', reviewed_by: 'Test reviewer', reviewed_on: '2026-10-01' };

let app: any;
let rest: FakeRest;
let guard: FetchGuard;
before(async () => {
  rest = await fakeRest();
  guard = installFetchGuard(rest.url);
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.PLAN_ADAPTATIONS = 'on';
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
const day = (offset: number) => new Date(now + offset * DAY).toISOString().slice(0, 10);
const today = day(0);
const tomorrow = day(1);
const run = (daysAgo: number, mins: number) => {
  const at = new Date(now - daysAgo * DAY).toISOString();
  return { type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, distance: mins * 170, moving_time: mins * 60, elapsed_time: mins * 60, average_heartrate: 140 };
};
// Three light weeks, then a big one: acute:chronic well above 1.5 (back-off).
const spike = () => [run(8, 20), run(15, 20), run(22, 20), run(27, 20), ...[1, 2, 3, 4, 5, 6].map((d) => run(d, 60))];

const mondayOf = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};
const INTERVALS = [
  { type: 'warmup', duration_min: 10, intensity: 'easy' },
  { type: 'interval', reps: 5, work_duration_min: 3, work_intensity: 'vo2max', rest_duration_min: 2, rest_intensity: 'easy' },
  { type: 'cooldown', duration_min: 12, intensity: 'easy' },
];
const sessionRow = (id: string, date: string, intensity: string, minutes: number, structure: unknown = null) => ({
  id, scheduled_date: date, planned_intensity: intensity, planned_duration_min: minutes, planned_distance_km: null,
  athlete_completed: null, workout_structure_json: structure,
});

function seed(template: unknown = reviewed) {
  rest.answer('athletes', { body: [{ strava_access_token: 'tok', strava_refresh_token: 'ref', strava_expires_at: Math.floor(now / 1000) + 3600 }] });
  guard.stravaActivities(spike());
  // No coach plan, then the active SCORA plan (started the Monday before).
  rest.answer('training_plans', { body: [] }, {
    body: [{ id: 'plan-1', start_date: mondayOf(day(-7)), goal_race_date: null,
      plan_templates: { slug: 'four-week', version: 1, structure_json: template } }],
  });
  const week = [
    sessionRow('w-tomorrow', tomorrow, 'intervals', 45, INTERVALS),
    sessionRow('w-long', day(4), 'long', 90),
    sessionRow('w-easy', day(3), 'easy', 40),
  ];
  rest.answer('scheduled_workouts', { body: week }, { body: week });
  rest.answer('rpc/apply_plan_adaptation', { body: 'adapt-1' });
}

test('back-off + intervals tomorrow: one named downgrade at the same duration', async () => {
  seed();
  guard.openAi('Load has climbed well past its usual level this week.');
  const r = await app.inject({ method: 'POST', url: '/api/read', payload: { athleteId: '42', today } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().posture.posture, 'back-off');

  const applies = rest.requests.filter((q) => q.table === 'rpc/apply_plan_adaptation');
  assert.equal(applies.length, 1, 'exactly one adaptation written');
  const p = applies[0].body.p;
  assert.equal(p.athlete_id, '42');
  assert.equal(p.scheduled_workout_id, 'w-tomorrow');
  assert.equal(p.type, 'downgraded');
  assert.equal(p.reason_code, 'posture_backoff_intervals_scheduled');
  assert.equal(p.new_workout.planned_intensity, 'steady_state');
  assert.deepEqual(p.new_workout.workout_structure_json, [{ type: 'steady', duration_min: 45, intensity: 'steady' }]);
  // Never silent (CLAUDE.md §6.2): a plain reason that passes the voice rules.
  assert.ok(typeof p.reason_text === 'string' && p.reason_text.length > 0);
  assert.ok(validateVoice(p.reason_text, []).bannedHits.length === 0, p.reason_text);
  // The reason is the fixed sentence: no model call beyond the read itself.
  assert.equal(guard.calls.filter((c) => c.host === 'api.openai.com').length, 1);
});

test('a coach plan stops the engine before it reads the SCORA plan', async () => {
  rest.answer('athletes', { body: [{ strava_access_token: 'tok', strava_refresh_token: 'ref', strava_expires_at: Math.floor(now / 1000) + 3600 }] });
  guard.stravaActivities(spike());
  rest.answer('training_plans', { body: [{ id: 'coach-plan' }] });
  guard.openAi('Load has climbed well past its usual level this week.');
  const r = await app.inject({ method: 'POST', url: '/api/read', payload: { athleteId: '42', today } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(rest.requests.filter((q) => q.table === 'rpc/apply_plan_adaptation').length, 0);
  assert.equal(rest.requests.filter((q) => q.table === 'training_plans').length, 1);
});

test('a draft template never adapts, whatever the posture', async () => {
  seed(draft);
  guard.openAi('Load has climbed well past its usual level this week.');
  const r = await app.inject({ method: 'POST', url: '/api/read', payload: { athleteId: '42', today } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().posture.posture, 'back-off');
  assert.equal(rest.requests.filter((q) => q.table === 'rpc/apply_plan_adaptation').length, 0);
});
