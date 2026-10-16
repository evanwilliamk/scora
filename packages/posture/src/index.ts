// @scora/posture: deterministic daily posture (doc 07 v1 §8.3).
//
// Pipeline (doc 06 §2): drivers -> computePosture -> @scora/voice selectPattern
// -> LLM render -> validators. No LLM decides the posture.
//
// NOT yet wired into apps/api: the daily read still lets the LLM name a posture
// from raw data. Wiring needs the driver record (load, sleep, HRV deltas)
// computed per user, which is the next step.

export type {
  Posture, PostureDrivers, UserBaselines, PostureResult, RuleTrace, RuleId, Clause, Comparator,
} from './types';
export { POSTURES } from './types';
export { POSTURE_ENGINE_VERSION, T as POSTURE_THRESHOLDS } from './constants';
export { computePosture } from './engine';
