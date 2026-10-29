import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { dueDeliveries, localClock, isValidTimezone, isValidDeliveryMinute, defaultPrefs, minutesLate } from '../src/delivery';
import { sqlPrefsStore } from '../src/preferences';
import { runTick } from '../src/scheduler';

const prefs = (over = {}) => ({ ...defaultPrefs(), ...over });
const quiet = { info() {}, warn() {}, error() {} };

test('localClock reads the athlete zone, including DST', () => {
  // 2026-10-19 13:30 UTC is a Monday: 09:30 in New York (EDT), 06:30 in Los Angeles (PDT).
  const t = new Date(Date.UTC(2026, 9, 19, 13, 30));
  assert.deepEqual(localClock(t, 'America/New_York'), { date: '2026-10-19', minute: 570, weekday: 1 });
  assert.deepEqual(localClock(t, 'America/Los_Angeles'), { date: '2026-10-19', minute: 390, weekday: 1 });
  // After the November switch New York is UTC-5.
  assert.equal(localClock(new Date(Date.UTC(2026, 10, 10, 11, 0)), 'America/New_York').minute, 360);
});

test('daily is due from the delivery minute, once per local day, within the late window', () => {
  const p = prefs({ timezone: 'America/Los_Angeles', delivery_minute: 390 }); // 06:30
  const at = (h: number, m: number) => new Date(Date.UTC(2026, 9, 20, h + 7, m)); // PDT = UTC-7
  assert.equal(dueDeliveries(p, at(6, 15)).daily, false, 'too early');
  assert.equal(dueDeliveries(p, at(6, 30)).daily, true);
  assert.equal(dueDeliveries(p, at(8, 29)).daily, true);
  assert.equal(dueDeliveries(p, at(8, 30)).daily, false, 'too late, skip rather than arrive mid-morning');
  assert.equal(dueDeliveries({ ...p, last_daily_sent_on: '2026-10-20' }, at(7, 0)).daily, false, 'already sent today');
  assert.equal(dueDeliveries({ ...p, last_daily_sent_on: '2026-10-19' }, at(7, 0)).daily, true);
});

test('weekly is due only on local Monday', () => {
  const p = prefs(); // 06:00 New York
  const monday = new Date(Date.UTC(2026, 9, 19, 10, 15)); // 06:15 EDT Monday
  const tuesday = new Date(Date.UTC(2026, 9, 20, 10, 15));
  assert.deepEqual(dueDeliveries(p, monday), { daily: true, weekly: true, localDate: '2026-10-19' });
  assert.equal(dueDeliveries(p, tuesday).weekly, false);
});

test('a bad stored zone falls back to the default instead of throwing', () => {
  assert.equal(dueDeliveries(prefs({ timezone: 'Mars/Olympus' }), new Date(Date.UTC(2026, 9, 20, 10, 5))).daily, true);
});

test('input validation', () => {
  assert.equal(isValidTimezone('Europe/London'), true);
  assert.equal(isValidTimezone('Nowhere/Land'), false);
  assert.equal(isValidTimezone(42), false);
  assert.equal(isValidDeliveryMinute(360), true);
  assert.equal(isValidDeliveryMinute(1440), false);
  assert.equal(isValidDeliveryMinute(6.5), false);
});

