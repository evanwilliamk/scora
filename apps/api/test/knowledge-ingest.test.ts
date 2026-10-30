import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import {
  parseExport, chunkPassage, planIngest, ingest, sqlStore, supabaseStore, openAiEmbedder,
  IngestError, EMBEDDING_DIMS, EMBEDDING_MODEL, PRUNE_BATCH,
} from '../src/knowledge-ingest';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'fieldcopy-export.json'), 'utf8'));

// Deterministic fake embedder: one-hot on a hash of the text.
const fakeEmbed = (calls: string[][]) => async (texts: string[]) => {
  calls.push(texts);
  return texts.map((t) => {
    const v = new Array(EMBEDDING_DIMS).fill(0);
    let h = 0;
    for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) % EMBEDDING_DIMS;
    v[h] = 1;
    return v;
  });
};

let db: PGlite;
before(async () => {
  db = new PGlite({ extensions: { vector } });
  const dir = join(here, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
});
after(async () => { await db.close(); });

test('parseExport accepts the FieldCopy shape and both wrappers', () => {
  const entries = parseExport(fixture);
  assert.equal(entries.length, 3);
  assert.equal(parseExport(fixture.entries).length, 3);
});

test('parseExport rejects a bad entry with its index and field', () => {
  assert.throws(() => parseExport([{ id: 'x', source_title: 'T' }]), /Entry 0: passage/);
  assert.throws(() => parseExport({ nope: [] }), IngestError);
});

test('short passages are one chunk; whitespace is normalized', () => {
  assert.deepEqual(chunkPassage('  One  idea.\r\n'), ['One idea.']);
  assert.deepEqual(chunkPassage('   '), []);
});

test('long passages split on sentence boundaries under the limit, with overlap', () => {
  const sentence = (i: number) => `Sentence number ${i} carries one small idea about training.`;
  const text = Array.from({ length: 12 }, (_, i) => sentence(i)).join(' ');
  const chunks = chunkPassage(text, 200, 60);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 200, `chunk too long: ${c.length}`);
  // Every sentence survives somewhere.
  for (let i = 0; i < 12; i++) assert.ok(chunks.some((c) => c.includes(`number ${i} `)), `lost sentence ${i}`);
  // Chunk 2 starts with context carried from chunk 1.
  const tailWords = chunks[0].split(' ').slice(-3).join(' ');
  assert.ok(chunks[1].includes(tailWords), 'expected overlap between chunks');
});

test('a single sentence longer than the limit splits on words', () => {
  const long = Array.from({ length: 100 }, () => 'word').join(' ');
  const chunks = chunkPassage(long, 50, 0);
  for (const c of chunks) assert.ok(c.length <= 50);
  assert.equal(chunks.join(' ').split(' ').length, 100);
});

test('planIngest groups sources and maps citations', () => {
  const plan = planIngest(parseExport(fixture));
  assert.equal(plan.sources.length, 2);
  assert.equal(plan.chunks.length, 3);
  const first = plan.chunks[0];
  assert.equal(first.fieldcopy_entry_id, 'a1b2c3d4-0001');
  assert.equal(first.page, '112');
  assert.deepEqual(first.tags, ['sleep', 'recovery']);
  assert.match(first.embedText, /Take: Short sleep/);
  assert.equal(plan.chunks[1].page, '140'); // numeric page becomes text
  assert.equal(plan.chunks[1].embedText, plan.chunks[1].text); // no take, nothing appended
  assert.equal(plan.chunks[2].page, null);
});

test('planIngest rejects duplicate entry ids', () => {
  const e = parseExport(fixture);
  assert.throws(() => planIngest([e[0], e[0]]), /Duplicate entry id/);
});

test('ingest writes sources and chunks, and re-ingest is idempotent', async () => {
  const calls: string[][] = [];
  const store = sqlStore(db);
  const entries = parseExport(fixture);

  const r1 = await ingest(entries, { embed: fakeEmbed(calls), store, batchSize: 2 });
  assert.deepEqual(r1, { sources: 2, chunks: 3, embedCalls: 2 });
  assert.deepEqual(calls.map((c) => c.length), [2, 1]);

  await ingest(entries, { embed: fakeEmbed(calls), store });
  const sources = await db.query<{ n: number }>('select count(*)::int as n from knowledge_sources');
  const chunks = await db.query<{ n: number }>('select count(*)::int as n from knowledge_chunks');
  assert.equal(sources.rows[0].n, 2, 'null-author source must not duplicate');
  assert.equal(chunks.rows[0].n, 3);

  const row = await db.query<{ page: string; tags: string[]; embedding_model: string }>(
    `select page, tags, embedding_model from knowledge_chunks where fieldcopy_entry_id = 'a1b2c3d4-0001'`
  );
  assert.deepEqual(row.rows[0], { page: '112', tags: ['sleep', 'recovery'], embedding_model: EMBEDDING_MODEL });
});

