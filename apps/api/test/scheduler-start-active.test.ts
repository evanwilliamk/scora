// The active startScheduler path end to end: APNs reported configured, the
// cron timer replaced by a hand-fired task, a simulated clock, and the tick's
// dependencies on PGlite (every migration applied, so claim/release and
// scora_due_deliveries are the real SQL). Reads come from a fake /api/read and
// pushes go to a fake APNs; nothing leaves the process.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { blankEnv } from './helpers/test-env';
import { migratedPglite, callDue } from './helpers/pglite-db';
import type { DueRow } from '../src/push';
import type { PushIo, TickDeps } from '../src/scheduler';

// push.ts reads APNs settings at import: blank them first.
blankEnv();
const { startScheduler, schedulerDeps, RETRY_AFTER_MS, DUE_RPC_RECHECK_MS, DELIVERY_CONCURRENCY } = await import('../src/scheduler');
const { MissingRpcError, isMissingFunction } = await import('../src/push');
const { sqlPrefsStore } = await import('../src/preferences');
const { LATE_WINDOW_MIN } = await import('../src/delivery');

let pg: PGlite;
// Without migration 20261101010000: scora_due_deliveries does not exist.
let pgOld: PGlite;
before(async () => {
  pg = await migratedPglite();
  pgOld = await migratedPglite({ skip: (f) => f.startsWith('20261101010000') });
});
after(async () => { await pg.close(); await pgOld.close(); });

const MIN = 60_000;
// Tuesday 2026-11-03, 11:01 UTC is 06:01 in New York (EST): the default
// 06:00 daily read is due there.
const TUE = Date.UTC(2026, 10, 3, 11, 1);

type Athlete = { id: string; tz?: string; minute?: number; daily?: string | null; weekly?: string | null; tokens?: number };

async function seed(db: PGlite, athletes: Athlete[]) {
  await db.exec('delete from device_tokens; delete from athlete_preferences;');
  for (const a of athletes) {
    for (let i = 0; i < (a.tokens ?? 1); i++) {
      await db.query('insert into device_tokens (athlete_id, token) values ($1, $2)', [a.id, `tok-${a.id}-${i}`]);
    }
    await db.query(
      `insert into athlete_preferences (athlete_id, timezone, delivery_minute, last_daily_sent_on, last_weekly_sent_on)
       values ($1, $2, $3, $4, $5)`,
      [a.id, a.tz ?? 'America/New_York', a.minute ?? 360, a.daily ?? null, a.weekly ?? '2026-11-02']);
  }
}

async function sentOn(db: PGlite, id: string) {
  const r = await db.query<{ d: string | null; w: string | null }>(
    `select to_char(last_daily_sent_on, 'YYYY-MM-DD') as d, to_char(last_weekly_sent_on, 'YYYY-MM-DD') as w
     from athlete_preferences where athlete_id = $1`, [id]);
  return r.rows[0];
}

interface Harness {
  fire(): Promise<void> | void;
  setClock(ms: number): void;
  pushes: { athleteId: string; token: string; kind: string; date: string }[];
  reads: string[];
  calls: { listDue: number; listAthletes: number };
  logs: string[];
  expression: string;
  // Per athlete: make the next reads fail, throw, or wait.
  readBehavior: Map<string, 'fail' | 'throw' | (() => Promise<void>)>;
  sendBehavior: Map<string, 'throw' | 'reject'>;
  inFlight: { now: number; max: number };
}

