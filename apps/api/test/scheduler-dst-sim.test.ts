// Morning delivery across DST changes, end to end on a simulated clock. The
// production tick wiring (schedulerDeps) runs over 8 simulated days against
// stateful fake Supabase tables, the real /api/read and
// /api/weekly routes (canned Strava, OpenAI down so the validated fallback),
// the real APNs sender and a local HTTP/2 APNs stand-in. Nothing leaves the
// machine. Checks: one daily push per athlete per local date at the chosen
// local time (a time the spring-forward gap skips goes out at the first
// minute after the gap), the free tier's weekly review on Monday (Sunday's
// read, 24 hours delayed, CLAUDE.md §5.1), nothing twice in a repeated hour,
// and a failed read released and retried once 15 minutes later.
//
// Each scenario runs twice: once with scora_due_deliveries missing (the tick
// reads every athlete and decides in TypeScript) and once with it answered by
// the migrated function on PGlite. Both must send the same pushes at the same
// instants and leave the same claims, and on every SQL tick the function's
// rows must equal dueDeliveries over every athlete.
//
// Ticks: every minute from 2 minutes before each athlete's set time to 20
// after (the send and the 15-minute retry), around +60 (the repeated
// fall-back hour) and +120 (the end of the late window), every 5 minutes in
// between, and every 30 minutes otherwise. Outside those minutes nothing is
// due under either rule, so a send there is still caught at the 30-minute
// ticks; the claim state is the same at minute 23 as at 25.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';
import { installSchedulerDb, type SchedulerDb } from './helpers/fake-scheduler-db';
import { migratedPglite, sqlDue } from './helpers/pglite-db';
import type { PGlite } from '@electric-sql/pglite';
import { dueDeliveries } from '../src/delivery';

blankEnv();

type Push = { token: string; kind: string; date: string; at: number };
let simNow = 0;
const pushes: Push[] = [];
const apns = http2.createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    pushes.push({ token: String(req.headers[':path']).split('/').pop()!, kind: body.scora.kind, date: body.scora.date, at: simNow });
    res.statusCode = 200;
    res.end();
  });
});

let rest: FakeRest;
let guard: FetchGuard;
let app: any;
let sched: typeof import('../src/scheduler');
let prefsStore: import('../src/preferences').PrefsStore;
let push: typeof import('../src/push');
let pg: PGlite;

before(async () => {
  await new Promise<void>((r) => apns.listen(0, '127.0.0.1', () => r()));
  const apnsUrl = `http://127.0.0.1:${(apns.address() as AddressInfo).port}`;
  rest = await fakeRest();
  guard = installFetchGuard(rest.url, { allowHttp2: apnsUrl });
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.APNS_TEST_HOST = apnsUrl;
  process.env.APNS_KEY_ID = 'ABC123DEFG';
  process.env.APNS_TEAM_ID = 'TEAM456789';
  process.env.APNS_BUNDLE_ID = 'app.scora.test';
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  process.env.APNS_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  app = (await import('../src/index')).default;
  await app.ready();
  sched = await import('../src/scheduler');
  push = await import('../src/push');
  const { supabasePrefsStore } = await import('../src/preferences');
  const { createClient } = await import('@supabase/supabase-js');
  prefsStore = supabasePrefsStore(createClient(rest.url, 'test-service-role'));
  pg = await migratedPglite();
});
after(async () => {
  await pg.close();
  await app.close();
  guard.restore();
  await rest.close();
  apns.close();
});

const DAY = 86_400_000;
const run = (daysAgo: number, mins: number) => {
  const at = new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10) + 'T07:00:00Z';
  return { type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, distance: mins * 170, moving_time: mins * 60, elapsed_time: mins * 60, average_heartrate: 140 };
};

