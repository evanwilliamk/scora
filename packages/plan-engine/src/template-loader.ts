// Plan template loader. Reads *.yaml under a template directory, validates each
// against the template schema (doc 07 v2 §4.2.1) and the plan-level bans in
// CLAUDE.md §4.3, so a bad template fails at boot with a named error, never
// while an athlete's plan is being built. Same discipline as the voice
// pattern loader (packages/voice/src/loader.ts).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  EXPERIENCE_LEVELS, REST_SLOT, SPORTS, STEP_INTENSITIES, WEEKDAYS, WORKOUT_INTENSITIES,
} from './template-types';
import type {
  ExperienceLevel, PlanTemplate, Sport, StepIntensity, TemplatePhase, Weekday, WorkoutDefinition, WorkoutStep,
} from './template-types';
import type { Intensity } from './types';

export type TemplateErrorCode =
  | 'not_mapping'
  | 'missing_field'
  | 'bad_value'
  | 'phase_weeks'
  | 'pattern_day'
  | 'slot_unmapped'
  | 'unknown_workout'
  | 'bad_step'
  | 'duration_mismatch'
  | 'load_percent'
  | 'volume_jump'
  | 'unreviewed'
  | 'duplicate_slug';

export class TemplateError extends Error {
  constructor(public code: TemplateErrorCode, message: string, public file: string) {
    super(`template ${file}: [${code}] ${message}`);
    this.name = 'TemplateError';
  }
}

// CLAUDE.md §4.3: weekly volume never jumps more than 10%. Measured against
// the highest earlier week, so a cutback week can return to where it was.
export const MAX_WEEKLY_INCREASE = 0.1;
// An authored total_duration_est_min may round, but not disagree.
export const DURATION_ESTIMATE_TOLERANCE_MIN = 5;
const LOAD_PERCENT_RANGE: [number, number] = [40, 150];

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

export interface ValidateOptions {
  allowDrafts?: boolean;
}

export function stepMinutes(s: WorkoutStep): number {
  return s.type === 'interval'
    ? s.reps * s.work_duration_min + (s.reps - 1) * s.rest_duration_min
    : s.duration_min;
}

