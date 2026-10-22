// Strava and Oura access tokens are refreshed on demand before every read.
// The database and the token endpoints are fakes here; no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getValidStravaToken } from '../src/strava';
import { getValidOuraToken } from '../src/oura';
import { fakeSupabase } from './helpers/fake-supabase';

const now = () => Math.floor(Date.now() / 1000);

function tokenEndpoint(body: object, status = 200) {
  const calls: { url: string; body: string }[] = [];
  const f = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: String(init.body) });
    return new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Bad Request' });
  }) as typeof fetch;
  return { f, calls };
}

test('Strava: a token valid past the 5-minute window is used as is', async () => {
  const sb = fakeSupabase([{ data: { strava_access_token: 'acc', strava_refresh_token: 'ref', strava_expires_at: now() + 3600 } }]);
  const ep = tokenEndpoint({});
  assert.equal(await getValidStravaToken('s1', sb as any, ep.f), 'acc');
  assert.equal(ep.calls.length, 0);
  assert.deepEqual(sb.queries[0].calls.slice(1), [['eq', 'strava_id', 's1'], ['single']]);
});

test('Strava: inside the window it refreshes and stores the rotated refresh token', async () => {
  const sb = fakeSupabase([
    { data: { strava_access_token: 'old', strava_refresh_token: 'ref1', strava_expires_at: now() + 120 } },
    {},
  ]);
  const ep = tokenEndpoint({ access_token: 'new', refresh_token: 'ref2', expires_at: now() + 21600 });
  assert.equal(await getValidStravaToken('s1', sb as any, ep.f), 'new');
  assert.equal(ep.calls[0].url, 'https://www.strava.com/oauth/token');
  const sent = JSON.parse(ep.calls[0].body);
  assert.deepEqual([sent.grant_type, sent.refresh_token], ['refresh_token', 'ref1']);
  const [update, where] = sb.queries[1].calls;
  assert.equal(update[0], 'update');
  assert.deepEqual([(update[1] as any).strava_access_token, (update[1] as any).strava_refresh_token], ['new', 'ref2']);
  assert.deepEqual(where, ['eq', 'strava_id', 's1']);
});

test('Strava: no stored refresh token, or a refused refresh, asks the athlete to reconnect', async () => {
  const none = fakeSupabase([{ data: { strava_access_token: 'a', strava_refresh_token: null, strava_expires_at: 0 } }]);
  await assert.rejects(getValidStravaToken('s1', none as any, tokenEndpoint({}).f), /reconnect Strava/);
  const missing = fakeSupabase([{ data: null, error: { message: 'no rows' } }]);
  await assert.rejects(getValidStravaToken('s1', missing as any, tokenEndpoint({}).f), /reconnect Strava/);
  const refused = fakeSupabase([{ data: { strava_access_token: 'a', strava_refresh_token: 'r', strava_expires_at: 0 } }]);
  await assert.rejects(getValidStravaToken('s1', refused as any, tokenEndpoint({}, 400).f), /Strava token refresh failed/);
});

test('Oura: refresh turns expires_in into an absolute expiry and stores both tokens', async () => {
  const sb = fakeSupabase([
    { data: { oura_access_token: 'old', oura_refresh_token: 'r1', oura_expires_at: now() - 10 } },
    {},
  ]);
  const ep = tokenEndpoint({ access_token: 'new', refresh_token: 'r2', expires_in: 86400 });
  const before = now();
  assert.equal(await getValidOuraToken('s1', sb as any, ep.f), 'new');
  assert.match(ep.calls[0].body, /grant_type=refresh_token&refresh_token=r1/);
  const row = sb.queries[1].calls[0][1] as any;
  assert.deepEqual([row.oura_access_token, row.oura_refresh_token], ['new', 'r2']);
  assert.ok(row.oura_expires_at >= before + 86400 && row.oura_expires_at <= now() + 86400);
});

test('Oura: not connected is its own error (the dashboard shows Connect Oura)', async () => {
  const sb = fakeSupabase([{ data: { oura_access_token: null } }]);
  await assert.rejects(getValidOuraToken('s1', sb as any, tokenEndpoint({}).f), /^Error: Oura not connected\.$/);
});

test('a refreshed token that cannot be saved is reported, and still serves this read', async () => {
  const sb = fakeSupabase([
    { data: { oura_access_token: 'old', oura_refresh_token: 'r1', oura_expires_at: 0 } },
    { error: { message: 'connection reset' } },
  ]);
  const errors: string[] = [];
  const realError = console.error;
  console.error = (m: string) => errors.push(m);
  try {
    assert.equal(await getValidOuraToken('s1', sb as any, tokenEndpoint({ access_token: 'new', refresh_token: 'r2', expires_in: 60 }).f), 'new');
  } finally {
    console.error = realError;
  }
  assert.deepEqual(errors, ['Oura token refresh not saved: connection reset']);
});
