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
import { consumeCdvQuota, refundCdvQuota } from '../src/usage';

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

// ---- CDV quota ----

async function athlete(id: string, count: number, date: string | null) {
  await pg.query(`insert into athletes (name, strava_id, cdv_count, cdv_count_date) values ('A', $1, $2, $3)`, [id, count, date]);
}
const cdv = async (id: string) =>
  (await pg.query<any>(`select cdv_count, to_char(cdv_count_date, 'YYYY-MM-DD') d from athletes where strava_id = $1`, [id])).rows[0];

test('cdv: two queries at once with one left: one allowed, one refused, count at the limit', async () => {
  await athlete('1', 2, '2026-11-03');
  bridge.hold(getsOn('athletes'), 2);
  const [a, b] = await Promise.all([
    consumeCdvQuota('1', 3, sb, '2026-11-03'),
    consumeCdvQuota('1', 3, sb, '2026-11-03'),
  ]);
  assert.deepEqual([a.allowed, b.allowed].sort(), [false, true]);
  assert.deepEqual(await cdv('1'), { cdv_count: 3, d: '2026-11-03' });
});

test('cdv: two first queries of a new day both count', async () => {
  await athlete('1', 3, '2026-11-02');
  bridge.hold(getsOn('athletes'), 2);
  const [a, b] = await Promise.all([
    consumeCdvQuota('1', 3, sb, '2026-11-03'),
    consumeCdvQuota('1', 3, sb, '2026-11-03'),
  ]);
  assert.ok(a.allowed && b.allowed);
  assert.deepEqual([a.used, b.used].sort(), [1, 2]);
  assert.deepEqual(await cdv('1'), { cdv_count: 2, d: '2026-11-03' });
});

test('cdv: a refund racing another query loses neither', async () => {
  await athlete('1', 1, '2026-11-03');
  bridge.hold(getsOn('athletes'), 2);
  const [q, refunded] = await Promise.all([
    consumeCdvQuota('1', 3, sb, '2026-11-03'),
    refundCdvQuota('1', '2026-11-03', sb),
  ]);
  assert.ok(q.allowed);
  assert.equal(refunded, true);
  assert.deepEqual(await cdv('1'), { cdv_count: 1, d: '2026-11-03' });
});

test('cdv: a refund for yesterday after the day turned gives nothing back', async () => {
  await athlete('1', 3, '2026-11-02');
  const q = await consumeCdvQuota('1', 3, sb, '2026-11-03');
  assert.equal(q.used, 1);
  assert.equal(await refundCdvQuota('1', '2026-11-02', sb), false);
  assert.deepEqual(await cdv('1'), { cdv_count: 1, d: '2026-11-03' });
  assert.equal(await refundCdvQuota('1', '2026-11-03', sb), true);
  assert.equal(await refundCdvQuota('1', '2026-11-03', sb), false, 'never below zero');
  assert.deepEqual(await cdv('1'), { cdv_count: 0, d: '2026-11-03' });
});

