import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import {
  buildRetrievalQuery, knowledgeForRead, knowledgeRetrievalEnabled, libraryPromptBlock,
  supabaseChunkMatcher, recordCitations, RETRIEVAL_MIN_SIMILARITY, citedChunks, libraryClaimHits,
} from '../src/knowledge-retrieval';
import type { ChunkMatcher, RetrievedChunk } from '../src/knowledge-retrieval';
import { ingest, parseExport, sqlStore, EMBEDDING_DIMS } from '../src/knowledge-ingest';

const here = dirname(fileURLToPath(import.meta.url));

// Topic embedder: one axis per keyword, so "sleep" queries land on sleep chunks.
const AXES = ['sleep', 'taper', 'load', 'hrv', 'hard'];
const topicEmbed = async (texts: string[]) => texts.map((t) => {
  const v = new Array(EMBEDDING_DIMS).fill(0);
  const lower = t.toLowerCase();
  AXES.forEach((k, i) => { if (lower.includes(k)) v[i] = 1; });
  v[EMBEDDING_DIMS - 1] = 0.05; // never a zero vector
  return v;
});

const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  id: 'c1', source_title: 'Book', source_author: 'Author', page: '12', text: 'Sleep is when adaptation lands.',
  take: null, similarity: 0.8, ...over,
});

const backOffDrivers = { acwr: 1.6, consecutive_hard_days: 1, sleep_7d_avg_delta: -6, consecutive_low_sleep_nights: 2, hrv_7d_avg_delta: -8 };

test('flag is off unless KNOWLEDGE_RETRIEVAL=on', () => {
  assert.equal(knowledgeRetrievalEnabled({}), false);
  assert.equal(knowledgeRetrievalEnabled({ KNOWLEDGE_RETRIEVAL: 'true' }), false);
  assert.equal(knowledgeRetrievalEnabled({ KNOWLEDGE_RETRIEVAL: 'on' }), true);
});

test('query names only situations backed by drivers, and tags them', () => {
  const q = buildRetrievalQuery('back-off', backOffDrivers);
  assert.match(q.text, /reads back-off/);
  assert.match(q.text, /load has spiked/);
  assert.match(q.text, /Sleep has been short/);
  assert.match(q.text, /HRV is down/);
  assert.deepEqual(q.tags.sort(), ['hrv', 'load', 'recovery', 'sleep']);

  const empty = buildRetrievalQuery('steady', {});
  assert.equal(empty.text, 'Endurance athlete, body state reads steady.');
  assert.deepEqual(empty.tags, []);
});

test('library mode when retrieval finds close chunks', async () => {
  let asked: any;
  const match: ChunkMatcher = async (e, n, tags) => { asked = { n, tags }; return [chunk(), chunk({ id: 'c2', similarity: 0.1 })]; };
  const k = await knowledgeForRead(
    { posture: 'back-off', drivers: backOffDrivers, completeness: 1 },
    { enabled: true, embed: topicEmbed, match, patterns: [] }
  );
  assert.equal(k.mode, 'library');
  assert.deepEqual(k.chunks.map((c) => c.id), ['c1'], `drops chunks under ${RETRIEVAL_MIN_SIMILARITY}`);
  assert.equal(asked.n, 4);
  assert.ok(asked.tags.includes('sleep'));
  assert.match(k.promptBlock, /\[1\] \(Book, Author, p\. 12\) Sleep is when/);
  assert.match(k.promptBlock, /Never take a number from the library/);
});

test('retries without tags when the tagged search is empty', async () => {
  const seen: string[][] = [];
  const match: ChunkMatcher = async (_e, _n, tags) => { seen.push(tags); return tags.length ? [] : [chunk()]; };
  const k = await knowledgeForRead({ posture: 'back-off', drivers: backOffDrivers, completeness: 1 },
    { enabled: true, embed: topicEmbed, match, patterns: [] });
  assert.equal(k.mode, 'library');
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], []);
});

test('retries without tags when every tagged hit is under the similarity floor', async () => {
  const seen: string[][] = [];
  const match: ChunkMatcher = async (_e, _n, tags) => {
    seen.push(tags);
    return tags.length ? [chunk({ id: 'weak', similarity: 0.2 })] : [chunk({ id: 'strong', similarity: 0.6 })];
  };
  const k = await knowledgeForRead({ posture: 'back-off', drivers: backOffDrivers, completeness: 1 },
    { enabled: true, embed: topicEmbed, match, patterns: [] });
  assert.equal(k.mode, 'library');
  assert.deepEqual(k.chunks.map((c) => c.id), ['strong']);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], []);
});

