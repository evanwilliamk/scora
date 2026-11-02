// A failed Strava pull, on every route that surfaces one to the app: the
// status stays 401, and `error` (the field the app shows, APIErrorText in
// DashboardView.swift) is a plain sentence that tells a revoked connection
// (401/403 after the token refresh) from Strava not answering (5xx, network).

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

const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
// Sticky: the read's Oura token lookup reads the same table and can land
// after the route has already answered.
const connected = () => rest.handle('athletes', () => ({
  body: [{ strava_access_token: 'tok-a1', strava_refresh_token: 'ref-a1', strava_expires_at: Math.floor(now / 1000) + 3600 }],
}));

const RECONNECT = 'Strava needs to be connected again.';
const UNAVAILABLE = 'Strava is not answering right now.';

const routes: { name: string; call: () => Promise<any>; env?: string }[] = [
  { name: 'read', call: () => app.inject({ method: 'POST', url: '/api/read', payload: { athleteId: '42', today } }) },
  { name: 'weekly', call: () => app.inject({ method: 'POST', url: '/api/weekly', payload: { athleteId: '42', today } }) },
  { name: 'cdv', call: () => app.inject({ method: 'POST', url: '/api/cdv', payload: { athleteId: '42', message: 'How was my week?' } }) },
  { name: 'prediction', env: 'RACE_PREDICTIONS', call: () => app.inject({ method: 'GET', url: '/api/plan/prediction?athleteId=42&race=10k' }) },
  { name: 'calories', env: 'CALORIE_ENGINE', call: () => app.inject({ method: 'GET', url: '/api/calories?athleteId=42' }) },
];

const cases: { how: number | 'network'; line: string }[] = [
  { how: 401, line: RECONNECT },
  { how: 403, line: RECONNECT },
  { how: 503, line: UNAVAILABLE },
  { how: 500, line: UNAVAILABLE },
  { how: 'network', line: UNAVAILABLE },
];

for (const route of routes) {
  for (const c of cases) {
    test(`${route.name}: Strava ${c.how} answers 401 with "${c.line}"`, async () => {
      if (route.env) process.env[route.env] = 'on';
      try {
        connected();
        guard.stravaFails(c.how);
        const r = await route.call();
        assert.equal(r.statusCode, 401, r.body);
        assert.deepEqual(r.json(), { error: c.line });
        assert.ok(guard.calls.some((x) => x.host === 'www.strava.com'), 'Strava was asked');
        assert.ok(!guard.calls.some((x) => x.host === 'api.openai.com'), 'no model call');
      } finally {
        if (route.env) process.env[route.env] = '';
      }
    });
  }
}

// The same rule APIErrorText.isForAthlete applies in the app: a full stop at
// the end, short, no markup, no env-style names, no "Missing:" label.
test('both lines pass the app\'s athlete-text check', () => {
  for (const line of [RECONNECT, UNAVAILABLE]) {
    assert.ok(line.length > 0 && line.length <= 200, line);
    assert.ok(line.endsWith('.'), line);
    assert.ok(!line.includes('<'), line);
    assert.ok(!line.startsWith('Missing:'), line);
    assert.ok(!/[A-Z]{2,}_[A-Z]/.test(line), line);
  }
});