function start(db: PGlite, opts: { missingRpc?: boolean; readDelayMs?: number } = {}): Harness {
  let clock = TUE;
  let task: (() => Promise<void> | void) | undefined;
  const h: Harness = {
    fire: () => task!(),
    setClock: (ms) => { clock = ms; },
    pushes: [], reads: [], calls: { listDue: 0, listAthletes: 0 }, logs: [], expression: '',
    readBehavior: new Map(), sendBehavior: new Map(), inFlight: { now: 0, max: 0 },
  };
  const log = {
    info: (m: string) => h.logs.push(`info ${m}`),
    warn: (m: string) => h.logs.push(`warn ${m}`),
    error: (m: string) => h.logs.push(`error ${m}`),
  };
  const fakeFetch = (async (_url: string, init: { body: string }) => {
    const { athleteId, today } = JSON.parse(init.body);
    h.reads.push(`${athleteId}:${today}`);
    h.inFlight.now++;
    h.inFlight.max = Math.max(h.inFlight.max, h.inFlight.now);
    try {
      if (opts.readDelayMs) await new Promise((r) => setTimeout(r, opts.readDelayMs));
      const b = h.readBehavior.get(athleteId);
      if (typeof b === 'function') await b();
      if (b === 'throw') throw new Error('connect ECONNREFUSED');
      if (b === 'fail') return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ read: { voice: 'Body is settled.', numbers: 'Sleep 7:12' } }), { status: 200 });
    } finally {
      h.inFlight.now--;
    }
  }) as unknown as typeof fetch;
  const io: PushIo = {
    now: () => new Date(clock),
    fetch: fakeFetch,
    getDeviceTokens: async (id) =>
      (await db.query<{ token: string }>('select token from device_tokens where athlete_id = $1 order by token', [id])).rows.map((r) => r.token),
    sendPush: async (token, _alert, extra) => {
      const athleteId = token.split('-')[1];
      const b = h.sendBehavior.get(athleteId);
      if (b === 'throw') throw new Error('apns socket closed');
      if (b === 'reject') return { ok: false, status: 500, reason: 'InternalServerError' };
      h.pushes.push({ athleteId, token, kind: String(extra?.kind), date: String(extra?.date) });
      return { ok: true, status: 200 };
    },
    removeDeviceToken: async () => {},
  };
  const prefs = sqlPrefsStore(db);
  const deps: TickDeps = {
    ...schedulerDeps('http://scora.test', log, prefs, io),
    listAthletes: async () => {
      h.calls.listAthletes++;
      return (await db.query<{ athlete_id: string }>('select distinct athlete_id from device_tokens order by athlete_id')).rows.map((r) => r.athlete_id);
    },
    // getDueDeliveries' contract on PGlite: a missing function is MissingRpcError.
    listDue: async (now) => {
      h.calls.listDue++;
      try {
        return (await callDue(db, { p_now: now.toISOString(), p_window_minutes: LATE_WINDOW_MIN })) as DueRow[];
      } catch (e: any) {
        if (isMissingFunction({ code: e.code, message: e.message })) throw new MissingRpcError(`scora_due_deliveries: ${e.message}`);
        throw e;
      }
    },
  };
  startScheduler(0, log, prefs, {
    apnsConfigured: () => true,
    schedule: (expression, t) => { h.expression = expression; task = t; },
    now: () => new Date(clock),
    deps,
  });
  return h;
}

const pushed = (h: Harness) => h.pushes.map((p) => `${p.token}:${p.kind}:${p.date}`).sort();

beforeEach(async () => { await pg.exec('delete from device_tokens; delete from athlete_preferences;'); });

test('active start registers an every-minute task and logs that it started', async () => {
  await seed(pg, []);
  const h = start(pg);
  assert.equal(h.expression, '* * * * *');
  assert.deepEqual(h.logs, ['info scheduler: push scheduler started (every minute, per-athlete delivery time)']);
  await h.fire();
  assert.deepEqual(h.pushes, []);
});

test('due athletes get one push per local day; a second tick in the same window sends nothing', async () => {
  await seed(pg, [
    { id: 'a' },
    { id: 'b', tokens: 2 },
    // 12:00 in London is 12:00 UTC: not due at 11:01 UTC.
    { id: 'c', tz: 'Europe/London', minute: 720 },
  ]);
  const h = start(pg);
  await h.fire();
  assert.deepEqual(pushed(h), ['tok-a-0:daily:2026-11-03', 'tok-b-0:daily:2026-11-03', 'tok-b-1:daily:2026-11-03']);
  assert.equal((await sentOn(pg, 'a')).d, '2026-11-03');
  assert.equal((await sentOn(pg, 'c')).d, null);

  // Every minute through the rest of the window: nothing more for a or b.
  for (let m = 1; m <= LATE_WINDOW_MIN + 5; m++) {
    h.setClock(TUE + m * MIN);
    if (m === 59) { h.pushes.length = 0; await h.fire(); assert.deepEqual(pushed(h), ['tok-c-0:daily:2026-11-03']); continue; }
    h.pushes.length = 0;
    await h.fire();
    assert.deepEqual(h.pushes, [], `tick at +${m} min sent ${pushed(h).join(', ')}`);
  }
  assert.equal(h.reads.filter((r) => r.startsWith('a:')).length, 1, 'one read generated for a');

  // The next local day: one more each.
  h.setClock(TUE + 24 * 60 * MIN);
  h.pushes.length = 0;
  await h.fire();
  assert.deepEqual(pushed(h), ['tok-a-0:daily:2026-11-04', 'tok-b-0:daily:2026-11-04', 'tok-b-1:daily:2026-11-04']);
  h.setClock(TUE + 24 * 60 * MIN + MIN);
  h.pushes.length = 0;
  await h.fire();
  assert.deepEqual(h.pushes, []);
});

