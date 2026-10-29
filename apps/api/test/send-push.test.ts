// sendPush against a local plaintext HTTP/2 server standing in for APNs
// (APNS_TEST_HOST, honored only under NODE_ENV=test). Checks what Apple
// would receive and how its answers map to results. Throwaway key only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';

const seen: { headers: http2.IncomingHttpHeaders; body: any }[] = [];
let answer: { status: number; body?: string } = { status: 200 };
const server = http2.createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    seen.push({ headers: req.headers, body: JSON.parse(raw) });
    res.statusCode = answer.status;
    res.end(answer.body ?? '');
  });
});

let push: typeof import('../src/push');
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  process.env.NODE_ENV = 'test';
  process.env.APNS_TEST_HOST = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APNS_KEY_ID = 'ABC123DEFG';
  process.env.APNS_TEAM_ID = 'TEAM456789';
  process.env.APNS_BUNDLE_ID = 'app.scora.test';
  process.env.APNS_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  push = await import('../src/push');
});
after(() => { server.close(); });

test('an accepted push: path, headers and the scora payload Apple receives', async () => {
  answer = { status: 200 };
  const r = await push.sendPush('abc123', { title: 'Today’s read', body: 'Sleep 7:12\nBody is settled.' }, { kind: 'daily', date: '2026-10-28', sent_at: 1 });
  assert.deepEqual(r, { ok: true, status: 200 });
  const { headers, body } = seen.at(-1)!;
  assert.equal(headers[':path'], '/3/device/abc123');
  assert.equal(headers['apns-topic'], 'app.scora.test');
  assert.equal(headers['apns-push-type'], 'alert');
  assert.match(String(headers.authorization), /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.deepEqual(body, {
    aps: { alert: { title: 'Today’s read', body: 'Sleep 7:12\nBody is settled.' }, sound: 'default' },
    scora: { kind: 'daily', date: '2026-10-28', sent_at: 1 },
  });
});

test('no extra data, no scora key', async () => {
  answer = { status: 200 };
  await push.sendPush('abc123', { title: 't', body: 'b' });
  assert.equal('scora' in seen.at(-1)!.body, false);
});

test("APNs refusals come back with Apple's reason, never thrown", async () => {
  answer = { status: 410, body: JSON.stringify({ reason: 'Unregistered' }) };
  assert.deepEqual(await push.sendPush('gone', { title: 't', body: 'b' }), { ok: false, status: 410, reason: 'Unregistered' });
  answer = { status: 500, body: 'not json' };
  assert.deepEqual(await push.sendPush('x', { title: 't', body: 'b' }), { ok: false, status: 500, reason: 'not json' });
});

test('an unreachable host is a failed result, not a throw', async () => {
  const closed = http2.createServer();
  await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
  const port = (closed.address() as AddressInfo).port;
  await new Promise<void>((r) => closed.close(() => r()));
  // The module read its host at import; a fresh import with a dead host.
  process.env.APNS_TEST_HOST = `http://127.0.0.1:${port}`;
  const fresh = await import(`../src/push?dead=${port}`);
  const r = await fresh.sendPush('x', { title: 't', body: 'b' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
});