test('runTick delivers what is due, claims it first, and releases a failed delivery', async () => {
  const claimed: string[] = [];
  const released: string[] = [];
  const delivered: string[] = [];
  const store = new Map([
    ['ny', prefs()],
    ['la', prefs({ timezone: 'America/Los_Angeles' })],
    ['done', prefs({ last_daily_sent_on: '2026-10-19', last_weekly_sent_on: '2026-10-19' })],
    ['fails', prefs({ last_daily_sent_on: '2026-10-18' })],
  ]);
  const sent = await runTick(new Date(Date.UTC(2026, 9, 19, 10, 15)), {
    listAthletes: async () => ['ny', 'la', 'done', 'fails'],
    prefs: {
      getMany: async (ids) => new Map(ids.map((id) => [id, { athlete_id: id, onboarded_at: null, ...store.get(id)! }])),
      claim: async (id, kind, date) => { claimed.push(`${id}:${kind}:${date}`); return true; },
      release: async (id, kind, _date, previous) => { released.push(`${id}:${kind}:${previous}`); },
    },
    deliver: async (id, kind) => { delivered.push(`${id}:${kind}`); return id !== 'fails'; },
    log: quiet,
  });
  assert.deepEqual(delivered, ['ny:daily', 'ny:weekly', 'fails:daily', 'fails:weekly']);
  assert.deepEqual(claimed, ['ny:daily:2026-10-19', 'ny:weekly:2026-10-19', 'fails:daily:2026-10-19', 'fails:weekly:2026-10-19']);
  assert.deepEqual(released, ['fails:daily:2026-10-18', 'fails:weekly:null'], 'failed deliveries restore the previous date');
  assert.deepEqual(sent, { daily: 1, weekly: 1 });
});

test('a lost claim skips delivery', async () => {
  let delivered = 0;
  await runTick(new Date(Date.UTC(2026, 9, 20, 10, 15)), {
    listAthletes: async () => ['a'],
    prefs: {
      getMany: async () => new Map([['a', { athlete_id: 'a', onboarded_at: null, ...prefs() }]]),
      claim: async () => false,
      release: async () => {},
    },
    deliver: async () => { delivered++; return true; },
    log: quiet,
  });
  assert.equal(delivered, 0);
});

test('runTick survives listing, preference and delivery failures', async () => {
  const noPrefs = { getMany: async () => new Map(), claim: async () => true, release: async () => {} };
  assert.deepEqual(await runTick(new Date(), {
    listAthletes: async () => { throw new Error('db down'); }, prefs: noPrefs, deliver: async () => true, log: quiet,
  }), { daily: 0, weekly: 0 });

  assert.deepEqual(await runTick(new Date(), {
    listAthletes: async () => ['a'],
    prefs: { ...noPrefs, getMany: async () => { throw new Error('503'); } },
    deliver: async () => true,
    log: quiet,
  }), { daily: 0, weekly: 0 });

  let released = 0;
  const r = await runTick(new Date(Date.UTC(2026, 9, 20, 10, 15)), {
    listAthletes: async () => ['a'],
    prefs: {
      getMany: async () => new Map([['a', { athlete_id: 'a', onboarded_at: null, ...prefs() }]]),
      claim: async () => true,
      release: async () => { released++; },
    },
    deliver: async () => { throw new Error('boom'); },
    log: quiet,
  });
  assert.deepEqual(r, { daily: 0, weekly: 0 });
  assert.equal(released, 1, 'a throwing delivery is released for retry');
});

test('minutesLate counts from the set time in the athlete zone, across midnight', () => {
  const ny = { timezone: 'America/New_York', delivery_minute: 6 * 60 };
  // 10:07 UTC on Oct 19 is 06:07 in New York (EDT).
  assert.equal(minutesLate(ny, '2026-10-19', new Date(Date.UTC(2026, 9, 19, 10, 7))), 7);
  assert.equal(minutesLate(ny, '2026-10-19', new Date(Date.UTC(2026, 9, 19, 9, 59))), -1);
  const late = { timezone: 'America/New_York', delivery_minute: 23 * 60 + 30 };
  // 04:10 UTC on Oct 20 is 00:10 on Oct 20 in New York: 40 minutes after 23:30 on the 19th.
  assert.equal(minutesLate(late, '2026-10-19', new Date(Date.UTC(2026, 9, 20, 4, 10))), 40);
  assert.equal(minutesLate({ timezone: 'Not/AZone', delivery_minute: 360 }, '2026-10-19', new Date(Date.UTC(2026, 9, 19, 10, 0))), 0, 'bad zone falls back to New York');
});

