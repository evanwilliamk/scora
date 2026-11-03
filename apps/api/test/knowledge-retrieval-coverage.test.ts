// Branches of the retrieval query and its live wiring that the main
// knowledge-retrieval suite does not reach. No network: the env wiring only
// builds clients, it never calls them.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRetrievalQuery, knowledgeDepsFromEnv, knowledgeForRead, recordCitations, libraryPromptBlock,
} from '../src/knowledge-retrieval';
import type { RetrievedChunk } from '../src/knowledge-retrieval';

const ENV_KEYS = ['KNOWLEDGE_RETRIEVAL', 'OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test('query: low load, a hard-day streak, raised resting HR, HRV up, a race and the plan session', () => {
  const q = buildRetrievalQuery('steady', {
    acwr: 0.6,
    consecutive_hard_days: 3,
    rhr_7d_avg_delta: 4,
    hrv_7d_avg_delta: 7,
    race_in_next_7d: true,
  } as any, { planned_intensity: 'tempo' } as any);
  assert.match(q.text, /Training load is well below the recent norm\./);
  assert.match(q.text, /3 hard days in a row\./);
  assert.match(q.text, /Resting heart rate is elevated\./);
  assert.match(q.text, /HRV is up against the weekly baseline\./);
  assert.match(q.text, /Race within a week\./);
  assert.match(q.text, /The plan has a tempo session today\./);
  assert.deepEqual([...q.tags].sort(), ['hrv', 'intensity', 'load', 'recovery', 'taper']);
});

test('query: values inside the thresholds add nothing', () => {
  const q = buildRetrievalQuery('steady', {
    acwr: 1.0, consecutive_hard_days: 1, rhr_7d_avg_delta: 2, hrv_7d_avg_delta: 4.9,
    sleep_7d_avg_delta: -3, consecutive_low_sleep_nights: 1,
  } as any);
  assert.equal(q.text, 'Endurance athlete, body state reads steady.');
  assert.deepEqual(q.tags, []);
});

test('query: two short nights alone count as poor sleep; a taper posture tags taper', () => {
  const q = buildRetrievalQuery('taper', { consecutive_low_sleep_nights: 2 } as any);
  assert.match(q.text, /Sleep has been short or poor/);
  assert.deepEqual([...q.tags].sort(), ['sleep', 'taper']);
});

test('knowledgeDepsFromEnv: off unless the flag and all three keys are set', () => {
  process.env.KNOWLEDGE_RETRIEVAL = '';
  process.env.OPENAI_API_KEY = 'k';
  process.env.SUPABASE_URL = 'http://127.0.0.1:9';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  assert.equal(knowledgeDepsFromEnv().enabled, false);
  process.env.KNOWLEDGE_RETRIEVAL = 'on';
  process.env.OPENAI_API_KEY = '';
  const off = knowledgeDepsFromEnv();
  assert.equal(off.enabled, false);
  assert.equal(off.sb, null);
  assert.equal(off.embed, undefined);
});

test('knowledgeDepsFromEnv: flag and keys on builds embed, match and one shared client', () => {
  process.env.KNOWLEDGE_RETRIEVAL = 'on';
  process.env.OPENAI_API_KEY = 'test-not-a-key';
  process.env.SUPABASE_URL = 'http://127.0.0.1:9';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  const log = { warn: () => {} };
  const a = knowledgeDepsFromEnv(log);
  assert.equal(a.enabled, true);
  assert.equal(typeof a.embed, 'function');
  assert.equal(typeof a.match, 'function');
  assert.equal(a.log, log);
  assert.ok(a.sb);
  assert.equal(knowledgeDepsFromEnv().sb, a.sb, 'the Supabase client is built once');
});

test('recordCitations: nothing to record makes no call; an insert error throws', async () => {
  let calls = 0;
  await recordCitations({ from: () => { calls++; return {}; } }, 'a', 't', []);
  assert.equal(calls, 0);
  const chunk: RetrievedChunk = { id: 'c', source_title: 'B', source_author: null, page: null, text: 'x', take: null, similarity: 0.9 };
  await assert.rejects(
    recordCitations({ from: () => ({ insert: async () => ({ error: { message: 'denied' } }) }) }, 'a', 't', [chunk]),
    /denied/,
  );
});

test('libraryPromptBlock: no author or page is cited as the title alone; a take is added on its own line', () => {
  const block = libraryPromptBlock([
    { id: 'c', source_title: 'Book', source_author: null, page: null, text: 'Text.', take: 'Mine.', similarity: 0.9 },
  ]);
  assert.match(block, /\[1\] \(Book\) Text\.\n {4}Reader's take: Mine\./);
});

test('knowledgeForRead: a non-Error thrown by the embedder is still logged and falls back', async () => {
  const warns: string[] = [];
  const out = await knowledgeForRead(
    { posture: 'steady', drivers: {} as any, completeness: 1, sleepSeconds: Number.NaN },
    { enabled: true, embed: async () => { throw 'plain string'; }, match: async () => [], patterns: [], log: { warn: (m) => warns.push(m) } },
  );
  assert.equal(out.mode, 'none');
  assert.deepEqual(warns, ['Knowledge retrieval failed, falling back to patterns: plain string']);
});