test('Monday brings the weekly review once, alongside the daily read', async () => {
  await seed(pg, [{ id: 'a', daily: '2026-11-08', weekly: '2026-11-02' }]);
  const h = start(pg);
  const MON = Date.UTC(2026, 10, 9, 11, 1);
  h.setClock(MON);
  await h.fire();
  assert.deepEqual(pushed(h), ['tok-a-0:daily:2026-11-09', 'tok-a-0:weekly:2026-11-09']);
  h.setClock(MON + MIN);
  h.pushes.length = 0;
  await h.fire();
  assert.deepEqual(h.pushes, []);
  assert.deepEqual(await sentOn(pg, 'a'), { d: '2026-11-09', w: '2026-11-09' });
});

test('a failed read is released and retried after 15 minutes, not before', async () => {
  await seed(pg, [{ id: 'a', daily: '2026-11-02' }, { id: 'b' }]);
  const h = start(pg);
  h.readBehavior.set('a', 'fail');
  await h.fire();
  assert.deepEqual(pushed(h), ['tok-b-0:daily:2026-11-03']);
  assert.equal((await sentOn(pg, 'a')).d, '2026-11-02', 'claim released to the previous date');
  assert.ok(h.logs.some((l) => /warn scheduler: \/api\/read for a returned 500/.test(l)));

  h.readBehavior.delete('a');
  const readsOfA = () => h.reads.filter((r) => r.startsWith('a:')).length;
  for (let m = 1; m < RETRY_AFTER_MS / MIN; m++) {
    h.setClock(TUE + m * MIN);
    await h.fire();
    assert.equal(readsOfA(), 1, `no retry at +${m} min`);
  }
  assert.equal((await sentOn(pg, 'a')).d, '2026-11-02');

  h.pushes.length = 0;
  h.setClock(TUE + RETRY_AFTER_MS);
  await h.fire();
  assert.equal(readsOfA(), 2);
  assert.deepEqual(pushed(h), ['tok-a-0:daily:2026-11-03']);
  assert.equal((await sentOn(pg, 'a')).d, '2026-11-03');

  h.pushes.length = 0;
  h.setClock(TUE + RETRY_AFTER_MS + MIN);
  await h.fire();
  assert.deepEqual(h.pushes, []);
});

test('reads run at most 4 at a time and every due athlete is served', async () => {
  const ids = Array.from({ length: 11 }, (_, i) => `x${String(i).padStart(2, '0')}`);
  await seed(pg, ids.map((id) => ({ id })));
  const h = start(pg, { readDelayMs: 5 });
  await h.fire();
  assert.equal(DELIVERY_CONCURRENCY, 4);
  assert.equal(h.inFlight.max, 4);
  assert.equal(h.pushes.length, 11);
  assert.deepEqual(new Set(h.pushes.map((p) => p.athleteId)), new Set(ids));
});

