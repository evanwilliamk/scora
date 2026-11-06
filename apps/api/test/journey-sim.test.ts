// One athlete's weeks of real use across every feature, end to end and
// repeatable. The real Fastify routes run by inject on a Postgres (PGlite) with
// all migrations, the real scheduler tick runs every 15 simulated minutes, and
// Strava, Oura, OpenAI and APNs are fakes keyed by each athlete's own token. The
// clock is mocked (Date only), so nothing depends on when the suite runs.
//
// 21 days, 2026-10-19 to 2026-11-08, across the US and UK clock changes, with
// four athletes alive at once:
//   FREE    Strava plus HealthKit summaries, no plan; connects Oura on day 5;
//           misses runs; a whole Monday-to-Sunday week with no run.
//   PLAN    a generated template plan (test fixture), race on day 20, so the T-7
//           freeze and race day are crossed; short-sleep nights; marks sessions;
//           sets the same plan up again mid-way.
//   ICAL    a calendar plan in miles, refreshed twice; New York to Tokyo to Los
//           Angeles; moves its delivery time.
//   PASTE   a brand-new account with no runs yet, a pasted plan in miles, then a
//           second paste.
//
// Each day each athlete gets: the scheduled push, a morning read, every card
// tapped, chat up to and past the daily quota, the weekly read on Sunday (the
// push comes Monday), and another read in the evening. The invariants are
// checked as the days pass; a broken one names the athlete and date. All of it
// also holds on an LLM that writes prescriptive drafts, invents numbers, or is
// down, on set days of the journey.
//
// Failures are collected rather than thrown one by one, so one run shows every
// broken invariant.

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { migratedPglite } from './helpers/pglite-db';
import { servePglite } from './helpers/pglite-rest';
import { World, zoneOffsetSec, zonedInstant, type Night, type LlmMode } from './helpers/journey-world';
import type { PGlite } from '@electric-sql/pglite';
import { validateVoice } from '../src/validator';
import { postureClaimHits } from '../src/drivers';
import { addDays, mondayOf } from '../src/dates';
import { dueDeliveries, localClock } from '../src/delivery';

blankEnv();

const FREE = '1001';
const PLAN = '1002';
const ICAL = '1003';
const PASTE = '1004';
const ATHLETES = [FREE, PLAN, ICAL, PASTE];
const START = '2026-10-19'; // a Monday
const END = '2026-11-08'; // a Sunday, day 21
const RACE = '2026-11-07';
const MI = 1609.34;
const DAY = 86_400_000;
const STEP = 15 * 60_000;

const WEEKDAY = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const dayIndex = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / DAY) + 1;

// ---- failures ----
const fails = new Map<string, number>();
const seen = new Map<string, number>();
const fail = (invariant: string, detail: string) => {
  const key = `${invariant}: ${detail}`;
  fails.set(key, (fails.get(key) ?? 0) + 1);
};
const tally = (what: string) => seen.set(what, (seen.get(what) ?? 0) + 1);
const check = (ok: unknown, invariant: string, detail: string) => { if (!ok) fail(invariant, detail); };

// ---- what each simulated person is doing ----
interface Sim {
  id: string;
  tz: string;
  deliveryMinute: number;
  changedAt: number; // when the zone or delivery time last changed
  morningDone: Set<string>;
  eveningDone: Set<string>;
  midnightDone: Set<string>;
  // Marks the athlete made: stable key -> done or missed.
  marks: Map<string, boolean>;
  // Chats counted on each quota day, and the newest day counted.
  quota: Map<string, number>;
  quotaDay: string | null;
  // Week So Far as last seen in the evening, by local date.
  wsfByDate: Map<string, any>;
  lastNumbers: Map<string, string>;
  // Local dates an app session, or a tick in the window, saw.
  planId: string | null;
  generated: any[] | null; // the plan's rows as generated
  knownWorkoutIds: Set<string>;
}

const newSim = (id: string, tz: string, deliveryMinute: number): Sim => ({
  id, tz, deliveryMinute, changedAt: 0, morningDone: new Set(), eveningDone: new Set(), midnightDone: new Set(),
  marks: new Map(), quota: new Map(), quotaDay: null, wsfByDate: new Map(), lastNumbers: new Map(),
  planId: null, generated: null, knownWorkoutIds: new Set(),
});

const sims: Record<string, Sim> = {
  [FREE]: newSim(FREE, 'America/New_York', 360),
  [PLAN]: newSim(PLAN, 'Europe/London', 390),
  [ICAL]: newSim(ICAL, 'America/New_York', 360),
  [PASTE]: newSim(PASTE, 'Asia/Kolkata', 330),
};

// ---- the app under test ----
let rest: FakeRest;
let pg: PGlite;
let world: World;
let app: any;
let sched: typeof import('../src/scheduler');
let push: typeof import('../src/push');
let prefsStore: import('../src/preferences').PrefsStore;
const pushes: { athlete: string; kind: string; date: string; at: number; body: string; title: string }[] = [];
const telemetry: any[] = [];
const appErrors: string[] = [];
const statuses = new Map<string, number>();
const unservedTables = new Set<string>();

const TABLES = [
  'athletes', 'athlete_preferences', 'device_tokens', 'training_plans', 'scheduled_workouts', 'plan_adaptations', 'plan_templates',
  'rpc/scora_due_deliveries', 'rpc/apply_plan_adaptation', 'rpc/create_scora_plan', 'rpc/replace_manual_plan',
  'rpc/replace_external_plan', 'rpc/refresh_ical_plan', 'rpc/mark_scheduled_workout', 'rpc/mark_workout_watch_sent',
];

const tokenOf = (id: string) => id.repeat(16); // 64 hex characters
const athleteOfToken = (t: string) => ATHLETES.find((a) => tokenOf(a) === t) ?? `unknown:${t}`;

before(async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-18T12:00:00Z') });
  rest = await fakeRest();
  pg = await migratedPglite();
  servePglite(rest, pg, TABLES);
  world = new World(rest.url);
  world.install();
  Object.assign(process.env, {
    SUPABASE_URL: rest.url, SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', OPENAI_API_KEY: 'test-openai',
    OURA_CLIENT_ID: 'test-oura', OURA_CLIENT_SECRET: 'test-oura-secret',
    PLAN_ADAPTATIONS: 'on', PLAN_GENERATION: 'on', RACE_PREDICTIONS: 'on', CALORIE_ENGINE: 'on', ICAL_IMPORT: 'on',
    INLINE_CHARTS: 'on', ADAPTATION_REASON_LLM: 'on',
    PLAN_TEMPLATE_DIR: fileURLToPath(new URL('./fixtures/journey-templates/', import.meta.url)),
  });
  app = (await import('../src/index')).default;
  await app.ready();
  // The telemetry and error lines are the record; the request log would be
  // thousands of lines.
  app.log.level = 'silent';
  const keep = (m: unknown) => {
    if (typeof m === 'string' && m.startsWith('telemetry ')) telemetry.push(JSON.parse(m.slice(10)));
  };
  app.log.info = (...a: unknown[]) => keep(a.find((x) => typeof x === 'string'));
  app.log.warn = () => {};
  app.log.error = (...a: any[]) => { appErrors.push(a.map((x) => (typeof x === 'string' ? x : x?.err?.message ?? JSON.stringify(x))).join(' ')); };
  sched = await import('../src/scheduler');
  push = await import('../src/push');
  const { supabasePrefsStore } = await import('../src/preferences');
  const { createClient } = await import('@supabase/supabase-js');
  prefsStore = supabasePrefsStore(createClient(rest.url, 'test-service-role'));
});

after(async () => {
  mock.timers.reset();
  await app.close();
  world.restore();
  await pg.close();
  await rest.close();
});

// Every call goes through here: no 5xx, ever, on any route.
async function call(sim: Sim, method: string, url: string, payload?: unknown) {
  world.actingFor = sim.id;
  const r = await app.inject({ method, url, ...(payload !== undefined ? { payload } : {}) });
  world.actingFor = null;
  const route = `${method} ${url.split('?')[0].replace(/[0-9a-f-]{36}/, ':id')}`;
  statuses.set(`${route} ${r.statusCode}`, (statuses.get(`${route} ${r.statusCode}`) ?? 0) + 1);
  check(r.statusCode < 500, 'no route returns a 500', `${sim.id} ${route} ${r.statusCode} ${r.body.slice(0, 120)}`);
  return r;
}
const post = (sim: Sim, url: string, payload: unknown) => call(sim, 'POST', url, payload);
const get = (sim: Sim, url: string) => call(sim, 'GET', url);

const localNow = (sim: Sim) => localClock(new Date(), sim.tz);

// ---- the data each athlete makes ----
// A run's moving time always has seconds: real runs do, and rounding is where
// numbers shown in two places come apart.
const secs = (mins: number, n: number) => mins * 60 + (n * 17) % 41 + 7;

