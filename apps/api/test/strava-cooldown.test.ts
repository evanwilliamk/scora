// A Strava 429 stops this process asking until the window turns: the limit is
// the application's, so every other athlete's call would only fail as well.

import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchActivitiesSince, fetchStravaAthlete, resetStravaCooldown, stravaCooldownEnd } from '../src/strava';
import { VendorHttpError } from '../src/vendor-error';

// 2026-11-04 06:07:30 UTC
const T = Date.UTC(2026, 10, 4, 6, 7, 30);
const limited = (headers: Record<string, string> = {}) => new Response('{}', { status: 429, headers });

beforeEach(() => {
  resetStravaCooldown();
  mock.method(console, 'warn', () => {});
  mock.method(Date, 'now', () => T);
});
afterEach(() => mock.restoreAll());

const counting = (first: () => Response) => {
  let n = 0;
  const f = (async () => (n++ === 0 ? first() : new Response('[]', { status: 200 }))) as unknown as typeof fetch;
  return { f, count: () => n };
};
const rejects429 = (p: Promise<unknown>) =>
  assert.rejects(p, (e) => e instanceof VendorHttpError && e.status === 429);

test('a 15-minute limit waits for the next quarter hour', () => {
  assert.equal(stravaCooldownEnd(new Headers(), T), Date.UTC(2026, 10, 4, 6, 15));
  const h = new Headers({ 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '100,412' });
  assert.equal(stravaCooldownEnd(h, T), Date.UTC(2026, 10, 4, 6, 15));
});

test('a spent daily count waits for midnight UTC, overall or read', () => {
  const midnight = Date.UTC(2026, 10, 5);
  assert.equal(stravaCooldownEnd(new Headers({ 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '40,1000' }), T), midnight);
  assert.equal(stravaCooldownEnd(new Headers({ 'X-ReadRateLimit-Limit': '100,1000', 'X-ReadRateLimit-Usage': '40,1001' }), T), midnight);
});

test('after a 429 nothing is asked for any athlete until the window turns, then Strava is asked again', async () => {
  const { f, count } = counting(() => limited());
  await rejects429(fetchActivitiesSince('tok-a', 0, f));
  assert.equal(count(), 1);
  await rejects429(fetchActivitiesSince('tok-b', 0, f));
  await rejects429(fetchStravaAthlete('tok-c', f));
  assert.equal(count(), 1, 'no request while the window is spent');

  mock.restoreAll();
  mock.method(console, 'warn', () => {});
  mock.method(Date, 'now', () => Date.UTC(2026, 10, 4, 6, 15));
  assert.deepEqual(await fetchActivitiesSince('tok-a', 0, f), []);
  assert.equal(count(), 2);
});

test('a 500 starts no cooldown: the next athlete is still asked', async () => {
  const { f, count } = counting(() => new Response('{}', { status: 500 }));
  await assert.rejects(fetchActivitiesSince('tok-a', 0, f), /Strava 500/);
  assert.deepEqual(await fetchActivitiesSince('tok-b', 0, f), []);
  assert.equal(count(), 2);
});

test('the limit is logged once, with no athlete and no token', async () => {
  const warn = mock.method(console, 'warn', () => {});
  const { f } = counting(() => limited());
  await rejects429(fetchActivitiesSince('tok-a', 0, f));
  await rejects429(fetchActivitiesSince('tok-b', 0, f));
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0].arguments[0], 'telemetry {"event":"vendor_limit","vendor":"Strava","wait_min":8}');
});
