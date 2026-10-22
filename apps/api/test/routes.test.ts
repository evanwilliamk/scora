// The real routes, driven with fastify.inject. Only paths that answer before
// any database or network call: flag gates and input checks. No env secrets
// are set, so anything further would fail closed, not reach a service.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SCORA_NO_LISTEN = '1';
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'STRAVA_CLIENT_SECRET']) delete process.env[k];

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
