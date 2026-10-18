// Deterministic plan adaptation rules (doc 07 v2 §6.2 and §9, CLAUDE.md §6.2).
//
// Same inputs always give the same decision. The LLM never decides whether
// to adapt; it only words the reason for a decision made here.
//
// Order:
//   1. Guards on the workout itself: only SCORA's own plans adapt (a coach's
//      or an external plan is never changed by the engine), only future,
//      uncompleted workouts.
//   2. Rules: rest + hard session -> move; back-off + intervals/threshold ->
//      steady state; back-off + tempo -> endurance. primed never pushes past
//      the plan; moderate, steady and taper change nothing.
//   3. Guards on the result: race week freezes everything, weekly volume
//      stays within ±10% of the template, long runs keep their distance
//      (a move keeps it; nothing here shortens one).

import {
  DISPLACEABLE_INTENSITIES, HARD_INTENSITIES, RACE_FREEZE_DAYS, WEEKLY_VOLUME_TOLERANCE,
} from './constants';
import { addDays, daysBetween, weekEnd } from './dates';
import type {
  AdaptationDecision, AdaptationFacts, AdaptationInput, Intensity, NoAdaptation, NoChangeCode,
  PlannedWorkout, ReasonCode,
} from './types';

type Rule =
  | { kind: 'move'; reason: ReasonCode }
  | { kind: 'downgrade'; to: Intensity; reason: ReasonCode };

export function matchRule(posture: AdaptationInput['posture'], intensity: Intensity): Rule | null {
  if (posture === 'rest' && HARD_INTENSITIES.includes(intensity)) {
    return { kind: 'move', reason: 'posture_rest_hard_scheduled' };
  }
  if (posture === 'back-off') {
    if (intensity === 'intervals') {
      return { kind: 'downgrade', to: 'steady_state', reason: 'posture_backoff_intervals_scheduled' };
    }
    if (intensity === 'threshold') {
      return { kind: 'downgrade', to: 'steady_state', reason: 'posture_backoff_threshold_scheduled' };
    }
    if (intensity === 'tempo') {
      return { kind: 'downgrade', to: 'endurance', reason: 'posture_backoff_tempo_scheduled' };
    }
  }
  return null;
}

const none = (code: NoChangeCode, blocked_rule: ReasonCode | null = null): NoAdaptation => ({
  type: 'none', code, blocked_rule,
});

const minutes = (w: PlannedWorkout) =>
  w.planned_intensity === 'rest' ? 0 : Math.max(0, w.planned_duration_min ?? 0);

export const weekMinutes = (week: PlannedWorkout[]) => week.reduce((s, w) => s + minutes(w), 0);

const isHard = (w: PlannedWorkout) => HARD_INTENSITIES.includes(w.planned_intensity);

// True when moving changes the week by more than the tolerance allows.
// An adaptation that leaves the week's minutes as they were never trips it,
// even if the week already sat outside the band.
function breaksVolume(before: number, after: number, template: number): boolean {
  if (after === before) return false;
  if (template <= 0) return true;
  return Math.abs(after - template) / template > WEEKLY_VOLUME_TOLERANCE + 1e-9;
}

function inRaceFreeze(date: string, race: string | null): boolean {
  if (!race) return false;
  const d = daysBetween(date, race);
  return d >= 0 && d <= RACE_FREEZE_DAYS;
}

export function evaluateAdaptation(input: AdaptationInput): AdaptationDecision {
  const { posture, workout, plan, today } = input;

  if (plan.source !== 'scora_ai') return none('source_not_adaptable');
  if (daysBetween(today, workout.scheduled_date) <= 0) return none('workout_not_in_future');
  if (workout.athlete_completed) return none('workout_completed');

  const rule = matchRule(posture, workout.planned_intensity);
  if (!rule) return none('no_rule_matched');

  if (inRaceFreeze(workout.scheduled_date, plan.goal_race_date)) {
    return none('race_week_freeze', rule.reason);
  }

  // The evaluated workout counts toward the week even if the caller left it
  // out of plan.week.
  const week = plan.week.some((w) => w.id === workout.id) ? plan.week : [...plan.week, workout];
  const before = weekMinutes(week);
  const template = plan.template_week_minutes ?? before;
  const facts = (after: number): AdaptationFacts => ({
    posture,
    workout_date: workout.scheduled_date,
    workout_intensity: workout.planned_intensity,
    workout_duration_min: workout.planned_duration_min,
    week_minutes_before: before,
    week_minutes_after: after,
    template_week_minutes: template,
  });

  if (rule.kind === 'downgrade') {
    // Same duration, lower intensity: the week's minutes do not change.
    return {
      type: 'downgraded',
      workout_id: workout.id,
      from_intensity: workout.planned_intensity,
      to_intensity: rule.to,
      duration_min: workout.planned_duration_min,
      reason_code: rule.reason,
      facts: facts(before),
    };
  }

  // Move: the next day in the same plan week that is a rest day or holds a
  // single easy session, does not sit next to another hard day (no clustering
  // of hard days), and is clear of race week. The original day becomes rest.
  const others = week.filter((w) => w.id !== workout.id);
  const on = (d: string) => others.filter((w) => w.scheduled_date === d);
  const hardOn = (d: string) => on(d).some(isHard);
  const end = weekEnd(workout.scheduled_date);

  let volumeBlocked = false;
  for (let d = addDays(workout.scheduled_date, 1); daysBetween(d, end) >= 0; d = addDays(d, 1)) {
    if (inRaceFreeze(d, plan.goal_race_date)) break;
    const sessions = on(d).filter((w) => w.planned_intensity !== 'rest');
    if (sessions.length > 1) continue;
    const displaced = sessions[0] ?? null;
    if (displaced && (!DISPLACEABLE_INTENSITIES.includes(displaced.planned_intensity) || displaced.athlete_completed)) {
      continue;
    }
    if (hardOn(addDays(d, -1)) || hardOn(addDays(d, 1))) continue;

    const after = before - (displaced ? minutes(displaced) : 0);
    if (breaksVolume(before, after, template)) {
      volumeBlocked = true;
      continue;
    }
    return {
      type: 'moved',
      workout_id: workout.id,
      from: workout.scheduled_date,
      to: d,
      displaced_workout_id: displaced?.id ?? null,
      reason_code: rule.reason,
      facts: facts(after),
    };
  }
  return none(volumeBlocked ? 'skip_volume_guard' : 'skip_no_window', rule.reason);
}
