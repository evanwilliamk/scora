// Oura paths the other suites skip: the code exchange, storing tokens
// against the local fake Supabase REST server, a missing refresh token, and
// a route whose fetch rejects. Nothing reaches Oura or Supabase.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';
import { fakeSupabase } from './helpers/fake-supabase';

blankEnv();

let rest: FakeRest;
let guard: FetchGuard;
let oura: typeof import('../src/oura');
before(async () => {
  rest = await fakeRest();
  guard = installFetchGuard(rest.url);
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  oura = await import('../src/oura');
});
after(async () => {
  guard.restore();
  await rest.close();
});
beforeEach(() => rest.reset());

// Swap global fetch for the body of one test, then put the guard's back.
async function withFetch<T>(f: typeof fetch, run: () => Promise<T>): Promise<T> {
  const prev = globalThis.fetch;
  globalThis.fetch = f;
  try { return await run(); } finally { globalThis.fetch = prev; }
}

test('exchangeOuraCode posts a form-encoded authorization_code grant and returns the token body', async () => {
  const seen: { url: string; init: any }[] = [];
  const out = await withFetch((async (url: any, init: any) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 86400 }), { status: 200 });
  }) as typeof fetch, () => oura.exchangeOuraCode('code-1'));
  assert.deepEqual(out, { access_token: 'a', refresh_token: 'r', expires_in: 86400 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.ouraring.com/oauth/token');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(String(seen[0].init.body));
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'code-1');
  assert.match(body.get('redirect_uri') ?? '', /\/api\/auth\/oura\/callback$/);
});

test('exchangeOuraCode: a refused exchange throws a status-only vendor error', async () => {
  await withFetch((async () => new Response('{"error":"invalid_grant","detail":"secret-ish"}', { status: 400 })) as typeof fetch, async () => {
    await assert.rejects(oura.exchangeOuraCode('bad'), (e: any) => {
      assert.equal(e.name, 'VendorHttpError');
      assert.equal(e.status, 400);
      assert.doesNotMatch(e.message, /secret-ish/);
      return true;
    });
  });
});

test('storeOuraTokens writes both tokens and an absolute expiry onto the athlete row', async () => {
  rest.answer('athletes', { body: [{ strava_id: '42' }] });
  const before = Math.floor(Date.now() / 1000);
  await oura.storeOuraTokens('42', { access_token: 'a', refresh_token: 'r', expires_in: 3600 });
  const q = rest.requests[0];
  assert.equal(q.method, 'PATCH');
  assert.equal(q.params.get('strava_id'), 'eq.42');
  assert.equal(q.body.oura_access_token, 'a');
  assert.equal(q.body.oura_refresh_token, 'r');
  assert.ok(q.body.oura_expires_at >= before + 3600 && q.body.oura_expires_at <= Math.floor(Date.now() / 1000) + 3600);
});

test('storeOuraTokens: no expires_in or tokens store nulls, not undefined', async () => {
  rest.answer('athletes', { body: [{ strava_id: '42' }] });
  await oura.storeOuraTokens('42', {});
  const b = rest.requests[0].body;
  assert.deepEqual([b.oura_access_token, b.oura_refresh_token, b.oura_expires_at], [null, null, null]);
});

test('storeOuraTokens: a storage error and a missing athlete row both throw', async () => {
  rest.answer('athletes', { status: 500, body: { message: 'boom' } });
  await assert.rejects(oura.storeOuraTokens('42', { access_token: 'a' }), /Failed to store Oura tokens: boom/);
  rest.answer('athletes', { body: [] });
  await assert.rejects(oura.storeOuraTokens('43', { access_token: 'a' }), /No athlete row for id 43\. Connect Strava first\./);
});

test('getValidOuraToken: an access token without a refresh token asks for a reconnect', async () => {
  const sb = fakeSupabase([{ data: { oura_access_token: 'acc', oura_refresh_token: null, oura_expires_at: 0 } }]);
  await assert.rejects(oura.getValidOuraToken('s7', sb as any, (async () => { throw new Error('no fetch expected'); }) as any),
    /No Oura refresh token stored\. Please reconnect Oura\./);
});

test('getValidOuraToken: a lookup error reads as not connected', async () => {
  const sb = fakeSupabase([{ error: { message: 'down' } }]);
  await assert.rejects(oura.getValidOuraToken('s8', sb as any, fetch), /^Error: Oura not connected\.$/);
});

test('getValidOuraToken: a refresh with no expires_in stores a null expiry; a zero-row save is logged', async () => {
  const sb = fakeSupabase([
    { data: { oura_access_token: 'old', oura_refresh_token: 'r1', oura_expires_at: null } },
    { data: [] },
  ]);
  const errors: string[] = [];
  const realError = console.error;
  console.error = (m: string) => { errors.push(m); };
  try {
    const f = (async () => new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2' }), { status: 200 })) as typeof fetch;
    assert.equal(await oura.getValidOuraToken('s10', sb as any, f), 'new');
  } finally {
    console.error = realError;
  }
  assert.equal((sb.queries[1].calls[0][1] as any).oura_expires_at, null);
  assert.deepEqual(errors, ['Oura token refresh not saved: no athlete row matched']);
});

test('fetchOuraSummary: routes whose fetch rejects leave every field null', async () => {
  const s = await withFetch((async () => { throw new TypeError('network down'); }) as typeof fetch,
    () => oura.fetchOuraSummary('tok', { localToday: '2026-10-17' }));
  assert.deepEqual(s, { sleepSeconds: null, sleepScore: null, hrvMs: null, restingHr: null, readinessScore: null, hrvWeekAvgMs: null });
});

test('fetchOuraSummary: a stale newest readiness day is not today\'s score; with no localToday the newest is used', async () => {
  const f = (async (url: string) => {
    if (url.includes('/daily_readiness?')) return new Response(JSON.stringify({ data: [{ day: '2026-10-15', score: 70 }, { day: '2026-10-16', score: 81 }] }));
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const stale = await withFetch(f, () => oura.fetchOuraSummary('tok', { localToday: '2026-10-17' }));
  assert.equal(stale.readinessScore, null);
  const any = await withFetch(f, () => oura.fetchOuraSummary('tok'));
  assert.equal(any.readinessScore, 81);
});
