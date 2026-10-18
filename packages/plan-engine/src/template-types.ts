// Plan template types (doc 07 v2 §4.2 plan_templates and §4.2.1 structure_json).
//
// Templates are hand-authored by coaches and reviewed before ship (doc 07 v2
// §8.3, 90-day plan §3.2). The engine only reads them; no LLM writes one and
// no agent writes training content (CLAUDE.md §6.1, §6.3).

import type { Intensity } from './types';

export type Sport = 'run' | 'ride' | 'swim' | 'tri';
export const SPORTS: readonly Sport[] = ['run', 'ride', 'swim', 'tri'];

export type ExperienceLevel = 'first_timer' | 'regular' | 'competitive';
export const EXPERIENCE_LEVELS: readonly ExperienceLevel[] = ['first_timer', 'regular', 'competitive'];

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export const WEEKDAYS: readonly Weekday[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

// A weekly_pattern value of 'rest' is a rest day; anything else names a slot.
export const REST_SLOT = 'rest';

// Effort of one step inside a workout.
export type StepIntensity =
  | 'recovery' | 'easy' | 'moderate' | 'steady' | 'tempo' | 'threshold' | 'vo2max' | 'sprint';
export const STEP_INTENSITIES: readonly StepIntensity[] = [
  'recovery', 'easy', 'moderate', 'steady', 'tempo', 'threshold', 'vo2max', 'sprint',
];

// Workout-level intensity a definition maps to (scheduled_workouts.planned_intensity).
export const WORKOUT_INTENSITIES: readonly Intensity[] = [
  'recovery', 'easy', 'moderate', 'endurance', 'steady_state', 'tempo', 'threshold', 'intervals', 'hard', 'long',
];

export type WorkoutStep =
  | { type: 'warmup' | 'steady' | 'cooldown'; duration_min: number; intensity: StepIntensity }
  | {
      type: 'interval';
      reps: number;
      work_duration_min: number;
      work_intensity: StepIntensity;
      rest_duration_min: number;
      rest_intensity: StepIntensity;
    };

export interface WorkoutDefinition {
  intensity: Intensity;
  structure: WorkoutStep[];
  // Derived from structure by the loader; an authored estimate must agree.
  duration_min: number;
}

export interface TemplatePhase {
  name: string;
  weeks: number[];
  focus: string;
}

export interface PlanTemplate {
  slug: string;
  sport: Sport;
  goal_type: string;
  duration_weeks: number;
  experience_level: ExperienceLevel;
  weekly_volume_range_km: [number, number]; // [min, max)
  author: string;
  version: string; // semver; athletes stay pinned to the version they started on
  // 'draft' until a qualified coach signs off (doc 07 v2 §8.3). The loader
  // refuses drafts unless the caller opts in (tests, local review).
  status: 'draft' | 'reviewed';
  reviewed_by: string | null;
  reviewed_on: string | null;
  phases: TemplatePhase[];
  // Per-week load as a percent of the template's base week, one per week.
  // Defaults to 100 for every week.
  week_load_percent: number[];
  weekly_pattern: Record<Weekday, string>;
  workout_types_by_phase: Record<string, Record<string, string[]>>;
  workout_definitions: Record<string, WorkoutDefinition>;
}
