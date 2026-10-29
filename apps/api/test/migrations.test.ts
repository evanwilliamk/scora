// Applies every Supabase migration to an in-process Postgres (PGlite with
// pgvector) and exercises the knowledge library schema. No network, no
// Supabase project.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
let db: PGlite;

// A unit vector along `axis`, nudged toward `toward` by `mix`. Cosine
// similarity to a query on `axis` falls as `mix` grows.
const vec = (axis: number, mix = 0, toward = 1): string => {
  const v = new Array(1536).fill(0);
  v[axis] = 1 - mix;
  v[toward] += mix;
  return `[${v.join(',')}]`;
};

before(async () => {
  db = new PGlite({ extensions: { vector } });
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
});

after(async () => {
  await db.close();
});

const addSource = async (title: string, active = true): Promise<string> => {
  const r = await db.query<{ id: string }>(
    'insert into knowledge_sources (title, author, active) values ($1, $2, $3) returning id',
    [title, 'Author', active]
  );
  return r.rows[0].id;
};

const addChunk = async (sourceId: string, text: string, embedding: string, tags: string[] = [], entry?: string) => {
  const r = await db.query<{ id: string }>(
    `insert into knowledge_chunks (source_id, text, embedding, tags, fieldcopy_entry_id)
     values ($1, $2, $3::vector, $4, $5) returning id`,
    [sourceId, text, embedding, tags, entry ?? null]
  );
  return r.rows[0].id;
};

test('every migration applies in order and creates the knowledge tables', async () => {
  const r = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name like any (array['knowledge_%', 'read_citations'])
     order by table_name`
  );
  assert.deepEqual(r.rows.map((x) => x.table_name), ['knowledge_chunks', 'knowledge_sources', 'read_citations']);
});

test('match_knowledge_chunks ranks by cosine similarity, filters tags and inactive sources', async () => {
  const daniels = await addSource('Running Formula');
  const retired = await addSource('Retired Book', false);
  await addChunk(daniels, 'Sleep debt and threshold work', vec(0), ['sleep']);
  await addChunk(daniels, 'Taper keeps intensity, drops volume', vec(0, 0.4), ['taper']);
  await addChunk(daniels, 'Unrelated passage', vec(5), ['base']);
  await addChunk(retired, 'Should never surface', vec(0), ['sleep']);

  const all = await db.query<{ text: string; similarity: number; source_title: string }>(
    'select * from match_knowledge_chunks($1::vector, 3)',
    [vec(0)]
  );
  assert.deepEqual(all.rows.map((r) => r.text), [
    'Sleep debt and threshold work',
    'Taper keeps intensity, drops volume',
    'Unrelated passage',
  ]);
  assert.ok(Math.abs(all.rows[0].similarity - 1) < 1e-5);
  assert.ok(all.rows[0].similarity > all.rows[1].similarity);
  assert.equal(all.rows[0].source_title, 'Running Formula');

  const taper = await db.query<{ text: string }>(
    'select * from match_knowledge_chunks($1::vector, 5, $2)',
    [vec(0), ['taper']]
  );
  assert.deepEqual(taper.rows.map((r) => r.text), ['Taper keeps intensity, drops volume']);
});

test('re-ingesting the same FieldCopy entry chunk is rejected', async () => {
  const s = await addSource('Idempotent Source');
  await addChunk(s, 'once', vec(2), [], 'fc-entry-1');
  await assert.rejects(addChunk(s, 'twice', vec(2), [], 'fc-entry-1'), /duplicate key|unique/i);
});

test('read citations link to chunks and cascade when a source is deleted', async () => {
  const s = await addSource('Cascade Source');
  const chunk = await addChunk(s, 'cited', vec(3));
  await db.query(
    `insert into read_citations (athlete_id, read_kind, read_generated_at, chunk_id, rank, similarity)
     values ('12345', 'daily', now(), $1, 0, 0.91)`,
    [chunk]
  );
  await assert.rejects(
    db.query(`insert into read_citations (athlete_id, read_kind, read_generated_at, chunk_id)
              values ('12345', 'monthly', now(), $1)`, [chunk]),
    /check constraint/i
  );
  await db.query('delete from knowledge_sources where id = $1', [s]);
  const left = await db.query('select 1 from read_citations where chunk_id = $1', [chunk]);
  assert.equal(left.rows.length, 0);
});

test('source kind is constrained', async () => {
  await assert.rejects(
    db.query(`insert into knowledge_sources (title, kind) values ('Podcast', 'podcast')`),
    /check constraint/i
  );
});

test('every table has row level security on (doc 10 §6.5), so the anon key reads nothing', async () => {
  const r = await db.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
  );
  assert.deepEqual(r.rows.map((x) => x.relname), [], 'a new table needs "enable row level security" in its migration');
});
