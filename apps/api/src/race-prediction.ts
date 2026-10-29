// Race predictions (Plan tier, PRD §5.B.6). Deterministic: a range from the
// athlete's own recent runs, never a single overconfident number, and nothing
// at all when the data cannot support one (no data, no claim). Every effort
// the range is built from is returned with it, so the number is backed.
//
// v1 uses current fitness only: Riegel's projection (T2 = T1 x (D2/D1)^1.06)
// from the best recent efforts, races first. Plan progression and body-state
// trend (also in §5.B.6) are not in yet. Off unless RACE_PREDICTIONS=on.

import { isOutdoorRun } from './activity-types';

export const predictionsEnabled = () => process.env.RACE_PREDICTIONS === 'on';

export const RACE_DISTANCES_M: Record<string, number> = {
  '5k': 5000,
  '10k': 10000,
  half_marathon: 21097.5,
  marathon: 42195,
};

export const PREDICTION = {
  version: 'prediction-v1.0.0',
  riegel: 1.06,
  windowDays: 56, // efforts from the last 8 weeks
  minEffortM: 3000, // shorter runs say little about a longer race
  efforts: 3, // the range spans the best three projections
  minSpread: 0.02, // never narrower than ±2% around the middle
  // The longest recent run must be at least this share of the race (capped
  // at 25 km): without it a marathon number is a guess.
  longRunShare: 0.5,
  longRunCapM: 25000,
};

export interface Effort {
  date: string; // local YYYY-MM-DD
  distance_m: number;
  time_s: number;
  race: boolean; // tagged as a race on Strava
  projected_s: number;
}

export type Prediction =
  | { ok: true; race: string; distance_m: number; low_s: number; high_s: number; efforts: Effort[]; used_races: boolean; version: string }
  | { ok: false; race: string; reason: 'unknown_race' | 'not_enough_runs' | 'no_long_run'; needed?: string };

export const riegel = (timeS: number, fromM: number, toM: number) => timeS * (toM / fromM) ** PREDICTION.riegel;

export function predictRace(activities: any[], race: string, today: string): Prediction {
  const distance = RACE_DISTANCES_M[race];
  if (!distance) return { ok: false, race, reason: 'unknown_race' };
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (PREDICTION.windowDays - 1) * 86_400_000).toISOString().slice(0, 10);

  const runs = activities.filter((a) => {
    const d = typeof a.start_date_local === 'string' ? a.start_date_local.slice(0, 10) : null;
    return isOutdoorRun(a) && d && d >= from && d <= today && a.distance > 0 && a.moving_time > 0;
  });
  const longest = Math.max(0, ...runs.map((a) => a.distance));
  const needLong = Math.min(distance * PREDICTION.longRunShare, PREDICTION.longRunCapM);
  if (runs.length > 0 && longest < needLong) {
    return { ok: false, race, reason: 'no_long_run', needed: `a run of at least ${Math.ceil(needLong / 1000)} km in the last 8 weeks` };
  }

  const efforts: Effort[] = runs
    .filter((a) => a.distance >= PREDICTION.minEffortM)
    .map((a) => {
      const isRace = a.workout_type === 1; // Strava: 1 = race (run)
      // A race is timed start to finish; a training run by moving time.
      const time = isRace && a.elapsed_time > 0 ? a.elapsed_time : a.moving_time;
      return {
        date: a.start_date_local.slice(0, 10),
        distance_m: a.distance,
        time_s: time,
        race: isRace,
        projected_s: Math.round(riegel(time, a.distance, distance)),
      };
    });
  const races = efforts.filter((e) => e.race);
  const pool = (races.length > 0 ? races : efforts).sort((a, b) => a.projected_s - b.projected_s);
  const best = pool.slice(0, PREDICTION.efforts);
  if (races.length === 0 && best.length < PREDICTION.efforts) {
    return { ok: false, race, reason: 'not_enough_runs', needed: `${PREDICTION.efforts} runs of 3 km or more in the last 8 weeks` };
  }

  let low = best[0].projected_s;
  let high = best[best.length - 1].projected_s;
  const mid = (low + high) / 2;
  low = Math.min(low, Math.round(mid * (1 - PREDICTION.minSpread)));
  high = Math.max(high, Math.round(mid * (1 + PREDICTION.minSpread)));
  return { ok: true, race, distance_m: distance, low_s: low, high_s: high, efforts: best, used_races: races.length > 0, version: PREDICTION.version };
}
