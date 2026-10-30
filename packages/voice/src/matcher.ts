// Deterministic pattern matcher (doc 06 §2 pipeline: posture -> pattern match).
//
// Given a MatchContext (posture + driver record + optional scheduled workout),
// returns the curated pattern(s) whose gates all pass, ranked by priority. The
// selection is fully deterministic — no LLM decides which pattern fires
// (CLAUDE.md §6.3). The chosen entry's template/tone is what the render step
// feeds the LLM to interpret FROM.

import { compileDriverRule } from './driver-rule';
import type { PatternEntry, MatchContext } from './types';

// Compiled driver_rule cache keyed by source, so repeated matches don't reparse.
const _ruleCache = new Map<string, ReturnType<typeof compileDriverRule>>();
function rule(src: string) {
  let c = _ruleCache.get(src);
  if (!c) { c = compileDriverRule(src); _ruleCache.set(src, c); }
  return c;
}

// The driver(s) each numeric slot is filled from; any one present backs it.
// A slot not listed here is filled from the driver of the same name. Some
// slots have no exact driver in the record yet (days to race, sleep as
// hours:minutes, long distance), so the closest recorded driver stands in:
// without it there is certainly nothing to fill the slot with. Sleep hours
// come from sleep_last_night_seconds (the duration itself), so a HealthKit-only
// athlete with sleep hours but no Oura score still backs the slot.
export const NUMERIC_SLOT_SOURCES: Record<string, string[]> = {
  hrv_pct_change: ['hrv_7d_avg_delta'],
  days_to_race: ['race_in_next_7d'],
  sleep_hours_minutes: ['sleep_last_night_seconds', 'sleep_last_night_score', 'sleep_7d_avg_delta'],
  long_distance_km: ['days_since_long_effort'],
};

// Numeric-first (CLAUDE.md §3.3): a pattern whose numbers have no driver
// cannot be rendered honestly, so it does not fire.
function numericSlotsBacked(entry: PatternEntry, ctx: MatchContext): boolean {
  for (const slot of entry.numeric_slots ?? []) {
    const sources = NUMERIC_SLOT_SOURCES[slot] ?? [slot];
    const present = sources.some((k) => {
      const v = (ctx.drivers as Record<string, unknown>)[k];
      return v !== null && v !== undefined && v !== false;
    });
    if (!present) return false;
  }
  return true;
}

function passes(entry: PatternEntry, ctx: MatchContext): boolean {
  const context = ctx.context ?? 'daily';
  const tier = ctx.tier ?? 'free';
  const completeness = ctx.dataCompleteness ?? 1;

  if (!entry.posture_filter.includes(ctx.posture)) return false;
  if (!entry.context_filter.includes(context)) return false;
  if (entry.tier_filter && !entry.tier_filter.includes(tier)) return false;

  if (entry.requires_scheduled_workout && !ctx.scheduledWorkout) return false;
  if (entry.scheduled_workout_intensity_filter) {
    const intensity = ctx.scheduledWorkout?.planned_intensity;
    if (!intensity || !entry.scheduled_workout_intensity_filter.includes(intensity)) return false;
  }

  if (completeness < entry.min_data_completeness) return false;

  if (entry.exclude_if_recently_fired && ctx.recentlyFired) {
    const since = ctx.recentlyFired[entry.id];
    if (since != null && since < entry.exclude_if_recently_fired) return false;
  }

  // driver_rule is evaluated over the numeric/boolean driver record.
  if (entry.driver_rule && !rule(entry.driver_rule).evaluate(ctx.drivers)) return false;

  if (!numericSlotsBacked(entry, ctx)) return false;

  return true;
}

// All patterns that fire for this context, highest priority first. Multiple can
// fire (e.g. a posture pattern alongside a plan-vs-body pattern, doc 06 §5) —
// the render prompt can weave several into one 2-4 sentence read.
export function selectPatterns(ctx: MatchContext, entries: PatternEntry[]): PatternEntry[] {
  return entries
    .filter((e) => passes(e, ctx))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

// The single highest-priority firing pattern, or null if none fire.
export function selectPattern(ctx: MatchContext, entries: PatternEntry[]): PatternEntry | null {
  let best: PatternEntry | null = null;
  for (const e of entries) {
    if (!passes(e, ctx)) continue;
    if (!best || e.priority > best.priority
      || (e.priority === best.priority && e.id.localeCompare(best.id) < 0)) {
      best = e;
    }
  }
  return best;
}