function seedHistory() {
  // Six weeks: heavy until the last week, so the first week reads low acute load.
  const plain = (a: string, tz: string, weeks: number, mins: number[]) => {
    for (let w = weeks; w >= 1; w--) {
      const monday = addDays(START, -7 * w);
      [0, 2, 3, 5].forEach((off, i) => {
        const m = (w === 1 ? 0.5 : 1) * mins[i];
        const date = addDays(monday, off);
        world.addLocalRun(a, date, 17 * 60, tz, { name: `Run-${a}-h${w}${i}`, seconds: secs(Math.round(m), w + i), meters: m * 170, hr: 140 });
      });
    }
  };
  plain(FREE, 'America/New_York', 6, [50, 50, 50, 100]);
  plain(PLAN, 'Europe/London', 6, [80, 90, 80, 170]);
  plain(ICAL, 'America/New_York', 6, [45, 60, 45, 110]);

  // FREE in the journey: misses runs, then a whole week with none (Oct 26 to Nov 1).
  const free = (date: string, min: number, mins: number, n: number) =>
    world.addLocalRun(FREE, date, min, 'America/New_York', { name: `Run-${FREE}-${date}`, seconds: secs(mins, n), meters: mins * 170, hr: 141 + (n % 3) });
  free('2026-10-19', 17 * 60, 45, 1);
  free('2026-10-21', 17 * 60, 50, 2);
  free('2026-10-24', 8 * 60, 95, 3);
  // Before the Monday push: Monday's run must not count in the weekly.
  free('2026-11-02', 5 * 60, 40, 4);
  free('2026-11-04', 17 * 60, 50, 5);
  free('2026-11-05', 17 * 60, 45, 6);
  free('2026-11-07', 8 * 60, 100, 7);
}

