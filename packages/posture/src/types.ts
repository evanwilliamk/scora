// Posture engine types (doc 07 v1 §8, daily_posture table).
//
// A posture is a high-level read of the body's state for the day. It is NOT a
// workout (CLAUDE.md §3.1): the voice names it, the plan engine may react to
// it, nothing here prescribes a session.

export type Posture = 'primed' | 'steady' | 'moderate' | 'back-off' | 'rest' | 'taper';
export const POSTURES: Posture[] = ['primed', 'steady', 'moderate', 'back-off', 'rest', 'taper'];

// The driver record a posture is computed from. Every field is nullable:
// a user without Oura has no HRV, a new user has no 28-day load, and so on.
// Field names match the daily_posture columns and the pattern driver_rules.
export interface PostureDrivers {
  load_7d?: number | null;
  load_28d?: number | null;
  acwr?: number | null; // load_7d / (load_28d / 4)
  consecutive_hard_days?: number | null;

  sleep_last_night_score?: number | null;
  sleep_7d_avg_delta?: number | null;
  consecutive_low_sleep_nights?: number | null;

  hrv_7d_avg_delta?: number | null;
  rhr_7d_avg_delta?: number | null;

  days_since_long_effort?: number | null;

  race_in_next_7d?: boolean | null;
}

// Per-user sleep score percentiles over the trailing window (doc 07 §8.2 step 5).
export interface UserBaselines {
  sleep_score_p25?: number | null;
  sleep_score_p75?: number | null;
}

export type Comparator = '>' | '>=' | '<' | '<=' | '=';

// One evaluated comparison, kept so reasoning_json can show exactly which
// values drove the posture (auditability, PRD §5.D).
export interface Clause {
  driver: string;
  value: number | boolean | null;
  op: Comparator;
  threshold: number | boolean | null;
  met: boolean;
}

export type RuleId = 'taper' | 'rest' | 'back-off' | 'moderate' | 'primed' | 'default';

export interface RuleTrace {
  rule: RuleId;
  met: boolean;
  clauses: Clause[];
  // The clauses that made this rule fire: for an OR rule, only the branches
  // that completed. Empty when the rule did not fire. The read cites only
  // these (CLAUDE.md §3.2).
  evidence: Clause[];
}

export interface PostureResult {
  posture: Posture;
  rule: RuleId;
  engine_version: string;
  // Every rule evaluated, in order, up to and including the one that fired.
  // Stored as daily_posture.reasoning_json.
  reasoning: RuleTrace[];
}
