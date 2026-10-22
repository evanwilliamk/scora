import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekSoFar, plannedRunMinutes, mondayOf } from '../src/week-so-far';
import { validateVoice } from '../src/validator';

const run = (d: string, min: number) => ({ type: 'Run', start_date_local: `${d}T07:00:00Z`, moving_time: min * 60 });

test('Monday to today, later days empty, compared with last week to the same day', () => {
  // Thursday 2026-10-22.
  const w = weekSoFar([
    run('2026-10-19', 40), run('2026-10-21', 50), run('2026-10-21', 30),
    run('2026-10-13', 45), run('2026-10-15', 50), run('2026-10-17', 90), // last week; Sat is after Thu
    { type: 'Ride', start_date_local: '2026-10-20T07:00:00Z', moving_time: 3600 },
  ], '2026-10-22');
  assert.deepEqual(w.days.map((d) => [d.weekday, d.run_min]), [
    ['Mon', 40], ['Tue', 0], ['Wed', 80], ['Thu', 0], ['Fri', null], ['Sat', null], ['Sun', null],
  ]);
  assert.deepEqual([w.runs, w.total_min, w.last_week_to_date_min], [3, 120, 95]);
  assert.equal(w.line, '3 runs, 120 min since Monday; 95 min through Thursday last week.');
});

test('every number in the line is shown, and the line passes the voice validator', () => {
  const w = weekSoFar([run('2026-10-19', 40), run('2026-10-12', 30)], '2026-10-19');
  assert.equal(w.line, '1 run, 40 min since Monday; 30 min through Monday last week.');
  const drivers = [{ metric: 'Runs', value: String(w.runs) }, { metric: 'Week', value: `${w.total_min} min` }, { metric: 'Last week', value: `${w.last_week_to_date_min} min` }];
  assert.deepEqual(validateVoice(w.line, drivers), { ok: true, bannedHits: [], unbackedNumbers: [] });
});

test('no runs yet, with and without last week', () => {
  assert.equal(weekSoFar([], '2026-10-20').line, 'No runs yet this week.');
  assert.equal(weekSoFar([run('2026-10-12', 30)], '2026-10-20').line, 'No runs yet this week. Last week had 30 min through Tuesday.');
  assert.equal(weekSoFar([], '2026-10-25').days.every((d) => d.run_min === 0), true); // Sunday: whole week shown
});

test('with a plan: each day carries its planned run minutes, and the line states the plan through today', () => {
  const planned = plannedRunMinutes([
    { scheduled_date: '2026-10-19', planned_type: 'run', planned_intensity: 'easy', planned_duration_min: 40 },
    { scheduled_date: '2026-10-20', planned_type: 'run', planned_intensity: 'rest', planned_duration_min: null },
    { scheduled_date: '2026-10-21', planned_type: 'run', planned_intensity: 'tempo', planned_duration_min: 50 },
    { scheduled_date: '2026-10-21', planned_type: 'strength', planned_intensity: null, planned_duration_min: 30 },
    { scheduled_date: '2026-10-24', planned_type: 'run', planned_intensity: 'long', planned_duration_min: 100 },
  ]);
  const w = weekSoFar([run('2026-10-19', 40), run('2026-10-21', 45)], '2026-10-22', planned);
  assert.deepEqual(w.days.map((d) => d.planned_min), [40, 0, 50, 0, 0, 100, 0]);
  assert.equal(w.planned_to_date_min, 90);
  assert.equal(w.line, '2 runs, 85 min since Monday. Plan: 90 min through Thursday.');
  const drivers = [{ metric: 'Runs', value: '2' }, { metric: 'Week', value: '85 min' }, { metric: 'Plan', value: '90 min' }];
  assert.deepEqual(validateVoice(w.line, drivers), { ok: true, bannedHits: [], unbackedNumbers: [] });
});

test('without a plan nothing about plans appears; mondayOf finds the week', () => {
  const w = weekSoFar([run('2026-10-19', 40)], '2026-10-22');
  assert.equal('planned_to_date_min' in w, false);
  assert.equal(w.days.every((d) => !('planned_min' in d)), true);
  assert.equal(mondayOf('2026-10-22'), '2026-10-19');
  assert.equal(mondayOf('2026-10-25'), '2026-10-19');
  assert.equal(mondayOf('2026-10-26'), '2026-10-26');
});

test('a planned run with no duration leaves its day unknown and the plan clause out (review 4)', () => {
  const planned = plannedRunMinutes([
    { scheduled_date: '2026-10-19', planned_type: 'run', planned_intensity: 'easy', planned_duration_min: 40 },
    { scheduled_date: '2026-10-21', planned_type: 'run', planned_intensity: 'long', planned_duration_min: null },
  ]);
  const w = weekSoFar([run('2026-10-19', 40), run('2026-10-21', 120)], '2026-10-22', planned);
  assert.deepEqual(w.days.map((d) => d.planned_min), [40, 0, null, 0, 0, 0, 0]);
  assert.equal(w.planned_to_date_min, undefined);
  assert.doesNotMatch(w.line, /Plan:/);
});
