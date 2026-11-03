// Non-plan writes against the real migrations: the production supabase-js
// stores talk to a PostgREST stand-in over PGlite, and race tests line two
// requests up so both read before either writes.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { migratedPglite } from './helpers/pglite-db';
import { servePglite, type PgliteRest } from './helpers/pglite-rest';
import { supabaseStore, sqlStore } from '../src/knowledge-ingest';

let rest: FakeRest;
let pg: PGlite;
let bridge: PgliteRest;
let sb: ReturnType<typeof createClient>;

const TABLES = ['athletes', 'athlete_preferences', 'device_tokens', 'knowledge_sources', 'knowledge_chunks'];

before(async () => {
  rest = await fakeRest();
  pg = await migratedPglite();
  sb = createClient(rest.url, 'test-service-role', { auth: { persistSession: false } });
});
after(async () => {
  await pg.close();
  await rest.close();
});
beforeEach(async () => {
  rest.reset();
  bridge = servePglite(rest, pg, TABLES);
  await pg.exec('delete from athlete_preferences; delete from device_tokens; delete from knowledge_chunks; delete from knowledge_sources; delete from athletes;');
});

const getsOn = (table: string) => (r: { method: string; table: string }) => r.method === 'GET' && r.table === table;

// ---- knowledge ingest ----

test('knowledge: two ingests of a source with no author keep one source row (supabase store)', async () => {
  const store = supabaseStore(sb);
  bridge.hold(getsOn('knowledge_sources'), 2);
  const [a, b] = await Promise.all([
    store.upsertSource({ key: 'notes', title: 'Notes', author: null }),
    store.upsertSource({ key: 'notes', title: 'Notes', author: null }),
  ]);
  assert.equal(a, b);
  const r = await pg.query<any>(`select count(*)::int n from knowledge_sources`);
  assert.equal(r.rows[0].n, 1);
});

test('knowledge: two ingests of a source with no author keep one source row (SQL store)', async () => {
  const store = sqlStore(pg);
  const [a, b] = await Promise.all([
    store.upsertSource({ key: 'notes', title: 'Notes', author: null }),
    store.upsertSource({ key: 'notes', title: 'Notes', author: null }),
  ]);
  assert.equal(a, b);
  const r = await pg.query<any>(`select count(*)::int n from knowledge_sources`);
  assert.equal(r.rows[0].n, 1);
});

test('knowledge: two ingests of an authored source keep one row and neither fails', async () => {
  const store = supabaseStore(sb);
  bridge.hold(getsOn('knowledge_sources'), 2);
  const [a, b] = await Promise.all([
    store.upsertSource({ key: 'daniels', title: 'Daniels', author: 'Jack Daniels' }),
    store.upsertSource({ key: 'daniels', title: 'Daniels', author: 'Jack Daniels' }),
  ]);
  assert.equal(a, b);
});
