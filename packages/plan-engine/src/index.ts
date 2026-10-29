// @scora/plan-engine: deterministic plan adaptation (doc 07 v2 §6.2, §9).
//
// Pipeline (doc 07 v2 §6.2): daily posture + tomorrow's scheduled workout ->
// evaluateAdaptation -> (API) plan_adaptations row + scheduled_workouts update
// -> adaptation-reason prompt words the decision. No LLM decides it.
//
// NOT yet wired into apps/api: there is no training_plans table and no plan
// generation yet. Template loader and assembler come next.

export type {
  AdaptationDecision, AdaptationFacts, AdaptationInput, DowngradeAdaptation, Intensity, MoveAdaptation,
  NoAdaptation, NoChangeCode, PlanContext, PlannedWorkout, PlanSource, Posture, ReasonCode,
} from './types';
export {
  ADAPTATION_ENGINE_VERSION, DISPLACEABLE_INTENSITIES, HARD_INTENSITIES, RACE_FREEZE_DAYS,
  WEEKLY_VOLUME_TOLERANCE,
} from './constants';
export { evaluateAdaptation, matchRule, weekMinutes } from './adaptation-rules';

export type {
  ExperienceLevel, PlanTemplate, Sport, StepIntensity, TemplatePhase, Weekday, WorkoutDefinition, WorkoutStep,
} from './template-types';
export { EXPERIENCE_LEVELS, REST_SLOT, SPORTS, STEP_INTENSITIES, WEEKDAYS } from './template-types';
export type { TemplateErrorCode, ValidateOptions } from './template-loader';
export {
  DURATION_ESTIMATE_TOLERANCE_MIN, MAX_WEEKLY_INCREASE, TemplateError, loadTemplates, phaseOf, scaleStructure,
  stepMinutes, structureMinutes, templateWeekMinutes, validateTemplate, workoutFor,
} from './template-loader';

export type { AssembleInput, AssembledPlan, AssembledWorkout, TemplateQuery } from './assembler';
export { AssemblyError, assemblePlan, matchTemplate, startDateForRace } from './assembler';

import { fileURLToPath } from 'node:url';

// The template library folder (packages/plan-templates).
export const TEMPLATE_DIR = fileURLToPath(new URL('../../plan-templates/', import.meta.url));

export { describeWorkout, spokenDuration } from './describe';
