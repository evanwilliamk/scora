import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeCdvQuota, quotaDay } from '../src/usage';

// Minimal stand-in for the athletes table row the quota reads and writes.
function fakeDb(row: { cdv_count: number | null; cdv_count_date: string | null }) {
  const chain: any = {
    select: () => chain, eq: () => chain,
    single: async () => ({ data: { ...row }, error: null }),
    update: (v: any) => { Object.assign(row, v); return chain; },
  };
  return { db: { from: () => chain } as any, row };
}

test('quotaDay: the local date within a day of the server, otherwise the server day', () => {
  const now = new Date('2026-10-19T01:30:00Z'); // 21:30 on the 18th in New York
  assert.equal(quotaDay('2026-10-18', now), '2026-10-18');
  assert.equal(quotaDay('2026-10-20', now), '2026-10-20');
  assert.equal(quotaDay('2026-10-25', now), '2026-10-19');
  assert.equal(quotaDay('2026-02-31', now), '2026-10-19');
  assert.equal(quotaDay(undefined, now), '2026-10-19');
});

test('a US evening keeps the day it is in: no reset at UTC midnight', async () => {
  const { db, row } = fakeDb({ cdv_count: 3, cdv_count_date: '2026-10-18' });
  const q = await consumeCdvQuota('a', 3, db, quotaDay('2026-10-18', new Date('2026-10-19T01:30:00Z')));
  assert.equal(q.allowed, false);
  assert.equal(row.cdv_count, 3);
});

test('the quota day never moves backwards, so changing the clock buys nothing', async () => {
  const { db, row } = fakeDb({ cdv_count: 3, cdv_count_date: '2026-10-19' });
  const q = await consumeCdvQuota('a', 3, db, '2026-10-18');
  assert.equal(q.allowed, false);
  assert.equal(row.cdv_count_date, '2026-10-19');
});

test('a new local day resets the count', async () => {
  const { db, row } = fakeDb({ cdv_count: 3, cdv_count_date: '2026-10-18' });
  const q = await consumeCdvQuota('a', 3, db, '2026-10-19');
  assert.deepEqual([q.allowed, q.used, row.cdv_count_date], [true, 1, '2026-10-19']);
});