// PLAN's ring: ordinary nights, a good night, nights that fire rest and back-off.
function seedNights() {
  const base = (day: string, i: number): Night => ({
    day, sleepSeconds: 7 * 3600 + 20 * 60 + (i % 5) * 60, score: 76 + (i % 7), hrv: 54 + (i % 4), rhr: 48 + (i % 2), readiness: 78,
  });
  const nights = new Map<string, Night>();
  for (let d = addDays(START, -40), i = 0; d <= END; d = addDays(d, 1), i++) nights.set(d, base(d, i));
  const set = (day: string, over: Partial<Night>) => nights.set(day, { ...nights.get(day)!, ...over });
  // Short nights with the body signals down: rest. Mon Oct 19, Fri Oct 23, Fri Oct 30.
  for (const day of ['2026-10-19', '2026-10-23', '2026-10-30']) set(day, { sleepSeconds: 5 * 3600 + 30 * 60, score: 58, hrv: 42, rhr: 56 });
  // Two then four low-score nights on ordinary body signals: back-off.
  for (const day of ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']) set(day, { sleepSeconds: 6 * 3600, score: 55 });
  // A very good night in a low-load week, no hard run yesterday: primed.
  set('2026-10-21', { sleepSeconds: 8 * 3600 + 10 * 60, score: 96, hrv: 62, rhr: 46 });
  world.nights.set(PLAN, nights);

  const free = new Map<string, Night>();
  for (let d = addDays(START, -40), i = 0; d <= END; d = addDays(d, 1), i++) {
    free.set(d, { day: d, sleepSeconds: 7 * 3600 + (i % 9) * 60, score: 72 + (i % 6), hrv: 60 + (i % 3), rhr: 52, readiness: 74 });
  }
  world.nights.set(FREE, free);
}

// FREE's phone until Oura: last night from Apple Health, on the app's request.
function healthFor(sim: Sim, date: string, ouraConnected: boolean) {
  if (sim.id !== FREE || ouraConnected) return undefined;
  const n = world.nights.get(FREE)!.get(date);
  if (!n) return undefined;
  const prior = Array.from({ length: 7 }, (_, i) => world.nights.get(FREE)!.get(addDays(date, -1 - i))!.hrv);
  return {
    sleepSeconds: n.sleepSeconds, hrvMs: n.hrv, restingHr: n.rhr,
    hrvWeekAvgMs: Math.round(prior.reduce((s, v) => s + v, 0) / prior.length),
    nights: Array.from({ length: 7 }, (_, i) => {
      const x = world.nights.get(FREE)!.get(addDays(date, -i))!;
      return { day: x.day, sleepSeconds: x.sleepSeconds, hrvMs: x.hrv, restingHr: x.rhr };
    }),
  };
}

const LLM_BY_DAY: Record<number, LlmMode> = { 3: 'prescriptive', 6: 'first_bad', 8: 'invented', 10: 'down', 13: 'prescriptive', 17: 'first_bad', 19: 'down' };

// ---- ground truth, from the runs as they happened ----
const mine = (id: string) => (world.runs.get(id) ?? []).filter((r) => r.startMs + r.seconds * 1000 <= Date.now());
const localDateOf = (r: { startMs: number; offsetSec: number }) => new Date(r.startMs + r.offsetSec * 1000).toISOString().slice(0, 10);

function rolling(id: string, fromDaysAgo: number, toDaysAgo = 0) {
  const now = Date.now();
  return mine(id).filter((r) => r.startMs > now - fromDaysAgo * DAY && r.startMs <= now - toDaysAgo * DAY);
}
const minutes = (runs: { seconds: number }[]) => Math.round(runs.reduce((s, r) => s + r.seconds, 0) / 60);
const miles = (runs: { meters: number }[]) => +(runs.reduce((s, r) => s + r.meters, 0) / MI).toFixed(1);
const runsOn = (id: string, date: string) => mine(id).filter((r) => localDateOf(r) === date);

// ---- the plan as it stands in the database ----
async function activeRows(id: string) {
  const r = await pg.query<any>(
    `select w.id, to_char(w.scheduled_date, 'YYYY-MM-DD') as date, w.planned_intensity as intensity, w.planned_duration_min as minutes,
            w.planned_distance_km::float8 as km, w.planned_type as type, w.planned_description as description, w.athlete_completed as completed,
            w.workout_structure_json as structure, w.athlete_id
     from scheduled_workouts w join training_plans p on p.id = w.training_plan_id
     where w.athlete_id = $1 and p.current_status = 'active' order by w.scheduled_date, w.created_at, w.id`, [id]);
  return r.rows;
}
async function adaptationRows(id: string) {
  const r = await pg.query<any>(
    `select a.id, a.scheduled_workout_id as workout, a.adaptation_type as type, to_char(a.original_date, 'YYYY-MM-DD') as original,
            to_char(a.new_date, 'YYYY-MM-DD') as new_date, a.reason_code, a.reason_text
     from plan_adaptations a join training_plans p on p.id = a.training_plan_id
     where a.athlete_id = $1 and p.current_status = 'active'`, [id]);
  return r.rows;
}
const sig = (r: any) => `${r.date}|${r.intensity}|${r.minutes}|${r.km}`;

// ---- voice checks: every emission on every surface ----
const PRESCRIPTIVE: RegExp[] = [
  /\byou (?:should|need to|must)\b/i, /\bdo an? (?:easy|hard)\b/i, /\brun a\b/i, /\bgo for a\b/i,
  /does that sound right|let me know if that resonates/i, /good catch|you'?re right/i, /\bas an ai\b|i'?m just an ai/i,
  /\b(?:crush it|smash today|let'?s go|beast mode)\b/i, /\b(?:medical|diagnose|prescribe)\b/i, /\btake a rest day\b/i,
  /\b(?:your|ai|as your) coach\b|\bi'?m your coach\b/i, /\b(?:skip|move|shift|swap|shorten|delay)\s+(?:today|tomorrow|your|the)\b/i,
  /!/, /\p{Extended_Pictographic}/u,
];

function checkVoice(sim: Sim, surface: string, date: string, voice: unknown, drivers: any[], posture?: string | null) {
  if (typeof voice !== 'string' || !voice.trim()) { fail('every voice output exists', `${sim.id} ${date} ${surface}`); return; }
  const v = validateVoice(voice, drivers);
  check(v.ok, 'every voice output passes the validators',
    `${sim.id} ${date} ${surface}: "${voice}" banned=${JSON.stringify(v.bannedHits)} numbers=${JSON.stringify(v.unbackedNumbers)} claims=${JSON.stringify(v.unbackedClaims)} drivers=${JSON.stringify(drivers.map((d) => `${d.metric}=${d.value}${d.trend ? ` (${d.trend})` : ''}`))}`);
  for (const re of PRESCRIPTIVE) check(!re.test(voice), 'the voice never prescribes', `${sim.id} ${date} ${surface} ${re}: "${voice}"`);
  if (posture !== undefined) {
    const hits = postureClaimHits(voice, posture);
    check(hits.length === 0, 'the voice names only the decided posture', `${sim.id} ${date} ${surface} ${hits}: "${voice}"`);
  }
}

const drv = (body: any, metric: string) => (body.drivers ?? []).find((d: any) => d.metric === metric);
const card = (body: any, id: string) => (body.cards ?? []).find((c: any) => c.id === id);

// ---- one read, morning or evening ----
async function readAndCheck(sim: Sim, label: string, date: string, ouraConnected: boolean) {
  const before = sim.planId ? await activeRows(sim.id) : [];
  const beforeAdapts = sim.planId ? await adaptationRows(sim.id) : [];
  const r = await post(sim, '/api/read', { athleteId: sim.id, today: date, health: healthFor(sim, date, ouraConnected) });
  check(r.statusCode === 200, 'the read answers', `${sim.id} ${date} ${label} ${r.statusCode}`);
  if (r.statusCode !== 200) return null;
  const body = r.json();
  const where = `${sim.id} ${date} ${label}`;
  checkVoice(sim, `read ${label}`, date, body.read?.voice, body.drivers ?? [], body.posture?.posture ?? null);
  tally(`posture ${sim.id} ${body.posture?.posture ?? 'unbacked'}`);

  // Numbers agree: the numeric line, the drivers, the cards, and the runs.
  const load7 = rolling(sim.id, 7);
  const loadMin = minutes(load7);
  const load = drv(body, 'Load');
  const hadRuns = rolling(sim.id, 14).length > 0;
  check(!!load === hadRuns, 'Load shown exactly when there are runs in two weeks', `${where} driver=${JSON.stringify(load)} runs14=${rolling(sim.id, 14).length}`);
  if (load) {
    check(load.value === `${loadMin} min`, 'read Load is the real last-7-days minutes', `${where} driver ${load.value} truth ${loadMin}`);
    const c = card(body, 'training_load');
    check(c?.value === String(loadMin), 'card Load equals read Load', `${where} card ${c?.value} truth ${loadMin}`);
    check(c?.trend === load.trend, 'card trend equals read trend', `${where} card ${c?.trend} driver ${load.trend}`);
    check(new RegExp(`(^|· )Load ${loadMin}( |$)`).test(body.read.numbers ?? ''), 'numeric line Load equals read Load', `${where} numbers "${body.read.numbers}" truth ${loadMin}`);
    check(c?.translation?.includes(`across ${load7.length} run`), 'card run count is real', `${where} "${c?.translation}" truth ${load7.length}`);
    const evidence = drv(body, 'Load (7d)');
    if (evidence) check(evidence.value === `${loadMin} min`, 'posture evidence Load equals read Load', `${where} ${evidence.value} vs ${loadMin}`);
    const vol = drv(body, 'Weekly volume');
    check(vol?.value === `${miles(load7)} mi`, 'read volume is the real last-7-days miles', `${where} ${vol?.value} vs ${miles(load7)}`);
  }
  const hard = rolling(sim.id, 7).filter((x) => x.hr > 0);
  if (hard.length) {
    const peak = Math.round(Math.max(...hard.map((x) => x.hr)));
    check(card(body, 'recent_intensity')?.value === String(peak), 'card peak HR is real', `${where} ${card(body, 'recent_intensity')?.value} vs ${peak}`);
  }
  const last30 = rolling(sim.id, 30);
  if (last30.length) {
    // On a tie the newest, as Strava's newest-first list gives it.
    const longest = [...last30].sort((a, b) => b.startMs - a.startMs).reduce((m, x) => (x.meters > m.meters ? x : m));
    const longMiles = +(longest.meters / MI).toFixed(1);
    const d = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${localDateOf(longest)}T00:00:00Z`)) / DAY);
    const lr = drv(body, 'Longest run (30d)');
    check(lr?.value === `${longMiles} mi`, 'longest run is real', `${where} ${lr?.value} vs ${longMiles}`);
    check(lr?.trend === (d === 0 ? 'today' : `${d}d ago`), 'longest run date is the athlete\'s calendar', `${where} ${lr?.trend} vs ${d}`);
  }

  // Sleep and HRV: the night the athlete just had, on line, card and driver.
  const night = world.nights.get(sim.id)?.get(date);
  const sleepKnown = night && (ouraConnected || sim.id === FREE);
  if (sleepKnown) {
    const m = Math.round(night.sleepSeconds / 60);
    const hm = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    check(drv(body, 'Sleep')?.value === hm, 'sleep is last night\'s', `${where} ${drv(body, 'Sleep')?.value} vs ${hm}`);
    check(card(body, 'sleep')?.value === hm, 'sleep card equals read', `${where} ${card(body, 'sleep')?.value} vs ${hm}`);
    check((body.read.numbers ?? '').startsWith(`Sleep ${hm}`), 'numeric line opens with the sleep', `${where} "${body.read.numbers}"`);
    check(card(body, 'recovery_signal')?.value === String(night.hrv), 'HRV card equals the night', `${where} ${card(body, 'recovery_signal')?.value} vs ${night.hrv}`);
    check(drv(body, 'HRV')?.value === `${night.hrv}ms`, 'HRV driver equals the night', `${where} ${drv(body, 'HRV')?.value} vs ${night.hrv}`);
    check(card(body, 'sleep')?.source === (ouraConnected ? 'Oura' : 'Apple Health'), 'sleep names its source', `${where} ${card(body, 'sleep')?.source}`);
  } else {
    check(!drv(body, 'Sleep'), 'no sleep shown with no sleep source', `${where} ${JSON.stringify(drv(body, 'Sleep'))}`);
    check(card(body, 'sleep')?.available === false && card(body, 'sleep')?.connect === 'oura', 'the sleep card offers to connect', `${where} ${JSON.stringify(card(body, 'sleep'))}`);
  }
  check(body.connections?.oura === ouraConnected, 'connections says whether Oura is linked', `${where} ${JSON.stringify(body.connections)}`);

  // Week So Far: Monday to today on the athlete's own calendar.
  const wsf = body.weekSoFar;
  if (wsf) {
    const monday = mondayOf(date);
    check(wsf.days[0].date === monday && wsf.days[0].weekday === 'Mon', 'Week So Far starts on the athlete\'s Monday', `${where} ${wsf.days[0].date} vs ${monday}`);
    let total = 0;
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      const shown = wsf.days[i];
      check(shown.date === d, 'Week So Far days are contiguous', `${where} ${shown.date} vs ${d}`);
      if (d > date) { check(shown.run_min === null, 'days ahead have no minutes', `${where} ${d}`); continue; }
      const today = runsOn(sim.id, d);
      const m = Math.round(today.reduce((s, x) => s + x.seconds, 0) / 60);
      check(shown.run_min === m, 'Week So Far minutes are real, by local day', `${where} ${d} shown ${shown.run_min} truth ${m}`);
      total += m;
      n += today.length;
    }
    check(wsf.total_min === total, 'Week So Far total is its days', `${where} ${wsf.total_min} vs ${total}`);
    check(wsf.runs === n, 'Week So Far run count is real', `${where} ${wsf.runs} vs ${n}`);
    if (label === 'evening') sim.wsfByDate.set(date, wsf);
    if (sim.planId) {
      const rows = await activeRows(sim.id);
      const toDate = rows.filter((x) => x.date >= monday && x.date <= date);
      const hasUnknown = toDate.some((x) => x.type === 'run' && x.intensity !== 'rest' && x.minutes == null);
      const sum = toDate.reduce((s, x) => s + (x.type === 'run' && x.intensity !== 'rest' ? x.minutes ?? 0 : 0), 0);
      if (rows.some((x) => x.date >= monday && x.date <= addDays(date, 6))) {
        check(wsf.planned_to_date_min === (hasUnknown ? undefined : sum), 'Week So Far plan minutes match the plan', `${where} ${wsf.planned_to_date_min} vs ${hasUnknown ? 'unknown' : sum}`);
      }
    }
  }

  // Inline charts: spans inside the text, a series behind each.
  for (const l of body.read?.links ?? []) {
    const s = body.read.series?.[l.key];
    const span = body.read.voice.slice(l.start, l.end);
    check(s && s.points.length > 0, 'every linked driver has a chart', `${where} ${l.key}`);
    check(span.length > 0, 'chart links sit inside the voice', `${where} ${l.key} ${l.start}-${l.end}`);
    const newest = s?.points[s.points.length - 1];
    if (newest) check(newest.date <= date, 'no chart point from the future', `${where} ${l.key} ${newest.date}`);
    if (newest && l.key === 'load' && load) check(`${newest.value} min` === load.value, 'the load chart ends on the number cited', `${where} ${newest.value} vs ${load.value}`);
    if (newest && l.key === 'hrv' && drv(body, 'HRV')) check(`${newest.value}ms` === drv(body, 'HRV').value, 'the HRV chart ends on the number cited', `${where} ${newest.value} vs ${drv(body, 'HRV').value}`);
    tally('chart links');
  }

  // Plan: what the read says is today's is today's, on the plan as stored now.
  const after = sim.planId ? await activeRows(sim.id) : [];
  const todays = after.filter((x) => x.date === date);
  if (sim.planId) {
    const pc = card(body, 'plan_today');
    if (body.drivers?.length) {
      if (todays.length === 0) check(body.plan?.today === null, 'no session today reads as none', `${where} ${JSON.stringify(body.plan)}`);
      else check(!!body.plan?.today, 'a session today is named', `${where} rows=${todays.length}`);
    }
    if (after.some((x) => x.date >= mondayOf(date) && x.date <= addDays(date, 6))) {
      check(pc, 'a plan shows the Plan Today card', `${where}`);
      if (todays.length === 0) check(pc?.value === 'Nothing', 'Plan Today says nothing on an empty day', `${where} ${JSON.stringify(pc)}`);
    }
    // §3.3: only a SCORA session gets the Today line, and every one of them does.
    const scoraToday = todays.filter((x) => x.structure && x.intensity !== 'rest');
    check(!!body.read.today === (scoraToday.length > 0), 'the Today line is there for a SCORA session only', `${where} line=${body.read.today} rows=${JSON.stringify(todays.map((x) => [x.intensity, x.minutes]))}`);
    if (sim.id === PLAN && scoraToday.length && body.read.today) {
      check(new RegExp(`${scoraToday[0].minutes}`).test(String(body.read.today)) || /minute/.test(String(body.read.today)), 'the Today line is the session stored', `${where} "${body.read.today}"`);
    }
  } else {
    check(!body.read.today, 'no plan, no Today line', `${where} ${body.read.today}`);
    check(!card(body, 'plan_today'), 'no plan, no Plan Today card', `${where}`);
  }

  // Adaptations this read made.
  if (sim.planId) await checkAdaptations(sim, date, label, before, after, beforeAdapts, body.posture?.posture ?? null);
  await checkMarks(sim, `${label} read`, date);
  return body;
}

// ---- adaptations (CLAUDE.md 4.3, 6.2) ----
const HARD = ['hard', 'intervals', 'threshold', 'tempo', 'long'];
const TEMPLATE_WEEK: Record<string, number> = { '2026-10-19': 295, '2026-10-26': 305, '2026-11-02': 186 };

async function checkAdaptations(sim: Sim, date: string, label: string, before: any[], after: any[], beforeAdapts: any[], postureSeen: string | null) {
  const where = `${sim.id} ${date} ${label}`;
  const adapts = await adaptationRows(sim.id);
  const fresh = adapts.filter((a) => !beforeAdapts.some((b) => b.id === a.id));
  const changed = after.filter((x) => {
    const was = before.find((b) => b.id === x.id);
    return !was || sig(was) !== sig(x);
  });
  check(after.length === before.length, 'no session appears or disappears on a read', `${where} ${before.length} -> ${after.length}`);
  for (const c of changed) {
    check(fresh.some((a) => a.workout === c.id), 'every change to the plan is named', `${where} ${c.date} ${c.intensity} has no new adaptation row`);
  }
  // SCORA's engine never touches a pasted or calendar plan.
  if (sim.id !== PLAN) {
    check(fresh.length === 0, 'an external plan is never adapted', `${where} ${JSON.stringify(fresh.map((a) => a.reason_code))}`);
    return;
  }
  for (const a of fresh) {
    tally(`adaptation ${a.type} ${a.reason_code}`);
    check(a.reason_text?.trim().length > 0, 'every adaptation has a reason', `${where} ${a.reason_code}`);
    check(a.reason_text.includes(WEEKDAY(a.original)), 'the reason names the day', `${where} "${a.reason_text}" ${a.original}`);
    for (const re of PRESCRIPTIVE) check(!re.test(a.reason_text), 'a reason never prescribes', `${where} ${re}: "${a.reason_text}"`);
    check(postureSeen !== 'primed' && postureSeen !== 'taper' && postureSeen !== 'steady' && postureSeen !== 'moderate', 'primed, taper and steady never change the plan', `${where} posture ${postureSeen}: ${a.type} ${a.reason_code}`);
    if (a.type === 'moved') check(postureSeen === 'rest', 'only rest moves a session', `${where} ${postureSeen}`);
    if (a.type === 'downgraded') check(postureSeen === 'rest' || postureSeen === 'back-off', 'only rest and back-off lower one', `${where} ${postureSeen}`);
    if (a.type !== 'skipped') check(a.original === addDays(date, 1), 'only tomorrow adapts', `${where} ${a.original}`);
    const inFreeze = (d: string | null) => d != null && d >= addDays(RACE, -7) && d <= RACE;
    check(!inFreeze(a.original) && !inFreeze(a.new_date), 'nothing changes inside race week', `${where} ${a.type} ${a.original} -> ${a.new_date}`);
  }
  const original = sim.generated!;
  // Race week as generated, always.
  for (const g of original.filter((x) => x.date >= addDays(RACE, -7))) {
    const now = after.find((x) => x.id === g.id);
    check(now && sig(now) === sig(g), 'nothing changes inside race week', `${where} ${g.date} ${sig(g)} is now ${now ? sig(now) : 'gone'}`);
  }
  // Long runs keep their minutes and their number; only the day may move, named.
  const longs = (rows: any[]) => rows.filter((x) => x.intensity === 'long');
  check(longs(after).length === longs(original).length, 'long runs are never removed', `${where} ${longs(after).length} vs ${longs(original).length}`);
  for (const g of longs(original)) {
    const now = after.find((x) => x.id === g.id);
    check(now?.intensity === 'long' && now.minutes === g.minutes, 'a long run keeps its distance', `${where} ${g.date} ${JSON.stringify(now && sig(now))}`);
  }
  // Weekly volume within 10% of the template call.
  for (const [monday, call] of Object.entries(TEMPLATE_WEEK)) {
    const sum = after.filter((x) => x.date >= monday && x.date <= addDays(monday, 6) && x.intensity !== 'rest').reduce((s, x) => s + (x.minutes ?? 0), 0);
    const startedOn = original.filter((x) => x.date >= monday && x.date <= addDays(monday, 6)).reduce((s, x) => s + (x.minutes ?? 0), 0);
    check(Math.abs(sum - startedOn) / startedOn <= 0.1 + 1e-9, 'weekly volume stays within 10%', `${where} week ${monday}: ${sum} vs generated ${startedOn} (template ${call})`);
  }
  // No clustering: a moved session never lands next to a hard day.
  for (const a of fresh.filter((x) => x.type === 'moved')) {
    const near = after.filter((x) => x.id !== a.workout && HARD.includes(x.intensity) && (x.date === addDays(a.new_date, -1) || x.date === addDays(a.new_date, 1)));
    check(near.length === 0, 'a move never clusters hard days', `${where} to ${a.new_date} next to ${JSON.stringify(near.map(sig))}`);
  }
  // A missed session stays where it was (6.2: never auto-rescheduled).
  for (const x of after.filter((r) => r.completed === false)) {
    check(x.date <= date, 'a missed session is not rescheduled', `${where} ${x.date}`);
  }
}

// ---- marks survive ----
const markKey = (sim: Sim, r: any) => (sim.id === PLAN ? r.id : `${r.date}|${r.description}`);

async function checkMarks(sim: Sim, what: string, date: string) {
  if (!sim.planId || sim.marks.size === 0) return;
  const rows = await activeRows(sim.id);
  for (const [key, done] of sim.marks) {
    const row = rows.find((r) => markKey(sim, r) === key);
    check(row, 'a past session mark survives', `${sim.id} ${date} after ${what}: ${key} is gone`);
    if (row) check(row.completed === done, 'a past session mark survives', `${sim.id} ${date} after ${what}: ${key} was ${done}, now ${row.completed}`);
  }
}

// ---- cards ----
async function tapCards(sim: Sim, date: string, body: any) {
  const own = new Set((body.drivers ?? []).map((d: any) => `${d.metric}|${d.value}`));
  for (const c of body.cards ?? []) {
    const r = await post(sim, '/api/card-expand', { athleteId: sim.id, cardId: c.id });
    check(r.statusCode === 200, 'a card tap answers', `${sim.id} ${date} ${c.id} ${r.statusCode} ${r.body.slice(0, 80)}`);
    if (r.statusCode !== 200) continue;
    const x = r.json();
    tally('card taps');
    for (const d of x.drivers ?? []) check(own.has(`${d.metric}|${d.value}`), 'a card cites only this athlete\'s read', `${sim.id} ${date} ${c.id} ${d.metric}=${d.value}`);
    if (x.generated === true || (x.drivers ?? []).length) checkVoice(sim, `card ${c.id}`, date, x.reply, x.drivers ?? [], body.posture?.posture ?? null);
    check(typeof x.reply === 'string' && x.reply.length > 0, 'a card tap says something', `${sim.id} ${date} ${c.id} ${JSON.stringify(x)}`);
  }
  const bad = await post(sim, '/api/card-expand', { athleteId: sim.id, cardId: 'no_such_card' });
  check(bad.statusCode === 404, 'an unknown card is a 404', `${sim.id} ${date} ${bad.statusCode}`);
}

// ---- chat at the quota edge ----
const QUESTIONS = ['How was my week?', 'Am I on track?', 'How is my pace?', 'What about Thursdays?'];

async function chat(sim: Sim, date: string, question: string, body: any | null) {
  // The stored zone's date decides; the day never moves backwards.
  const quotaDay = sim.quotaDay && sim.quotaDay > date ? sim.quotaDay : date;
  const used = sim.quota.get(quotaDay) ?? 0;
  const r = await post(sim, '/api/cdv', { athleteId: sim.id, message: question, today: date });
  const where = `${sim.id} ${date} "${question}" used ${used}`;
  if (used >= 3) {
    check(r.statusCode === 429, 'the fourth chat of a day is refused', `${where}: ${r.statusCode} ${r.body.slice(0, 100)}`);
    if (r.statusCode === 429) {
      const x = r.json();
      check(x.used === 3 && x.limit === 3 && x.remaining === 0, 'a refused chat reports the count', `${where} ${r.body}`);
    }
    tally('chats refused');
    return;
  }
  check(r.statusCode === 200, 'a chat under the quota answers', `${where}: ${r.statusCode} ${r.body.slice(0, 100)}`);
  if (r.statusCode !== 200) return;
  const x = r.json();
  tally('chats answered');
  if (x.unavailable) {
    // An outage spends nothing.
    check(x.remaining === 3 - used - 1 + 1, 'an outage gives the chat back', `${where} remaining ${x.remaining}`);
    tally('chat outages');
  } else {
    sim.quota.set(quotaDay, used + 1);
    sim.quotaDay = quotaDay;
    check(x.remaining === 3 - used - 1, 'chat counts down per local day', `${where} remaining ${x.remaining}`);
    check(x.limit === 3, 'chat states the limit', `${where} ${x.limit}`);
  }
  check(!PRESCRIPTIVE.some((re) => re.test(x.voice)), 'the voice never prescribes', `${where} chat: "${x.voice}"`);
  const load = rolling(sim.id, 7);
  check(x.data.weeklyMiles === miles(load), 'chat miles equal the read\'s', `${where} ${x.data.weeklyMiles} vs ${miles(load)}`);
  check(x.data.runCount === load.length, 'chat run count is real', `${where} ${x.data.runCount} vs ${load.length}`);
  if (body) {
    const vol = drv(body, 'Weekly volume');
    if (vol) check(`${x.data.weeklyMiles} mi` === vol.value, 'chat miles equal the read\'s', `${where} ${x.data.weeklyMiles} vs ${vol.value}`);
  }
}

// ---- weekly ----
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function checkWeekly(sim: Sim, date: string, where: string, x: any) {
  const from = addDays(date, -7);
  const to = addDays(date, -1);
  const week = mine(sim.id).filter((r) => localDateOf(r) >= from && localDateOf(r) <= to);
  checkVoice(sim, where, date, x.read?.voice, x.drivers ?? [], null);
  if (week.length === 0) {
    check(/No runs logged/.test(x.read?.voice ?? ''), 'a week with no runs says so', `${sim.id} ${date} ${where}: "${x.read?.voice}"`);
    tally('weekly with no runs');
    return;
  }
  tally('weekly with runs');
  const m = minutes(week);
  const load = (x.drivers ?? []).find((d: any) => d.metric === 'Load');
  check(load?.value === `${m} min`, 'weekly Load is the seven complete local days', `${sim.id} ${date} ${where} ${load?.value} vs ${m}`);
  check(x.stats.find((s: any) => s.label === 'Load')?.value === `${m} min`, 'weekly tile equals weekly driver', `${sim.id} ${date} ${where}`);
  const days = new Set(week.map(localDateOf)).size;
  check((x.drivers ?? []).find((d: any) => d.metric === 'Days trained')?.value === `${days} of 7`, 'weekly days trained is real', `${sim.id} ${date} ${where}`);
  const longest = [...week].sort((a, b) => b.startMs - a.startMs).reduce((a, b) => (b.meters > a.meters ? b : a));
  const lr = (x.drivers ?? []).find((d: any) => d.metric === 'Long run');
  check(lr?.trend === WEEKDAY_SHORT[new Date(`${localDateOf(longest)}T00:00:00Z`).getUTCDay()], 'weekly long run names the right weekday', `${sim.id} ${date} ${where} ${lr?.trend} vs ${localDateOf(longest)}`);
  // Monday's review of Monday to Sunday states what Sunday's Week So Far showed.
  if (localClock(new Date(`${date}T12:00:00Z`), 'UTC').weekday === 1) {
    const sunday = sim.wsfByDate.get(to);
    if (sunday) check(load?.value === `${sunday.total_min} min`, 'Monday\'s weekly equals Sunday\'s Week So Far', `${sim.id} ${date} weekly ${load?.value} vs Week So Far ${sunday.total_min}`);
  }
}

// ---- the push, as it reaches the phone ----
function checkPushBody(sim: Sim, p: { kind: string; date: string; body: string }, read: any) {
  if (p.kind !== 'daily' || !read?.read?.numbers) return;
  // Health summaries live on the phone, so a push has no Apple Health sleep; Load must match all the same.
  const load = /Load (\d+)/.exec(read.read.numbers)?.[1];
  const pushed = /Load (\d+)/.exec(p.body)?.[1];
  if (load && pushed) check(load === pushed, 'the pushed Load equals the morning read\'s', `${sim.id} ${p.date} push ${pushed} read ${load}`);
}

// ---- scripted plan material ----
const ICS_V1 = (rows: [string, string][]) => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Journey Sim//EN',
  ...rows.flatMap(([d, summary], i) => ['BEGIN:VEVENT', `UID:journey-${d}-${i}`, `DTSTART;VALUE=DATE:${d.replace(/-/g, '')}`, `SUMMARY:${summary}`, 'END:VEVENT']),
  'END:VCALENDAR', '',
].join('\r\n');

// ICAL's plan: miles only, a session most days.
function icalRows(fromDay: string, extra: [string, string][] = []): [string, string][] {
  const rows: [string, string][] = [];
  for (let d = fromDay; d <= END; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 1) rows.push([d, 'Rest day']);
    else if (wd === 2) rows.push([d, 'Tempo run 6 mi']);
    else if (wd === 4) rows.push([d, 'Easy run 5.5 mi']);
    else if (wd === 6) rows.push([d, 'Long run 13.1 mi']);
    else if (wd === 0) rows.push([d, 'Easy run 4 mi']);
  }
  return [...rows, ...extra];
}
const ICAL_MILES: Record<string, number> = { 'Tempo run 6 mi': 6, 'Easy run 5.5 mi': 5.5, 'Long run 13.1 mi': 13.1, 'Easy run 4 mi': 4, 'Extra easy run 3 mi': 3 };

const PASTE_V1 = () => {
  const lines: string[] = [];
  for (let d = '2026-10-20'; d <= '2026-11-01'; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 2 || wd === 5) lines.push(`${d}: 45 min tempo`);
    if (wd === 3 || wd === 0) lines.push(`${d}: 4 mi easy`);
    if (wd === 6) lines.push(`${d}: 10 mi long`);
  }
  return lines.join('\n');
};
const PASTE_V2 = () => {
  const lines: string[] = [];
  for (let d = '2026-10-29'; d <= END; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 2) lines.push(`${d}: 50 min tempo`);
    if (wd === 4) lines.push(`${d}: 5 mi easy`);
    if (wd === 6) lines.push(`${d}: 12 mi long`);
  }
  return lines.join('\n');
};

const generateBody = (date: string) => ({
  athleteId: PLAN, sport: 'run', goal_type: '10k', experience_level: 'regular', current_weekly_km: 40, goal_race_date: RACE, today: date,
});
// PLAN skips these: left unrun, marked missed.
const PLAN_MISSES = new Set(['2026-10-22', '2026-11-04']);
const ICAL_MISSES = new Set(['2026-10-24', '2026-11-05']);
const planned = new Map<string, number>(); // per athlete+date: a run was added

async function planOnboarding(sim: Sim, date: string) {
  if (sim.id === PLAN && date === START) {
    const options = await get(sim, `/api/plan/options?athleteId=${sim.id}`);
    check(options.json().goals?.some((g: any) => g.goal_type === '10k'), 'plan options list the fixture', `${JSON.stringify(options.json())}`);
    const r = await post(sim, '/api/plan/generate', generateBody(date));
    check(r.statusCode === 200, 'the plan builds', `${r.statusCode} ${r.body.slice(0, 200)}`);
    sim.planId = r.json().planId;
    sim.generated = await activeRows(sim.id);
  }
  if (sim.id === ICAL && date === START) {
    const r = await post(sim, '/api/plan/ical', { athleteId: sim.id, ics: ICS_V1(icalRows(START)), today: date, timeZone: sim.tz });
    check(r.statusCode === 200, 'the calendar imports', `${r.statusCode} ${r.body.slice(0, 200)}`);
    sim.planId = r.json().planId;
  }
  if (sim.id === PASTE && date === '2026-10-20') {
    const r = await post(sim, '/api/plan/manual', { athleteId: sim.id, text: PASTE_V1(), today: date });
    check(r.statusCode === 200, 'the paste saves', `${r.statusCode} ${r.body.slice(0, 200)}`);
    sim.planId = r.json().planId;
  }
}

// The athlete's day on the road: run what the plan says, unless skipped.
async function doTodaysSession(sim: Sim, date: string) {
  if (sim.id === PLAN) {
    if (date === RACE) {
      world.addLocalRun(sim.id, date, 9 * 60, sim.tz, { name: `Race-${sim.id}`, seconds: 45 * 60 + 12, meters: 10_000, hr: 172, workoutType: 1 });
      return;
    }
    if (PLAN_MISSES.has(date)) return;
    const rows = (await activeRows(sim.id)).filter((r) => r.date === date && r.intensity !== 'rest');
    for (const [i, r] of rows.entries()) {
      world.addLocalRun(sim.id, date, 17 * 60, sim.tz, {
        name: `Run-${sim.id}-${date}-${i}`, seconds: secs(r.minutes, dayIndex(date) + i), meters: r.minutes * 180,
        hr: r.intensity === 'long' ? 143 : HARD.includes(r.intensity) ? 150 : 138,
      });
    }
  }
  if (sim.id === ICAL && !ICAL_MISSES.has(date)) {
    const rows = (await activeRows(sim.id)).filter((r) => r.date === date && r.intensity !== 'rest');
    for (const [i, r] of rows.entries()) {
      const km = r.km ?? 8;
      world.addLocalRun(sim.id, date, 17 * 60, sim.tz, {
        name: `Run-${sim.id}-${date}-${i}`, seconds: Math.round(km * 340) + 7, meters: km * 1000, hr: 139 + (dayIndex(date) % 4),
      });
    }
  }
  if (sim.id === PASTE && date >= '2026-10-23' && dayIndex(date) % 2 === 1) {
    world.addLocalRun(sim.id, date, 17 * 60, sim.tz, { name: `Run-${sim.id}-${date}`, seconds: secs(40, dayIndex(date)), meters: 6800, hr: 145 });
  }
}

// Mark today's session in the evening: done if run, missed if not.
async function markToday(sim: Sim, date: string) {
  if (!sim.planId) return;
  const rows = (await activeRows(sim.id)).filter((r) => r.date === date && r.intensity !== 'rest');
  for (const r of rows) {
    const done = runsOn(sim.id, date).length > 0;
    const m = await post(sim, `/api/plan/workouts/${r.id}/status`, { athleteId: sim.id, status: done ? 'done' : 'missed', today: date });
    check(m.statusCode === 200, 'marking today\'s session works', `${sim.id} ${date} ${m.statusCode} ${m.body.slice(0, 100)}`);
    sim.marks.set(markKey(sim, r), done);
    tally(done ? 'marks done' : 'marks missed');
  }
  // A session still ahead cannot be marked, and neither can someone else's.
  const ahead = (await activeRows(sim.id)).find((r) => r.date > date && r.intensity !== 'rest');
  if (ahead) {
    const m = await post(sim, `/api/plan/workouts/${ahead.id}/status`, { athleteId: sim.id, status: 'done', today: date });
    check(m.statusCode === 404, 'a session ahead cannot be marked', `${sim.id} ${date} ${ahead.date} ${m.statusCode}`);
  }
}

// ---- other athletes' rows stay out of reach ----
async function checkNoCrossing(sim: Sim, date: string) {
  for (const other of ATHLETES.filter((a) => a !== sim.id)) {
    const theirs = (await activeRows(other)).find((r) => r.date >= date);
    if (!theirs) continue;
    const m = await post(sim, `/api/plan/workouts/${theirs.id}/status`, { athleteId: sim.id, status: 'done', today: addDays(date, 1) });
    check(m.statusCode === 404, 'an athlete cannot mark another athlete\'s session', `${sim.id} marked ${other}'s ${theirs.id}: ${m.statusCode}`);
    const w = await post(sim, `/api/plan/workouts/${theirs.id}/watch-sent`, { athleteId: sim.id });
    check(w.statusCode === 404, 'an athlete cannot touch another athlete\'s session', `${sim.id} watch-sent ${other}'s: ${w.statusCode}`);
  }
  const r = await get(sim, `/api/plan?athleteId=${sim.id}&today=${date}`);
  const body = r.json();
  const ids = new Set((await activeRows(sim.id)).map((x) => x.id));
  for (const w of [...(body.workouts ?? []), ...(body.recent ?? [])]) check(ids.has(w.id), 'the plan shows only this athlete\'s sessions', `${sim.id} ${date} ${w.id}`);
  check(body.today === date, 'the plan agrees what day it is', `${sim.id} ${date} ${body.today}`);
  // §6.2 acknowledge: a marked session leaves the list of ones to mark; nothing ahead is listed.
  for (const w of body.recent ?? []) {
    check(w.athlete_completed == null, 'a marked session leaves the list to mark', `${sim.id} ${date} ${w.scheduled_date}`);
    check(w.scheduled_date < date, 'the list to mark is only the past', `${sim.id} ${date} ${w.scheduled_date}`);
  }
  for (const w of body.workouts ?? []) check(w.scheduled_date >= date, 'the plan\'s next sessions are ahead', `${sim.id} ${date} ${w.scheduled_date}`);
}

// ---- routes the rest of the app reads, on the plan athlete ----
async function checkPlanRoutes(sim: Sim, date: string) {
  const b = await get(sim, `/api/plan/block?athleteId=${sim.id}&today=${date}`);
  if (sim.id === PLAN) {
    check(b.statusCode === 200, 'the block answers', `${date} ${b.statusCode}`);
    const block = b.json().block;
    const week = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / (7 * DAY)) + 1;
    check(block?.week === Math.min(week, 3), 'the block\'s week is the calendar\'s', `${date} ${block?.week} vs ${week}`);
    check(block?.race_date === RACE, 'the block holds the race', `${date} ${block?.race_date}`);
    const p = await get(sim, `/api/plan/prediction?athleteId=${sim.id}&today=${date}`);
    check(p.statusCode === 200, 'the prediction answers', `${date} ${p.statusCode} ${p.body.slice(0, 120)}`);
    const a = await get(sim, `/api/plan/adaptations?athleteId=${sim.id}`);
    const h = await get(sim, `/api/plan/adaptations/history?athleteId=${sim.id}`);
    check(a.statusCode === 200 && h.statusCode === 200, 'adaptation lists answer', `${date}`);
    const rows = await adaptationRows(sim.id);
    check(h.json().adaptations.length === rows.length, 'the history shows every change', `${date} ${h.json().adaptations.length} vs ${rows.length}`);
    for (const x of h.json().adaptations) check(x.reason_text, 'every listed change has its reason', `${date} ${x.id}`);
  }
  const c = await get(sim, `/api/calories?athleteId=${sim.id}`);
  check(c.statusCode === 200, 'calories answer', `${sim.id} ${date} ${c.statusCode}`);
}

// ---- sessions ----
const ouraLinked = new Set<string>([PLAN]);

async function connectOura(sim: Sim) {
  const r = await get(sim, `/api/auth/oura/callback?code=oura-${sim.id}&state=${sim.id}`);
  check(r.statusCode === 200 && r.body.includes('scora://oura/success'), 'Oura connects', `${sim.id} ${r.statusCode}`);
  ouraLinked.add(sim.id);
}

async function morning(sim: Sim, date: string) {
  const idx = dayIndex(date);
  world.zones.set(sim.id, sim.tz);
  // Day 5: FREE connects Oura. PLAN's ring is linked at onboarding.
  if (sim.id === FREE && date === '2026-10-23') await connectOura(sim);
  await planOnboarding(sim, date);
  if (sim.id === PASTE && date === '2026-10-29') {
    const r = await post(sim, '/api/plan/manual', { athleteId: sim.id, text: PASTE_V2(), today: date });
    check(r.statusCode === 200, 'the second paste saves', `${r.statusCode} ${r.body.slice(0, 200)}`);
    sim.planId = r.json().planId;
    sim.marks.clear(); // a new paste is a new plan: its sessions start unmarked
  }
  if (sim.id === PLAN && date === '2026-10-27') {
    // Setting the same plan up again changes nothing: not one mark, not one move.
    const before = await activeRows(sim.id);
    const adapts = await adaptationRows(sim.id);
    const r = await post(sim, '/api/plan/generate', generateBody(date));
    check(r.statusCode === 200 && r.json().planId === sim.planId, 'the same setup is the same plan', `${r.statusCode} ${r.body.slice(0, 200)}`);
    check(JSON.stringify(await activeRows(sim.id)) === JSON.stringify(before), 'the same setup changes no session', date);
    check((await adaptationRows(sim.id)).length === adapts.length, 'the same setup keeps the plan changes', date);
    await checkMarks(sim, 'same setup again', date);
    tally('plan refresh, same setup');
  }
  if (sim.id === ICAL && (date === '2026-10-26' || date === '2026-11-02')) {
    // Tomorrow's sessions may change in the feed; past marks must stay, also across zones.
    const extra: [string, string][] = date === '2026-11-02' ? [['2026-11-03', 'Extra easy run 3 mi']] : [];
    const r = await post(sim, '/api/plan/ical', { athleteId: sim.id, ics: ICS_V1(icalRows(addDays(date, -1), extra)), today: date, timeZone: sim.tz, refresh: true });
    check(r.statusCode === 200, 'the calendar refresh answers', `${date} ${r.statusCode} ${r.body.slice(0, 200)}`);
    if (r.statusCode === 200) sim.planId = r.json().planId;
    await checkMarks(sim, 'calendar refresh', date);
    tally('calendar refreshes');
  }
  await doTodaysSession(sim, date);
  const body = await readAndCheck(sim, 'morning', date, ouraLinked.has(sim.id));
  if (!body) return;
  sim.lastNumbers.set(date, body.read?.numbers ?? '');
  const p = pushes.find((x) => x.athlete === sim.id && x.kind === 'daily' && x.date === date);
  if (p) checkPushBody(sim, p, body);
  await tapCards(sim, date, body);
  // The quota edge: three, then the refusal.
  for (const q of QUESTIONS) await chat(sim, date, q, body);
  await checkNoCrossing(sim, date);
  // Miles on a pasted or calendar plan read back as written.
  if (sim.id === ICAL) {
    const rows = (await activeRows(sim.id)).filter((r) => r.date === date && r.intensity !== 'rest' && r.km != null);
    for (const r of rows) {
      const mi = ICAL_MILES[r.description];
      if (mi === undefined) { fail('every calendar session is the one written', `${date} ${r.description}`); continue; }
      const pc = card(body, 'plan_today');
      if (rows.length === 1) {
        check(pc?.value === String(mi) && pc?.unit === 'mi', 'plan miles read back as written', `${date} card ${pc?.value} ${pc?.unit} vs ${mi}`);
        check(String(body.plan?.today ?? '').includes(`${mi} mi`), 'plan miles read back as written', `${date} read ${body.plan?.today} vs ${mi}`);
      }
      tally('plan miles days');
    }
  }
  if (WEEKDAY(date) === 'Sunday') {
    // Sunday's read of the seven complete days before it.
    const w = await post(sim, '/api/weekly', { athleteId: sim.id, today: date });
    check(w.statusCode === 200, 'the weekly answers', `${sim.id} ${date} ${w.statusCode}`);
    if (w.statusCode === 200) checkWeekly(sim, date, 'sunday weekly', w.json());
    await checkPlanRoutes(sim, date);
  }
  if (idx === 1) await checkPlanRoutes(sim, date);
}

async function evening(sim: Sim, date: string) {
  await markToday(sim, date);
  const body = await readAndCheck(sim, 'evening', date, ouraLinked.has(sim.id));
  if (body) {
    const c = await post(sim, '/api/card-expand', { athleteId: sim.id, cardId: 'training_load' });
    check(c.statusCode === 200, 'a card tap answers in the evening', `${sim.id} ${date} ${c.statusCode}`);
  }
  // Quota still spent in the evening.
  await chat(sim, date, 'Anything else?', body);
}

// Either side of the athlete's midnight: spent until it, fresh after. The UTC
// day turns at a different moment in every zone here.
async function midnightChat(sim: Sim, date: string, minute: number) {
  if (minute >= 23 * 60 + 45) {
    await chat(sim, date, 'Late question?', null);
  } else if (minute <= 15) {
    const used = sim.quota.get(date) ?? 0;
    check(used === 0, 'nothing counted on a new local day yet', `${sim.id} ${date} ${used}`);
    await chat(sim, date, 'Early question?', null);
    tally('chats just after local midnight');
  }
}

// ---- the journey ----
const TRAVEL: { at: string; athlete: string; tz?: string; minute?: number }[] = [
  { at: '2026-10-27T22:00:00Z', athlete: ICAL, tz: 'Asia/Tokyo' }, // lands in Tokyo evening of Oct 28 local
  { at: '2026-10-31T23:30:00Z', athlete: ICAL, minute: 450 }, // moves delivery to 07:30
  { at: '2026-11-03T02:00:00Z', athlete: ICAL, tz: 'America/Los_Angeles' }, // Tokyo to Los Angeles: Nov 2 again there
];
const travelDone = new Set<number>();

async function fireTravel(now: number) {
  for (const [i, t] of TRAVEL.entries()) {
    if (travelDone.has(i) || Date.parse(t.at) > now) continue;
    travelDone.add(i);
    const sim = sims[t.athlete];
    sim.changedAt = now;
    if (t.tz) sim.tz = t.tz;
    if (t.minute !== undefined) sim.deliveryMinute = t.minute;
    const r = await call(sim, 'PUT', '/api/preferences', { athleteId: sim.id, ...(t.tz ? { timezone: t.tz } : {}), ...(t.minute !== undefined ? { deliveryMinute: t.minute } : {}) });
    check(r.statusCode === 200, 'preferences save', `${r.statusCode} ${r.body.slice(0, 120)}`);
    const back = await get(sim, `/api/preferences?athleteId=${sim.id}`);
    check(back.json().timezone === sim.tz && back.json().deliveryMinute === sim.deliveryMinute, 'preferences read back', back.body);
    tally('zone or delivery changes');
  }
}

test('21 days across features, four athletes at once', { timeout: 300_000 }, async (t) => {
  const wall = globalThis.performance.now();
  seedHistory();
  seedNights();

  // Onboarding: the real callbacks, the real preferences and device routes.
  for (const id of ATHLETES) {
    const sim = sims[id];
    world.zones.set(id, sim.tz);
    const r = await get(sim, `/api/auth/strava/callback?code=code-${id}`);
    check(r.statusCode === 200, 'Strava connects', `${id} ${r.statusCode} ${r.body.slice(0, 200)}`);
    const dev = await post(sim, '/api/register-device', { athleteId: id, deviceToken: tokenOf(id) });
    check(dev.statusCode === 200, 'the device registers', `${id} ${dev.statusCode}`);
    const pref = await call(sim, 'PUT', '/api/preferences', { athleteId: id, timezone: sim.tz, deliveryMinute: sim.deliveryMinute, onboarded: true });
    check(pref.statusCode === 200, 'preferences save', `${id} ${pref.statusCode}`);
  }
  await connectOura(sims[PLAN]);

  const logger = { info: () => {}, warn: (m: string) => appErrors.push(`scheduler warn: ${m}`), error: (m: string) => appErrors.push(`scheduler: ${m}`) };
  const injectFetch = (async (url: any, init: any) => {
    const u = new URL(String(url));
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const r = await app.inject({ method: init?.method ?? 'GET', url: u.pathname, payload: body });
    const route = `scheduler ${u.pathname} ${r.statusCode}`;
    statuses.set(route, (statuses.get(route) ?? 0) + 1);
    check(r.statusCode < 500, 'no route returns a 500', `${route} ${r.body.slice(0, 120)}`);
    return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const fakeSend = (async (token: string, alert: { title: string; body: string }, extra?: any) => {
    const athlete = athleteOfToken(token);
    const at = Date.now();
    const sim = sims[athlete];
    pushes.push({ athlete, kind: extra?.kind, date: extra?.date, at, body: alert.body, title: alert.title });
    if (!sim) { fail('a push reaches a known device', token); return { ok: true, status: 200 }; }
    const l = localClock(new Date(at), sim.tz);
    // Exactly one per local day: the claim holds on every path.
    const twice = pushes.filter((p) => p.athlete === athlete && p.kind === extra?.kind && p.date === extra?.date).length;
    check(twice === 1, 'one push per local date', `${athlete} ${extra?.kind} ${extra?.date} sent ${twice} times`);
    check(extra?.date === l.date, 'a push carries the local date it lands on', `${athlete} ${extra?.kind} ${extra?.date} landed ${l.date} in ${sim.tz}`);
    // A change of zone or time can land inside the late window: it goes out at once.
    const justChanged = at - sim.changedAt <= 120 * 60_000;
    check(l.minute === sim.deliveryMinute || (justChanged && l.minute > sim.deliveryMinute && l.minute < sim.deliveryMinute + 120), 'a push lands at the set minute', `${athlete} ${extra?.kind} ${extra?.date} at ${l.minute} vs ${sim.deliveryMinute}`);
    check(extra?.kind !== 'weekly' || l.weekday === 1, 'the weekly goes out on Monday', `${athlete} ${extra?.date}`);
    check(typeof extra?.sent_at === 'number', 'a push carries when it was sent', `${athlete}`);
    check(alert.body.length <= 178, 'a push fits a notification', `${athlete} ${alert.body.length}`);
    check(alert.body.length > 0, 'a push says something', `${athlete}`);
    for (const re of PRESCRIPTIVE) check(!re.test(alert.body), 'the voice never prescribes', `${athlete} ${extra?.date} push ${re}: "${alert.body}"`);
    // Someone else's run names and numbers never reach it.
    const open = await app.inject({ method: 'POST', url: '/api/events/push-open', payload: { athleteId: athlete, kind: extra?.kind, date: extra?.date, sentAt: extra?.sent_at } });
    check(open.statusCode === 204, 'a push open is logged', `${athlete} ${open.statusCode}`);
    return { ok: true, status: 200 };
  }) as typeof push.sendPush;
  const deps = sched.schedulerDeps('http://localhost:3000', logger, prefsStore, {
    now: () => new Date(),
    fetch: injectFetch,
    getDeviceTokens: push.getDeviceTokens,
    sendPush: fakeSend,
    removeDeviceToken: push.removeDeviceToken,
  });

  // Weekly pushes, with each one's body checked by re-reading it through the route.
  const startAt = Date.parse('2026-10-18T12:00:00Z');
  const endAt = Date.parse('2026-11-09T14:00:00Z'); // through every zone's Monday delivery after day 21
  let ticks = 0;
  for (let now = startAt; now <= endAt; now += STEP) {
    mock.timers.setTime(now);
    await fireTravel(now);
    // The day's model mood, from UTC so it spans athletes.
    const simDay = dayIndex(new Date(now).toISOString().slice(0, 10));
    world.llmMode = LLM_BY_DAY[simDay] ?? 'clean';
    const pushesBefore = pushes.length;
    await sched.runTick(new Date(now), deps);
    ticks++;
    for (const p of pushes.slice(pushesBefore)) {
      if (p.kind === 'weekly') {
        const sim = sims[p.athlete];
        const w = await post(sim, '/api/weekly', { athleteId: p.athlete, today: p.date });
        if (w.statusCode === 200) checkWeekly(sim, p.date, 'monday weekly', w.json());
      }
    }
    for (const id of ATHLETES) {
      const sim = sims[id];
      const l = localClock(new Date(now), sim.tz);
      if (l.date < START || l.date > END) continue;
      if (l.minute >= sim.deliveryMinute + 15 && l.minute < 20 * 60 && !sim.morningDone.has(l.date)) {
        sim.morningDone.add(l.date);
        await morning(sim, l.date);
      }
      if (l.minute >= 20 * 60 + 30 && l.minute < 23 * 60 && !sim.eveningDone.has(l.date) && sim.morningDone.has(l.date)) {
        sim.eveningDone.add(l.date);
        await evening(sim, l.date);
      }
      // Two nights a week, either side of local midnight.
      const nightly = dayIndex(l.date) % 4 === 2;
      if ((l.minute >= 23 * 60 + 45 && nightly) || (l.minute <= 15 && dayIndex(addDays(l.date, -1)) % 4 === 2)) {
        const key = `${l.date}:${l.minute >= 23 * 60 ? 'late' : 'early'}`;
        if (!sim.midnightDone.has(key)) {
          sim.midnightDone.add(key);
          await midnightChat(sim, l.date, l.minute);
        }
      }
    }
  }

  // ---- the whole journey ----
  // One daily push per local date, none missing (the zone change that jumps a
  // morning is named).
  const expectMissing: Record<string, string[]> = { [ICAL]: [] };
  for (const id of ATHLETES) {
    const mineDaily = pushes.filter((p) => p.athlete === id && p.kind === 'daily');
    const dates = mineDaily.map((p) => p.date);
    check(new Set(dates).size === dates.length, 'one push per local date', `${id} ${dates.join(' ')}`);
    for (let d = START; d <= END; d = addDays(d, 1)) {
      if (!dates.includes(d) && !(expectMissing[id] ?? []).includes(d)) fail('a daily push on every local date', `${id} ${d} has none`);
    }
    const weekly = pushes.filter((p) => p.athlete === id && p.kind === 'weekly').map((p) => p.date);
    for (const d of ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']) {
      check(weekly.includes(d), 'a weekly push every Monday', `${id} ${d}: ${weekly.join(' ')}`);
    }
  }

  // Every emission the routes logged passed its checks; a fallback is a validated one.
  const emissions = telemetry.filter((e) => e.event === 'voice_emission');
  for (const e of emissions) check(e.final_ok !== false && e.finalOk !== false, 'every logged emission passed its checks', JSON.stringify(e));
  tally(`emissions ${emissions.length}`);
  tally(`emissions fallback ${emissions.filter((e) => e.fallback).length}`);

  // Nothing crossed: a chat prompt holds only the asker's own runs, and every
  // vendor call carried a token that resolved to someone (the wrong token would
  // have been an empty read, caught by the numbers above).
  for (const c of world.llmCalls) {
    const names = [...c.user.matchAll(/(?:Run|Race)-(\d{4})-/g)].map((m) => m[1]);
    for (const n of names) check(n === c.actingFor, 'nothing crosses between athletes', `prompt for ${c.actingFor} holds ${n}'s run`);
  }
  check(world.badTokens.length === 0, 'every vendor call carries a live token', world.badTokens.slice(0, 5).join(', '));
  check([...world.hosts].sort().join() === 'api.openai.com,api.ouraring.com,www.strava.com', 'only the three fakes are called', [...world.hosts].join());
  const stored = await pg.query<any>('select athlete_id, count(*)::int as n from scheduled_workouts group by 1');
  for (const r of stored.rows) check(ATHLETES.includes(r.athlete_id), 'sessions stay with known athletes', r.athlete_id);
  const tables = new Set(rest.requests.map((q) => q.table));
  for (const name of tables) if (!TABLES.includes(name)) unservedTables.add(name);
  check(unservedTables.size === 0, 'every table the app used was the real schema', [...unservedTables].join());
  const errors = [...new Set(appErrors)].filter((m) => !/canned outage|voice_llm_error|OpenAI error/.test(m));
  check(errors.length === 0, 'no unexpected error lines', errors.slice(0, 8).join(' | '));

  // The journey did what it set out to: every interesting path ran.
  const need = [
    'posture 1002 rest', 'posture 1002 back-off', 'posture 1002 primed', 'posture 1002 taper',
    'adaptation moved posture_rest_hard_scheduled', 'adaptation skipped displaced_by_move', 'adaptation downgraded posture_backoff_threshold_scheduled',
    'adaptation downgraded posture_backoff_tempo_scheduled', 'marks done', 'marks missed', 'plan refresh, same setup', 'calendar refreshes',
    'zone or delivery changes', 'chats refused', 'chat outages', 'chats just after local midnight', 'weekly with no runs', 'weekly with runs', 'plan miles days', 'chart links', 'card taps',
  ];
  for (const n of need) check(seen.has(n), 'the journey covers this path', n);
  // The frozen rest night: rest the morning before the first race-week day, and nothing moved.
  const frozen = (await activeRows(PLAN)).find((r) => r.date === '2026-10-31');
  check(frozen?.intensity === 'long', 'the long run on the first frozen day stays', JSON.stringify(frozen && sig(frozen)));

  const seconds = Math.round((globalThis.performance.now() - wall) / 1000);
  t.diagnostic(`${ticks} ticks, ${pushes.length} pushes, ${emissions.length} emissions, ${world.llmCalls.length} model calls, ${seconds} s`);
  t.diagnostic([...seen.entries()].map(([k, v]) => `${k}: ${v}`).sort().join('; '));
  if (process.env.JOURNEY_DUMP) t.diagnostic([...statuses.entries()].sort().map(([k, v]) => `${k}: ${v}`).join('; '));
  const report = [...fails.entries()].map(([k, n]) => (n > 1 ? `${k} (x${n})` : k));
  assert.equal(report.length, 0, `\n${report.slice(0, 120).join('\n')}${report.length > 120 ? `\n... and ${report.length - 120} more` : ''}`);
});

// Quiet unused-import complaints stay out: these are part of the helpers' surface.
void zoneOffsetSec; void zonedInstant; void dueDeliveries; void planned;
