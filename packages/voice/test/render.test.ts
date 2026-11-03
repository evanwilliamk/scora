import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, templateSlots } from '../src/render';

test('fills known slots, including dotted names', () => {
  const t = 'HRV down {{hrv_pct_change}}%, plan calls for {{scheduled_workout.planned_intensity}}.';
  const r = fillTemplate(t, { hrv_pct_change: -9, 'scheduled_workout.planned_intensity': 'threshold' });
  assert.equal(r.text, 'HRV down 9%, plan calls for threshold.');
  assert.deepEqual(r.missing, []);
});

test('leaves an unfilled slot visible and reports it (never invents a value)', () => {
  const r = fillTemplate('Sleep {{sleep_hours}}:{{sleep_minutes_padded}}.', { sleep_hours: 6 });
  assert.equal(r.text, 'Sleep 6:{{sleep_minutes_padded}}.');
  assert.deepEqual(r.missing, ['sleep_minutes_padded']);
});

test('templateSlots lists placeholders in order without duplicates', () => {
  const slots = templateSlots('{{a}} then {{b}} then {{a}} again {{c.d}}');
  assert.deepEqual(slots, ['a', 'b', 'c.d']);
});

// Direction word and signed value always agree (copy audit, borderline 5).
test('negative value: word before the slot reads down, number unsigned', () => {
  assert.equal(fillTemplate('HRV down {{hrv_pct_change}}% from last week.', { hrv_pct_change: -9 }).text,
    'HRV down 9% from last week.');
  assert.equal(fillTemplate('HRV up {{hrv_pct_change}}% and sleep held.', { hrv_pct_change: -9 }).text,
    'HRV down 9% and sleep held.');
});

test('negative value: word after the slot reads below, number unsigned', () => {
  assert.equal(fillTemplate('HRV is still {{hrv_pct_change}}% below baseline.', { hrv_pct_change: -6 }).text,
    'HRV is still 6% below baseline.');
  assert.equal(fillTemplate('HRV is {{hrv_pct_change}}% above baseline.', { hrv_pct_change: '-6' }).text,
    'HRV is 6% below baseline.');
});

test('positive value: word follows the sign', () => {
  assert.equal(fillTemplate('HRV up {{hrv_pct_change}}% from last week.', { hrv_pct_change: 8 }).text,
    'HRV up 8% from last week.');
  assert.equal(fillTemplate('HRV down {{hrv_pct_change}}% from last week.', { hrv_pct_change: 4 }).text,
    'HRV up 4% from last week.');
  assert.equal(fillTemplate('HRV is still {{hrv_pct_change}}% below baseline.', { hrv_pct_change: 2.5 }).text,
    'HRV is still 2.5% above baseline.');
});

test('zero value: no sign, template word stands', () => {
  assert.equal(fillTemplate('HRV down {{hrv_pct_change}}%.', { hrv_pct_change: 0 }).text, 'HRV down 0%.');
  assert.equal(fillTemplate('{{hrv_pct_change}}% below baseline.', { hrv_pct_change: -0 }).text, '0% below baseline.');
});

test('direction handling leaves the values map (the real driver value) untouched', () => {
  const values = { hrv_pct_change: -9 };
  fillTemplate('HRV down {{hrv_pct_change}}%.', values);
  assert.equal(values.hrv_pct_change, -9);
});

test('a missing direction slot is still reported and left visible', () => {
  const r = fillTemplate('HRV down {{hrv_pct_change}}%.', {});
  assert.equal(r.text, 'HRV down {{hrv_pct_change}}%.');
  assert.deepEqual(r.missing, ['hrv_pct_change']);
});

test('every shipped pattern with a direction word renders sign-consistent text', async () => {
  const { loadPatterns } = await import('../src/loader');
  const dirSlot = /\b(up|down|above|below|higher|lower)\s+\{\{|\}\}%?\s+(up|down|above|below|higher|lower)\b/;
  const entries = (loadPatterns() as Array<{ id: string; template: string }>).filter((e) => dirSlot.test(e.template));
  assert.ok(entries.length >= 4);
  for (const e of entries) {
    for (const v of [-9, 9]) {
      const values: Record<string, number> = {};
      for (const k of templateSlots(e.template)) values[k] = k === 'hrv_pct_change' ? v : 7;
      const out = fillTemplate(e.template, values).text;
      assert.doesNotMatch(out, /-\d/, e.id);
      assert.doesNotMatch(out, v < 0 ? /\b(up|above|higher) \d|\d%? (above|higher)\b/ : /\b(down|below|lower) \d|\d%? (below|lower)\b/, e.id);
    }
  }
});

test('a capitalized direction word follows the sign and keeps its case', () => {
  assert.equal(fillTemplate('Down {{hrv_pct_change}}% this week.', { hrv_pct_change: 6 }).text, 'Up 6% this week.');
  assert.equal(fillTemplate('Up {{hrv_pct_change}}% this week.', { hrv_pct_change: -6 }).text, 'Down 6% this week.');
  assert.equal(fillTemplate('{{hrv_pct_change}}% Below baseline.', { hrv_pct_change: 3 }).text, '3% Above baseline.');
});

test('a string value keeps its own digits when its sign is dropped', () => {
  assert.equal(fillTemplate('HRV down {{hrv_pct_change}}%.', { hrv_pct_change: '-8.0' }).text, 'HRV down 8.0%.');
  assert.equal(fillTemplate('HRV down {{hrv_pct_change}}%.', { hrv_pct_change: '+8.0' }).text, 'HRV up 8.0%.');
});
