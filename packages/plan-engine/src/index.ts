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
