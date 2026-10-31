import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchActivitiesSince, fetchRecentActivities } from '../src/strava';

test('fetchRecentActivities asks by date, pages, and returns newest first', async () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const urls: string[] = [];
  // Strava with `after` answers oldest first, 200 a page.
  const oldestFirst = Array.from({ length: 250 }, (_, i) => ({ id: i, start_date: new Date(now - (250 - i) * 3600_000).toISOString() }));
  const fake = (async (url: string) => {
    urls.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    return { ok: true, json: async () => oldestFirst.slice((page - 1) * 200, page * 200) };
  }) as any;
  const got = await fetchRecentActivities('t', 56, fake, now);
  assert.equal(got.length, 250);
  assert.equal(got[0].id, 249, 'newest first, so callers can slice the latest from the front');
  assert.equal(got[249].id, 0);
  assert.equal(new URL(urls[0]).searchParams.get('after'), String(Math.floor(now / 1000) - 56 * 86400));
  assert.equal(urls.length, 2);
});

test('fetchRecentActivities passes a Strava refusal up', async () => {
  await assert.rejects(fetchRecentActivities('t', 15, (async () => ({ ok: false, status: 401 })) as any), /Strava 401/);
});

test('fetchActivitiesSince gives each Strava page a timeout, so a hung call cannot hold the read', async () => {
  const inits: any[] = [];
  const fake = (async (_url: string, init: any) => { inits.push(init); return { ok: true, json: async () => [] }; }) as any;
  await fetchActivitiesSince('t', 0, fake);
  assert.ok(inits[0]?.signal instanceof AbortSignal, 'request carries an abort signal');
});

test('fetchActivitiesSince rejects a non-list body and drops non-object entries', async () => {
  const obj = (async () => ({ ok: true, json: async () => ({ message: 'odd' }) })) as any;
  await assert.rejects(fetchActivitiesSince('t', 0, obj), /Strava returned no activity list/);
  const mixed = (async () => ({ ok: true, json: async () => [null, 3, 'x', { id: 1, start_date: '2026-10-01T00:00:00Z' }] })) as any;
  const got = await fetchActivitiesSince('t', 0, mixed);
  assert.deepEqual(got.map((a) => a.id), [1]);
});
