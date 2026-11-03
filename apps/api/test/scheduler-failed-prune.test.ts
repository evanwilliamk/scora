// Memory-state review: a read that fails every day (a disconnected Strava,
// say) leaves one failure mark per athlete, kind and local date. Marks older
// than the retry wait no longer hold anything back, so they must be pruned or
// the long-lived scheduler map grows for as long as the server runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPrefs } from '../src/delivery';
import type { TickDeps } from '../src/scheduler';
import { blankEnv } from './helpers/test-env';

blankEnv();
const { runTick, RETRY_AFTER_MS } = await import('../src/scheduler');

const quiet = { info() {}, warn() {}, error() {} };
// 10:15 UTC on Tuesday 2026-10-20 is 06:15 in New York: the daily read is due.
const AT = Date.UTC(2026, 9, 20, 10, 15);
const DAY = 24 * 60 * 60_000;

test('failure marks from past days are pruned, not kept forever', async () => {
  const failedAt = new Map<string, number>();
  const deps: TickDeps = {
    listAthletes: async () => ['a'],
    prefs: {
      getMany: async () => new Map([['a', { athlete_id: 'a', onboarded_at: null, ...defaultPrefs() }]]),
      claim: async () => true,
      release: async () => {},
    },
    deliver: async () => false,
    log: quiet,
    failedAt,
    pendingReleases: new Map(),
  };
  for (let d = 0; d < 30; d++) await runTick(new Date(AT + d * DAY), deps);
  // At most today's daily and weekly marks survive.
  assert.ok(failedAt.size <= 2, `failedAt holds ${failedAt.size} marks after 30 failing days`);
});

test('a fresh failure mark still holds back the retry until the wait is over', async () => {
  const delivered: number[] = [];
  const failedAt = new Map<string, number>();
  const deps: TickDeps = {
    listAthletes: async () => ['a'],
    prefs: {
      getMany: async () => new Map([['a', { athlete_id: 'a', onboarded_at: null, ...defaultPrefs(), last_weekly_sent_on: '2026-10-19' }]]),
      claim: async () => true,
      release: async () => {},
    },
    deliver: async () => { delivered.push(1); return false; },
    log: quiet,
    failedAt,
    pendingReleases: new Map(),
  };
  await runTick(new Date(AT), deps);
  await runTick(new Date(AT + 60_000), deps);
  assert.equal(delivered.length, 1, 'no retry inside the wait');
  await runTick(new Date(AT + RETRY_AFTER_MS), deps);
  assert.equal(delivered.length, 2, 'retried once the wait is over');
});
