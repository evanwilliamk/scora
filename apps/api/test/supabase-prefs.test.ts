// supabasePrefsStore is what production runs; the SQL twin is tested on
// PGlite in delivery.test.ts. These pin the filters it sends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabasePrefsStore } from '../src/preferences';
import { fakeSupabase } from './helpers/fake-supabase';

test('claim: ensure the row, then a conditional update only one caller wins', async () => {
  const sb = fakeSupabase([{}, { data: [{ athlete_id: 'a1' }] }]);
  assert.equal(await supabasePrefsStore(sb).claim('a1', 'daily', '2026-10-22'), true);
  const [ensure, claim] = sb.queries;
  assert.deepEqual(ensure.calls, [['upsert', { athlete_id: 'a1' }, { onConflict: 'athlete_id', ignoreDuplicates: true }]]);
  assert.equal(claim.table, 'athlete_preferences');
  assert.deepEqual(claim.calls.map((c) => c[0]), ['update', 'eq', 'or', 'select']);
  assert.equal((claim.calls[0][1] as any).last_daily_sent_on, '2026-10-22');
  assert.deepEqual(claim.calls[1], ['eq', 'athlete_id', 'a1']);
  assert.deepEqual(claim.calls[2], ['or', 'last_daily_sent_on.is.null,last_daily_sent_on.neq.2026-10-22']);
});

test('claim: no row back means another tick already sent it', async () => {
  const sb = fakeSupabase([{}, { data: [] }]);
  assert.equal(await supabasePrefsStore(sb).claim('a1', 'weekly', '2026-10-26'), false);
  assert.deepEqual(sb.queries[1].calls[2], ['or', 'last_weekly_sent_on.is.null,last_weekly_sent_on.neq.2026-10-26']);
});

test('release only undoes its own claim (matches the claimed date)', async () => {
  const sb = fakeSupabase([{}]);
  await supabasePrefsStore(sb).release('a1', 'daily', '2026-10-22', '2026-10-21');
  assert.deepEqual(sb.queries[0].calls, [
    ['update', { last_daily_sent_on: '2026-10-21' }],
    ['eq', 'athlete_id', 'a1'],
    ['eq', 'last_daily_sent_on', '2026-10-22'],
  ]);
});

test('errors surface with what failed', async () => {
  const sb = fakeSupabase([{ error: { message: 'permission denied' } }]);
  await assert.rejects(supabasePrefsStore(sb).claim('a1', 'daily', '2026-10-22'), /Ensure preferences: permission denied/);
});

test('getMany fills defaults for athletes with no row; update keeps onboarded_at once set', async () => {
  const sb = fakeSupabase([{ data: [{ athlete_id: 'a1', timezone: 'Europe/London', delivery_minute: 420, onboarded_at: null }] }]);
  const m = await supabasePrefsStore(sb).getMany(['a1', 'a2']);
  assert.equal(m.get('a1')!.timezone, 'Europe/London');
  assert.equal(m.get('a2')!.timezone, 'America/New_York');
  assert.deepEqual(sb.queries[0].calls[1], ['in', 'athlete_id', ['a1', 'a2']]);

  const sb2 = fakeSupabase([
    { data: { athlete_id: 'a1', timezone: 'UTC', delivery_minute: 360, onboarded_at: '2026-10-01T00:00:00Z' } },
    {},
    { data: { athlete_id: 'a1', timezone: 'UTC', delivery_minute: 300, onboarded_at: '2026-10-01T00:00:00Z' } },
  ]);
  await supabasePrefsStore(sb2).update('a1', { delivery_minute: 300, onboarded: true });
  const row = sb2.queries[1].calls[0][1] as any;
  assert.equal(row.delivery_minute, 300);
  assert.equal(row.timezone, 'UTC');
  assert.equal('onboarded_at' in row, false, 'an existing onboarded_at is not overwritten');
});
