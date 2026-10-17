// Plan-aware daily read (PRD 5.A.6, CLAUDE.md §1.3).
//
// The read may name today's planned session; it never creates, moves or
// skips one. Today's session becomes (a) the scheduled workout the pattern
// matcher and retrieval see and (b) one driver, so its numbers pass the
// driver-existence validator when the voice mentions them.

import type { StoredWorkout } from './plan-store';
import type { Driver } from './metrics';
import { toScheduledWorkout } from './plan-parse';

// When a day has more than one session, the read keys off the hardest.
const WEIGHT: Record<string, number> = {
  long: 8, intervals: 7, threshold: 6, hard: 6, tempo: 5, moderate: 4, easy: 3, recovery: 2, rest: 1,
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
    promptLine: `PLAN TODAY (the athlete's own plan; you may name it, never change, move or add to it): ${driver.value}${
      workout.planned_description ? ` ("${workout.planned_description.slice(0, 160)}")` : ''
    }`,
  };
}
