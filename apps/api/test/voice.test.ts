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
  assert.deepEqual([r.usedFallback, r.llmError], [true, true]);
  assert.match(errors[0], /^voice_llm_error .*"attempt":2.*"kind":"network"/);
  assert.doesNotMatch(errors[0], /socket hang up/, 'the error text stays out of the log');
});

test('a failed first call propagates when the caller has no fallback', async () => {
  stubOpenAI([503]);
  await assert.rejects(generateValidatedVoice(params), /OpenAI 503/);
});

test('an outage on the first call ends in the validated fallback when the caller opts in', async () => {
  for (const failure of [503, 429, new Error('fetch failed'), Object.assign(new Error('aborted'), { name: 'TimeoutError' })]) {
    const calls = stubOpenAI([failure]);
    const errors: string[] = [];
    const r = await generateValidatedVoice({ ...params, fallbackOnLlmError: true, surface: 'daily', leadIn: "Today's numbers", log: { warn() {}, error: (m) => errors.push(m) } });
    assert.equal(calls.length, 1, 'no second call into an outage');
    assert.deepEqual([r.usedFallback, r.llmError], [true, true]);
    assert.equal(r.voice, "Today's numbers: Load 412 min (+8% wk). HRV 52ms.");
    assert.equal(validateVoice(r.voice, drivers).ok, true);
    assert.equal(errors.length, 1);
    const line = JSON.parse(errors[0].slice('voice_llm_error '.length));
    assert.equal(line.event, 'voice_llm_error');
    assert.equal(line.attempt, 1);
    assert.equal(line.surface, 'daily');
    assert.match(line.kind, /^(http_\d{3}|timeout|network)$/);
    assert.doesNotMatch(errors[0], /upstream error|412|52/, 'no error body, no athlete values');
  }
});

test('a clean read is not flagged as an LLM error', async () => {
  stubOpenAI(['HRV 52ms.']);
  const r = await generateValidatedVoice({ ...params, fallbackOnLlmError: true });
  assert.equal(r.llmError, false);
});

test('each OpenAI call carries a timeout signal', async () => {
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_u: string, init: any) => {
    signal = init.signal;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'HRV 52ms.' } }] }), { status: 200 });
  }) as typeof fetch;
  await generateValidatedVoice(params);
  assert.ok(signal instanceof AbortSignal);
});

test('model and token limit pass through', async () => {
  const calls = stubOpenAI(['HRV 52ms.']);
  await generateValidatedVoice({ ...params, model: 'gpt-4o-mini', maxTokens: 150 });
  assert.equal(calls[0].model, 'gpt-4o-mini');
  assert.equal(calls[0].max_tokens, 150);
});

test('the telemetry line records whether the emitted text passed (gate 1.1.4)', async () => {
  const lines: string[] = [];
  const log = { warn() {}, error() {}, info: (m: string) => lines.push(m) };
  stubOpenAI(['You should do an easy run today.', 'Crush it today!']);
  await generateValidatedVoice({ ...params, surface: 'daily', log });
  stubOpenAI(['Load is 412 min. HRV sits at 52ms.']);
  await generateValidatedVoice({ ...params, surface: 'daily', log });
  const events = lines.map((l) => JSON.parse(l.slice('telemetry '.length)));
  assert.deepEqual(events.map((e) => [e.fallback, e.final_ok]), [[true, true], [false, true]]);
});

test('an extra check (the read\'s posture) counts as a catch: retry, then fallback', async () => {
  const calls = stubOpenAI(['Load is 412 min. The body reads primed.', 'Load is 412 min. Still primed.']);
  const check = (v: string) => (/primed/i.test(v) ? ['posture primed'] : []);
  const r = await generateValidatedVoice({ ...params, check });
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages[1].content, /posture primed/);
  assert.equal(r.usedFallback, true);
  assert.doesNotMatch(r.voice, /primed/i);
});

test('an extra check passing on the retry uses the retry', async () => {
  stubOpenAI(['Load is 412 min. The body reads primed.', 'Load is 412 min, up 8% on the week.']);
  const r = await generateValidatedVoice({ ...params, check: (v) => (/primed/i.test(v) ? ['posture primed'] : []) });
  assert.deepEqual([r.voice, r.attempts, r.usedFallback], ['Load is 412 min, up 8% on the week.', 2, false]);
});
