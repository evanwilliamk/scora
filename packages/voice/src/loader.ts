// Pattern-library loader. Reads patterns/*.yaml, validates each entry against
// the v0.3 schema (doc 06 §3), and compiles its driver_rule so a bad rule fails
// at boot, not at render time. Same discipline as packages/voice/patterns in
// CLAUDE.md §9 — versioned, reviewed, tested.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { compileDriverRule, DriverRuleError } from './driver-rule';
import {
  PatternEntry, Posture, Context, Tier, POSTURES, CONTEXTS, TIERS,
} from './types';

export class PatternSchemaError extends Error {
  constructor(message: string, public file: string) {
    super(`pattern ${file}: ${message}`);
    this.name = 'PatternSchemaError';
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function strArray(v: unknown, field: string, file: string, allowed?: readonly string[]): string[] {
  if (!Array.isArray(v) || v.length === 0 || !v.every(isStr)) {
    throw new PatternSchemaError(`"${field}" must be a non-empty array of strings`, file);
  }
  if (allowed) {
    for (const item of v) {
      if (!allowed.includes(item)) {
        throw new PatternSchemaError(`"${field}" has unknown value "${item}" (allowed: ${allowed.join(', ')})`, file);
      }
    }
  }
  return v as string[];
}

// Validate one parsed YAML object into a typed PatternEntry, applying defaults.
export function validateEntry(raw: unknown, file: string): PatternEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PatternSchemaError('entry must be a YAML mapping', file);
  }
  const o = raw as Record<string, unknown>;

  if (!isStr(o.id)) throw new PatternSchemaError('"id" is required', file);
  if (!isNum(o.priority)) throw new PatternSchemaError('"priority" must be a number', file);
  if (!isStr(o.template)) throw new PatternSchemaError('"template" is required', file);

  const posture_filter = strArray(o.posture_filter, 'posture_filter', file, POSTURES) as Posture[];

  const requires_scheduled_workout =
    o.requires_scheduled_workout === undefined ? false : o.requires_scheduled_workout;
  if (typeof requires_scheduled_workout !== 'boolean') {
    throw new PatternSchemaError('"requires_scheduled_workout" must be a boolean', file);
  }

  const min_data_completeness = o.min_data_completeness === undefined ? 0 : o.min_data_completeness;
  if (!isNum(min_data_completeness) || min_data_completeness < 0 || min_data_completeness > 1) {
    throw new PatternSchemaError('"min_data_completeness" must be a number in [0,1]', file);
  }

  // driver_rule is optional, but if present it must compile.
  let driver_rule: string | undefined;
  if (o.driver_rule !== undefined) {
    if (!isStr(o.driver_rule)) throw new PatternSchemaError('"driver_rule" must be a string', file);
    driver_rule = o.driver_rule.trim();
    try {
      compileDriverRule(driver_rule);
    } catch (e) {
      const why = e instanceof DriverRuleError ? e.message : String(e);
      throw new PatternSchemaError(`invalid driver_rule — ${why}`, file);
    }
  }

  const context_filter = (o.context_filter === undefined
    ? ['daily']
    : strArray(o.context_filter, 'context_filter', file, CONTEXTS)) as Context[];

  const tier_filter = o.tier_filter === undefined
    ? undefined
    : (strArray(o.tier_filter, 'tier_filter', file, TIERS) as Tier[]);

  const scheduled_workout_intensity_filter = o.scheduled_workout_intensity_filter === undefined
    ? undefined
    : strArray(o.scheduled_workout_intensity_filter, 'scheduled_workout_intensity_filter', file);

  const slot_drivers = o.slot_drivers === undefined
    ? undefined
    : strArray(o.slot_drivers, 'slot_drivers', file);
  const numeric_slots = o.numeric_slots === undefined
    ? undefined
    : strArray(o.numeric_slots, 'numeric_slots', file);

  if (o.exclude_if_recently_fired !== undefined
    && (!isNum(o.exclude_if_recently_fired) || o.exclude_if_recently_fired < 0)) {
    throw new PatternSchemaError('"exclude_if_recently_fired" must be a non-negative number', file);
  }

  return {
    id: o.id,
    priority: o.priority,
    posture_filter,
    requires_scheduled_workout,
    scheduled_workout_intensity_filter,
    driver_rule,
    min_data_completeness,
    voice_version: isStr(o.voice_version) ? o.voice_version : 'v0.3.0',
    tone_notes: isStr(o.tone_notes) ? o.tone_notes : undefined,
    llm_hint: isStr(o.llm_hint) ? o.llm_hint : undefined,
    slot_drivers,
    numeric_slots,
    template: o.template,
    context_filter,
    tier_filter,
    exclude_if_recently_fired: isNum(o.exclude_if_recently_fired) ? o.exclude_if_recently_fired : undefined,
  };
}

function defaultPatternsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'patterns');
}

// Load + validate every pattern in a directory. Throws on the first malformed
// entry or on any duplicate id. Returns entries sorted by descending priority.
export function loadPatterns(dir: string = defaultPatternsDir()): PatternEntry[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
  const entries: PatternEntry[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch (e) {
      throw new PatternSchemaError(`invalid YAML — ${e instanceof Error ? e.message : String(e)}`, file);
    }
    const entry = validateEntry(parsed, file);
    const prior = seen.get(entry.id);
    if (prior) throw new PatternSchemaError(`duplicate id "${entry.id}" (also in ${prior})`, file);
    seen.set(entry.id, file);
    entries.push(entry);
  }

  return entries.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

let _cache: PatternEntry[] | null = null;
// Cached load of the built-in library (the patterns/ dir shipped in this package).
export function getPatterns(): PatternEntry[] {
  if (!_cache) _cache = loadPatterns();
  return _cache;
}
