// APNs provider token (ES256 JWT). APNs is not configured anywhere yet, so
// this is the only check that the token Apple will receive is well formed.
// A throwaway P-256 key is generated here; no real key is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
process.env.APNS_KEY_ID = 'ABC123DEFG';
process.env.APNS_TEAM_ID = 'TEAM456789';
process.env.APNS_BUNDLE_ID = 'app.scora.test';
process.env.APNS_KEY = pem.replace(/\n/g, '\\n'); // as pasted into an env var, literal \n
const push = await import('../src/push');

const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

test('configured once every APNs variable is set', () => {
  assert.equal(push.apnsConfigured(), true);
});

test('the provider token is an ES256 JWT Apple can verify', () => {
  const before = Math.floor(Date.now() / 1000);
  const token = push.providerJwt();
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)), 'base64url, no padding');
  assert.deepEqual(JSON.parse(b64urlDecode(parts[0]).toString()), { alg: 'ES256', kid: 'ABC123DEFG' });
  const payload = JSON.parse(b64urlDecode(parts[1]).toString());
  assert.equal(payload.iss, 'TEAM456789');
  assert.ok(payload.iat >= before && payload.iat <= before + 5);
  const sig = b64urlDecode(parts[2]);
  assert.equal(sig.length, 64, 'raw R||S, not DER');
  assert.ok(crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig));
});

test('the token is reused rather than minted on every push (Apple throttles new tokens)', () => {
  assert.equal(push.providerJwt(), push.providerJwt());
});