test('runTick logs one push_delivery line per attempt with minutes late, no read text', async () => {
  const lines: string[] = [];
  const log = { info: (m: string) => lines.push(m), warn() {}, error() {} };
  await runTick(new Date(Date.UTC(2026, 9, 20, 10, 1)), {
    listAthletes: async () => ['ok', 'fails'],
    prefs: {
      getMany: async (ids) => new Map(ids.map((id) => [id, { athlete_id: id, onboarded_at: null, ...prefs() }])),
      claim: async () => true,
      release: async () => {},
    },
    deliver: async (id) => id === 'ok',
    log,
    clock: () => new Date(Date.UTC(2026, 9, 20, 10, 3)),
  });
  const events = lines.filter((l) => l.startsWith('telemetry ')).map((l) => JSON.parse(l.slice('telemetry '.length)));
  assert.deepEqual(events, [
    { event: 'push_delivery', kind: 'daily', athlete: 'ok', date: '2026-10-20', late_min: 3, delivered: true },
    { event: 'push_delivery', kind: 'daily', athlete: 'fails', date: '2026-10-20', late_min: 3, delivered: false },
  ]);
});

// ---- preferences on PGlite ----

let db: PGlite;
before(async () => {
  db = new PGlite({ extensions: { vector } });
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
});
after(async () => { await db.close(); });

test('preferences default until saved, then persist; onboarded_at is set once', async () => {
  const s = sqlPrefsStore(db);
  const fresh = await s.get('a1');
  assert.equal(fresh.timezone, 'America/New_York');
  assert.equal(fresh.delivery_minute, 360);
  assert.equal(fresh.onboarded_at, null);

  const saved = await s.update('a1', { timezone: 'Europe/London', delivery_minute: 420, onboarded: true });
  assert.equal(saved.timezone, 'Europe/London');
  assert.equal(saved.delivery_minute, 420);
  assert.ok(saved.onboarded_at);

  const again = await s.update('a1', { delivery_minute: 300, onboarded: true });
  assert.equal(again.timezone, 'Europe/London', 'unchanged fields keep their value');
  assert.equal(again.delivery_minute, 300);
  assert.equal(again.onboarded_at, saved.onboarded_at, 'first onboarding time is kept');
});

test('markSent records the local date and getMany fills defaults', async () => {
  const s = sqlPrefsStore(db);
  await s.markSent('a2', 'daily', '2026-10-19');
  await s.markSent('a2', 'weekly', '2026-10-19');
  const m = await s.getMany(['a1', 'a2', 'a3']);
  assert.equal(m.get('a2')!.last_daily_sent_on, '2026-10-19');
  assert.equal(m.get('a2')!.last_weekly_sent_on, '2026-10-19');
  assert.equal(m.get('a3')!.timezone, 'America/New_York');
  assert.equal(m.get('a1')!.delivery_minute, 300);
});

test('two ticks at once on the same store send each read once', async () => {
  const s = sqlPrefsStore(db);
  await s.update('dup', {});
  const delivered: string[] = [];
  const deps = {
    listAthletes: async () => ['dup'],
    prefs: s,
    deliver: async (id: string, kind: string) => { delivered.push(`${id}:${kind}`); await new Promise((r) => setTimeout(r, 5)); return true; },
    log: quiet,
  };
  const monday = new Date(Date.UTC(2026, 9, 19, 10, 15));
  await Promise.all([runTick(monday, deps), runTick(monday, deps)]);
  assert.deepEqual(delivered.sort(), ['dup:daily', 'dup:weekly']);
});

test('claim is single-winner and release restores the previous date', async () => {
  const s = sqlPrefsStore(db);
  assert.equal(await s.claim('c1', 'daily', '2026-10-19'), true);
  assert.equal(await s.claim('c1', 'daily', '2026-10-19'), false);
  await s.release('c1', 'daily', '2026-10-19', null);
  assert.equal((await s.get('c1')).last_daily_sent_on, null);
  assert.equal(await s.claim('c1', 'daily', '2026-10-19'), true);
});
