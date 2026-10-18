import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cyclingMet, estimateCalories, runningKcal } from '../src/calories';

test('running: ACSM equation, about 1 kcal per kg per km on the flat, more uphill', () => {
  // 70 kg, 10 km in 50 min: 200 m/min -> VO2 43.5 -> 3.045 L/min -> 761 kcal.
  assert.equal(Math.round(runningKcal(70, 10000, 3000)), 761);
  assert.ok(runningKcal(70, 10000, 3000, 200) > runningKcal(70, 10000, 3000));
  const e = estimateCalories({ id: 1, type: 'Run', start_date_local: '2026-10-17T07:00:00Z', distance: 10000, moving_time: 3000, total_elevation_gain: 0 }, 70);
  assert.deepEqual(e, {
    activity_id: 1, date: '2026-10-17', sport: 'Run', kcal: 761, method: 'acsm_running',
    inputs: { weight_kg: 70, distance_m: 10000, moving_s: 3000, climb_m: 0 },
  });
});

test('rides: measured work from a power meter wins; otherwise a MET by speed', () => {
  const powered = estimateCalories({ id: 2, type: 'Ride', distance: 40000, moving_time: 5400, kilojoules: 950, device_watts: true }, 70);
  assert.deepEqual([powered!.kcal, powered!.method], [950, 'measured_work']);
  // Estimated watts (device_watts false) are not measured work.
  const est = estimateCalories({ id: 3, type: 'Ride', distance: 40000, moving_time: 5400, kilojoules: 950, device_watts: false }, 70);
  assert.equal(est!.method, 'met_cycling');
  // 40 km in 1.5 h = 26.7 km/h -> MET 12 -> 12 x 70 x 1.5 = 1260.
  assert.equal(est!.kcal, 1260);
  assert.equal(cyclingMet(15), 4);
  assert.equal(cyclingMet(31), 15.8);
});

test('no weight or no data, no estimate; other sports are left out in v1', () => {
  const run = { id: 4, type: 'Run', distance: 5000, moving_time: 1500 };
  assert.equal(estimateCalories(run, null), null);
  assert.equal(estimateCalories(run, 12), null); // implausible weight
  assert.equal(estimateCalories({ ...run, moving_time: 0 }, 70), null);
  assert.equal(estimateCalories({ id: 5, type: 'Swim', distance: 1500, moving_time: 1800 }, 70), null);
});

test('below running speed the ACSM walking equation is used (review fix)', () => {
  // 20 km in 4 h with 1000 m climb: 83 m/min, a hike-paced trail run.
  // Walking: 3.5 + 8.33 + 1.8 x 83.3 x 0.05 = 19.33 ml/kg/min -> 70 kg x 240 min -> 1624 kcal.
  assert.equal(Math.round(runningKcal(70, 20000, 4 * 3600, 1000)), 1624);
  // At running speed nothing changes.
  assert.equal(Math.round(runningKcal(70, 10000, 3000)), 761);
});
