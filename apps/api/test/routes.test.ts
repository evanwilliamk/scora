// The real routes, driven with fastify.inject. Only paths that answer before
// any database or network call: flag gates and input checks. No env secrets
// are set, so anything further would fail closed, not reach a service.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SCORA_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';
// Blank, not deleted: dotenv in index.ts fills only variables that are unset,
// so a local .env can never put real keys back.
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'STRAVA_CLIENT_SECRET']) process.env[k] = '';

let app: any;
before(async () => {
  app = (await import('../src/index')).default;
  await app.ready();
});
after(async () => { await app.close(); });

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });

test('calendar import is off unless ICAL_IMPORT=on', async () => {
  delete process.env.ICAL_IMPORT;
  assert.equal((await post('/api/plan/ical', { athleteId: 'a', ics: 'BEGIN:VCALENDAR' })).statusCode, 404);
});

test('calendar import checks its input before touching storage', async () => {
  process.env.ICAL_IMPORT = 'on';
  try {
    assert.equal((await post('/api/plan/ical', { athleteId: 'a' })).statusCode, 400);
    const notCal = await post('/api/plan/ical', { athleteId: 'a', ics: 'Tue: 45 min tempo' });
    assert.equal(notCal.statusCode, 422);
    assert.match(notCal.json().error, /does not look like a calendar/);
    const past = await post('/api/plan/ical', { athleteId: 'a', today: '2026-10-22', ics: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20250101\r\nSUMMARY:Easy run 30 min\r\nEND:VEVENT\r\nEND:VCALENDAR' });
    assert.equal(past.statusCode, 422);
    assert.match(past.json().error, /No upcoming sessions/);
  } finally {
    delete process.env.ICAL_IMPORT;
  }
});

test('manual plan and chat reject a missing body field', async () => {
  assert.equal((await post('/api/plan/manual', { athleteId: 'a' })).statusCode, 400);
  assert.equal((await post('/api/cdv', { athleteId: 'a' })).statusCode, 400);
});

test('flagged Plan-tier routes stay off by default', async () => {
  for (const k of ['PLAN_GENERATION', 'PLAN_ADAPTATIONS', 'RACE_PREDICTIONS']) delete process.env[k];
  assert.equal((await post('/api/plan/generate', { athleteId: 'a' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/plan/adaptations?athleteId=a' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/plan/prediction?athleteId=a' })).statusCode, 404);
});

test('health answers; every athlete route rejects a missing athleteId', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  for (const url of ['/api/read', '/api/weekly', '/api/card-expand', '/api/push/test', '/api/register-device']) {
    assert.equal((await post(url, {})).statusCode, 400, url);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/plan' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/preferences', payload: {} })).statusCode, 400);
});

test('preferences reject an unknown zone and an impossible delivery time before saving', async () => {
  const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/preferences', payload });
  assert.equal((await put({ athleteId: 'a', timezone: 'Mars/Olympus' })).statusCode, 400);
  for (const deliveryMinute of [-1, 1440, 6.5, '360']) {
    assert.equal((await put({ athleteId: 'a', deliveryMinute })).statusCode, 400, String(deliveryMinute));
  }
});

test('card expansion with no read in memory asks for a refresh; push test needs APNs', async () => {
  assert.equal((await post('/api/card-expand', { athleteId: 'nobody', cardId: 'sleep' })).statusCode, 409);
  for (const k of ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID', 'APNS_KEY']) delete process.env[k];
  assert.equal((await post('/api/push/test', { athleteId: 'a' })).statusCode, 503);
});

test('calorie estimates are off by default', async () => {
  delete process.env.CALORIE_ENGINE;
  assert.equal((await app.inject({ method: 'GET', url: '/api/calories?athleteId=a' })).statusCode, 404);
});

test('push-open logs a telemetry line and stores nothing; bad input is a 400', async () => {
  const id = '0b7c1d2e-1111-2222-3333-444455556666';
  const sentAt = Math.floor(Date.now() / 1000) - 600;
  const ok = await post('/api/events/push-open', { athleteId: id, kind: 'daily', date: '2026-10-28', sentAt });
  assert.equal(ok.statusCode, 204);
  const now = Math.floor(Date.now() / 1000);
  for (const bad of [
    {},
    { athleteId: 'a', kind: 'daily', date: '2026-10-28', sentAt },
    { athleteId: id + '"}', kind: 'daily', date: '2026-10-28', sentAt },
    { athleteId: id, kind: 'hourly', date: '2026-10-28', sentAt },
    { athleteId: id, kind: 'daily', date: 'today', sentAt },
    { athleteId: id, kind: 'daily', date: '2026-10-28', sentAt: '1' },
    { athleteId: id, kind: 'daily', date: '2026-10-28', sentAt: now + 3600 },
    { athleteId: id, kind: 'daily', date: '2026-10-28', sentAt: now - 8 * 86400 },
  ]) {
    assert.equal((await post('/api/events/push-open', bad)).statusCode, 400, JSON.stringify(bad));
  }
});

test('watch-sent rejects a missing athlete and a malformed id before storage', async () => {
  assert.equal((await post('/api/plan/workouts/0b7c1d2e-1111-2222-3333-444455556666/watch-sent', {})).statusCode, 400);
  assert.equal((await post('/api/plan/workouts/not-an-id/watch-sent', { athleteId: 'a' })).statusCode, 404);
});

test('adaptation history is off with plan adaptations, and needs an athlete', async () => {
  delete process.env.PLAN_ADAPTATIONS;
  assert.equal((await app.inject({ method: 'GET', url: '/api/plan/adaptations/history?athleteId=a' })).statusCode, 404);
  process.env.PLAN_ADAPTATIONS = 'on';
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/plan/adaptations/history' })).statusCode, 400);
  } finally {
    delete process.env.PLAN_ADAPTATIONS;
  }
});

test('plan options are off unless PLAN_GENERATION=on', async () => {
  delete process.env.PLAN_GENERATION;
  assert.equal((await app.inject({ method: 'GET', url: '/api/plan/options' })).statusCode, 404);
});

test('plan block is off unless PLAN_GENERATION=on, and needs an athlete and a day', async () => {
  delete process.env.PLAN_GENERATION;
  assert.equal((await app.inject({ method: 'GET', url: '/api/plan/block?athleteId=a&today=2026-10-28' })).statusCode, 404);
  process.env.PLAN_GENERATION = 'on';
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/plan/block?today=2026-10-28' })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: '/api/plan/block?athleteId=a' })).statusCode, 400);
  } finally {
    delete process.env.PLAN_GENERATION;
  }
});
