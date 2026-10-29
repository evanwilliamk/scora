// Plan-aware daily read (PRD 5.A.6, CLAUDE.md §1.3).
//
// The read may name today's planned session; it never creates, moves or
// skips one. Today's session becomes (a) the scheduled workout the pattern
// matcher and retrieval see and (b) one driver, so its numbers pass the
// driver-existence validator when the voice mentions them.

import type { StoredWorkout } from './plan-store';
import type { Card, Driver } from './metrics';
import { toScheduledWorkout } from './plan-parse';
import { isRun } from './activity-types';

// When a day has more than one session, the read keys off the hardest.
const WEIGHT: Record<string, number> = {
  long: 8, intervals: 7, threshold: 6, hard: 6, tempo: 5, steady_state: 4, moderate: 4, endurance: 3, easy: 3, recovery: 2, rest: 1,
};

export function todaysWorkout(rows: StoredWorkout[], today: string): StoredWorkout | null {
  const todays = rows.filter((r) => r.scheduled_date === today);
  if (todays.length === 0) return null;
  return todays.reduce((best, r) =>
    (WEIGHT[r.planned_intensity ?? ''] ?? 0) > (WEIGHT[best.planned_intensity ?? ''] ?? 0) ? r : best
  );
}

// "tempo, 45 min" / "long, 25.8 km" / "rest". Only stored values.
export function planDriver(w: StoredWorkout): Driver {
  const parts: string[] = [w.planned_intensity ?? w.planned_type];
  if (w.planned_duration_min != null) parts.push(`${w.planned_duration_min} min`);
  if (w.planned_distance_km != null) parts.push(`${Number(w.planned_distance_km)} km`);
  return { metric: 'Plan today', value: parts.join(', ') };
}

export interface PlanForRead {
  workout: StoredWorkout | null;
  scheduled: ReturnType<typeof toScheduledWorkout> | null;
  driver: Driver | null;
  promptLine: string;
}

export function planForRead(rows: StoredWorkout[], today: string): PlanForRead {
  const workout = todaysWorkout(rows, today);
  if (!workout) {
    return {
      workout: null,
      scheduled: null,
      driver: null,
      promptLine: rows.length > 0 ? 'PLAN TODAY: nothing scheduled.' : '',
    };
  }
  const driver = planDriver(workout);
  return {
    workout,
    scheduled: toScheduledWorkout(workout),
    driver,
    // The free-text description stays out: its numbers are not drivers, so a
    // read that cited them would fail validation.
    promptLine: `PLAN TODAY (the athlete's own plan; you may name it, never change, move or add to it): ${driver.value}`,
  };
}

// For the weekly review: how the last 7 complete days tracked against the athlete's
// plan, as one driver ("180 of 210 planned run min"). Planned minutes are
// stored durations of run sessions only; run minutes come from Strava. Null
// when the plan has no run minutes in the window (nothing to compare).
export function weeklyPlanDriver(
  rows: Pick<StoredWorkout, 'scheduled_date' | 'planned_type' | 'planned_intensity' | 'planned_duration_min'>[],
  activities: any[],
  from: string,
  to: string,
): Driver | null {
  const runRows = rows.filter((r) => r.scheduled_date >= from && r.scheduled_date <= to && r.planned_type === 'run' && r.planned_intensity !== 'rest');
  // A run with no stored duration (a distance-only long run) makes the plan's
  // minutes unknown: no driver rather than one that understates the plan.
  if (runRows.some((r) => r.planned_duration_min == null)) return null;
  const planned = runRows.reduce((s, r) => s + (r.planned_duration_min ?? 0), 0);
  if (planned <= 0) return null;
  const done = Math.round(activities
    .filter((a) => isRun(a) && typeof a.start_date_local === 'string')
    .filter((a) => a.start_date_local.slice(0, 10) >= from && a.start_date_local.slice(0, 10) <= to)
    .reduce((s, a) => s + (a.moving_time || 0) / 60, 0));
  return { metric: 'Plan this week', value: `${done} of ${planned} planned run min` };
}

// Whether a read names today's planned session (doc 10 2.1.8: plan reference
// in at least 60% of reads on a day with a session). Named = the word plan;
// the session's own minutes or kilometres, in any spelling ("45 min",
// "45-minute", "25.8 kilometres"); or its kind tied to today ("today's
// tempo"). The kind alone is not enough: "tempo work earlier this week".
export function readNamesPlan(voice: string, driver: Driver | null): boolean {
  if (!driver) return false;
  if (/\bplan(?:s|ned|'s)?\b/i.test(voice)) return true;
  const [kind, ...amounts] = driver.value.split(', ');
  for (const a of amounts) {
    const m = /^(\d+(?:\.\d+)?) (min|km)$/.exec(a);
    if (!m) continue;
    const unit = m[2] === 'min' ? 'min(?:ute)?s?' : 'k(?:m|ilomet(?:er|re)s?)';
    if (new RegExp(`(?<![\\d.])${m[1].replace('.', '\\.')}(?:\\s|-)?${unit}\\b`, 'i').test(voice)) return true;
  }
  const k = kind.replace(/_/g, '[ -]?');
  return new RegExp(`\\btoday(?:'s)?\\b[^.]{0,40}\\b${k}\\b|\\b${k}\\b[^.]{0,40}\\btoday\\b`, 'i').test(voice);
}

// The dashboard's Plan Today card (PRD §5.A.3), shown only when the athlete
// has a plan. It states what the plan holds; it never suggests anything.
// `rows` are the active plan's sessions around today (empty: no plan).
export function planTodayCard(rows: StoredWorkout[], today: string): Card | null {
  if (rows.length === 0) return null;
  const w = todaysWorkout(rows, today);
  const base = { id: 'plan_today', title: 'Plan today', available: true, source: 'Your plan' };
  if (!w) return { ...base, value: 'Nothing', translation: 'Nothing on your plan today.' };
  if (w.planned_intensity === 'rest') return { ...base, value: 'Rest', translation: 'Your plan has a rest day today.' };
  const kind = (w.planned_intensity ?? w.planned_type).replace(/_/g, ' ');
  const translation = `On your plan today: ${planDriver(w).value.replace(/_/g, ' ')}.`;
  // The amount is the big number, the kind sits under it; no amount, the kind is the value.
  if (w.planned_duration_min != null) return { ...base, value: String(w.planned_duration_min), unit: 'min', trend: kind, translation };
  if (w.planned_distance_km != null) return { ...base, value: String(Number(w.planned_distance_km)), unit: 'km', trend: kind, translation };
  return { ...base, value: kind[0].toUpperCase() + kind.slice(1), translation };
}

// The morning message's "Today:" line (CLAUDE.md §3.3, Plan and Coach tiers):
// only for a session SCORA built (it has steps), never for a pasted plan,
// which the Free tier reads in the voice instead. Rest days have no line.
export function todayLine(workout: StoredWorkout | null, describe: (intensity: string, steps: any) => string | null): string | null {
  if (!workout || !workout.workout_structure_json || workout.planned_intensity === 'rest') return null;
  const d = describe(workout.planned_intensity ?? workout.planned_type, workout.workout_structure_json);
  return d ? `Today: ${d}` : null;
}
