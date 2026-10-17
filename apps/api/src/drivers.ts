// Per-user driver record for the posture engine (CLAUDE.md §3.2, doc 07 v1 §8.2).
//
// Pure: Strava activities + the recovery summary in, PostureDrivers +
// UserBaselines out. Every field is null when the data to back it is missing,
// so the posture engine can never fire on a guess. Definitions (units, windows,
// what counts as a hard day) are logged in DECISIONS.md 2026-10-17.

import type { PostureDrivers, UserBaselines } from '../../../packages/posture/src/index';
import type { OuraSummary } from './oura';

const DAY = 86400000;

// A hard day is a run whose average HR sits in the athlete's own top fifth
// for the last 28 days, or one Strava marks as a race or workout.
const HARD_HR_PERCENTILE = 0.8;
const MIN_HR_RUNS_FOR_PERCENTILE = 5;
const STRAVA_RACE = 1;
const STRAVA_WORKOUT = 3;

// ACWR is only honest once the history covers the chronic window. Without
// this a two-week-old account reads acwr ~2 and lands in back-off.
const MIN_HISTORY_DAYS_FOR_ACWR = 21;

// A long effort is a run of at least 90 minutes moving time.
const LONG_EFFORT_MIN_SECONDS = 90 * 60;

// Sleep score percentiles need at least a week of nights.
const MIN_NIGHTS_FOR_BASELINE = 7;

export interface DriverRecordOptions {
  now?: number;
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

const startMs = (a: any): number => new Date(a.start_date_local || a.start_date).getTime();
const daysAgo = (a: any, now: number): number => Math.floor((now - startMs(a)) / DAY);
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
  return hrThreshold !== null && typeof a.average_heartrate === 'number' && a.average_heartrate >= hrThreshold;
}

// Consecutive days with a hard run, counting back from today. If nothing has
// been recorded today yet, the count starts from yesterday.
function consecutiveHardDays(runs: any[], now: number, hrThreshold: number | null): number {
  const byDay = new Map<number, any[]>();
  for (const r of runs) {
    const d = daysAgo(r, now);
    if (d < 0) continue;
    byDay.set(d, [...(byDay.get(d) || []), r]);
  }
  let d = byDay.has(0) ? 0 : 1;
  let count = 0;
  while ((byDay.get(d) || []).some((r) => isHard(r, hrThreshold))) {
    count++;
    d++;
  }
  return count;
}

export function computeDriverRecord(
  activities: any[],
  recovery?: OuraSummary | null,
  opts: DriverRecordOptions = {}
): DriverRecordResult {
  const now = opts.now ?? Date.now();
  const runs = activities.filter((a) => a.type === 'Run' && Number.isFinite(startMs(a)));
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
    d.acwr = oldest >= MIN_HISTORY_DAYS_FOR_ACWR && d.load_28d > 0
      ? Math.round((d.load_7d / (d.load_28d / 4)) * 100) / 100
      : null;

    const hrs = last28
      .map((a) => a.average_heartrate)
      .filter((v): v is number => typeof v === 'number');
    const hrThreshold = hrs.length >= MIN_HR_RUNS_FOR_PERCENTILE ? percentile(hrs, HARD_HR_PERCENTILE) : null;
    const anyMarked = last28.some((a) => a.workout_type === STRAVA_RACE || a.workout_type === STRAVA_WORKOUT);
    d.consecutive_hard_days = hrThreshold !== null || anyMarked
      ? consecutiveHardDays(last28, now, hrThreshold)
      : null;

    const long = runs.filter((a) => (a.moving_time || 0) >= LONG_EFFORT_MIN_SECONDS && daysAgo(a, now) >= 0);
    d.days_since_long_effort = long.length > 0 ? Math.min(...long.map((a) => daysAgo(a, now))) : null;
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