// fetch into the app itself, as the scheduler's localhost call would be.
const injectFetch = (async (url: any, init: any) => {
  const u = new URL(String(url));
  const r = await app.inject({ method: init?.method ?? 'GET', url: u.pathname, payload: init?.body, headers: init?.headers });
  return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const local = (at: number, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday };
};

interface Athlete { id: string; tz: string; minute: number }

type Path = 'typescript' | 'sql';

interface Sim {
  path: Path;
  db: SchedulerDb;
  pushes: Push[];
  // Scheduler queries per tick (device_tokens, athlete_preferences, the rpc),
  // and whether anything was sent in it.
  queries: { n: number; sent: boolean }[];
  ticks: number;
  // SQL path: rpc calls compared with dueDeliveries, and the mismatches.
  rpcCompared: number;
  rpcMismatches: string[];
  log: { info: string[]; warn: string[]; error: string[] };
}

const minuteFmt = new Map<string, Intl.DateTimeFormat>();
const localMinute = (at: number, tz: string) => {
  let f = minuteFmt.get(tz);
  if (!f) minuteFmt.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
};

// The simulated minutes that get a tick (see the header).
function tickTimes(athletes: Athlete[], start: number, days: number): number[] {
  const out: number[] = [];
  for (let t = start; t < start + days * DAY; t += 60_000) {
    const near = (t - start) % (30 * 60_000) === 0 || athletes.some((a) => {
      const d = (localMinute(t, a.tz) - a.minute + 1440) % 1440;
      return d >= 1438 || d <= 20 || (d >= 58 && d <= 62) || (d >= 118 && d <= 122) || (d < 125 && d % 5 === 0);
    });
    if (near) out.push(t);
  }
  return out;
}

async function simulate(path: Path, athletes: Athlete[], startIso: string, days: number, setup?: (db: SchedulerDb) => void,
  onTick?: (at: number, db: SchedulerDb) => void): Promise<Sim> {
  rest.reset();
  guard.reset();
  guard.stravaActivities([run(1, 50), run(3, 50), run(4, 40), run(6, 100), run(9, 45), run(12, 90)]);
  pushes.length = 0;
  const db = installSchedulerDb(rest);
  for (const a of athletes) {
    db.devices.push({ athlete_id: a.id, token: `dev-${a.id}` });
    db.prefs.set(a.id, { athlete_id: a.id, timezone: a.tz, delivery_minute: a.minute, onboarded_at: '2026-01-01T00:00:00Z', last_daily_sent_on: null, last_weekly_sent_on: null });
  }
  setup?.(db);
  let rpcCompared = 0;
  const rpcMismatches: string[] = [];
  if (path === 'sql') {
    rest.handle('rpc/scora_due_deliveries', sqlDue(pg, db, (args, rows) => {
      // The same answer dueDeliveries gives over every athlete with a device.
      const now = new Date(args.p_now);
      const want = [...new Set(db.devices.map((d) => d.athlete_id as string))].sort().flatMap((id) => {
        const d = dueDeliveries(db.prefs.get(id) as any, now);
        return d.daily || d.weekly ? [`${id} ${d.localDate} ${d.daily} ${d.weekly}`] : [];
      });
      const got = rows.map((r) => `${r.athlete_id} ${r.local_date} ${r.daily} ${r.weekly}`);
      rpcCompared++;
      if (JSON.stringify(got) !== JSON.stringify(want)) rpcMismatches.push(`${args.p_now}: sql ${JSON.stringify(got)} ts ${JSON.stringify(want)}`);
    }));
  }
  const log = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  const logger = { info: (m: string) => log.info.push(m), warn: (m: string) => log.warn.push(m), error: (m: string) => log.error.push(m) };
  const deps = sched.schedulerDeps('http://localhost:3000', logger, prefsStore, {
    now: () => new Date(simNow),
    fetch: injectFetch,
    getDeviceTokens: push.getDeviceTokens,
    sendPush: push.sendPush,
    removeDeviceToken: push.removeDeviceToken,
  });
  const queries: Sim['queries'] = [];
  const times = tickTimes(athletes, Date.parse(startIso), days);
  for (const t of times) {
    simNow = t;
    onTick?.(t, db);
    const before = rest.requests.length;
    const r = await sched.runTick(new Date(t), deps);
    // Only the scheduler's own queries: the read pipeline's are app traffic.
    const own = rest.requests.slice(before).filter((q) => ['device_tokens', 'athlete_preferences', 'rpc/scora_due_deliveries'].includes(q.table));
    queries.push({ n: own.length, sent: r.daily + r.weekly > 0 });
    rest.requests.length = 0;
  }
  return { path, db, pushes: [...pushes], queries, ticks: times.length, rpcCompared, rpcMismatches, log };
}

// Run a scenario on both paths: each passes the scenario's checks, and the
// two send the same pushes at the same instants and end with the same claims.
async function bothPaths(t: import('node:test').TestContext, run: (path: Path) => Promise<Sim>) {
  const t0 = Date.now();
  const ts = await run('typescript');
  const t1 = Date.now();
  const sql = await run('sql');
  const ms = `typescript ${t1 - t0} ms, sql ${Date.now() - t1} ms`;
  // Within one tick athletes go a few at a time (and the rpc lists them by
  // id), so only the order inside a tick may differ.
  const byTime = (s: Sim) => s.pushes.map((p) => `${p.at} ${p.token} ${p.kind} ${p.date}`).sort();
  assert.deepEqual(byTime(sql), byTime(ts), 'same pushes at the same instants on both paths');
  // updated_at is the real clock's, not the simulated one.
  const claims = (s: Sim) => [...s.db.prefs.values()].map(({ updated_at: _u, ...p }) => p)
    .sort((a, b) => a.athlete_id.localeCompare(b.athlete_id));
  assert.deepEqual(claims(sql), claims(ts), 'same claims on both paths');
  const tele = (s: Sim) => s.log.info.filter((l) => l.startsWith('telemetry ') && l.includes('push_delivery')).sort();
  assert.deepEqual(tele(sql), tele(ts), 'same delivery telemetry on both paths');
  assert.deepEqual(sql.rpcMismatches, []);
  assert.ok(sql.rpcCompared >= sql.ticks, 'the SQL path asked the rpc every tick');
  // The fallback path never asked PGlite; the SQL path never read every athlete.
  assert.equal(ts.rpcCompared, 0);
  const idle = (s: Sim) => [...new Set(s.queries.filter((q) => !q.sent).map((q) => q.n))].sort();
  assert.deepEqual(idle(sql), [1], 'SQL path: one request per idle tick');
  t.diagnostic(`${ts.ticks} ticks per path; idle tick requests: typescript ${idle(ts).join('/')} (2, plus the rpc ask every 15 min), sql ${idle(sql).join('/')}; ${ts.pushes.length} pushes; ${ms}`);
  return { ts, sql };
}

const HHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// The shared checks: one daily per local date, contiguous, at the set time
// (or `gapTime` on `gapDate`); weekly only on Mondays, same instant as that
// Monday's daily; never anything twice.
function checkAthlete(sim: Sim, a: Athlete, expectDates: string[], exceptions: Record<string, string> = {}) {
  const mine = sim.pushes.filter((p) => p.token === `dev-${a.id}`);
  const daily = mine.filter((p) => p.kind === 'daily');
  assert.deepEqual(daily.map((p) => p.date), expectDates, `${a.id}: one daily per local date`);
  for (const p of daily) {
    const l = local(p.at, a.tz);
    assert.equal(l.date, p.date, `${a.id}: pushed on its own local date`);
    assert.equal(l.time, exceptions[p.date] ?? HHMM(a.minute), `${a.id} ${p.date}: local time`);
  }
  const weekly = mine.filter((p) => p.kind === 'weekly');
  const mondays = daily.filter((p) => local(p.at, a.tz).weekday === 'Mon');
  assert.deepEqual(weekly.map((p) => [p.date, p.at]), mondays.map((p) => [p.date, p.at]), `${a.id}: weekly on Monday with the daily`);
  const keys = mine.map((p) => `${p.kind}:${p.date}`);
  assert.equal(new Set(keys).size, keys.length, `${a.id}: nothing sent twice`);
}

const dates = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10));

