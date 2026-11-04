// meteredFetch logs one line per OpenAI request and changes nothing the caller
// gets back. Each OpenAI wrapper is checked here with a fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meteredFetch } from '../src/llm-meter';
import { openAiEmbedder } from '../src/knowledge-ingest';
import { openAiPlanLlm } from '../src/plan-parse';
import { openAiReasonLlm } from '../src/adaptation-reason';

const usage = { prompt_tokens: 11, completion_tokens: 7 };
const chat = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage }), { status: 200 })) as unknown as typeof fetch;
const collect = () => {
  const lines: any[] = [];
  return { lines, log: { info: (m: string) => lines.push(JSON.parse(m.replace('telemetry ', ''))) } };
};

test('plan parse and adaptation reason each log their surface, model and tokens', async () => {
  const { lines, log } = collect();
  assert.equal(await openAiPlanLlm('k', meteredFetch('plan_parse', 42, log, chat))('s', 'u'), 'hi');
  assert.equal(await openAiReasonLlm('k', meteredFetch('adaptation_reason', '42', log, chat))('s', 'u'), 'hi');
  assert.deepEqual(lines.map((l) => [l.surface, l.athlete, l.model, l.attempt, l.prompt_tokens, l.completion_tokens]), [
    ['plan_parse', '42', 'gpt-4o-mini', 1, 11, 7],
    ['adaptation_reason', '42', 'gpt-4o-mini', 1, 11, 7],
  ]);
});

test('an embedding logs its prompt tokens; it has no completion', async () => {
  const { lines, log } = collect();
  const f = (async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }], usage: { prompt_tokens: 9, total_tokens: 9 } }), { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await openAiEmbedder('k', meteredFetch('retrieval', '42', log, f))(['x']), [[1]]);
  assert.equal(lines[0].surface, 'retrieval');
  assert.equal(lines[0].prompt_tokens, 9);
  assert.equal(lines[0].completion_tokens, null);
});

test('a refused call and a network failure each count, and the failure still reaches the caller', async () => {
  const { lines, log } = collect();
  let n = 0;
  const f = (async () => {
    if (n++ === 0) return new Response('{"error":"echoes the prompt"}', { status: 429 });
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const m = meteredFetch('cdv', '42', log, f);
  assert.equal((await m('https://x', { body: JSON.stringify({ model: 'gpt-4o-mini' }) })).status, 429);
  await assert.rejects(m('https://x', { body: JSON.stringify({ model: 'gpt-4o-mini' }) }), TypeError);
  assert.deepEqual(lines.map((l) => [l.attempt, l.status]), [[1, 429], [2, null]]);
  assert.doesNotMatch(JSON.stringify(lines), /echoes/);
});

test('the caller can still read the body, and a broken log costs nothing', async () => {
  const m = meteredFetch('cdv', null, { info: () => { throw new Error('log down'); } }, chat);
  const res = await m('https://x', {});
  assert.deepEqual(((await res.json()) as any).usage, usage);
});
