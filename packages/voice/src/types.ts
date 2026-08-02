// Pattern-library types (Pattern Library v0.3 schema, doc 06 §3).
//
// A pattern entry is a curated interpretation: a deterministic firing rule
// (posture + driver_rule) plus the template/tone the LLM renders FROM. The
// library is the moat (CLAUDE.md §0). Nothing here prescribes — entries name a
// pattern; they never emit a workout (CLAUDE.md §1.1).

export type Posture = 'primed' | 'steady' | 'moderate' | 'back-off' | 'rest' | 'taper';
export const POSTURES: Posture[] = ['primed', 'steady', 'moderate', 'back-off', 'rest', 'taper'];

// Where a pattern is allowed to fire. Defaults to ['daily'] when unset (doc 06 §8).
export type Context = 'daily' | 'weekly';
export const CONTEXTS: Context[] = ['daily', 'weekly'];

// Subscription tier. Coach-tier patterns (coach note / message) set tier_filter.
export type Tier = 'free' | 'plan' | 'coach';
export const TIERS: Tier[] = ['free', 'plan', 'coach'];

export interface PatternEntry {
  id: string;
  priority: number;
  posture_filter: Posture[];
  // NEW in v0.3: candidate only when today's scheduled_workout is not null.
  requires_scheduled_workout: boolean;
  // Fires only for these planned intensities (e.g. [hard, threshold, tempo]).
  scheduled_workout_intensity_filter?: string[];
  // Boolean predicate over the driver record. See driver-rule.ts for grammar.
  driver_rule?: string;
  // 0..1 — minimum fraction of expected drivers present for the entry to fire.
  min_data_completeness: number;
  voice_version: string;
  tone_notes?: string;
  llm_hint?: string;
  slot_drivers?: string[];
  // Numeric values that MUST appear in the rendered read (numeric-first, §3.3).
  numeric_slots?: string[];
  template: string;
  // Defaults to ['daily'] at load time.
  context_filter: Context[];
  // Absent = all tiers. Present = only these tiers.
  tier_filter?: Tier[];
  // Suppress if this entry fired within the last N days.
  exclude_if_recently_fired?: number;
}

// A driver value the rule engine can reason about. Strings exist for
// scheduled-workout fields; rule predicates operate on numbers/booleans.
export type DriverValue = number | boolean | string | null | undefined;

// The numeric/boolean driver record a driver_rule is evaluated against
// (acwr, hrv_7d_avg_delta, consecutive_hard_days, race_in_next_7d, ...).
export type DriverRecord = Record<string, DriverValue>;

export interface ScheduledWorkout {
  planned_intensity?: string; // easy | recovery | rest | tempo | threshold | intervals | hard | long
  planned_description?: string;
  planned_distance_km?: number;
  [k: string]: DriverValue;
}

// Everything the matcher needs to pick the firing pattern(s) for one read.
export interface MatchContext {
  posture: Posture;
  drivers: DriverRecord;
  scheduledWorkout?: ScheduledWorkout | null;
  context?: Context; // default 'daily'
  tier?: Tier; // default 'free'
  dataCompleteness?: number; // 0..1, default 1
  // pattern id -> days since it last fired, for exclude_if_recently_fired.
  recentlyFired?: Record<string, number>;
}