export function validateTemplate(raw: unknown, file: string, opts: ValidateOptions = {}): PlanTemplate {
  const fail = (code: TemplateErrorCode, msg: string): never => {
    throw new TemplateError(code, msg, file);
  };
  const str = (o: Record<string, unknown>, k: string): string => (isStr(o[k]) ? (o[k] as string).trim() : fail('missing_field', `"${k}" is required`));
  const oneOf = <T extends string>(o: Record<string, unknown>, k: string, allowed: readonly T[]): T => {
    const v = str(o, k);
    if (!allowed.includes(v as T)) fail('bad_value', `"${k}" is "${v}" (allowed: ${allowed.join(', ')})`);
    return v as T;
  };
  const posNum = (v: unknown, where: string): number =>
    isNum(v) && v > 0 ? v : fail('bad_step', `${where} must be a positive number`);
  const stepIntensity = (v: unknown, where: string): StepIntensity =>
    STEP_INTENSITIES.includes(v as StepIntensity)
      ? (v as StepIntensity)
      : fail('bad_step', `${where} is "${String(v)}" (allowed: ${STEP_INTENSITIES.join(', ')})`);

  if (!isObj(raw)) fail('not_mapping', 'template must be a YAML mapping');
  const o = raw as Record<string, unknown>;

  const slug = str(o, 'slug');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail('bad_value', `"slug" must be kebab-case, got "${slug}"`);
  const sport = oneOf<Sport>(o, 'sport', SPORTS);
  const goal_type = str(o, 'goal_type');
  const experience_level = oneOf<ExperienceLevel>(o, 'experience_level', EXPERIENCE_LEVELS);
  const author = str(o, 'author');
  const version = str(o, 'version');
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('bad_value', `"version" must be semver (1.0.0), got "${version}"`);

  if (!isPosInt(o.duration_weeks) || (o.duration_weeks as number) > 52) {
    fail('bad_value', '"duration_weeks" must be a whole number from 1 to 52');
  }
  const duration_weeks = o.duration_weeks as number;

  const range = o.weekly_volume_range_km;
  if (!Array.isArray(range) || range.length !== 2 || !range.every((n) => isNum(n) && n >= 0) || range[0] >= range[1]) {
    fail('bad_value', '"weekly_volume_range_km" must be [min, max] with 0 <= min < max');
  }

  const status = o.status === undefined ? 'draft' : oneOf(o, 'status', ['draft', 'reviewed'] as const);
  const reviewed_by = isStr(o.reviewed_by) ? (o.reviewed_by as string).trim() : null;
  const reviewed_on = isStr(o.reviewed_on) ? String(o.reviewed_on).trim() : null;
  if (status === 'reviewed' && (!reviewed_by || !reviewed_on)) {
    fail('unreviewed', '"status: reviewed" needs "reviewed_by" and "reviewed_on"');
  }
  if (status === 'draft' && !opts.allowDrafts) {
    fail('unreviewed', 'draft templates do not load until a coach signs off (doc 07 v2 §8.3)');
  }

  // Phases cover weeks 1..N, each exactly once, in order.
  if (!Array.isArray(o.phases) || o.phases.length === 0) fail('missing_field', '"phases" must be a non-empty list');
  const phases: TemplatePhase[] = (o.phases as unknown[]).map((p, i) => {
    if (!isObj(p)) return fail('not_mapping', `phases[${i}] must be a mapping`);
    const weeks = p.weeks;
    if (!Array.isArray(weeks) || weeks.length === 0 || !weeks.every(isPosInt)) {
      fail('phase_weeks', `phases[${i}].weeks must be a non-empty list of week numbers`);
    }
    return { name: str(p, 'name'), weeks: weeks as number[], focus: str(p, 'focus') };
  });
  const names = phases.map((p) => p.name);
  if (new Set(names).size !== names.length) fail('phase_weeks', 'phase names must be unique');
  const allWeeks = phases.flatMap((p) => p.weeks);
  const expected = Array.from({ length: duration_weeks }, (_, i) => i + 1);
  if (allWeeks.join(',') !== expected.join(',')) {
    fail('phase_weeks', `phases must cover weeks 1 to ${duration_weeks} once each, in order (got ${allWeeks.join(', ')})`);
  }

  // Load percent per week, and the 10% weekly increase ban.
  let week_load_percent: number[];
  if (o.week_load_percent === undefined) {
    week_load_percent = expected.map(() => 100);
  } else {
    const w = o.week_load_percent;
    if (!Array.isArray(w) || w.length !== duration_weeks || !w.every(isNum)) {
      return fail('load_percent', `"week_load_percent" must list ${duration_weeks} numbers, one per week`);
    }
    for (const [i, v] of w.entries()) {
      if (v < LOAD_PERCENT_RANGE[0] || v > LOAD_PERCENT_RANGE[1]) {
        fail('load_percent', `week ${i + 1} load ${v}% is outside ${LOAD_PERCENT_RANGE[0]} to ${LOAD_PERCENT_RANGE[1]}`);
      }
    }
    week_load_percent = w as number[];
  }

  // Workout definitions. Duration comes from the structure.
  if (!isObj(o.workout_definitions) || Object.keys(o.workout_definitions).length === 0) {
    fail('missing_field', '"workout_definitions" must be a non-empty mapping');
  }
  const workout_definitions: Record<string, WorkoutDefinition> = {};
  for (const [id, d] of Object.entries(o.workout_definitions as Record<string, unknown>)) {
    if (!isObj(d)) fail('not_mapping', `workout "${id}" must be a mapping`);
    const def = d as Record<string, unknown>;
    const intensity = def.intensity as Intensity;
    if (!WORKOUT_INTENSITIES.includes(intensity)) {
      fail('bad_value', `workout "${id}" intensity is "${String(def.intensity)}" (allowed: ${WORKOUT_INTENSITIES.join(', ')})`);
    }
    if (!Array.isArray(def.structure) || def.structure.length === 0) {
      fail('bad_step', `workout "${id}" needs a non-empty structure`);
    }
    const structure: WorkoutStep[] = (def.structure as unknown[]).map((s, i) => {
      const at = `workout "${id}" step ${i + 1}`;
      if (!isObj(s)) return fail('bad_step', `${at} must be a mapping`);
      if (s.type === 'interval') {
        if (!isPosInt(s.reps)) fail('bad_step', `${at} reps must be a whole number of at least 1`);
        const rest = s.reps === 1 && s.rest_duration_min === undefined ? 0 : s.rest_duration_min;
        return {
          type: 'interval',
          reps: s.reps as number,
          work_duration_min: posNum(s.work_duration_min, `${at} work_duration_min`),
          work_intensity: stepIntensity(s.work_intensity, `${at} work_intensity`),
          rest_duration_min: rest === 0 ? 0 : posNum(rest, `${at} rest_duration_min`),
          rest_intensity: stepIntensity(s.rest_intensity ?? 'easy', `${at} rest_intensity`),
        };
      }
      if (s.type === 'warmup' || s.type === 'steady' || s.type === 'cooldown') {
        return {
          type: s.type,
          duration_min: posNum(s.duration_min, `${at} duration_min`),
          intensity: stepIntensity(s.intensity, `${at} intensity`),
        };
      }
      return fail('bad_step', `${at} type is "${String(s.type)}" (allowed: warmup, steady, interval, cooldown)`);
    });
    const duration_min = structure.reduce((t, s) => t + stepMinutes(s), 0);
    if (def.total_duration_est_min !== undefined) {
      const est = def.total_duration_est_min;
      if (!isNum(est) || Math.abs(est - duration_min) > DURATION_ESTIMATE_TOLERANCE_MIN) {
        fail('duration_mismatch', `workout "${id}" says ${String(est)} min but its structure adds up to ${duration_min}`);
      }
    }
    workout_definitions[id] = { intensity, structure, duration_min };
  }

  // Weekly pattern: all seven days, each a rest day or a slot.
  if (!isObj(o.weekly_pattern)) fail('missing_field', '"weekly_pattern" must be a mapping of weekdays');
  const wp = o.weekly_pattern as Record<string, unknown>;
  for (const k of Object.keys(wp)) {
    if (!WEEKDAYS.includes(k as Weekday)) fail('pattern_day', `weekly_pattern has unknown day "${k}"`);
  }
  const weekly_pattern = {} as Record<Weekday, string>;
  for (const day of WEEKDAYS) {
    if (!isStr(wp[day])) fail('pattern_day', `weekly_pattern.${day} is required (use "${REST_SLOT}" for a rest day)`);
    weekly_pattern[day] = (wp[day] as string).trim();
  }
  const slots = [...new Set(Object.values(weekly_pattern).filter((s) => s !== REST_SLOT))];

  // Every slot is filled in every phase, only with defined workouts.
  if (!isObj(o.workout_types_by_phase)) fail('missing_field', '"workout_types_by_phase" must be a mapping');
  const byPhase = o.workout_types_by_phase as Record<string, unknown>;
  for (const k of Object.keys(byPhase)) {
    if (!names.includes(k)) fail('slot_unmapped', `workout_types_by_phase has unknown phase "${k}"`);
  }
  const workout_types_by_phase: Record<string, Record<string, string[]>> = {};
  for (const phase of names) {
    const m = byPhase[phase];
    if (!isObj(m)) return fail('slot_unmapped', `workout_types_by_phase.${phase} is missing`);
    workout_types_by_phase[phase] = {};
    for (const slot of slots) {
      const list = m[slot];
      if (!Array.isArray(list) || list.length === 0 || !list.every(isStr)) {
        fail('slot_unmapped', `slot "${slot}" has no workouts in phase "${phase}"`);
      }
      for (const id of list as string[]) {
        if (!workout_definitions[id]) fail('unknown_workout', `phase "${phase}" slot "${slot}" names undefined workout "${id}"`);
      }
      workout_types_by_phase[phase][slot] = list as string[];
    }
  }

  const template: PlanTemplate = {
    slug, sport, goal_type, duration_weeks, experience_level,
    weekly_volume_range_km: [(range as number[])[0], (range as number[])[1]],
    author, version, status, reviewed_by, reviewed_on,
    phases, week_load_percent, weekly_pattern, workout_types_by_phase, workout_definitions,
  };

  // CLAUDE.md §4.3 against the weeks as the template actually builds them.
  const totals = templateWeekMinutes(template);
  let peak = totals[0];
  for (let i = 1; i < totals.length; i++) {
    if (totals[i] > peak * (1 + MAX_WEEKLY_INCREASE) + 1e-9) {
      fail('volume_jump', `week ${i + 1} is ${totals[i]} min, more than 10% over the highest earlier week (${peak} min)`);
    }
    peak = Math.max(peak, totals[i]);
  }
  return template;
}

