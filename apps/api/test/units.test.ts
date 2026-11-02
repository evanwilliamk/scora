import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KM_PER_MI, distanceUnit, formatPlanDistance, planDistanceValue } from '../src/units';

test('distanceUnit: miles unless a meters preference is passed', () => {
  assert.equal(distanceUnit(), 'mi');
  assert.equal(distanceUnit(null), 'mi');
  assert.equal(distanceUnit('feet'), 'mi');
  assert.equal(distanceUnit('meters'), 'km');
});

test('a distance written in miles reads back as written after the km round trip', () => {
  for (const mi of [3.1, 5, 6.2, 8, 10, 13.1, 16, 18.5, 20, 26.2, 31.1, 50, 100]) {
    const stored = Math.round(mi * KM_PER_MI * 100) / 100; // plan-parse.ts, numeric(6, 2)
    assert.equal(planDistanceValue(stored), mi, `${mi} mi stored as ${stored} km`);
  }
  assert.equal(formatPlanDistance(21.08), '13.1 mi');
  assert.equal(formatPlanDistance(25.75), '16 mi');
});

test('km plans convert to miles by default, and stay as stored in km', () => {
  assert.equal(formatPlanDistance(10), '6.2 mi');
  assert.equal(formatPlanDistance(25.75, 'km'), '25.75 km');
  assert.equal(formatPlanDistance(8, 'km'), '8 km');
});

test('a positive distance never reads as 0', () => {
  assert.equal(formatPlanDistance(0.05), '0.03 mi');
  assert.equal(formatPlanDistance(0.01), '0.01 mi');
  assert.equal(formatPlanDistance(0.0001), '0.01 mi');
  assert.equal(formatPlanDistance(0.15), '0.09 mi');
  assert.equal(formatPlanDistance(0.161), '0.1 mi');
  assert.equal(formatPlanDistance(0.1608), '0.1 mi');
  assert.equal(formatPlanDistance(0.004, 'km'), '0.01 km');
  assert.equal(formatPlanDistance(0.05, 'km'), '0.05 km');
  assert.equal(formatPlanDistance(0), '0 mi');
});
