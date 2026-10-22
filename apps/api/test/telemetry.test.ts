import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceEmissionLine } from '../src/telemetry';
import { generateValidatedVoice } from '../src/voice';

test('one countable line per emission: labels and counts, never text', () => {
  const line = voiceEmissionLine({ surface: 'daily', attempts: 2, fallback: false, bannedHits: ['you should', 'you should'], unbackedCount: 1 });
  assert.ok(line.startsWith('telemetry '));
  assert.deepEqual(JSON.parse(line.slice('telemetry '.length)), {
    event: 'voice_emission', surface: 'daily', attempts: 2, fallback: false, caught: true, banned: ['you should'], unbacked: 1,
  });
});

test('generateValidatedVoice reports a retry and a fallback with what was caught, not the draft', async () => {
  const drafts = ['You should rest. HRV is 61ms.', 'HRV is 62ms!'];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: drafts.shift() } }] }))) as typeof fetch;
  const lines: string[] = [];
  try {
    const r = await generateValidatedVoice({
      systemPrompt: 's', userPrompt: 'u', drivers: [{ metric: 'HRV', value: '52ms' }], surface: 'daily',
      log: { warn: () => {}, error: () => {}, info: (m) => lines.push(m) },
    });
    assert.equal(r.usedFallback, true);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(lines.length, 1);
  const e = JSON.parse(lines[0].slice('telemetry '.length));
  assert.deepEqual([e.surface, e.attempts, e.fallback, e.caught], ['daily', 2, true, true]);
  assert.ok(e.banned.includes('you should') && e.banned.includes('exclamation point'));
  assert.equal(e.unbacked, 2);
  assert.ok(!lines[0].includes('61') && !lines[0].includes('HRV'), 'no draft text or values in the line');
});

test('validator warnings name what was caught without the numbers (no health values in logs)', async () => {
  const drafts = ['HRV is 61ms.', 'HRV is 63ms.'];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: drafts.shift() } }] }))) as typeof fetch;
  const warns: string[] = [];
  try {
    await generateValidatedVoice({ systemPrompt: 's', userPrompt: 'u', drivers: [{ metric: 'HRV', value: '52ms' }], log: { warn: (m) => warns.push(m), error: () => {} } });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(warns.length >= 2);
  for (const w of warns) assert.doesNotMatch(w, /61|63/);
  assert.match(warns[0], /unbacked numbers: 1/);
});