test('falls back to the pattern library when the flag is off, retrieval fails, or nothing is close', async () => {
  const input = {
    posture: 'back-off' as const,
    drivers: { acwr: 1.3, hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 1 },
    completeness: 1,
    scheduled: { planned_intensity: 'threshold' },
  };
  const off = await knowledgeForRead(input, { enabled: false });
  assert.equal(off.mode, 'pattern');
  assert.equal(off.pattern?.id, 'plan-says-hard-body-says-back-off-v1');
  assert.match(off.promptBlock, /^PATTERN \(curated read/);
  assert.match(off.promptBlock, /Fill the shape only with values from DRIVERS/);

  const warnings: string[] = [];
  const broken = await knowledgeForRead(input, {
    enabled: true, embed: async () => { throw new Error('quota'); }, match: async () => [],
    log: { warn: (m) => warnings.push(m) },
  });
  assert.equal(broken.mode, 'pattern');
  assert.match(warnings[0], /quota/);

  const far = await knowledgeForRead(input, { enabled: true, embed: topicEmbed, match: async () => [chunk({ similarity: 0.05 })] });
  assert.equal(far.mode, 'pattern');
});

test('mode none with no plan and nothing retrieved: the read runs on drivers alone', async () => {
  const k = await knowledgeForRead({ posture: 'steady', drivers: {}, completeness: 0 }, { enabled: false });
  assert.deepEqual(k, { mode: 'none', chunks: [], pattern: null, promptBlock: '' });
});

test('library prompt never carries an imperative of its own', () => {
  const block = libraryPromptBlock([chunk({ take: 'Short sleep reads as debt.' })]);
  assert.doesNotMatch(block.replace(/never tells the athlete what to do/, ''), /\byou should\b|\byou need to\b|\bdo a\b|\bgo for\b/i);
  assert.match(block, /Reader's take: Short sleep reads as debt\./);
});

test('supabaseChunkMatcher calls the rpc with the vector text form', async () => {
  let call: any;
  const m = supabaseChunkMatcher({ rpc: async (fn: string, args: any) => { call = { fn, args }; return { data: [chunk()], error: null }; } });
  const out = await m([0.5, 0.25], 3, ['sleep']);
  assert.equal(call.fn, 'match_knowledge_chunks');
  assert.deepEqual(call.args, { query_embedding: '[0.5,0.25]', match_count: 3, filter_tags: ['sleep'] });
  assert.equal(out.length, 1);
  const failing = supabaseChunkMatcher({ rpc: async () => ({ data: null, error: { message: 'boom' } }) });
  await assert.rejects(failing([1], 1, []), /boom/);
});

test('recordCitations writes one ranked row per chunk', async () => {
  let rows: any[] = [];
  await recordCitations({ from: () => ({ insert: async (r: any[]) => { rows = r; return { error: null }; } }) },
    '12345', '2026-10-17T06:00:00Z', [chunk(), chunk({ id: 'c2', similarity: 0.6 })]);
  assert.deepEqual(rows.map((r) => [r.chunk_id, r.rank, r.read_kind]), [['c1', 0, 'daily'], ['c2', 1, 'daily']]);
});

// ---- end to end on PGlite: ingest -> retrieve through the SQL function ----

let db: PGlite;
before(async () => {
  db = new PGlite({ extensions: { vector } });
  const dir = join(here, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
});
after(async () => { await db.close(); });

test('end to end: an athlete short on sleep retrieves the sleep passage', async () => {
  const entries = parseExport([
    { id: 'e1', source_title: 'Book', source_author: 'A', page: '1', passage: 'Sleep debt blunts what training can build.', tags: ['sleep'] },
    { id: 'e2', source_title: 'Book', source_author: 'A', page: '2', passage: 'A taper keeps the edge and sheds the fatigue.', tags: ['taper'] },
  ]);
  await ingest(entries, { embed: topicEmbed, store: sqlStore(db) });

  const match: ChunkMatcher = async (embedding, count, tags) => {
    const r = await db.query<RetrievedChunk>('select * from match_knowledge_chunks($1::vector, $2, $3)',
      [`[${embedding.join(',')}]`, count, tags]);
    return r.rows;
  };
  const k = await knowledgeForRead(
    { posture: 'moderate', drivers: { sleep_7d_avg_delta: -5 }, completeness: 0.2 },
    { enabled: true, embed: topicEmbed, match, patterns: [] }
  );
  assert.equal(k.mode, 'library');
  assert.equal(k.chunks[0].text, 'Sleep debt blunts what training can build.');
  assert.ok(!k.chunks.some((c) => c.text.startsWith('A taper')), 'tag filter keeps taper out');
});

test('an unbacked posture is left out of the query and picks no pattern (night fixes 10-30)', async () => {
  const { buildRetrievalQuery, knowledgeForRead } = await import('../src/knowledge-retrieval');
  assert.doesNotMatch(buildRetrievalQuery(null, {}).text, /body state/);
  const k = await knowledgeForRead(
    { posture: 'steady', postureBacked: false, drivers: { hrv_7d_avg_delta: 5, consecutive_hard_days: 0, sleep_7d_avg_delta: 0 }, completeness: 1, scheduled: { planned_intensity: 'intervals' } },
    { enabled: false },
  );
  assert.equal(k.mode, 'none');
  assert.equal(k.promptBlock, '');
});

test('HealthKit-only athlete (sleep hours, no score) still gets the back-off pattern (night fixes 10-30 regression)', async () => {
  // index.ts sets sleepScore null for HealthKit, so both sleep score drivers
  // are null. Last night's duration backs the sleep-hours slot instead.
  const input = {
    posture: 'back-off' as const,
    drivers: { acwr: 1.3, hrv_7d_avg_delta: -6, consecutive_hard_days: 1, sleep_last_night_score: null, sleep_7d_avg_delta: null },
    completeness: 0.6,
    scheduled: { planned_intensity: 'threshold' },
  };
  const withHours = await knowledgeForRead({ ...input, sleepSeconds: 6 * 3600 + 12 * 60 }, { enabled: false });
  assert.equal(withHours.pattern?.id, 'plan-says-hard-body-says-back-off-v1');
  // No sleep at all: nothing fills "Sleep {{sleep_hours}}", so it stays off.
  const noSleep = await knowledgeForRead({ ...input, sleepSeconds: null }, { enabled: false });
  assert.notEqual(noSleep.pattern?.id, 'plan-says-hard-body-says-back-off-v1');
});

// ---- review 2026-10-31 ----

test('citations are recorded only when the read actually used the library (review finding)', () => {
  const lib = { mode: 'library' as const, chunks: [chunk(), chunk({ id: 'c2' })], pattern: null, promptBlock: 'x' };
  assert.deepEqual(citedChunks(lib, { usedFallback: false }).map((c) => c.id), ['c1', 'c2']);
  // The deterministic fallback is built from drivers alone: no chunk was used.
  assert.deepEqual(citedChunks(lib, { usedFallback: true }), []);
  assert.deepEqual(citedChunks({ mode: 'pattern', chunks: [], pattern: null, promptBlock: '' }, { usedFallback: false }), []);
});

test('library mode catches advice relayed through a source, and numbers lifted from a passage (review finding)', () => {
  const chunks = [chunk({ text: 'Pfitzinger caps a block at three hard days, then rests.' })];
  const drivers = ['1.4', '6:10'];
  // Advice by attribution: the validator alone lets these through.
  for (const v of [
    'ACWR sits at 1.4. Per the library, an easy day is the right call here.',
    'ACWR is 1.4. Daniels would cut the next session to recover.',
    'ACWR is 1.4, so it is worth backing off for a few days.',
    'ACWR is 1.4. The book recommends easing off.',
  ]) assert.ok(libraryClaimHits(v, chunks, drivers).includes('library advice'), v);
  // A number word the passage carries and no driver backs.
  assert.deepEqual(libraryClaimHits('ACWR is 1.4. Blocks tend to cap at three hard days.', chunks, drivers), ['library number three']);
  // Clean interpretation passes; a number word the drivers back passes.
  assert.deepEqual(libraryClaimHits('ACWR is 1.4, well above the recent norm. Load like that tends to arrive before fatigue does.', chunks, drivers), []);
  assert.deepEqual(libraryClaimHits('Three hard days in a row, ACWR 1.4.', chunks, ['1.4', '3']), []);
});

test('a query embedding of the wrong size falls back to patterns with a clear warning (review finding)', async () => {
  const warns: string[] = [];
  let matched = false;
  const r = await knowledgeForRead(
    { posture: 'back-off', drivers: backOffDrivers, completeness: 1 },
    { enabled: true, embed: async () => [[1, 2, 3]], match: async () => { matched = true; return [chunk()]; }, log: { warn: (m) => warns.push(m) } }
  );
  assert.equal(matched, false);
  assert.notEqual(r.mode, 'library');
  assert.match(warns[0], /3 dims, expected 1536/);
});

test('library number check leaves the everyday word "one" alone', () => {
  const chunks = [chunk({ text: 'One hard day a week is the floor, three the ceiling.' })];
  assert.deepEqual(libraryClaimHits('ACWR is 1.4, one of the higher reads this month.', chunks, ['1.4']), []);
});
