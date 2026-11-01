import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDriverRule, evaluateDriverRule, DriverRuleError } from '../src/driver-rule';
import { validateEntry, PatternSchemaError } from '../src/loader';
import { selectPattern, selectPatterns } from '../src/matcher';
import type { PatternEntry, MatchContext } from '../src/types';

// ---- driver_rule: parse errors and edge evaluation ----------------------

test('driver_rule rejects characters outside the grammar', () => {
  for (const bad of ['acwr > 1 & hrv < 0', 'acwr ! 1', 'acwr > 1;', 'name = "x"', 'acwr > 1.']) {
    assert.throws(() => compileDriverRule(bad), DriverRuleError, bad);
  }
});

test('driver_rule rejects an unclosed paren and a stray IS', () => {
  assert.throws(() => compileDriverRule('(acwr > 1'), /expected rparen/);
  assert.throws(() => compileDriverRule('acwr IS 3'), /expected null/);
  assert.throws(() => compileDriverRule('acwr IS NOT'), /expected null/);
  assert.throws(() => compileDriverRule('acwr >'), /unexpected end/);
  assert.throws(() => compileDriverRule('acwr 1'), /trailing token/);
});

test('driver_rule: keywords are case-insensitive', () => {
  assert.equal(evaluateDriverRule('a = TRUE and b Is Not Null', { a: true, b: 1 }), true);
  assert.equal(evaluateDriverRule('a = 1 Or b = 1', { a: 0, b: 1 }), true);
});

test('driver_rule: division by zero is missing, so the comparison is false', () => {
  assert.equal(evaluateDriverRule('load_7d / load_28d > 0', { load_7d: 10, load_28d: 0 }), false);
  assert.equal(evaluateDriverRule('load_7d / load_28d < 1', { load_7d: 10, load_28d: 0 }), false);
});

test('driver_rule: <= and != at the exact boundary', () => {
  assert.equal(evaluateDriverRule('x <= 3', { x: 3 }), true);
  assert.equal(evaluateDriverRule('x <= 3', { x: 3.01 }), false);
  assert.equal(evaluateDriverRule('x != 3', { x: 3 }), false);
  assert.equal(evaluateDriverRule('x != 3', { x: 4 }), true);
  // a missing driver is not "not equal": it makes the comparison false
  assert.equal(evaluateDriverRule('x != 3', {}), false);
});

test('driver_rule: non-finite numbers and strings count as missing', () => {
  assert.equal(evaluateDriverRule('x > 0', { x: Number.POSITIVE_INFINITY }), false);
  assert.equal(evaluateDriverRule('x < 0', { x: Number.NaN }), false);
  assert.equal(evaluateDriverRule('x > 0', { x: '5' }), false);
  assert.equal(evaluateDriverRule('-x < 0', { x: '5' }), false);
  // a string driver is still present for IS NOT NULL
  assert.equal(evaluateDriverRule('x IS NOT NULL', { x: 'note' }), true);
});

test('driver_rule: IS NULL on an expression checks the computed value', () => {
  assert.equal(evaluateDriverRule('(a + b) IS NULL', { a: 1 }), true);
  assert.equal(evaluateDriverRule('(a + b) IS NOT NULL', { a: 1, b: 2 }), true);
});

test('driver_rule: a bare number or driver is true only when it is boolean true', () => {
  assert.equal(evaluateDriverRule('flag', { flag: true }), true);
  assert.equal(evaluateDriverRule('flag', { flag: 1 }), false);
  assert.equal(evaluateDriverRule('1', {}), false);
});

test('driver_rule: a chained comparison never fires (boolean is not ordered)', () => {
  assert.equal(evaluateDriverRule('1 < x < 5', { x: 3 }), false);
});

test('driver_rule: unary minus binds tighter than division and stacks', () => {
  assert.equal(evaluateDriverRule('-load_28d / 4 = -400', { load_28d: 1600 }), true);
  assert.equal(evaluateDriverRule('--x = 2', { x: 2 }), true);
});

// ---- loader: schema rejections not covered elsewhere --------------------

const minimal = { id: 'x-v1', priority: 1, template: 'Body is settled.', posture_filter: ['steady'] };

test('validateEntry rejects a non-mapping entry', () => {
  for (const raw of [null, 'a string', 3, [minimal]]) {
    assert.throws(() => validateEntry(raw, 'f.yaml'), /must be a YAML mapping/);
  }
});

test('validateEntry rejects a non-boolean requires_scheduled_workout', () => {
  assert.throws(() => validateEntry({ ...minimal, requires_scheduled_workout: 'yes' }, 'f.yaml'), /must be a boolean/);
});

test('validateEntry: exclude_if_recently_fired must be a non-negative number; 0 is allowed', () => {
  assert.throws(() => validateEntry({ ...minimal, exclude_if_recently_fired: -1 }, 'f.yaml'), PatternSchemaError);
  assert.throws(() => validateEntry({ ...minimal, exclude_if_recently_fired: '2' }, 'f.yaml'), PatternSchemaError);
  assert.equal(validateEntry({ ...minimal, exclude_if_recently_fired: 0 }, 'f.yaml').exclude_if_recently_fired, 0);
});