test('fall back: New York 2026-11-01 and London 2026-10-25, with Kolkata and Auckland alongside', async (t) => {
  const athletes: Athlete[] = [
    { id: 'ny-0600', tz: 'America/New_York', minute: 360 },
    { id: 'ny-0130', tz: 'America/New_York', minute: 90 },
    { id: 'ny-0130-fails', tz: 'America/New_York', minute: 90 },
    { id: 'lon-0600', tz: 'Europe/London', minute: 360 },
    { id: 'lon-0130', tz: 'Europe/London', minute: 90 },
    { id: 'kol-0600', tz: 'Asia/Kolkata', minute: 360 },
    { id: 'akl-0600', tz: 'Pacific/Auckland', minute: 360 },
  ];
  // The failing athlete's read fails once, at the first 01:30 on fall-back
  // day (05:30Z, EDT): Strava answers with no token for that one try.
  const failAt = Date.parse('2026-11-01T05:30:00Z');
  await bothPaths(t, async (path) => {
  const releasedSeen: (string | null)[] = [];
  const sim = await simulate(path, athletes, '2026-10-25T00:00:00Z', 8, undefined, (at, db) => {
    if (at === failAt) db.disconnected.add('ny-0130-fails');
    else if (db.disconnected.delete('ny-0130-fails')) releasedSeen.push(db.prefs.get('ny-0130-fails')!.last_daily_sent_on);
  });

  const eightFrom1025 = dates('2026-10-25', 8);
  for (const a of athletes.filter((x) => x.id !== 'akl-0600')) {
    checkAthlete(sim, a, eightFrom1025, a.id === 'ny-0130-fails' ? { '2026-11-01': '01:45' } : {});
  }
  checkAthlete(sim, athletes.find((x) => x.id === 'akl-0600')!, dates('2026-10-26', 8));

  const at = (id: string, date: string, kind = 'daily') =>
    new Date(sim.pushes.find((p) => p.token === `dev-${id}` && p.date === date && p.kind === kind)!.at).toISOString();
  // The repeated hour: the first 01:30 (daylight time), never the second.
  assert.equal(at('ny-0130', '2026-11-01'), '2026-11-01T05:30:00.000Z');
  assert.equal(at('lon-0130', '2026-10-25'), '2026-10-25T00:30:00.000Z');
  // 06:00 follows the wall clock across the change.
  assert.equal(at('ny-0600', '2026-10-31'), '2026-10-31T10:00:00.000Z');
  assert.equal(at('ny-0600', '2026-11-01'), '2026-11-01T11:00:00.000Z');
  assert.equal(at('lon-0600', '2026-10-25'), '2026-10-25T06:00:00.000Z');
  assert.equal(at('kol-0600', '2026-10-26'), '2026-10-26T00:30:00.000Z');
  assert.equal(at('akl-0600', '2026-11-02', 'weekly'), '2026-11-01T17:00:00.000Z');

  // The failed try was released (the claim undone before the next tick) and
  // retried once, 15 minutes later, still in the first 01:xx hour.
  assert.deepEqual(releasedSeen, ['2026-10-31']);
  const failing = sim.pushes.filter((p) => p.token === 'dev-ny-0130-fails' && p.date === '2026-11-01');
  assert.deepEqual(failing.map((p) => new Date(p.at).toISOString()), ['2026-11-01T05:45:00.000Z']);
  assert.equal(sim.db.prefs.get('ny-0130-fails')!.last_daily_sent_on, '2026-11-01');

  // Telemetry: one failed attempt then one delivered, each with its lateness.
  const tele = sim.log.info.filter((l) => l.startsWith('telemetry ')).map((l) => JSON.parse(l.slice(10)))
    .filter((e) => e.event === 'push_delivery' && e.athlete === 'ny-0130-fails' && e.date === '2026-11-01');
  assert.deepEqual(tele.map((e) => [e.delivered, e.late_min]), [[false, 0], [true, 15]]);
  assert.deepEqual(sim.log.error, []);
  return sim;
  });
});

