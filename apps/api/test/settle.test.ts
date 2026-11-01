import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, unwrap } from '../src/settle';

test('settle: a value comes back as ok', async () => {
  const s = await settle(async () => 7);
  assert.deepEqual(s, { ok: true, value: 7 });
  assert.equal(unwrap(s), 7);
});

test('settle: a rejection or a synchronous throw is held, then rethrown by unwrap', async () => {
  const boom = new Error('boom');
  const a = await settle(() => Promise.reject(boom));
  const b = await settle((): Promise<number> => { throw boom; });
  for (const s of [a, b]) {
    assert.equal(s.ok, false);
    assert.throws(() => unwrap(s), (e) => e === boom);
  }
});

test('settle: the call starts at once, before anything awaits it', () => {
  let started = false;
  void settle(async () => { started = true; });
  assert.equal(started, true);
});