// Which phase a week belongs to, and its 1-based position in that phase.
export function phaseOf(t: PlanTemplate, week: number): { phase: TemplatePhase; weekInPhase: number } {
  const phase = t.phases.find((p) => p.weeks.includes(week));
  if (!phase) throw new RangeError(`week ${week} is outside ${t.slug} (1 to ${t.duration_weeks})`);
  return { phase, weekInPhase: phase.weeks.indexOf(week) + 1 };
}

// The workout a slot holds in a given week: each phase cycles its list in order.
export function workoutFor(t: PlanTemplate, week: number, slot: string): string {
  const { phase, weekInPhase } = phaseOf(t, week);
  const list = t.workout_types_by_phase[phase.name][slot];
  return list[(weekInPhase - 1) % list.length];
}

// Minutes the template calls for in each week, before any athlete scaling.
// Load percent scales a week's total; the assembler applies it the same way.
export function templateWeekMinutes(t: PlanTemplate): number[] {
  return Array.from({ length: t.duration_weeks }, (_, i) => {
    const week = i + 1;
    const base = WEEKDAYS.reduce((sum, day) => {
      const slot = t.weekly_pattern[day];
      return slot === REST_SLOT ? sum : sum + t.workout_definitions[workoutFor(t, week, slot)].duration_min;
    }, 0);
    return Math.round((base * t.week_load_percent[i]) / 100);
  });
}

// Load every *.yaml under dir (recursively). Slugs must be unique.
export function loadTemplates(dir: string, opts: ValidateOptions = {}): PlanTemplate[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.yaml') || name.endsWith('.yml')) files.push(p);
    }
  };
  walk(dir);
  const seen = new Map<string, string>();
  return files.map((p) => {
    const file = relative(dir, p);
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(p, 'utf8'));
    } catch (e) {
      throw new TemplateError('not_mapping', `YAML does not parse: ${(e as Error).message}`, file);
    }
    const t = validateTemplate(raw, file, opts);
    const prior = seen.get(t.slug);
    if (prior) throw new TemplateError('duplicate_slug', `slug "${t.slug}" is also used by ${prior}`, file);
    seen.set(t.slug, file);
    return t;
  });
}
