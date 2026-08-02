import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDriverRule, compileDriverRule, DriverRuleError } from '../src/driver-rule';
import type { DriverRecord } from '../src/types';

const ev = (rule: string, rec: DriverRecord) => evaluateDriverRule(rule, rec);

test('ordered comparisons', () => {
  assert.equal(ev('acwr > 1.2', { acwr: 1.3 }), true);
  assert.equal(ev('acwr > 1.2', { acwr: 1.2 }), false);
  assert.equal(ev('acwr >= 1.2', { acwr: 1.2 }), true);
  assert.equal(ev('load < 100', { load: 99 }), true);
  assert.equal(ev('load <= 100', { load: 100 }), true);
});

test('negative number literals', () => {
  assert.equal(ev('sleep_7d_avg_delta < -3', { sleep_7d_avg_delta: -4 }), true);
  assert.equal(ev('sleep_7d_avg_delta < -3', { sleep_7d_avg_delta: -2 }), false);
  assert.equal(ev('hrv_7d_avg_delta >= -1', { hrv_7d_avg_delta: -1 }), true);
});

test('equality across numbers and booleans', () => {
  assert.equal(ev('consecutive_hard_days = 0', { consecutive_hard_days: 0 }), true);
  assert.equal(ev('consecutive_hard_days = 0', { consecutive_hard_days: 1 }), false);
  assert.equal(ev('race_in_next_7d = true', { race_in_next_7d: true }), true);
  assert.equal(ev('race_in_next_7d = true', { race_in_next_7d: false }), false);
  assert.equal(ev('flag != true', { flag: false }), true);
  assert.equal(ev('n == 5', { n: 5 }), true);
});

test('AND / OR precedence — AND binds tighter than OR', () => {
  // a AND b OR c  ==  (a AND b) OR c
  const rule = 'a > 1 AND b > 1 OR c > 1';
  assert.equal(ev(rule, { a: 0, b: 0, c: 2 }), true); // c alone
  assert.equal(ev(rule, { a: 2, b: 2, c: 0 }), true); // a AND b
  assert.equal(ev(rule, { a: 2, b: 0, c: 0 }), false); // a only, no c
});

test('parentheses override precedence', () => {
  const rule = '(a > 1 OR b > 1) AND c > 1';
  assert.equal(ev(rule, { a: 2, b: 0, c: 2 }), true);
  assert.equal(ev(rule, { a: 2, b: 0, c: 0 }), false); // c fails
  assert.equal(ev(rule, { a: 0, b: 0, c: 2 }), false); // neither a nor b
});

test('arithmetic with precedence and parens', () => {
  // load_7d < (load_28d / 4) * 0.85  ->  threshold = 25 * 0.85 = 21.25
  const rule = 'load_7d < (load_28d / 4) * 0.85';
  assert.equal(ev(rule, { load_7d: 20, load_28d: 100 }), true);
  assert.equal(ev(rule, { load_7d: 22, load_28d: 100 }), false);
});

test('IS NULL / IS NOT NULL', () => {
  assert.equal(ev('coach_note IS NOT NULL', { coach_note: 'nice work' }), true);
  assert.equal(ev('coach_note IS NOT NULL', {}), false);
  assert.equal(ev('coach_note IS NOT NULL', { coach_note: null }), false);
  assert.equal(ev('coach_note IS NULL', {}), true);
  assert.equal(ev('coach_note IS NULL', { coach_note: 'x' }), false);
});

test('missing driver makes any comparison touching it false', () => {
  assert.equal(ev('hrv_7d_avg_delta >= 3', {}), false);
  assert.equal(ev('hrv_7d_avg_delta = 0', {}), false);
  // in an AND, a missing operand sinks the whole rule
  assert.equal(ev('acwr > 1 AND hrv_7d_avg_delta < -5', { acwr: 2 }), false);
  // in an OR, the present side can still carry it
  assert.equal(ev('acwr > 1 OR hrv_7d_avg_delta < -5', { acwr: 2 }), true);
});

test('the cornerstone rule fires only when both clauses hold', () => {
  const rule = '(acwr > 1.2 OR consecutive_hard_days >= 2) AND (sleep_7d_avg_delta < -3 OR hrv_7d_avg_delta < -5)';
  // load high + recovery debt -> fires
  assert.equal(ev(rule, { acwr: 1.3, hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 1 }), true);
  // load high but recovery fine -> no fire
  assert.equal(ev(rule, { acwr: 1.3, hrv_7d_avg_delta: 2, sleep_7d_avg_delta: 0, consecutive_hard_days: 1 }), false);
  // recovery debt but load fine -> no fire
  assert.equal(ev(rule, { acwr: 0.9, hrv_7d_avg_delta: -6, sleep_7d_avg_delta: -1, consecutive_hard_days: 0 }), false);
});

test('malformed rules throw DriverRuleError at compile time', () => {
  assert.throws(() => compileDriverRule('acwr >'), DriverRuleError);
  assert.throws(() => compileDriverRule('acwr 1.2'), DriverRuleError); // no operator
  assert.throws(() => compileDriverRule('(acwr > 1'), DriverRuleError); // unbalanced paren
  assert.throws(() => compileDriverRule('acwr > 1 AND'), DriverRuleError); // dangling AND
  assert.throws(() => compileDriverRule('@ > 1'), DriverRuleError); // bad char
});

test('compileDriverRule reuses one parse across evaluations', () => {
  const c = compileDriverRule('acwr > 1.2');
  assert.equal(c.evaluate({ acwr: 1.3 }), true);
  assert.equal(c.evaluate({ acwr: 1.0 }), false);
  assert.equal(c.source, 'acwr > 1.2');
});
