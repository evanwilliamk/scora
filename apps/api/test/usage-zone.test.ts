// athleteQuotaDay: the chat quota resets at the athlete's own midnight, from
// the zone stored in athlete_preferences; the app's date decides only when no
// zone is stored or the lookup fails. Plus the keepalive's pingDatabase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { athleteQuotaDay, pingDatabase } from '../src/usage';
import { fakeSupabase } from './helpers/fake-supabase';

// 01:30 UTC on the 19th: 21:30 on the 18th in New York, 18:30 in Los Angeles.
const NOW = new Date('2026-10-19T01:30:00Z');

test('a stored zone decides the day, whatever date the app sends', async () => {
  const db = fakeSupabase([{ data: { timezone: 'America/New_York' } }]);
  assert.equal(await athleteQuotaDay('a1', '2026-10-19', NOW, db as any), '2026-10-18');
  const q = db.queries[0];
  assert.equal(q.table, 'athlete_preferences');
  assert.deepEqual(q.calls, [['select', 'timezone'], ['eq', 'athlete_id', 'a1'], ['maybeSingle']]);
});

test('a zone east of UTC moves the day forward', async () => {
  const db = fakeSupabase([{ data: { timezone: 'Asia/Tokyo' } }]);
  assert.equal(await athleteQuotaDay('a1', null, NOW, db as any), '2026-10-19');
});

test('no stored row, a blank or unknown zone: the app\'s date within a day of the server', async () => {
  for (const data of [null, { timezone: null }, { timezone: '' }, { timezone: 'Mars/Olympus' }]) {
    const db = fakeSupabase([{ data }]);
    assert.equal(await athleteQuotaDay('a1', '2026-10-18', NOW, db as any), '2026-10-18', JSON.stringify(data));
  }
  const far = fakeSupabase([{ data: null }]);
  assert.equal(await athleteQuotaDay('a1', '2026-11-30', NOW, far as any), '2026-10-19');
});

test('a lookup error or a throwing client falls back to the app\'s date', async () => {
  const errored = fakeSupabase([{ data: { timezone: 'Asia/Tokyo' }, error: { message: 'down' } }]);
  assert.equal(await athleteQuotaDay('a1', '2026-10-18', NOW, errored as any), '2026-10-18');
  const throwing = { from() { throw new Error('no client'); } };
  assert.equal(await athleteQuotaDay('a1', undefined, NOW, throwing as any), '2026-10-19');
});

test('pingDatabase never throws: without Supabase configured it reports false', async () => {
  const before = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  try {
    assert.equal(await pingDatabase(), false);
  } finally {
    if (before.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = before.key;
  }
});
