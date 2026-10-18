import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekSoFar } from '../src/week-so-far';
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
  assert.equal(w.line, '3 runs, 120 min since Monday; 95 min by this point last week.');
});

test('every number in the line is shown, and the line passes the voice validator', () => {
  const w = weekSoFar([run('2026-10-19', 40), run('2026-10-12', 30)], '2026-10-19');
  assert.equal(w.line, '1 run, 40 min since Monday; 30 min by this point last week.');
  const drivers = [{ metric: 'Runs', value: String(w.runs) }, { metric: 'Week', value: `${w.total_min} min` }, { metric: 'Last week', value: `${w.last_week_to_date_min} min` }];
  assert.deepEqual(validateVoice(w.line, drivers), { ok: true, bannedHits: [], unbackedNumbers: [] });
});

test('no runs yet, with and without last week', () => {
  assert.equal(weekSoFar([], '2026-10-20').line, 'No runs yet this week.');
  assert.equal(weekSoFar([run('2026-10-12', 30)], '2026-10-20').line, 'No runs yet this week. Last week had 30 min by this point.');
  assert.equal(weekSoFar([], '2026-10-25').days.every((d) => d.run_min === 0), true); // Sunday: whole week shown
});
