// @scora/voice — the curated pattern library + deterministic matcher.
//
// The moat (CLAUDE.md §0): a versioned library of interpretations, matched
// deterministically to a driver record, rendered FROM (never invented by) the
// LLM. Interpretation-only — nothing here prescribes a workout (§1.1).
//
// Pipeline (doc 06 §2): posture -> selectPattern -> fillTemplate -> [LLM render]
//                       -> driver-existence + banned-phrase validators (apps/api).
//
// Used by the daily read: apps/api knowledge-retrieval.ts selects a pattern
// from the computed posture and today's planned session when library
// retrieval is off or finds nothing.

export type {
  Posture, Context, Tier, PatternEntry,
  DriverValue, DriverRecord, ScheduledWorkout, MatchContext,
} from './types';
export { POSTURES, CONTEXTS, TIERS } from './types';

export { compileDriverRule, evaluateDriverRule, DriverRuleError } from './driver-rule';
export type { CompiledRule } from './driver-rule';

export { loadPatterns, getPatterns, validateEntry, PatternSchemaError } from './loader';

export { selectPattern, selectPatterns } from './matcher';

export { fillTemplate, templateSlots } from './render';
export type { FilledTemplate } from './render';
