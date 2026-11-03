// supabasePrefsStore paths supabase-prefs.test.ts leaves out: markSent,
// first onboarding, chunked getMany, release on weekly, and load errors.
// Fake supabase-js builder only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabasePrefsStore, PREFS_CHUNK } from '../src/preferences';
import { fakeSupabase } from './helpers/fake-supabase';

test('markSent upserts the right day column for daily and weekly', async () => {
  const sb = fakeSupabase();
  const s = supabasePrefsStore(sb);
  await s.markSent('a1', 'daily', '2026-11-03');
  await s.markSent('a1', 'weekly', '2026-11-01');
  assert.deepEqual(sb.queries[0].calls[0], ['upsert', { athlete_id: 'a1', last_daily_sent_on: '2026-11-03' }, { onConflict: 'athlete_id' }]);
  assert.deepEqual(sb.queries[1].calls[0], ['upsert', { athlete_id: 'a1', last_weekly_sent_on: '2026-11-01' }, { onConflict: 'athlete_id' }]);
  const failing = supabasePrefsStore(fakeSupabase([{ error: { message: 'full' } }]));
  await assert.rejects(failing.markSent('a1', 'daily', '2026-11-03'), /^Error: Mark sent: full$/);
});

test('get with no row returns defaults; a load error names what failed', async () => {
  const p = await supabasePrefsStore(fakeSupabase([{ data: null }])).get('a9');
  assert.equal(p.athlete_id, 'a9');
  assert.equal(p.onboarded_at, null);
  assert.equal(p.timezone, 'America/New_York');
  await assert.rejects(supabasePrefsStore(fakeSupabase([{ error: { message: 'down' } }])).get('a9'), /^Error: Load preferences: down$/);
});

test('update: first onboarding stamps onboarded_at only where none is set; unset fields are not written', async () => {
  const sb = fakeSupabase([
    {},
    {},
    { data: { athlete_id: 'a1', timezone: 'Europe/Paris', delivery_minute: 390, onboarded_at: '2026-11-03T06:00:00.000Z' } },
  ]);
  const out = await supabasePrefsStore(sb).update('a1', { onboarded: true });
  const row = sb.queries[0].calls[0][1] as any;
  assert.deepEqual(Object.keys(row).sort(), ['athlete_id', 'updated_at']);
  const stamp = sb.queries[1].calls;
  assert.equal(typeof (stamp[0][1] as any).onboarded_at, 'string');
  assert.deepEqual(stamp[2], ['is', 'onboarded_at', null]);
  assert.equal(out.onboarded_at, '2026-11-03T06:00:00.000Z');
});

test('update: a save error is reported and the row is not re-read', async () => {
  const sb = fakeSupabase([{ error: { message: 'denied' } }]);
  await assert.rejects(supabasePrefsStore(sb).update('a1', { timezone: 'UTC' }), /^Error: Save preferences: denied$/);
  assert.equal(sb.queries.length, 1);
});

test('getMany: no ids is no request; more ids than one chunk are split across requests', async () => {
  const none = fakeSupabase();
  assert.equal((await supabasePrefsStore(none).getMany([])).size, 0);
  assert.equal(none.queries.length, 0);

  const ids = Array.from({ length: PREFS_CHUNK + 3 }, (_, i) => `a${i}`);
  const sb = fakeSupabase([{ data: [{ athlete_id: 'a0', timezone: 'UTC' }] }, { data: null }]);
  const m = await supabasePrefsStore(sb).getMany(ids);
  assert.equal(sb.queries.length, 2);
  assert.equal((sb.queries[0].calls[1][2] as string[]).length, PREFS_CHUNK);
  assert.deepEqual(sb.queries[1].calls[1][2], ids.slice(PREFS_CHUNK));
  assert.equal(m.size, ids.length);
  assert.equal(m.get('a0')!.timezone, 'UTC');
  assert.equal(m.get(`a${PREFS_CHUNK + 2}`)!.timezone, 'America/New_York');

  const failing = supabasePrefsStore(fakeSupabase([{ error: { message: 'down' } }]));
  await assert.rejects(failing.getMany(['a1']), /^Error: Load preferences: down$/);
});

test('release on weekly matches the weekly column; its error is reported', async () => {
  const sb = fakeSupabase();
  await supabasePrefsStore(sb).release('a1', 'weekly', '2026-11-01', null);
  assert.deepEqual(sb.queries[0].calls, [
    ['update', { last_weekly_sent_on: null }], ['eq', 'athlete_id', 'a1'], ['eq', 'last_weekly_sent_on', '2026-11-01'],
  ]);
  const failing = supabasePrefsStore(fakeSupabase([{ error: { message: 'x' } }]));
  await assert.rejects(failing.release('a1', 'daily', '2026-11-03', '2026-11-02'), /^Error: Release delivery: x$/);
});
