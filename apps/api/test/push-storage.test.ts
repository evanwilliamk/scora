// Device-token storage in push.ts against the local fake Supabase REST
// server: what each call asks PostgREST for, and how a storage error is
// reported. These rows decide which phones get an athlete's daily read.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';

blankEnv();

let rest: FakeRest;
let guard: FetchGuard;
let push: typeof import('../src/push');
before(async () => {
  rest = await fakeRest();
  guard = installFetchGuard(rest.url);
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  push = await import('../src/push');
});
after(async () => {
  guard.restore();
  await rest.close();
});
beforeEach(() => rest.reset());

test('getDeviceTokens lists only this athlete\'s tokens', async () => {
  rest.answer('device_tokens', { body: [{ token: 't1' }, { token: 't2' }] });
  assert.deepEqual(await push.getDeviceTokens('a1'), ['t1', 't2']);
  const q = rest.requests[0];
  assert.equal(q.method, 'GET');
  assert.equal(q.params.get('athlete_id'), 'eq.a1');
  assert.equal(q.params.get('select'), 'token');
});

test('getDeviceTokens: no rows is an empty list; a storage error throws with its message', async () => {
  assert.deepEqual(await push.getDeviceTokens('nobody'), []);
  rest.answer('device_tokens', { status: 500, body: { message: 'boom' } });
  await assert.rejects(push.getDeviceTokens('a1'), /Failed to read device tokens: boom/);
});

test('removeDeviceToken deletes that token for every athlete, and never throws', async () => {
  await push.removeDeviceToken('dead');
  const q = rest.requests[0];
  assert.equal(q.method, 'DELETE');
  assert.equal(q.params.get('token'), 'eq.dead');
  assert.equal(q.params.get('athlete_id'), null);
  rest.answer('device_tokens', { status: 500, body: { message: 'boom' } });
  await push.removeDeviceToken('dead');
});

test('unregisterDeviceToken removes only this athlete\'s row for this token', async () => {
  await push.unregisterDeviceToken('a1', 'tok');
  const q = rest.requests[0];
  assert.equal(q.method, 'DELETE');
  assert.equal(q.params.get('athlete_id'), 'eq.a1');
  assert.equal(q.params.get('token'), 'eq.tok');
  rest.answer('device_tokens', { status: 500, body: { message: 'locked' } });
  await assert.rejects(push.unregisterDeviceToken('a1', 'tok'), /Failed to remove device token: locked/);
});

test('registerDeviceToken: a storage error is thrown, not swallowed', async () => {
  rest.answer('device_tokens', { status: 500, body: { message: 'full' } });
  await assert.rejects(push.registerDeviceToken('a1', 'tok'), /Failed to store device token: full/);
});

test('getAthletesWithDevices: each athlete once, however many phones', async () => {
  rest.answer('device_tokens', { body: [{ athlete_id: 'a1' }, { athlete_id: 'a2' }, { athlete_id: 'a1' }, { athlete_id: 7 }] });
  assert.deepEqual(await push.getAthletesWithDevices(), ['a1', 'a2', '7']);
  assert.equal(rest.requests[0].params.get('select'), 'athlete_id');
  rest.answer('device_tokens', { status: 500, body: { message: 'down' } });
  await assert.rejects(push.getAthletesWithDevices(), /Failed to list device athletes: down/);
});

test('sendPush without APNs configured is a failed result, and no connection is tried', async () => {
  assert.equal(push.apnsConfigured(), false);
  // fetch-guard makes http2.connect throw, so reaching it would reject.
  assert.deepEqual(await push.sendPush('tok', { title: 't', body: 'b' }), { ok: false, status: 0, reason: 'APNs not configured' });
});
