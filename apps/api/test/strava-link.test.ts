// strava.ts storage and code exchange: the token set is what lets SCORA read
// an athlete's runs without asking them to reconnect. Supabase is the local
// fake REST server; Strava's token endpoint is answered here.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';

blankEnv();

let rest: FakeRest;
let guard: FetchGuard;
let guarded: typeof fetch;
let strava: typeof import('../src/strava');
let tokenAnswer: { status: number; body: unknown } = { status: 200, body: {} };
const tokenCalls: any[] = [];

before(async () => {
  rest = await fakeRest();
  guard = installFetchGuard(rest.url);
  guarded = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://www.strava.com/oauth/token') {
      tokenCalls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(tokenAnswer.body), { status: tokenAnswer.status, statusText: tokenAnswer.status === 200 ? 'OK' : 'Bad Request' });
    }
    return guarded(input, init);
  }) as typeof fetch;
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  strava = await import('../src/strava');
});
after(async () => {
  globalThis.fetch = guarded;
  guard.restore();
  await rest.close();
});
beforeEach(() => {
  rest.reset();
  tokenCalls.length = 0;
});

test('exchangeStravaCode posts the code as an authorization_code grant and returns Strava\'s answer', async () => {
  tokenAnswer = { status: 200, body: { access_token: 'acc', athlete: { id: 1 } } };
  assert.deepEqual(await strava.exchangeStravaCode('c0de'), { access_token: 'acc', athlete: { id: 1 } });
  assert.equal(tokenCalls[0].code, 'c0de');
  assert.equal(tokenCalls[0].grant_type, 'authorization_code');
  assert.equal(tokenCalls[0].client_id, strava.STRAVA_CLIENT_ID);
});

test('exchangeStravaCode: a refusal throws with the status text', async () => {
  tokenAnswer = { status: 400, body: { message: 'Bad Request' } };
  await assert.rejects(strava.exchangeStravaCode('used'), /Strava token exchange failed: Bad Request/);
});

test('storeStravaTokens upserts on strava_id with the full token set', async () => {
  await strava.storeStravaTokens('99', {
    access_token: 'a', refresh_token: 'r', expires_at: 123, athlete: { firstname: 'Ada', lastname: 'L' },
  });
  const q = rest.requests[0];
  assert.equal(q.table, 'athletes');
  assert.equal(q.method, 'POST');
  assert.equal(q.params.get('on_conflict'), 'strava_id');
  assert.deepEqual(q.body, { strava_id: '99', name: 'Ada L', strava_access_token: 'a', strava_refresh_token: 'r', strava_expires_at: 123 });
});

test('storeStravaTokens: no athlete block is "Unknown"; missing tokens are stored as null', async () => {
  await strava.storeStravaTokens('5', {});
  assert.deepEqual(rest.requests[0].body, {
    strava_id: '5', name: 'Unknown', strava_access_token: null, strava_refresh_token: null, strava_expires_at: null,
  });
  rest.answer('athletes', { status: 500, body: { message: 'db down' } });
  await assert.rejects(strava.storeStravaTokens('5', {}), /Failed to store Strava tokens: db down/);
});

test('linkStravaAthlete upserts the user against the Strava id and returns the row', async () => {
  rest.answer('athletes', { body: [{ id: 'row-1', strava_id: '42' }] });
  const row = await strava.linkStravaAthlete('user-1', { athlete: { id: 42, firstname: 'Ada', lastname: 'L' } });
  assert.deepEqual(row, { id: 'row-1', strava_id: '42' });
  const q = rest.requests[0];
  assert.equal(q.params.get('on_conflict'), 'strava_id');
  assert.deepEqual(q.body, { user_id: 'user-1', strava_id: '42', name: 'Ada L' });
});

test('linkStravaAthlete: a storage error throws with its message', async () => {
  rest.answer('athletes', { status: 409, body: { message: 'conflict' } });
  await assert.rejects(
    strava.linkStravaAthlete('user-1', { athlete: { id: 42, firstname: 'A', lastname: 'L' } }),
    /Failed to link Strava athlete: conflict/,
  );
});
