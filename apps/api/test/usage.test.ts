import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeCdvQuota, FREE_CDV_DAILY_LIMIT } from '../src/usage';

// A one-row fake of the athletes table, enough for select/update by strava_id.
function fakeDb(row: { cdv_count: number | null; cdv_count_date: string | null } | null) {
  const updates: any[] = [];
  const db: any = {
    from: (table: string) => {
      assert.equal(table, 'athletes');
      return {
        select: () => ({ eq: () => ({ single: async () => (row ? { data: { ...row }, error: null } : { data: null, error: { message: 'none' } }) }) }),
        update: (u: any) => ({ eq: async (_c: string, id: string) => { updates.push({ id, ...u }); if (row) Object.assign(row, u); return { error: null }; } }),
      };
    },
  };
  return { db, updates };
}

test('free tier allows 3 a day, then refuses without writing', async () => {
  assert.equal(FREE_CDV_DAILY_LIMIT, 3);
  const { db, updates } = fakeDb({ cdv_count: 0, cdv_count_date: '2026-10-17' });
  const r = [];
  for (let i = 0; i < 4; i++) r.push(await consumeCdvQuota('42', undefined, db, '2026-10-17'));
  assert.deepEqual(r.map((q) => [q.allowed, q.used, q.remaining]), [[true, 1, 2], [true, 2, 1], [true, 3, 0], [false, 3, 0]]);
  assert.equal(updates.length, 3);
  assert.deepEqual(updates[0], { id: '42', cdv_count: 1, cdv_count_date: '2026-10-17' });
});

test('a new day resets the count', async () => {
  const { db } = fakeDb({ cdv_count: 3, cdv_count_date: '2026-10-16' });
  const q = await consumeCdvQuota('42', undefined, db, '2026-10-17');
  assert.deepEqual([q.allowed, q.used, q.remaining], [true, 1, 2]);
});

test('a null count on today counts as zero', async () => {
  const { db } = fakeDb({ cdv_count: null, cdv_count_date: '2026-10-17' });
  assert.equal((await consumeCdvQuota('42', 3, db, '2026-10-17')).used, 1);
});

test('an unknown athlete throws so the route can fail open', async () => {
  const { db } = fakeDb(null);
  await assert.rejects(consumeCdvQuota('nobody', 3, db, '2026-10-17'), /Athlete not found/);
});

test('a higher limit (Plan tier seam) is respected', async () => {
  const { db } = fakeDb({ cdv_count: 3, cdv_count_date: '2026-10-17' });
  const q = await consumeCdvQuota('42', 30, db, '2026-10-17');
  assert.deepEqual([q.allowed, q.remaining, q.limit], [true, 26, 30]);
});
