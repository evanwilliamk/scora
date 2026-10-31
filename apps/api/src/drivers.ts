// Per-user driver record for the posture engine (CLAUDE.md §3.2, doc 07 v1 §8.2).
//
// Pure: Strava activities + the recovery summary in, PostureDrivers +
// UserBaselines out. Every field is null when the data to back it is missing,
// so the posture engine can never fire on a guess. Definitions (units, windows,
// what counts as a hard day) are logged in DECISIONS.md 2026-10-17.

import { computePosture } from '../../../packages/posture/src/index';
import type { PostureDrivers, PostureResult, UserBaselines } from '../../../packages/posture/src/index';
import type { OuraSummary } from './oura';
import type { Driver } from './metrics';
import { isRun } from './activity-types';

const DAY = 86400000;

// A hard day is a run whose average HR is above the athlete's own 80th
// percentile for the last 28 days (strictly above, so an athlete whose runs
// all sit at the same HR has no hard days), or one Strava marks as a race or
// workout.
const HARD_HR_PERCENTILE = 0.8;
const MIN_HR_RUNS_FOR_PERCENTILE = 5;
const STRAVA_RACE = 1;
const STRAVA_WORKOUT = 3;

// ACWR is only honest once the history covers the chronic window. Without
// this a two-week-old account reads acwr ~2 and lands in back-off. With less
// than 27 days of runs in the fetched 35, there is no ratio rather than a
// guessed one (a short window can't tell a new account from a comeback).
const MIN_HISTORY_DAYS_FOR_ACWR = 27;

// A long effort is a run of at least 90 minutes moving time.
const LONG_EFFORT_MIN_SECONDS = 90 * 60;

// Sleep score percentiles need at least a week of nights.
const MIN_NIGHTS_FOR_BASELINE = 7;

export interface DriverRecordOptions {
  now?: number;
  // The athlete's local date (YYYY-MM-DD). Defaults to now shifted by the
  // newest activity's utc_offset, which Strava sends per activity.
  localToday?: string;
  // No plan or race source is wired yet, so callers pass this when they know.
  raceInNext7d?: boolean | null;
}

export interface DriverRecordResult {
  drivers: PostureDrivers;
  baselines: UserBaselines;
  // 0..1: share of the driver fields that have a value. Feeds the voice
  // matcher's min_data_completeness.
  completeness: number;
}

// Strava's start_date is true UTC; start_date_local is local wall-clock time
// with a misleading Z. Elapsed-time windows use start_date; calendar days use
// the local date string.
const startMs = (a: any): number => new Date(a.start_date || a.start_date_local).getTime();
const daysAgo = (a: any, now: number): number => Math.floor((now - startMs(a)) / DAY);
const localDay = (a: any): string | null => {
  if (typeof a.start_date_local === 'string') return a.start_date_local.slice(0, 10);
  const t = startMs(a);
  return Number.isFinite(t) ? new Date(t + (a.utc_offset ?? 0) * 1000).toISOString().slice(0, 10) : null;
};
const prevDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

// The athlete's local date from the newest activity's utc_offset (Strava
// sends one per activity). UTC when there are no activities.
export function athleteLocalToday(activities: any[], now = Date.now()): string {
  return localTodayFor(activities.filter((a) => Number.isFinite(startMs(a))), now);
}

function localTodayFor(runs: any[], now: number): string {
  const newest = runs.reduce<any>((m, a) => (!m || startMs(a) > startMs(m) ? a : m), null);
  const offset = typeof newest?.utc_offset === 'number' ? newest.utc_offset : 0;
  return new Date(now + offset * 1000).toISOString().slice(0, 10);
}
const movingMin = (arr: any[]): number =>
  Math.round(arr.reduce((s, a) => s + (a.moving_time || 0), 0) / 60);
const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;
const round1 = (v: number): number => Math.round(v * 10) / 10;

// Nearest-rank percentile, p in 0..1.
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function isHard(a: any, hrThreshold: number | null): boolean {
  if (a.workout_type === STRAVA_RACE || a.workout_type === STRAVA_WORKOUT) return true;
  return hrThreshold !== null && typeof a.average_heartrate === 'number' && a.average_heartrate > hrThreshold;
}

// Consecutive local calendar days with a hard run, counting back from today.
// If nothing has been recorded today yet, the count starts from yesterday.
function consecutiveHardDays(runs: any[], today: string, hrThreshold: number | null): number {
  const byDay = new Map<string, any[]>();
  for (const r of runs) {
    const d = localDay(r);
    if (!d || d > today) continue;
    byDay.set(d, [...(byDay.get(d) || []), r]);
  }
  let d = byDay.has(today) ? today : prevDay(today);
  let count = 0;
  while ((byDay.get(d) || []).some((r) => isHard(r, hrThreshold))) {
    count++;
    d = prevDay(d);
  }
  return count;
}

