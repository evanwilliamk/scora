import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceEmissionLine } from '../src/telemetry';
import { generateValidatedVoice } from '../src/voice';
import { auditLog } from '../src/log-audit';

test('one countable line per emission: labels and counts, never text', () => {
  const line = voiceEmissionLine({ surface: 'daily', attempts: 2, fallback: false, bannedHits: ['you should', 'you should'], unbackedCount: 1, finalOk: true });
  assert.ok(line.startsWith('telemetry '));
  assert.deepEqual(JSON.parse(line.slice('telemetry '.length)), {
    event: 'voice_emission', surface: 'daily', attempts: 2, fallback: false, caught: true, banned: ['you should'], unbacked: 1, final_ok: true,
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
  assert.equal(lines.filter((l) => l.includes('"llm_call"')).length, 2, 'one line per model call, the retry too');
  const emissions = lines.filter((l) => l.includes('"voice_emission"'));
  assert.equal(emissions.length, 1);
  const e = JSON.parse(emissions[0].slice('telemetry '.length));
  assert.deepEqual([e.surface, e.attempts, e.fallback, e.caught], ['daily', 2, true, true]);
  assert.ok(e.banned.includes('you should') && e.banned.includes('exclamation point'));
  assert.equal(e.unbacked, 2);
  for (const line of lines) assert.ok(!line.includes('61') && !line.includes('HRV'), 'no draft text or values in the line');
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

test('gate 1.1.6: a wrong-direction catch on an HRV driver does not read as an HRV value in the logs', async () => {
  // The label names the driver ("HRV vs week"); next to the unbacked count
  // the log audit read it as an HRV value. Labels stay fixed strings.
  const line = voiceEmissionLine({ surface: 'adaptation_reason', attempts: 1, fallback: true, bannedHits: ['wrong direction for HRV vs week'], unbackedCount: 2, finalOk: true });
  assert.deepEqual(JSON.parse(line.slice('telemetry '.length)).banned, ['wrong direction']);
  assert.deepEqual(auditLog(line), []);

  // The same catch in the voice warn lines.
  const drafts = ['HRV is down 8% this week. Sleep 61.', 'HRV fell 8% over the week. Sleep 62.'];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: drafts.shift() } }] }))) as typeof fetch;
  const lines: string[] = [];
  const keep = (m: string) => lines.push(m);
  try {
    await generateValidatedVoice({
      systemPrompt: 's', userPrompt: 'u', drivers: [{ metric: 'HRV vs week', value: '+8%' }], surface: 'daily',
      log: { warn: keep, error: keep, info: keep },
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(lines.some((l) => /caught draft 1: banned: wrong direction;/.test(l)), lines.join('\n'));
  assert.deepEqual(auditLog(lines.join('\n')), []);
});
