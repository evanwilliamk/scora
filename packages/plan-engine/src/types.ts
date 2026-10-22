// Plan engine types (doc 07 v2 §4.3 to §4.5: training_plans,
// scheduled_workouts, plan_adaptations).
//
// The plan IS prescriptive, but it is a separate object from the voice
// (CLAUDE.md §1.2). Nothing here is written by an LLM: the engine decides,
// the adaptation-reason prompt only words the decision afterwards.

import type { Posture } from '@scora/posture';

export type { Posture };

// scheduled_workouts.planned_intensity, plus the two downgrade targets the
// adaptation rules produce (doc 07 v2 §6.2).
export type Intensity =
  | 'rest'
  | 'recovery'
  | 'easy'
  | 'moderate'
  | 'endurance'
  | 'steady_state'
  | 'tempo'
  | 'threshold'
  | 'intervals'
  | 'hard'
  | 'long';

export type PlanSource = 'scora_ai' | 'coach' | 'external';

// One row of scheduled_workouts, reduced to what the rules read.
// Dates are calendar dates in the athlete's timezone, 'YYYY-MM-DD'.
export interface PlannedWorkout {
  id: string;
  scheduled_date: string;
  planned_intensity: Intensity;
  planned_duration_min: number | null;
  planned_distance_km?: number | null;
  athlete_completed?: boolean | null;
}

export interface PlanContext {
  source: PlanSource;
  goal_race_date: string | null;
  // Every scheduled workout in the plan week (Monday to Sunday) that holds the
  // workout being evaluated, plus the following Monday's, so a move to Sunday
  // can see a hard session right after it. Rows outside the week count only
  // for that adjacency check, never toward the week's minutes. Rest days may
  // be rows with intensity 'rest' or simply have no row.
  week: PlannedWorkout[];
  // The template's weekly call in minutes for that week. When unknown, the
  // week as currently scheduled is the baseline.
  template_week_minutes?: number | null;
}

export interface AdaptationInput {
  posture: Posture;
  // The workout the adaptation would apply to (doc 07 v2 §6.2: tomorrow's).
  workout: PlannedWorkout;
  plan: PlanContext;
  // The date the engine runs on. Workouts on or before it are not adapted
  // (adaptations are never retroactive, and missed workouts are the
  // athlete's to acknowledge, CLAUDE.md §6.2).
  today: string;
}

// plan_adaptations.reason_code values the engine emits.
export type ReasonCode =
  | 'posture_rest_hard_scheduled'
  // Rest posture, hard session, and no day in the week could take it: the
  // session becomes easy at the same duration (Q19 option B).
  | 'posture_rest_hard_no_window'
  | 'posture_backoff_intervals_scheduled'
  | 'posture_backoff_threshold_scheduled'
  | 'posture_backoff_tempo_scheduled';

// Why the engine evaluated and changed nothing ('evaluated_no_change' in the
// telemetry log, doc 07 v2 §6.2 step 5, with the specific cause).
export type NoChangeCode =
  | 'no_rule_matched'
  | 'race_week_freeze'
  | 'source_not_adaptable'
  | 'workout_not_in_future'
  | 'workout_completed'
  | 'skip_volume_guard'
  | 'skip_no_window';

// Plain values the adaptation-reason prompt may cite. Every number the reason
// text uses must come from here (driver-existence rule, CLAUDE.md §3.2).
export interface AdaptationFacts {
  posture: Posture;
  workout_date: string;
  workout_intensity: Intensity;
  workout_duration_min: number | null;
  week_minutes_before: number;
  week_minutes_after: number;
  template_week_minutes: number;
}

export interface MoveAdaptation {
  type: 'moved';
  workout_id: string;
  from: string;
  to: string;
  // The easy workout that sat in the window, dropped to make room. Null when
  // the window was a rest day.
  displaced_workout_id: string | null;
  reason_code: ReasonCode;
  facts: AdaptationFacts;
}

export interface DowngradeAdaptation {
  type: 'downgraded';
  workout_id: string;
  from_intensity: Intensity;
  to_intensity: Intensity;
  duration_min: number | null; // unchanged: same duration (doc 07 v2 §6.2)
  reason_code: ReasonCode;
  facts: AdaptationFacts;
}

export interface NoAdaptation {
  type: 'none';
  code: NoChangeCode;
  // The rule that would have fired, when a guard stopped it. Logged so
  // frozen and skipped adaptations stay visible in telemetry.
  blocked_rule: ReasonCode | null;
}

export type AdaptationDecision = MoveAdaptation | DowngradeAdaptation | NoAdaptation;
