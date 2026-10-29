import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWorkout, spokenDuration } from '../src/index';

test('spokenDuration: whole minutes, seconds under two minutes, m:ss above', () => {
  assert.equal(spokenDuration(1), '1 minute');
  assert.equal(spokenDuration(10), '10 minutes');
  assert.equal(spokenDuration(0.5), '30 seconds');
  assert.equal(spokenDuration(1.5), '90 seconds');
  assert.equal(spokenDuration(2.5), '2:30 minutes');
  assert.equal(spokenDuration(1.999), '2 minutes');
  assert.equal(spokenDuration(0.999), '1 minute');
  assert.equal(spokenDuration(60), '1 hour');
  assert.equal(spokenDuration(120), '2 hours');
  assert.equal(spokenDuration(125), '2 hours 5 minutes');
  assert.equal(spokenDuration(120.5), '2 hours 1 minute', 'over an hour, the nearest minute');
});

test('describeWorkout: effort words, single reps, a lone step at another pace (review)', () => {
  assert.equal(describeWorkout('intervals', [
    { type: 'warmup', duration_min: 15, intensity: 'easy' },
    { type: 'interval', reps: 5, work_duration_min: 3, work_intensity: 'vo2max', rest_duration_min: 2, rest_intensity: 'recovery' },
    { type: 'cooldown', duration_min: 10, intensity: 'easy' },
  ]), '48-minute interval session. 15 minutes easy, 5 × 3 minutes at VO2max effort, 2 minutes recovery between, 10 minutes easy.');
  assert.equal(describeWorkout('threshold', [
    { type: 'interval', reps: 1, work_duration_min: 20, work_intensity: 'threshold', rest_duration_min: 2, rest_intensity: 'easy' },
  ]), '20-minute threshold session. 1 × 20 minutes at threshold.');
  assert.equal(describeWorkout('moderate', [{ type: 'steady', duration_min: 40, intensity: 'tempo' }]), '40-minute moderate run. 40 minutes at tempo.');
  assert.equal(describeWorkout('endurance', [{ type: 'steady', duration_min: 45, intensity: 'easy' }]), '45-minute endurance run.');
});

test('describeWorkout: the template numbers in a sentence, nothing added (CLAUDE.md §6.4)', () => {
  assert.equal(describeWorkout('tempo', [
    { type: 'warmup', duration_min: 10, intensity: 'easy' },
    { type: 'steady', duration_min: 25, intensity: 'tempo' },
    { type: 'cooldown', duration_min: 10, intensity: 'easy' },
  ]), '45-minute tempo. 10 minutes easy, 25 minutes at tempo, 10 minutes easy.');
  assert.equal(describeWorkout('easy', [
    { type: 'steady', duration_min: 35, intensity: 'easy' },
    { type: 'interval', reps: 6, work_duration_min: 0.5, work_intensity: 'sprint', rest_duration_min: 1.5, rest_intensity: 'easy' },
  ]), '46-minute easy run. 35 minutes easy, 6 × 30 seconds at sprint effort, 90 seconds easy between.');
  assert.equal(describeWorkout('long', [{ type: 'steady', duration_min: 95, intensity: 'easy' }]), '95-minute long run.');
  assert.equal(describeWorkout('rest', null), 'Rest day.');
  assert.equal(describeWorkout('easy', null), null, 'no structure, no description');
  assert.equal(describeWorkout('easy', []), null);
});
