// device_tokens and Strava/Oura token storage on the real migrations, through
// the production supabase-js code and a PostgREST stand-in over PGlite.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { migratedPglite } from './helpers/pglite-db';
import { servePglite } from './helpers/pglite-rest';

blankEnv();

let rest: FakeRest;
let pg: PGlite;
let sb: ReturnType<typeof createClient>;
let push: typeof import('../src/push');
let strava: typeof import('../src/strava');
let oura: typeof import('../src/oura');

before(async () => {
  rest = await fakeRest();
  pg = await migratedPglite();
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  sb = createClient(rest.url, 'test-service-role', { auth: { persistSession: false } });
  push = await import('../src/push');
  strava = await import('../src/strava');
  oura = await import('../src/oura');
});
after(async () => {
  await pg.close();
  await rest.close();
});
beforeEach(async () => {
  rest.reset();
  servePglite(rest, pg, ['athletes', 'device_tokens']);
  await pg.exec('delete from device_tokens; delete from athletes;');
});

const T1 = 'ab'.repeat(32);
const rows = async () =>
  (await pg.query<any>('select athlete_id, token from device_tokens order by athlete_id')).rows;

// ---- device_tokens ----

test('devices: registering twice keeps one row; a phone moving athletes follows the new one', async () => {
  await push.registerDeviceToken('1', T1);
  await push.registerDeviceToken('1', T1);
  assert.deepEqual(await rows(), [{ athlete_id: '1', token: T1 }]);
  await push.registerDeviceToken('2', T1);
  assert.deepEqual(await rows(), [{ athlete_id: '2', token: T1 }]);
  assert.deepEqual(await push.getDeviceTokens('1'), []);
  assert.deepEqual(await push.getDeviceTokens('2'), [T1]);
});

test('devices: the old athlete signing out late does not remove the phone from the new one', async () => {
  await push.registerDeviceToken('1', T1);
  await push.registerDeviceToken('2', T1);
  await push.unregisterDeviceToken('1', T1);
  assert.deepEqual(await rows(), [{ athlete_id: '2', token: T1 }]);
  await push.unregisterDeviceToken('2', T1);
  assert.deepEqual(await rows(), []);
});

test('devices: register and sign-out at once leave a consistent row set (no duplicate, no error)', async () => {
  await Promise.all([push.registerDeviceToken('1', T1), push.registerDeviceToken('1', T1), push.registerDeviceToken('2', T1)]);
  const r = await rows();
  assert.equal(r.length, 1);
});

test('devices: the same token in upper and lower case is one device', async () => {
  await push.registerDeviceToken('1', T1);
  await push.registerDeviceToken('1', T1.toUpperCase());
  assert.deepEqual(await rows(), [{ athlete_id: '1', token: T1 }]);
  await push.unregisterDeviceToken('1', T1.toUpperCase());
  assert.deepEqual(await rows(), []);
});

// ---- Strava / Oura tokens ----

const nowSec = () => Math.floor(Date.now() / 1000);

test('strava: a refresh racing a reconnect never stores the older token set', async () => {
  await pg.query(`insert into athletes (name, strava_id, strava_access_token, strava_refresh_token, strava_expires_at)
    values ('A', '7', 'acc0', 'ref0', $1)`, [nowSec() - 10]);
  // The token endpoint answers the refresh only after the athlete reconnected.
  const f = (async () => {
    await strava.storeStravaTokens('7', { athlete: { firstname: 'A', lastname: 'B' }, access_token: 'acc1', refresh_token: 'ref1', expires_at: nowSec() + 21600 });
    return new Response(JSON.stringify({ access_token: 'accR', refresh_token: 'refR', expires_at: nowSec() + 21600 }), { status: 200 });
  }) as typeof fetch;
  const errors: string[] = [];
  const orig = console.error;
  console.error = (m: string) => { errors.push(String(m)); };
  try {
    assert.equal(await strava.getValidStravaToken('7', sb as any, f), 'accR');
  } finally {
    console.error = orig;
  }
  const r = await pg.query<any>(`select strava_access_token a, strava_refresh_token r from athletes where strava_id = '7'`);
  assert.deepEqual(r.rows[0], { a: 'acc1', r: 'ref1' });
  assert.match(errors.join('\n'), /not saved: no athlete row matched/);
});

test('strava: reconnecting an athlete keeps one row and its quota count', async () => {
  await pg.query(`insert into athletes (name, strava_id, cdv_count, cdv_count_date) values ('A', '7', 2, '2026-11-03')`);
  await strava.storeStravaTokens('7', { athlete: { firstname: 'A', lastname: 'B' }, access_token: 'a', refresh_token: 'r', expires_at: 1 });
  const r = await pg.query<any>(`select count(*)::int n, max(cdv_count) c from athletes where strava_id = '7'`);
  assert.deepEqual(r.rows[0], { n: 1, c: 2 });
});

test('oura: a refresh racing a reconnect never stores the older token set', async () => {
  await pg.query(`insert into athletes (name, strava_id, oura_access_token, oura_refresh_token, oura_expires_at)
    values ('A', '7', 'o0', 'or0', $1)`, [nowSec() - 10]);
  process.env.OURA_CLIENT_ID = 'x';
  process.env.OURA_CLIENT_SECRET = 'y';
  const f = (async () => {
    await oura.storeOuraTokens('7', { access_token: 'o1', refresh_token: 'or1', expires_in: 86400 });
    return new Response(JSON.stringify({ access_token: 'oR', refresh_token: 'orR', expires_in: 86400 }), { status: 200 });
  }) as typeof fetch;
  const orig = console.error;
  console.error = () => {};
  try {
    assert.equal(await oura.getValidOuraToken('7', sb as any, f), 'oR');
  } finally {
    console.error = orig;
    process.env.OURA_CLIENT_ID = '';
    process.env.OURA_CLIENT_SECRET = '';
  }
  const r = await pg.query<any>(`select oura_access_token a, oura_refresh_token r from athletes where strava_id = '7'`);
  assert.deepEqual(r.rows[0], { a: 'o1', r: 'or1' });
});
