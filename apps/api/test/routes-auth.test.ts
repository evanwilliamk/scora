// The Strava OAuth hand-off past its input checks, and the keepalive ping,
// driven through the real routes. Supabase is the local fake REST server;
// Strava's token endpoint is answered here, every other outside host goes
// through helpers/fetch-guard and is blocked.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';

blankEnv();

let app: any;
let rest: FakeRest;
let guard: FetchGuard;
let guarded: typeof fetch;
// The next answers from https://www.strava.com/oauth/token, used in order.
let tokenAnswers: { status: number; body: unknown }[] = [];
const tokenCalls: any[] = [];

before(async () => {
  rest = await fakeRest();
  guard = installFetchGuard(rest.url);
  guarded = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://www.strava.com/oauth/token') {
      tokenCalls.push(JSON.parse(String(init?.body)));
      const a = tokenAnswers.shift() ?? { status: 500, body: { message: 'no answer queued' } };
      return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), {
        status: a.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return guarded(input, init);
  }) as typeof fetch;
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  app = (await import('../src/index')).default;
  await app.ready();
});
after(async () => {
  await app.close();
  globalThis.fetch = guarded;
  guard.restore();
  await rest.close();
});
beforeEach(() => {
  rest.reset();
  guard.reset();
  tokenAnswers = [];
  tokenCalls.length = 0;
});

const get = (url: string) => app.inject({ method: 'GET', url });
const tokenSet = (extra: Record<string, unknown> = {}) => ({
  access_token: 'acc-1',
  refresh_token: 'ref-1',
  expires_at: 1793000000,
  athlete: { id: 4242, firstname: 'Ada', lastname: 'Lovelace' },
  ...extra,
});

test('Strava connect redirects to Strava with the read scopes and the callback', async () => {
  const r = await get('/api/auth/strava');
  assert.equal(r.statusCode, 302);
  const to = new URL(r.headers.location);
  assert.equal(to.origin + to.pathname, 'https://www.strava.com/oauth/authorize');
  assert.equal(to.searchParams.get('response_type'), 'code');
  assert.equal(to.searchParams.get('scope'), 'read,activity:read_all');
  assert.match(to.searchParams.get('redirect_uri')!, /\/api\/auth\/strava\/callback$/);
});

test('Strava callback: the code is exchanged, the full token set stored, and the app opened', async () => {
  tokenAnswers.push({ status: 200, body: tokenSet() });
  const r = await get('/api/auth/strava/callback?code=abc');
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].code, 'abc');
  assert.equal(tokenCalls[0].grant_type, 'authorization_code');

  const saved = rest.requests.find((q) => q.table === 'athletes')!;
  assert.equal(saved.method, 'POST');
  assert.equal(saved.params.get('on_conflict'), 'strava_id');
  assert.deepEqual(saved.body, {
    strava_id: '4242',
    name: 'Ada Lovelace',
    strava_access_token: 'acc-1',
    strava_refresh_token: 'ref-1',
    strava_expires_at: 1793000000,
  });

  assert.match(r.body, /Welcome, Ada\./);
  // The deep link sits in a script string, with & escaped for the HTML parser.
  assert.ok(r.body.includes('"scora://auth/success?athlete_id=4242\\u0026name=Ada\\u0026token=acc-1"'));
  assert.doesNotMatch(r.body, /\p{Extended_Pictographic}/u);
});

test('Strava callback: an athlete name cannot inject markup or script', async () => {
  tokenAnswers.push({ status: 200, body: tokenSet({ athlete: { id: 7, firstname: '<img src=x onerror=alert(1)></script>', lastname: 'X' } }) });
  const r = await get('/api/auth/strava/callback?code=abc');
  assert.equal(r.statusCode, 200, r.body);
  assert.doesNotMatch(r.body, /<img src=x/);
  // Only the page's own closing script tag.
  assert.equal(r.body.match(/<\/script>/g)?.length, 1);
});

test('Strava callback: a refused exchange is a 400 and nothing is stored', async () => {
  tokenAnswers.push({ status: 400, body: { message: 'Bad Request', errors: [{ code: 'invalid' }] } });
  const r = await get('/api/auth/strava/callback?code=used-twice');
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { error: 'Token exchange failed' });
  assert.equal(rest.requests.length, 0);
});

test('Strava callback: tokens that cannot be saved fail the connect, no deep link', async () => {
  tokenAnswers.push({ status: 200, body: tokenSet() });
  rest.answer('athletes', { status: 500, body: { message: 'db down' } });
  const r = await get('/api/auth/strava/callback?code=abc');
  assert.equal(r.statusCode, 500);
  assert.deepEqual(r.json(), { error: 'Token storage failed', athleteId: 4242 });
  assert.doesNotMatch(r.body, /scora:\/\/auth\/success/);
  assert.doesNotMatch(r.body, /acc-1/);
});

test('Strava callback: a token answer without an athlete is a plain 500', async () => {
  tokenAnswers.push({ status: 200, body: { access_token: 'acc-1' } });
  const r = await get('/api/auth/strava/callback?code=abc');
  assert.equal(r.statusCode, 500);
  assert.deepEqual(r.json(), { error: 'Auth failed' });
  assert.equal(rest.requests.length, 0);
});

test('keepalive: reports whether the database answered, and is a 200 either way', async () => {
  const up = await get('/api/keepalive');
  assert.equal(up.statusCode, 200);
  assert.equal(up.json().ok, true);
  assert.equal(up.json().supabase, true);
  const ping = rest.requests.find((q) => q.table === 'athletes')!;
  assert.equal(ping.params.get('limit'), '1');

  rest.answer('athletes', { status: 500, body: { message: 'paused' } });
  const down = await get('/api/keepalive');
  assert.equal(down.statusCode, 200);
  assert.equal(down.json().supabase, false);
});