test('spring forward: New York 2027-03-14, a 02:30 delivery that does not exist that day goes out at 03:00', async (t) => {
  const athletes: Athlete[] = [
    { id: 'ny-0230', tz: 'America/New_York', minute: 150 },
    { id: 'ny-0600', tz: 'America/New_York', minute: 360 },
    { id: 'kol-0530', tz: 'Asia/Kolkata', minute: 330 },
  ];
  await bothPaths(t, async (path) => {
  const sim = await simulate(path, athletes, '2027-03-10T00:00:00Z', 8);
  checkAthlete(sim, athletes[0], dates('2027-03-10', 8), { '2027-03-14': '03:00' });
  checkAthlete(sim, athletes[1], dates('2027-03-10', 8));
  checkAthlete(sim, athletes[2], dates('2027-03-10', 8));
  const ny = sim.pushes.filter((p) => p.token === 'dev-ny-0230' && p.kind === 'daily');
  assert.deepEqual(ny.slice(3, 6).map((p) => new Date(p.at).toISOString()), [
    '2027-03-13T07:30:00.000Z', // 02:30 EST
    '2027-03-14T07:00:00.000Z', // 03:00 EDT, the first minute after the gap
    '2027-03-15T06:30:00.000Z', // 02:30 EDT
  ]);
  // On time by the clock: 03:00 is the first minute the athlete's 02:30 is reached.
  const late = sim.log.info.filter((l) => l.startsWith('telemetry ')).map((l) => JSON.parse(l.slice(10)))
    .filter((e) => e.event === 'push_delivery' && e.athlete === 'ny-0230' && e.date === '2027-03-14');
  assert.deepEqual(late.map((e) => [e.kind, e.late_min]), [['daily', 0]]);
  assert.deepEqual(sim.log.error, []);
  return sim;
  });
});

test('spring forward: Auckland 2026-09-27, 02:30 goes out at 03:00 NZDT', async (t) => {
  const athletes: Athlete[] = [
    { id: 'akl-0230', tz: 'Pacific/Auckland', minute: 150 },
    { id: 'akl-0600', tz: 'Pacific/Auckland', minute: 360 },
  ];
  await bothPaths(t, async (path) => {
  const sim = await simulate(path, athletes, '2026-09-23T00:00:00Z', 8);
  checkAthlete(sim, athletes[0], dates('2026-09-24', 8), { '2026-09-27': '03:00' });
  checkAthlete(sim, athletes[1], dates('2026-09-24', 8));
  const at = sim.pushes.find((p) => p.token === 'dev-akl-0230' && p.date === '2026-09-27')!.at;
  assert.equal(new Date(at).toISOString(), '2026-09-26T14:00:00.000Z');
  assert.deepEqual(sim.log.error, []);
  return sim;
  });
});
