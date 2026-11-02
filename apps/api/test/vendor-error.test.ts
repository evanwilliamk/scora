// Vendor error bodies never reach an error message or a log (gate 1.1.6):
// OpenAI and Oura can echo the request (athlete values, tokens) in the body.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAiReasonLlm, writeReason } from '../src/adaptation-reason';
import { openAiPlanLlm } from '../src/plan-parse';
import { openAiEmbedder } from '../src/knowledge-ingest';
import { getValidOuraToken } from '../src/oura';
import { VendorHttpError, vendorErrorKind } from '../src/vendor-error';
import { auditLog } from '../src/log-audit';
import { fakeSupabase } from './helpers/fake-supabase';

const BODY = '{"error":{"message":"Sleep 6:42, HRV 38ms in prompt was rejected"}}';
const failing = (status: number) => (async () => new Response(BODY, { status })) as typeof fetch;

async function messageOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('did not reject');
}

test('OpenAI wrappers throw a fixed label and the status, not the body', async () => {
  const msgs = [
    await messageOf(openAiReasonLlm('k', failing(500))('s', 'u')),
    await messageOf(openAiPlanLlm('k', failing(429))('s', 'u')),
    await messageOf(openAiEmbedder('k', failing(400))(['x'])),
  ];
  assert.deepEqual(msgs, ['OpenAI 500', 'OpenAI 429', 'OpenAI embeddings failed: 400']);
  for (const m of msgs) assert.doesNotMatch(m, /HRV|38|6:42|rejected/);
});

test('Oura token refresh failure carries the status only', async () => {
  const sb = fakeSupabase([{ data: { oura_access_token: 'a', oura_refresh_token: 'r', oura_expires_at: 0 } }]);
  const m = await messageOf(getValidOuraToken('vendor-err-1', sb as any, failing(401)));
  assert.equal(m, 'Oura token refresh failed: 401');
});

test('a failed adaptation reason logs a fixed category, not the vendor message', async () => {
  const d: any = { type: 'moved', facts: { posture: 'rest' } };
  const http = await writeReason(d, [], openAiReasonLlm('k', failing(503)), 'Moved.');
  assert.deepEqual(http.issues, ['llm failed: http_503']);
  const other = await writeReason(d, [], async () => { throw new Error(BODY); }, 'Moved.');
  assert.deepEqual(other.issues, ['llm failed: error']);
  const net = await writeReason(d, [], async () => { throw new TypeError('fetch failed for HRV 38ms'); }, 'Moved.');
  assert.deepEqual(net.issues, ['llm failed: network']);
  assert.deepEqual(auditLog([http, other, net].flatMap((r) => r.issues).join('\n')), []);
});

test('vendorErrorKind names a timeout', () => {
  const t = new Error('x');
  t.name = 'TimeoutError';
  assert.equal(vendorErrorKind(t), 'timeout');
  assert.equal(vendorErrorKind(new VendorHttpError('OpenAI', 502)), 'http_502');
});
