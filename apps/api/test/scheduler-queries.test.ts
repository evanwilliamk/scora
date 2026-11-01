// What one scheduler tick costs in database queries as athletes grow, and
// that every athlete is still served past a Supabase project's max-rows cap
// (1000 by default). The production tick wiring against stateful fake
// tables; the read itself is canned and the push stubbed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';
import { installSchedulerDb, countByTable, type SchedulerDb } from './helpers/fake-scheduler-db';

blankEnv();

let rest: FakeRest;
let guard: FetchGuard;
let sched: typeof import('../src/scheduler');
let push: typeof import('../src/push');
let prefsStore: import('../src/preferences').PrefsStore;

before(async () => {
  rest = await fakeRest();
  guard = installFetchGuard(rest.url);
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  sched = await import('../src/scheduler');
  push = await import('../src/push');
  const { supabasePrefsStore } = await import('../src/preferences');
  const { createClient } = await import('@supabase/supabase-js');
  prefsStore = supabasePrefsStore(createClient(rest.url, 'test-service-role'));
});
after(async () => {
  guard.restore();
  await rest.close();
});

const quiet = { info() {}, warn() {}, error() {} };

function setup(n: number, tz = 'Europe/London', minute = 360) {
  rest.reset();
  const db = installSchedulerDb(rest);
  for (let i = 0; i < n; i++) {
    const id = String(100000 + i);
    db.devices.push({ athlete_id: id, token: `dev-${id}` });
    db.prefs.set(id, { athlete_id: id, timezone: tz, delivery_minute: minute, onboarded_at: null, last_daily_sent_on: '2026-11-02', last_weekly_sent_on: '2026-11-02' });
  }
  const reads: string[] = [];
  const sent: string[] = [];
  const deps = sched.schedulerDeps('http://localhost:3000', quiet, prefsStore, {
    fetch: (async (_url: any, init: any) => {
      reads.push(JSON.parse(init.body).athleteId);
      return new Response(JSON.stringify({ read: { voice: 'Body is settled.', numbers: 'Sleep 7:12' } }), { status: 200 });
    }) as typeof fetch,
    getDeviceTokens: push.getDeviceTokens,
    sendPush: async (token) => { sent.push(token); return { ok: true, status: 200 }; },
    removeDeviceToken: push.removeDeviceToken,
  });
  return { db, deps, reads, sent };
}

async function tick(deps: import('../src/scheduler').TickDeps, iso: string) {
  rest.requests.length = 0;
  const r = await sched.runTick(new Date(iso), deps);
  return { r, queries: rest.requests.length, byTable: countByTable(rest.requests) };
}

test('past 1000 device rows and 1000 preference rows, every athlete gets their read at their own time', async () => {
  // Supabase answers at most 1000 rows a request: the 1001st athlete on had no
  // read (not listed) or the New York 06:00 default (preferences not loaded).
  const { deps, reads } = setup(2500);
  const due = await tick(deps, '2026-11-03T06:00:00Z');
  assert.equal(due.r.daily, 2500);
  assert.equal(new Set(reads).size, 2500);
  // 06:00 in New York: nobody is sent a second read on a default time.
  const ny = await tick(deps, '2026-11-03T11:00:00Z');
  assert.deepEqual(ny.r, { daily: 0, weekly: 0 });
});

test('queries per tick as athletes grow', async (t) => {
  const report: string[] = [];
  for (const n of [10, 100, 2500]) {
    const { db, deps } = setup(n);
    // 05:00 London on Tuesday 2026-11-03: nobody due.
    const idle = await tick(deps, '2026-11-03T05:00:00Z');
    // 06:00 London: everyone due, one day after their last read.
    const due = await tick(deps, '2026-11-03T06:00:00Z');
    assert.equal(due.r.daily, n);
    // Idle: one device page and one preferences request per 1000 / 500.
    assert.equal(idle.queries, Math.ceil(n / 1000) + Math.ceil(n / 500));
    // Per delivery: the claim (one update) and the device tokens.
    assert.equal(due.queries - idle.queries, 2 * n);
    report.push(`${n} athletes: idle ${idle.queries} ${JSON.stringify(idle.byTable)}; all due ${due.queries} (${((due.queries - idle.queries) / n).toFixed(2)} per delivery)`);
    // Then due again a minute later: nothing left to send.
    const after = await tick(deps, '2026-11-03T06:01:00Z');
    assert.equal(after.r.daily, 0);
    assert.equal([...db.prefs.values()].every((p) => p.last_daily_sent_on === '2026-11-03'), true);
  }
  t.diagnostic(report.join('\n'));
});
