// A claim whose release throws must not cost the athlete the day's read: it
// is queued and retried at the start of the next tick, before preferences are
// loaded. Also: the scheduler stays idle without APNs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPrefs } from '../src/delivery';
import type { PendingRelease, TickDeps } from '../src/scheduler';
import { blankEnv } from './helpers/test-env';

// push.ts reads APNs settings at import: blank them first.
blankEnv();
const { runTick, startScheduler } = await import('../src/scheduler');

const prefs = (over = {}) => ({ ...defaultPrefs(), ...over });
const quiet = { info() {}, warn() {}, error() {} };
// 10:15 UTC on Tuesday 2026-10-20 is 06:15 in New York: the daily read is due.
const AT = new Date(Date.UTC(2026, 9, 20, 10, 15));

test('a release that throws is queued, retried first on the next tick, then delivered', async () => {
  const pendingReleases = new Map<string, PendingRelease>();
  const failedAt = new Map<string, number>();
  const events: string[] = [];
  const errors: string[] = [];
  let releaseWorks = false;
  let sentOn: string | null = null;
  let deliverWorks = false;
  const deps: TickDeps = {
    listAthletes: async () => ['a'],
    prefs: {
      getMany: async () => {
        events.push('getMany');
        return new Map([['a', { athlete_id: 'a', onboarded_at: null, ...prefs({ last_daily_sent_on: sentOn, last_weekly_sent_on: '2026-10-19' }) }]]);
      },
      claim: async (_id, _kind, date) => { events.push('claim'); sentOn = date; return true; },
      release: async (_id, kind, date, previous) => {
        events.push(`release:${kind}:${date}:${previous}`);
        if (!releaseWorks) throw new Error('db down');
        sentOn = previous;
      },
    },
    deliver: async () => { events.push('deliver'); return deliverWorks; },
    log: { ...quiet, error: (m: string) => errors.push(m) },
    failedAt,
    pendingReleases,
  };

  await runTick(AT, deps);
  assert.equal(sentOn, '2026-10-20', 'the claim is stuck');
  assert.deepEqual([...pendingReleases.values()], [{ athleteId: 'a', kind: 'daily', localDate: '2026-10-20', previous: null }]);
  assert.match(errors[0], /release of daily for a failed: db down/);

  // Still down: the retry fails, stays queued, and is logged.
  events.length = 0;
  await runTick(new Date(AT.getTime() + 60_000), deps);
  assert.equal(events[0], 'release:daily:2026-10-20:null');
  assert.equal(pendingReleases.size, 1);
  assert.ok(errors.some((e) => /release retry for a daily failed: db down/.test(e)));

  // Back up, past the retry wait: released before preferences load, so the
  // read is claimed and delivered on the same tick.
  releaseWorks = true;
  deliverWorks = true;
  events.length = 0;
  const r = await runTick(new Date(AT.getTime() + 16 * 60_000), deps);
  assert.deepEqual(events, ['release:daily:2026-10-20:null', 'getMany', 'claim', 'deliver']);
  assert.equal(pendingReleases.size, 0);
  assert.deepEqual(r, { daily: 1, weekly: 0 });
  assert.equal(failedAt.size, 0, 'a delivered read clears its failure mark');
});

test('a deliver that throws is released and logged; the tick still returns', async () => {
  const released: string[] = [];
  const errors: string[] = [];
  const r = await runTick(AT, {
    listAthletes: async () => ['a'],
    prefs: {
      getMany: async () => new Map([['a', { athlete_id: 'a', onboarded_at: null, ...prefs({ last_weekly_sent_on: '2026-10-19' }) }]]),
      claim: async () => true,
      release: async (_id, kind) => { released.push(kind); },
    },
    deliver: async () => { throw new Error('read pipeline down'); },
    log: { ...quiet, error: (m: string) => errors.push(m) },
  });
  assert.deepEqual(r, { daily: 0, weekly: 0 });
  assert.deepEqual(released, ['daily']);
  assert.match(errors[0], /daily for a threw: read pipeline down/);
});

test('startScheduler is idle without APNs and says so', () => {
  const info: string[] = [];
  startScheduler(0, { ...quiet, info: (m: string) => info.push(m) }, {} as any);
  assert.deepEqual(info, ['scheduler: APNs not configured, push scheduler idle']);
});