test('a tick that overruns the minute does not start an overlapping tick', async () => {
  await seed(pg, [{ id: 'a' }]);
  const h = start(pg);
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  let entered!: () => void;
  const reading = new Promise<void>((r) => { entered = r; });
  h.readBehavior.set('a', async () => { entered(); await gate; });

  const first = h.fire();
  await reading;
  assert.equal(h.calls.listDue, 1);
  // Three minutes pass while the first tick waits on its read.
  for (let m = 1; m <= 3; m++) {
    h.setClock(TUE + m * MIN);
    assert.equal(h.fire(), undefined, 'skipped while running');
  }
  assert.equal(h.calls.listDue, 1, 'no second tick started');
  assert.equal(h.reads.length, 1);

  open();
  await first;
  assert.deepEqual(pushed(h), ['tok-a-0:daily:2026-11-03']);
  // Once it finished, the next minute ticks again (and finds nothing due).
  h.setClock(TUE + 4 * MIN);
  await h.fire();
  assert.equal(h.calls.listDue, 2);
  assert.equal(h.pushes.length, 1);
});

test('without scora_due_deliveries the tick reads every athlete and rechecks after 15 minutes', async () => {
  await seed(pgOld, [{ id: 'a' }, { id: 'c', tz: 'Europe/London', minute: 720 }]);
  const h = start(pgOld);
  await h.fire();
  assert.equal(h.calls.listDue, 1);
  assert.equal(h.calls.listAthletes, 1);
  assert.deepEqual(pushed(h), ['tok-a-0:daily:2026-11-03']);
  assert.equal((await sentOn(pgOld, 'a')).d, '2026-11-03');
  const notFound = () => h.logs.filter((l) => /scora_due_deliveries not found/.test(l)).length;
  assert.equal(notFound(), 1);
  assert.ok(!h.logs.some((l) => l.startsWith('error')), h.logs.join('\n'));

  // Inside the recheck wait: the function is not asked for again.
  h.pushes.length = 0;
  for (let m = 1; m < DUE_RPC_RECHECK_MS / MIN; m++) {
    h.setClock(TUE + m * MIN);
    await h.fire();
  }
  assert.equal(h.calls.listDue, 1);
  assert.equal(h.calls.listAthletes, DUE_RPC_RECHECK_MS / MIN);
  assert.deepEqual(h.pushes, [], 'no second push for a');

  // At the recheck it is tried again, still missing, and reported only once.
  h.setClock(TUE + DUE_RPC_RECHECK_MS);
  await h.fire();
  assert.equal(h.calls.listDue, 2);
  assert.equal(notFound(), 1);

  // c is due at 12:00 London on the fallback path too.
  h.setClock(Date.UTC(2026, 10, 3, 12, 0));
  await h.fire();
  assert.deepEqual(pushed(h), ['tok-c-0:daily:2026-11-03']);
});

test('a send that throws releases the claim and the read is retried', async () => {
  await seed(pg, [{ id: 'a', daily: '2026-11-02' }, { id: 'b', daily: '2026-11-02' }]);
  const h = start(pg);
  h.readBehavior.set('a', 'throw');
  h.sendBehavior.set('b', 'throw');
  await h.fire();
  assert.deepEqual(h.pushes, []);
  assert.equal((await sentOn(pg, 'a')).d, '2026-11-02', 'a released after the read threw');
  assert.equal((await sentOn(pg, 'b')).d, '2026-11-02', 'b released after the push threw');
  assert.ok(h.logs.some((l) => /error scheduler: daily for a threw: connect ECONNREFUSED/.test(l)));
  assert.ok(h.logs.some((l) => /error scheduler: daily for b threw: apns socket closed/.test(l)));

  h.readBehavior.delete('a');
  h.sendBehavior.delete('b');
  h.setClock(TUE + RETRY_AFTER_MS);
  await h.fire();
  assert.deepEqual(pushed(h), ['tok-a-0:daily:2026-11-03', 'tok-b-0:daily:2026-11-03']);
  assert.equal((await sentOn(pg, 'b')).d, '2026-11-03');
});

test('a push APNs rejects keeps the day claimed (the read was generated)', async () => {
  await seed(pg, [{ id: 'a', daily: '2026-11-02' }]);
  const h = start(pg);
  h.sendBehavior.set('a', 'reject');
  await h.fire();
  assert.equal((await sentOn(pg, 'a')).d, '2026-11-03');
  assert.ok(h.logs.some((l) => /warn scheduler: push to a failed \(500 InternalServerError\)/.test(l)));
  h.setClock(TUE + RETRY_AFTER_MS);
  await h.fire();
  assert.equal(h.reads.length, 1, 'no second LLM read');
});