test('validateEntry: min_data_completeness accepts the 0 and 1 endpoints only', () => {
  assert.equal(validateEntry({ ...minimal, min_data_completeness: 0 }, 'f.yaml').min_data_completeness, 0);
  assert.equal(validateEntry({ ...minimal, min_data_completeness: 1 }, 'f.yaml').min_data_completeness, 1);
  assert.throws(() => validateEntry({ ...minimal, min_data_completeness: 1.01 }, 'f.yaml'), PatternSchemaError);
  assert.throws(() => validateEntry({ ...minimal, min_data_completeness: -0.01 }, 'f.yaml'), PatternSchemaError);
});

test('validateEntry rejects a non-string driver_rule and unknown tier/context values', () => {
  assert.throws(() => validateEntry({ ...minimal, driver_rule: 3 }, 'f.yaml'), /must be a string/);
  assert.throws(() => validateEntry({ ...minimal, tier_filter: ['gold'] }, 'f.yaml'), /unknown value "gold"/);
  assert.throws(() => validateEntry({ ...minimal, context_filter: ['monthly'] }, 'f.yaml'), /unknown value "monthly"/);
});

// ---- matcher: gates at their exact boundaries ---------------------------

const entry = (over: Partial<PatternEntry> = {}): PatternEntry => ({
  ...validateEntry(minimal, 'f.yaml'),
  ...over,
});
const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({ posture: 'steady', drivers: {}, ...over });

test('matcher: min_data_completeness exactly met fires, just under does not', () => {
  const e = entry({ min_data_completeness: 0.6 });
  assert.equal(selectPattern(ctx({ dataCompleteness: 0.6 }), [e])?.id, 'x-v1');
  assert.equal(selectPattern(ctx({ dataCompleteness: 0.59 }), [e]), null);
});

test('matcher: exclude_if_recently_fired suppresses inside the window, fires at exactly N days', () => {
  const e = entry({ exclude_if_recently_fired: 3 });
  assert.equal(selectPattern(ctx({ recentlyFired: { 'x-v1': 2 } }), [e]), null);
  assert.equal(selectPattern(ctx({ recentlyFired: { 'x-v1': 3 } }), [e])?.id, 'x-v1');
  assert.equal(selectPattern(ctx({ recentlyFired: { other: 0 } }), [e])?.id, 'x-v1');
});

test('matcher: a numeric slot with no driver mapping is backed by the driver of the same name', () => {
  const e = entry({ numeric_slots: ['acwr'] });
  assert.equal(selectPattern(ctx({ drivers: { acwr: 1.1 } }), [e])?.id, 'x-v1');
  assert.equal(selectPattern(ctx({ drivers: {} }), [e]), null);
  assert.equal(selectPattern(ctx({ drivers: { acwr: null } }), [e]), null);
});

test('matcher: a mapped numeric slot needs one of its sources; false counts as absent', () => {
  const e = entry({ numeric_slots: ['days_to_race'] });
  assert.equal(selectPattern(ctx({ drivers: { race_in_next_7d: true } }), [e])?.id, 'x-v1');
  assert.equal(selectPattern(ctx({ drivers: { race_in_next_7d: false } }), [e]), null);
  // a zero value is a real number and backs the slot
  const z = entry({ numeric_slots: ['hrv_pct_change'] });
  assert.equal(selectPattern(ctx({ drivers: { hrv_7d_avg_delta: 0 } }), [z])?.id, 'x-v1');
});

test('matcher: tier, context and posture gates; defaults are free + daily', () => {
  const coachOnly = entry({ tier_filter: ['coach'] });
  assert.equal(selectPattern(ctx(), [coachOnly]), null);
  assert.equal(selectPattern(ctx({ tier: 'coach' }), [coachOnly])?.id, 'x-v1');
  const weekly = entry({ context_filter: ['weekly'] });
  assert.equal(selectPattern(ctx(), [weekly]), null);
  assert.equal(selectPattern(ctx({ context: 'weekly' }), [weekly])?.id, 'x-v1');
  assert.equal(selectPattern(ctx({ posture: 'rest' }), [entry()]), null);
});

test('matcher: an intensity filter with no planned intensity does not fire', () => {
  const e = entry({ scheduled_workout_intensity_filter: ['tempo'] });
  assert.equal(selectPattern(ctx({ scheduledWorkout: {} }), [e]), null);
  assert.equal(selectPattern(ctx({ scheduledWorkout: null }), [e]), null);
  assert.equal(selectPattern(ctx({ scheduledWorkout: { planned_intensity: 'tempo' } }), [e])?.id, 'x-v1');
});

test('matcher: equal priority ties break by id, the same in both selectors', () => {
  const a = entry({ id: 'b-v1', priority: 5 });
  const b = entry({ id: 'a-v1', priority: 5 });
  const c = entry({ id: 'c-v1', priority: 4 });
  assert.equal(selectPattern(ctx(), [a, c, b])?.id, 'a-v1');
  assert.deepEqual(selectPatterns(ctx(), [c, a, b]).map((e) => e.id), ['a-v1', 'b-v1', 'c-v1']);
});