test('ingested chunks come back through match_knowledge_chunks', async () => {
  const [v] = await fakeEmbed([])([planIngest(parseExport(fixture)).chunks[1].embedText]);
  const r = await db.query<{ text: string; source_title: string }>(
    'select * from match_knowledge_chunks($1::vector, 1)',
    [`[${v.join(',')}]`]
  );
  assert.equal(r.rows[0].text, 'In the final week the work stays sharp and the volume falls away.');
  assert.equal(r.rows[0].source_title, 'Sample Training Book');
});

test('ingest refuses vectors of the wrong size or count', async () => {
  const entries = parseExport(fixture).slice(0, 1);
  const store = { upsertSource: async () => 'id', upsertChunk: async () => {}, pruneEntry: async () => {}, pruneMissing: async () => {} };
  await assert.rejects(ingest(entries, { embed: async () => [[1, 2, 3]], store }), /dims/);
  await assert.rejects(ingest(entries, { embed: async () => [], store }), /0 vectors for 1/);
});

test('openAiEmbedder posts the model and restores input order', async () => {
  let body: any;
  const fakeFetch = (async (_url: string, init: any) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }],
    }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await openAiEmbedder('test-key', fakeFetch)(['a', 'b']);
  assert.equal(body.model, 'text-embedding-3-small');
  assert.deepEqual(body.input, ['a', 'b']);
  assert.deepEqual(out, [[1], [2]]);

  const failing = (async () => new Response('quota', { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(openAiEmbedder('k', failing)(['a']), /429/);
});

test('supabaseStore looks up a null-author source with IS NULL, then upserts chunks on the natural key', async () => {
  const log: any[] = [];
  const query = (result: any) => {
    const q: any = {
      select: (...a: any[]) => (log.push(['select', ...a]), q),
      eq: (...a: any[]) => (log.push(['eq', ...a]), q),
      is: (...a: any[]) => (log.push(['is', ...a]), q),
      limit: async () => result,
      insert: (row: any) => (log.push(['insert', row]), q),
      single: async () => ({ data: { id: 'new-id' }, error: null }),
      upsert: async (row: any, opts: any) => (log.push(['upsert', row, opts]), { error: null }),
    };
    return q;
  };
  const sb = { from: (t: string) => (log.push(['from', t]), query({ data: [], error: null })) };
  const store = supabaseStore(sb);
  const plan = planIngest(parseExport(fixture));
  const id = await store.upsertSource(plan.sources[1]);
  assert.equal(id, 'new-id');
  assert.ok(log.some((l) => l[0] === 'is' && l[1] === 'author' && l[2] === null));

  await store.upsertChunk('src', plan.chunks[0], new Array(EMBEDDING_DIMS).fill(0));
  const up = log.find((l) => l[0] === 'upsert');
  assert.equal(up[2].onConflict, 'fieldcopy_entry_id,chunk_index');
  assert.match(up[1].embedding, /^\[0,0,/);
});

test('chunking never rewrites text: decimals and abbreviations survive (review finding)', () => {
  const sentence = 'At 2.5 percent, e.g. a 42.2 km race needs 3.5 hours of steady work.';
  const text = Array.from({ length: 30 }, () => sentence).join(' ') + '\n\nSecond paragraph ends here.';
  const chunks = chunkPassage(text, 300, 0);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.doesNotMatch(c, /\d\. \d|e\. g\./);
  assert.equal(chunks.join(' '), text.replace(/\s+/g, ' '));
});

test('re-ingesting a shorter passage removes its stale chunks', async () => {
  const store = sqlStore(db);
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} about training load and recovery.`).join(' ');
  const entry = (passage: string) => parseExport([{ id: 'shrink-1', source_title: 'Shrink Book', passage }]);
  await ingest(entry(long), { embed: fakeEmbed([]), store });
  const before = await db.query<{ n: number }>(`select count(*)::int as n from knowledge_chunks where fieldcopy_entry_id = 'shrink-1'`);
  assert.ok(before.rows[0].n > 1);
  await ingest(entry('Now one short passage.'), { embed: fakeEmbed([]), store });
  const after = await db.query<{ n: number; text: string }>(`select count(*)::int as n, min(text) as text from knowledge_chunks where fieldcopy_entry_id = 'shrink-1'`);
  assert.deepEqual(after.rows[0], { n: 1, text: 'Now one short passage.' });
});

test('an entry emptied out loses its chunks; sync removes entries missing from the export', async () => {
  const store = sqlStore(db);
  const two = parseExport([
    { id: 'sync-a', source_title: 'Sync Book', passage: 'Passage A about sleep.' },
    { id: 'sync-b', source_title: 'Sync Book', passage: 'Passage B about load.' },
  ]);
  await ingest(two, { embed: fakeEmbed([]), store });
  const count = async (id: string) => (await db.query<{ n: number }>(`select count(*)::int as n from knowledge_chunks where fieldcopy_entry_id = '${id}'`)).rows[0].n;

  // Edited down to whitespace: the chunker yields no chunks.
  await ingest(parseExport([{ id: 'sync-a', source_title: 'Sync Book', passage: '   ' }]), { embed: fakeEmbed([]), store });
  assert.equal(await count('sync-a'), 0);
  assert.equal(await count('sync-b'), 1, 'without sync, other entries stay');

  await ingest(parseExport([{ id: 'sync-c', source_title: 'Sync Book', passage: 'Only C now.' }]), { embed: fakeEmbed([]), store, sync: true });
  assert.equal(await count('sync-b'), 0, 'sync removes entries not in the export');
  assert.equal(await count('sync-c'), 1);
});

test('sync refuses an empty export before embedding, and the store refuses an empty keep list', async () => {
  const store = sqlStore(db);
  await ingest(parseExport([{ id: 'keep-me', source_title: 'Guard Book', passage: 'Still here.' }]), { embed: fakeEmbed([]), store });
  const calls: string[][] = [];
  await assert.rejects(ingest([], { embed: fakeEmbed(calls), store, sync: true }), /empty export/);
  assert.equal(calls.length, 0);
  await assert.rejects(store.pruneMissing([]), /no entries/);
  const left = await db.query<{ n: number }>(`select count(*)::int as n from knowledge_chunks where fieldcopy_entry_id = 'keep-me'`);
  assert.equal(left.rows[0].n, 1, 'nothing was deleted');
});

test('sql sync prunes missing entries in batches', async () => {
  const store = sqlStore(db);
  const many = parseExport(Array.from({ length: PRUNE_BATCH + 30 }, (_, i) => (
    { id: `bulk-${i}`, source_title: 'Bulk Book', passage: `Passage ${i}.` })));
  await ingest(many, { embed: fakeEmbed([]), store });
  const deletes: number[] = [];
  const spy = { query: async (sql: string, params?: any[]) => {
    if (/^delete/.test(sql) && /any\(\$1\)/.test(sql)) deletes.push(params![0].length);
    return db.query(sql, params);
  } };
  await ingest(parseExport([{ id: 'bulk-0', source_title: 'Bulk Book', passage: 'Passage 0.' }]),
    { embed: fakeEmbed([]), store: sqlStore(spy), sync: true });
  const ids = await db.query<{ id: string }>('select distinct fieldcopy_entry_id as id from knowledge_chunks where fieldcopy_entry_id is not null');
  assert.deepEqual(ids.rows.map((r) => r.id), ['bulk-0']);
  assert.ok(deletes.length >= 2 && deletes.every((n) => n <= PRUNE_BATCH), `batched deletes: ${deletes}`);
});

test('supabaseStore sync lists stored ids page by page and deletes missing ones in batches', async () => {
  // In-memory knowledge_chunks behind a PostgREST-shaped fake.
  let rows = Array.from({ length: 2500 }, (_, i) => ({ fieldcopy_entry_id: `e-${Math.floor(i / 2)}`, chunk_index: i % 2 }));
  rows.push({ fieldcopy_entry_id: null as any, chunk_index: 0 });
  const deletes: string[][] = [];
  const sb = {
    from: (_t: string) => ({
      select: () => {
        const q: any = {
          not: () => q,
          order: () => q,
          range: async (a: number, b: number) => {
            const page = rows.filter((r) => r.fieldcopy_entry_id !== null).slice(a, Math.min(b + 1, a + 1000));
            return { data: page, error: null };
          },
        };
        return q;
      },
      delete: () => ({
        in: async (_col: string, ids: string[]) => {
          deletes.push(ids);
          rows = rows.filter((r) => !ids.includes(r.fieldcopy_entry_id));
          return { error: null };
        },
      }),
    }),
  };
  const keep = Array.from({ length: 2000 }, (_, i) => `keep-${i}`).concat(['e-0', 'e-7']);
  await supabaseStore(sb).pruneMissing(keep);
  assert.deepEqual([...new Set(rows.map((r) => r.fieldcopy_entry_id))].sort(), ['e-0', 'e-7', null].sort());
  assert.ok(deletes.every((ids) => ids.length <= PRUNE_BATCH));
  assert.equal(deletes.flat().length, 1248, 'each missing entry deleted once');
  await assert.rejects(supabaseStore(sb).pruneMissing([]), /no entries/);
});