export function computeDriverRecord(
  activities: any[],
  recovery?: OuraSummary | null,
  opts: DriverRecordOptions = {}
): DriverRecordResult {
  const now = opts.now ?? Date.now();
  const runs = activities.filter((a) => isRun(a) && Number.isFinite(startMs(a)));
  const within = (n: number) => runs.filter((a) => {
    const t = startMs(a);
    return t > now - n * DAY && t <= now;
  });

  const d: PostureDrivers = {};

  // --- Load: run moving minutes, same unit as the Load card ---
  const last7 = within(7);
  const last28 = within(28);
  if (runs.length > 0) {
    d.load_7d = movingMin(last7);
    d.load_28d = movingMin(last28);
    const oldest = Math.max(...runs.map((a) => daysAgo(a, now)));
    const chronicWeekly = d.load_28d / 4;
    d.acwr = oldest >= MIN_HISTORY_DAYS_FOR_ACWR && chronicWeekly > 0
      ? Math.round((d.load_7d / chronicWeekly) * 100) / 100
      : null;

    const hrs = last28
      .map((a) => a.average_heartrate)
      .filter((v): v is number => typeof v === 'number');
    const hrThreshold = hrs.length >= MIN_HR_RUNS_FOR_PERCENTILE ? percentile(hrs, HARD_HR_PERCENTILE) : null;
    const anyMarked = last28.some((a) => a.workout_type === STRAVA_RACE || a.workout_type === STRAVA_WORKOUT);
    d.consecutive_hard_days = hrThreshold !== null || anyMarked
      ? consecutiveHardDays(last28, opts.localToday ?? localTodayFor(runs, now), hrThreshold)
      : null;

    // Calendar days on the athlete's clock: last night's long run is 1, not 0.
    const today = opts.localToday ?? localTodayFor(runs, now);
    const calendarDaysAgo = (a: any): number | null => {
      const ranOn = localDay(a);
      return ranOn ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ranOn}T00:00:00Z`)) / DAY) : null;
    };
    const long = runs
      .filter((a) => (a.moving_time || 0) >= LONG_EFFORT_MIN_SECONDS && daysAgo(a, now) >= 0)
      .map(calendarDaysAgo)
      .filter((n): n is number => n !== null && n >= 0);
    d.days_since_long_effort = long.length > 0 ? Math.min(...long) : null;
  } else {
    d.load_7d = null;
    d.load_28d = null;
    d.acwr = null;
    d.consecutive_hard_days = null;
    d.days_since_long_effort = null;
  }

  // --- Recovery: last night against the prior nights ---
  const r = recovery || null;
  const baselines: UserBaselines = { sleep_score_p25: null, sleep_score_p75: null };

  d.sleep_last_night_score = r?.sleepScore ?? null;
  const scores = r?.sleepScoreHistory ?? [];
  if (scores.length >= MIN_NIGHTS_FOR_BASELINE) {
    baselines.sleep_score_p25 = percentile(scores, 0.25);
    baselines.sleep_score_p75 = percentile(scores, 0.75);
  }
  const prior7Scores = scores.slice(0, 7);
  d.sleep_7d_avg_delta = d.sleep_last_night_score != null && prior7Scores.length >= 3
    ? round1(d.sleep_last_night_score - mean(prior7Scores))
    : null;
  if (d.sleep_last_night_score != null && baselines.sleep_score_p25 != null) {
    const p25 = baselines.sleep_score_p25;
    let n = 0;
    for (const s of [d.sleep_last_night_score, ...scores]) {
      if (s < p25) n++;
      else break;
    }
    d.consecutive_low_sleep_nights = n;
  } else {
    d.consecutive_low_sleep_nights = null;
  }

  // HRV as percent change, matching the "+8% wk" trend the Recovery card shows.
  d.hrv_7d_avg_delta = r?.hrvMs != null && r.hrvWeekAvgMs
    ? round1(((r.hrvMs - r.hrvWeekAvgMs) / r.hrvWeekAvgMs) * 100)
    : null;
  // Resting HR in bpm.
  const rhrs = r?.restingHrHistory ?? [];
  d.rhr_7d_avg_delta = r?.restingHr != null && rhrs.length >= 3
    ? round1(r.restingHr - mean(rhrs))
    : null;

  d.race_in_next_7d = opts.raceInNext7d ?? null;

  const fields = Object.keys(d).filter((k) => k !== 'race_in_next_7d') as (keyof PostureDrivers)[];
  const present = fields.filter((k) => d[k] != null).length;
  const completeness = fields.length > 0 ? Math.round((present / fields.length) * 100) / 100 : 0;

  return { drivers: d, baselines, completeness };
}

// race_in_next_7d from the active plan's race date: true when the race is 0
// to 7 days after the athlete's local today, false when it is further off or
// past, null when there is no race date to read.
export function raceWithinWeek(raceDate: string | null | undefined, today: string): boolean | null {
  if (!raceDate || !/^\d{4}-\d{2}-\d{2}$/.test(raceDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const days = Math.round((Date.parse(`${raceDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  return days >= 0 && days <= 7;
}

// The clauses that made the posture fire, as drivers the read may cite, so a
// named posture is always backed by visible numbers (CLAUDE.md §3.2, §3.4).
const EVIDENCE: Record<string, (v: number | boolean) => Driver> = {
  acwr: (v) => ({ metric: 'Acute:chronic load', value: String(v) }),
  load_7d: (v) => ({ metric: 'Load (7d)', value: `${v} min` }),
  consecutive_hard_days: (v) => ({ metric: 'Hard days in a row', value: String(v) }),
  sleep_last_night_score: (v) => ({ metric: 'Sleep score', value: String(v) }),
  sleep_7d_avg_delta: (v) => ({ metric: 'Sleep score vs week', value: `${Number(v) > 0 ? '+' : ''}${v} pts` }),
  consecutive_low_sleep_nights: (v) => ({ metric: 'Short-sleep nights in a row', value: String(v) }),
  hrv_7d_avg_delta: (v) => ({ metric: 'HRV vs week', value: `${Number(v) > 0 ? '+' : ''}${v}%` }),
  rhr_7d_avg_delta: (v) => ({ metric: 'Resting HR vs week', value: `${Number(v) > 0 ? '+' : ''}${v} bpm` }),
  days_since_long_effort: (v) => ({ metric: 'Days since long effort', value: String(v) }),
  race_in_next_7d: () => ({ metric: 'Race within 7 days', value: 'yes' }),
};

export function postureEvidence(result: PostureResult): Driver[] {
  const fired = result.reasoning.find((t) => t.rule === result.rule);
  if (!fired || result.rule === 'default') return [];
  const out: Driver[] = [];
  for (const c of fired.clauses) {
    if (!c.met || c.value === null || !EVIDENCE[c.driver]) continue;
    const d = EVIDENCE[c.driver](c.value);
    if (!out.some((x) => x.metric === d.metric)) out.push(d);
  }
  return out;
}

export interface ReadPosture {
  record: DriverRecordResult;
  result: PostureResult;
  // Drivers backing the posture; added to the read's DRIVERS list.
  evidence: Driver[];
  // True when a rule fired on real values. The default steady (no rule
  // fired, often no usable drivers at all) has no evidence and is not backed.
  backed: boolean;
  // One line for the read prompt. The LLM names this posture; it never picks
  // one. Empty when the posture is not backed, so the voice cannot call the
  // body settled from nothing (CLAUDE.md §3.2).
  promptLine: string;
}

// Driver record -> posture engine, for the daily read. The posture is decided
// here by rules (doc 07 v1 §8.3); the LLM only names it.
export function postureForRead(
  activities: any[],
  recovery?: OuraSummary | null,
  opts: DriverRecordOptions = {}
): ReadPosture {
  const record = computeDriverRecord(activities, recovery, opts);
  const result = computePosture(record.drivers, record.baselines);
  const evidence = postureEvidence(result);
  const backed = evidence.length > 0;
  return {
    record,
    result,
    evidence,
    backed,
    promptLine: backed ? `POSTURE (decided by SCORA's rules from the drivers, ${result.engine_version}): ${result.posture}` : '',
  };
}

// The read may name only the posture the rules decided (null: none). The
// words that are not everyday English count anywhere; "steady", "moderate"
// and "rest" also describe numbers, so they count only tied to "posture".
// Returns one hit per posture claimed that is not the decided one.
const POSTURE_WORDS: { posture: string; re: RegExp }[] = [
  { posture: 'primed', re: /\bprimed\b/i },
  { posture: 'back-off', re: /\bback[\s-]?off\b/i },
  { posture: 'taper', re: /\btaper(?:s|ed|ing)?\b/i },
  { posture: 'steady', re: /\bposture\b[^.]{0,24}\bsteady\b/i },
  { posture: 'moderate', re: /\bposture\b[^.]{0,24}\bmoderate\b/i },
  { posture: 'rest', re: /\bposture\b[^.]{0,24}\brest\b/i },
];

export function postureClaimHits(voice: string, posture: string | null): string[] {
  return POSTURE_WORDS.filter((w) => w.posture !== posture && w.re.test(voice)).map((w) => `posture ${w.posture}`);
}
