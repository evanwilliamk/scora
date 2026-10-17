// generateValidatedVoice: draft -> validate -> one retry with the violations
// -> deterministic fallback. global fetch is stubbed; nothing reaches OpenAI.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateValidatedVoice } from '../src/voice';
import { validateVoice } from '../src/validator';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const drivers = [
  { metric: 'Load', value: '412 min', trend: '+8% wk' },
  { metric: 'HRV', value: '52ms' },
];

// Replies with each draft in turn and records what was sent.
function stubOpenAI(drafts: (string | Error | number)[]) {
  const calls: any[] = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    const next = drafts.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'number') return new Response('upstream error', { status: next });
    return new Response(JSON.stringify({ choices: [{ message: { content: `  ${next}  ` } }] }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const params = { systemPrompt: 'sys', userPrompt: 'user', drivers };

test('a clean first draft is used as is, trimmed', async () => {
  const calls = stubOpenAI(['Load is 412 min, up 8% on the week. HRV holds at 52ms.']);
  const r = await generateValidatedVoice(params);
  assert.equal(r.voice, 'Load is 412 min, up 8% on the week. HRV holds at 52ms.');
  assert.deepEqual([r.attempts, r.usedFallback], [1, false]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'gpt-4o');
});

test('a draft with an invented number is retried with the violation named', async () => {
  const calls = stubOpenAI([
    'Load is 412 min and HRV jumped to 61ms.',
    'Load is 412 min. HRV sits at 52ms.',
  ]);
  const warnings: string[] = [];
  const r = await generateValidatedVoice({ ...params, log: { warn: (m) => warnings.push(m), error() {} } });
  assert.equal(r.voice, 'Load is 412 min. HRV sits at 52ms.');
  assert.deepEqual([r.attempts, r.usedFallback], [2, false]);
  assert.match(calls[1].messages[1].content, /rejected for: numbers not in the drivers \(61\)/);
  assert.match(warnings[0], /caught draft 1/);
});

test('two bad drafts fall back to a read built only from drivers', async () => {
  stubOpenAI(['You should do an easy run today.', 'Crush it today!']);
  const r = await generateValidatedVoice({ ...params, leadIn: "Today's numbers" });
  assert.equal(r.usedFallback, true);
  assert.equal(r.voice, "Today's numbers: Load 412 min (+8% wk). HRV 52ms.");
  assert.equal(validateVoice(r.voice, drivers).ok, true, 'the fallback always passes the validators');
  assert.ok(r.validation.bannedHits.length > 0, 'reports why draft 2 failed');
});

test('a failed retry call still ends in the fallback, not an error', async () => {
  stubOpenAI(['HRV is 99ms.', new Error('socket hang up')]);
  const errors: string[] = [];
  const r = await generateValidatedVoice({ ...params, log: { warn() {}, error: (m) => errors.push(m) } });
  assert.equal(r.usedFallback, true);
  assert.match(errors[0], /socket hang up/);
});

test('a failed first call propagates so the route can return 500', async () => {
  stubOpenAI([503]);
  await assert.rejects(generateValidatedVoice(params), /OpenAI 503/);
});

test('model and token limit pass through', async () => {
  const calls = stubOpenAI(['HRV 52ms.']);
  await generateValidatedVoice({ ...params, model: 'gpt-4o-mini', maxTokens: 150 });
  assert.equal(calls[0].model, 'gpt-4o-mini');
  assert.equal(calls[0].max_tokens, 150);
});
