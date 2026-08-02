// @scora/voice — the curated pattern library + deterministic matcher.
//
// The moat (CLAUDE.md §0): a versioned library of interpretations, matched
// deterministically to a driver record, rendered FROM (never invented by) the
// LLM. Interpretation-only — nothing here prescribes a workout (§1.1).
//
// Pipeline (doc 06 §2): posture -> selectPattern -> fillTemplate -> [LLM render]
//                       -> driver-existence + banned-phrase validators (apps/api).
//
// NOT yet wired into the live daily read: firing needs a computed posture and a
// scheduled_workout source, neither of which exists in apps/api today. This
// package is proven standalone (see test/) and exposes MatchContext as the seam
// for when those upstream pieces land.

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
