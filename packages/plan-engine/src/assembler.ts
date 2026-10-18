// Plan assembler (doc 07 v2 §6.1 steps 2 to 5). Template + dates -> a dated
// calendar of scheduled workouts. Deterministic: every workout and every
// number comes from the template (CLAUDE.md §6.1, §6.3). The LLM writes
// planned_description afterwards from these rows; it adds nothing to them.

import { addDays, daysBetween, parseDate } from './dates';
import { REST_SLOT, WEEKDAYS } from './template-types';
import type { ExperienceLevel, PlanTemplate, Sport, Weekday, WorkoutStep } from './template-types';
import { scaleStructure, structureMinutes, phaseOf, workoutFor } from './template-loader';
import type { Intensity, PlannedWorkout } from './types';

export class AssemblyError extends Error {
  constructor(public code: 'start_not_monday' | 'race_outside_final_week' | 'race_before_start', message: string) {
    super(message);
    this.name = 'AssemblyError';
  }
}

export interface TemplateQuery {
  sport: Sport;
  goal_type: string;
  experience_level: ExperienceLevel;
  current_weekly_km: number;
  duration_weeks?: number;
}

// doc 07 v2 §6.1 step 2. No match returns null: the caller says "template not
// available yet". There is no LLM fallback that invents a plan.
export function matchTemplate(templates: PlanTemplate[], q: TemplateQuery): PlanTemplate | null {
  const hits = templates.filter((t) =>
    t.sport === q.sport
    && t.goal_type === q.goal_type
    && t.experience_level === q.experience_level
    && (q.duration_weeks === undefined || t.duration_weeks === q.duration_weeks)
    && q.current_weekly_km >= t.weekly_volume_range_km[0]
    && q.current_weekly_km < t.weekly_volume_range_km[1]);
  // Deterministic tie-break: highest version, then slug.
  hits.sort((a, b) => compareVersion(b.version, a.version) || a.slug.localeCompare(b.slug));
  return hits[0] ?? null;
}

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export interface AssembledWorkout extends PlannedWorkout {
  week: number;
  weekday: Weekday;
  phase: string;
  slot: string;
  workout_key: string; // template workout_definitions key
  planned_intensity: Intensity;
  planned_duration_min: number;
  structure: WorkoutStep[]; // workout_structure_json, for WorkoutKit
}

export interface AssembledPlan {
  template_slug: string;
  template_version: string;
  start_date: string;
  end_date: string;
  goal_race_date: string | null;
  // Planned minutes per week as assembled: the template call, less anything
  // dropped on or after race day (the adaptation engine's
  // template_week_minutes).
  week_minutes: number[];
  workouts: AssembledWorkout[];
}

export interface AssembleInput {
  template: PlanTemplate;
  start_date: string; // Monday of week 1
  goal_race_date?: string | null;
}

// The Monday that makes the race fall in the template's final week.
export function startDateForRace(template: PlanTemplate, race: string): string {
  const dow = (new Date(parseDate(race)).getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(race, -dow - 7 * (template.duration_weeks - 1));
}

export function assemblePlan({ template: t, start_date, goal_race_date = null }: AssembleInput): AssembledPlan {
  if (new Date(parseDate(start_date)).getUTCDay() !== 1) {
    throw new AssemblyError('start_not_monday', `start_date ${start_date} is not a Monday`);
  }
  const end_date = addDays(start_date, 7 * t.duration_weeks - 1);
  if (goal_race_date) {
    if (daysBetween(start_date, goal_race_date) < 0) {
      throw new AssemblyError('race_before_start', `race ${goal_race_date} is before the plan starts (${start_date})`);
    }
    const finalWeekStart = addDays(end_date, -6);
    if (daysBetween(finalWeekStart, goal_race_date) < 0 || daysBetween(goal_race_date, end_date) < 0) {
      throw new AssemblyError(
        'race_outside_final_week',
        `race ${goal_race_date} must fall in week ${t.duration_weeks} (${finalWeekStart} to ${end_date})`,
      );
    }
  }

  const workouts: AssembledWorkout[] = [];
  for (let week = 1; week <= t.duration_weeks; week++) {
    const { phase } = phaseOf(t, week);
    const percent = t.week_load_percent[week - 1];
    WEEKDAYS.forEach((weekday, i) => {
      const slot = t.weekly_pattern[weekday];
      if (slot === REST_SLOT) return;
      const date = addDays(start_date, 7 * (week - 1) + i);
      // The race is the session that day; nothing is scheduled on or after it.
      if (goal_race_date && daysBetween(goal_race_date, date) >= 0) return;
      const key = workoutFor(t, week, slot);
      const def = t.workout_definitions[key];
      const structure = scaleStructure(def.structure, percent);
      workouts.push({
        id: `${t.slug}@${t.version}:w${week}:${weekday}`,
        scheduled_date: date,
        week,
        weekday,
        phase: phase.name,
        slot,
        workout_key: key,
        planned_intensity: def.intensity,
        planned_duration_min: structureMinutes(structure),
        structure,
      });
    });
  }

  return {
    template_slug: t.slug,
    template_version: t.version,
    start_date,
    end_date,
    goal_race_date,
    week_minutes: Array.from({ length: t.duration_weeks }, (_, i) =>
      workouts.filter((w) => w.week === i + 1).reduce((sum, w) => sum + w.planned_duration_min, 0)),
    workouts,
  };
}
