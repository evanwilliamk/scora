import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, templateSlots } from '../src/render';

test('fills known slots, including dotted names', () => {
  const t = 'HRV down {{hrv_pct_change}}% — plan calls for {{scheduled_workout.planned_intensity}}.';
  const r = fillTemplate(t, { hrv_pct_change: -9, 'scheduled_workout.planned_intensity': 'threshold' });
  assert.equal(r.text, 'HRV down -9% — plan calls for threshold.');
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
