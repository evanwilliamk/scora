// Plan-aware daily read (PRD 5.A.6, CLAUDE.md §1.3).
//
// The read may name today's planned session; it never creates, moves or
// skips one. Today's session becomes (a) the scheduled workout the pattern
// matcher and retrieval see and (b) one driver, so its numbers pass the
// driver-existence validator when the voice mentions them.

import type { StoredWorkout } from './plan-store';
import type { Card, Driver } from './metrics';
import { toScheduledWorkout } from './plan-parse';
import { distanceUnit, formatPlanDistance, planDistanceValue } from './units';

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

// "tempo, 45 min" / "long, 13.1 mi" / "rest". Only stored values; a distance
// is the stored km in the athlete's unit (units.ts).
export function planDriver(w: StoredWorkout): Driver {
  // In words: the voice and the fallback quote this value as is.
  const parts: string[] = [(w.planned_intensity ?? w.planned_type).replace(/_/g, ' ')];
  if (w.planned_duration_min != null) parts.push(`${w.planned_duration_min} min`);
  if (w.planned_distance_km != null) parts.push(formatPlanDistance(w.planned_distance_km));
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

// Whether a read names today's planned session (doc 10 2.1.8: plan reference
// in at least 60% of reads on a day with a session). Named = the word plan;
// the session's own minutes, miles or kilometres, in any spelling ("45 min",
// "45-minute", "13.1 miles", "25.8 kilometres"); or its kind tied to today ("today's
// tempo"). The kind alone is not enough: "tempo work earlier this week".
export function readNamesPlan(voice: string, driver: Driver | null): boolean {
  if (!driver) return false;
  if (/\bplan(?:s|ned|'s)?\b/i.test(voice)) return true;
  const [kind, ...amounts] = driver.value.split(', ');
  for (const a of amounts) {
    const m = /^(\d+(?:\.\d+)?) (min|mi|km)$/.exec(a);
    if (!m) continue;
    const unit = m[2] === 'min' ? 'min(?:ute)?s?' : m[2] === 'mi' ? 'mi(?:les?)?' : 'k(?:m|ilomet(?:er|re)s?)';
    if (new RegExp(`(?<![\\d.])${m[1].replace('.', '\\.')}(?:\\s|-)?${unit}\\b`, 'i').test(voice)) return true;
  }
  const k = kind.replace(/[_ ]/g, '[ -]?');
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
  if (w.planned_distance_km != null) return { ...base, value: String(planDistanceValue(w.planned_distance_km)), unit: distanceUnit(), trend: kind, translation };
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
