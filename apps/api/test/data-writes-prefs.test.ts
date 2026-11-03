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
import { supabasePrefsStore } from '../src/preferences';

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

// ---- athlete_preferences ----

test('prefs: a time zone sync and a delivery time change at once both stick', async () => {
  await pg.query(`insert into athlete_preferences (athlete_id, timezone, delivery_minute) values ('a1', 'UTC', 360)`);
  const store = supabasePrefsStore(sb);
  bridge.hold(getsOn('athlete_preferences'), 2);
  await Promise.all([
    store.update('a1', { timezone: 'Europe/London' }),
    store.update('a1', { delivery_minute: 420 }),
  ]);
  const r = await pg.query<any>(`select timezone, delivery_minute from athlete_preferences where athlete_id = 'a1'`);
  assert.deepEqual(r.rows[0], { timezone: 'Europe/London', delivery_minute: 420 });
});

test('prefs: a settings save never moves the sent-on claims', async () => {
  await pg.query(`insert into athlete_preferences (athlete_id, last_daily_sent_on, last_weekly_sent_on) values ('a1', '2026-11-03', '2026-11-01')`);
  const store = supabasePrefsStore(sb);
  bridge.hold((r) => r.table === 'athlete_preferences', 2);
  // The scheduler releases today while the app saves a delivery time.
  await Promise.all([
    store.update('a1', { delivery_minute: 400 }),
    store.release('a1', 'daily', '2026-11-03', '2026-11-02'),
  ]);
  const r = await pg.query<any>(`select to_char(last_daily_sent_on, 'YYYY-MM-DD') d, to_char(last_weekly_sent_on, 'YYYY-MM-DD') w, delivery_minute from athlete_preferences`);
  assert.deepEqual(r.rows[0], { d: '2026-11-02', w: '2026-11-01', delivery_minute: 400 });
});

test('prefs: onboarding twice keeps the first onboarded_at; a first save makes the row with defaults', async () => {
  const store = supabasePrefsStore(sb);
  const first = await store.update('a2', { onboarded: true });
  assert.ok(first.onboarded_at);
  assert.equal(first.timezone, 'America/New_York');
  assert.equal(first.delivery_minute, 360);
  await new Promise((r) => setTimeout(r, 5));
  const second = await store.update('a2', { onboarded: true, timezone: 'UTC' });
  assert.equal(second.onboarded_at && new Date(second.onboarded_at).getTime(), new Date(first.onboarded_at!).getTime());
  assert.equal(second.timezone, 'UTC');
  const none = await store.update('a3', { timezone: 'UTC' });
  assert.equal(none.onboarded_at, null);
});

