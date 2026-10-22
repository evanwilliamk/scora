import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  AssemblyError, assemblePlan, evaluateAdaptation, loadTemplates, matchTemplate, scaleStructure,
  startDateForRace, structureMinutes,
} from '../src/index';
import type { PlanTemplate } from '../src/index';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const [T] = loadTemplates(FIXTURES, { allowDrafts: true });
const MON = '2026-10-19';

test('assembles every non-rest day of every week, dated from the Monday start', () => {
  const p = assemblePlan({ template: T, start_date: MON });
  assert.equal(p.workouts.length, 20); // 5 sessions x 4 weeks
  assert.equal(p.end_date, '2026-11-15');
  assert.deepEqual(
    p.workouts.filter((w) => w.week === 1).map((w) => [w.scheduled_date, w.workout_key, w.planned_intensity, w.planned_duration_min]),
    [
      ['2026-10-20', 'fartlek', 'intervals', 42],
      ['2026-10-21', 'easy_run', 'easy', 40],
      ['2026-10-22', 'tempo_run', 'tempo', 40],
      ['2026-10-24', 'long_easy', 'long', 90],
      ['2026-10-25', 'easy_run', 'easy', 40],
    ],
  );
  assert.equal(p.workouts.find((w) => w.week === 3 && w.weekday === 'tuesday')?.workout_key, 'threshold_intervals');
});

test('every number traces to the template: no invented workouts, durations or steps', () => {
  const p = assemblePlan({ template: T, start_date: MON });
  for (const w of p.workouts) {
    const def = T.workout_definitions[w.workout_key];
    assert.ok(def, w.workout_key);
    assert.equal(w.planned_intensity, def.intensity);
    assert.deepEqual(w.structure, scaleStructure(def.structure, T.week_load_percent[w.week - 1]));
    assert.equal(w.planned_duration_min, structureMinutes(w.structure));
  }
  for (let wk = 1; wk <= 4; wk++) {
    const sum = p.workouts.filter((w) => w.week === wk).reduce((s, w) => s + w.planned_duration_min, 0);
    assert.equal(sum, p.week_minutes[wk - 1], `week ${wk}`);
  }
});

test('load percent scales continuous steps only; interval sessions keep their reps and durations', () => {
  const p = assemblePlan({ template: T, start_date: MON });
  const fartlek4 = p.workouts.find((w) => w.week === 4 && w.workout_key === 'fartlek')!;
  assert.deepEqual(fartlek4.structure.map((s) => (s.type === 'interval' ? [s.reps, s.work_duration_min] : s.duration_min)), [8, [6, 2], 8]);
  assert.equal(p.workouts.find((w) => w.week === 4 && w.workout_key === 'long_easy')!.planned_duration_min, 72);
  // Assembling never mutates the template.
  assert.equal(T.workout_definitions.long_easy.structure[0].type === 'steady' && T.workout_definitions.long_easy.structure[0].duration_min, 90);
});

test('ids are stable and unique per template version, week and day', () => {
  const a = assemblePlan({ template: T, start_date: MON });
  const b = assemblePlan({ template: T, start_date: MON });
  assert.deepEqual(a, b);
  assert.equal(new Set(a.workouts.map((w) => w.id)).size, a.workouts.length);
  assert.equal(a.workouts[0].id, 'test-fixture-4wk@0.0.1:w1:tuesday');
});

test('race date: start is the Monday that puts the race in the final week; nothing is scheduled on or after it', () => {
  assert.equal(startDateForRace(T, '2026-11-15'), MON); // Sunday race
  assert.equal(startDateForRace(T, '2026-11-09'), MON); // Monday race
  const sun = assemblePlan({ template: T, start_date: MON, goal_race_date: '2026-11-15' });
  assert.equal(sun.workouts.length, 19);
  const sat = assemblePlan({ template: T, start_date: MON, goal_race_date: '2026-11-14' });
  assert.deepEqual(sat.workouts.filter((w) => w.week === 4).map((w) => w.weekday), ['tuesday', 'wednesday', 'thursday']);
  // Race-week minutes are the sessions actually left (review fix): 38 + 32 + 32.
  assert.equal(sat.week_minutes[3], 102);
  assert.deepEqual(sat.week_minutes.slice(0, 3), [252, 262, 270]);
});

test('assembly refuses bad dates with a named error', () => {
  const code = (fn: () => unknown) => {
    try { fn(); } catch (e) { return e instanceof AssemblyError ? e.code : String(e); }
    return 'no error';
  };
  assert.equal(code(() => assemblePlan({ template: T, start_date: '2026-10-20' })), 'start_not_monday');
  assert.equal(code(() => assemblePlan({ template: T, start_date: MON, goal_race_date: '2026-11-08' })), 'race_outside_final_week');
  assert.equal(code(() => assemblePlan({ template: T, start_date: MON, goal_race_date: '2026-11-16' })), 'race_outside_final_week');
  assert.equal(code(() => assemblePlan({ template: T, start_date: MON, goal_race_date: '2026-10-01' })), 'race_before_start');
});

test('template matching: sport, goal, level and volume range [min, max); no match is null, never a made-up plan', () => {
  const q = { sport: 'run', goal_type: '10k', experience_level: 'regular', current_weekly_km: 30 } as const;
  assert.equal(matchTemplate([T], q), T);
  assert.equal(matchTemplate([T], { ...q, current_weekly_km: 45 }), null); // max is exclusive
  assert.equal(matchTemplate([T], { ...q, current_weekly_km: 29.9 }), null);
  assert.equal(matchTemplate([T], { ...q, goal_type: 'marathon' }), null);
  assert.equal(matchTemplate([T], { ...q, experience_level: 'first_timer' }), null);
  assert.equal(matchTemplate([T], { ...q, duration_weeks: 12 }), null);
  const newer: PlanTemplate = { ...T, slug: 'test-fixture-4wk-b', version: '0.0.10' };
  assert.equal(matchTemplate([T, newer], q), newer); // 0.0.10 > 0.0.1, compared numerically
});

test('assembled weeks feed the adaptation engine directly', () => {
  const p = assemblePlan({ template: T, start_date: MON });
  const week2 = p.workouts.filter((w) => w.week === 2);
  const thu = week2.find((w) => w.weekday === 'thursday')!;
  const r = evaluateAdaptation({
    posture: 'back-off',
    workout: thu,
    plan: { source: 'scora_ai', goal_race_date: null, week: week2, template_week_minutes: p.week_minutes[1] },
    today: '2026-10-28',
  });
  assert.equal(r.type, 'downgraded');
  if (r.type === 'downgraded') assert.deepEqual([r.from_intensity, r.to_intensity, r.duration_min], ['tempo', 'endurance', 40]);
});

test('rest posture in a three-quality-day week: no move window, so the session drops to easy (Q19)', () => {
  // Tue/Thu/Sat hard with easy days between: every candidate day sits next to
  // a hard day, so nothing moves and the session becomes easy at the same duration.
  const p = assemblePlan({ template: T, start_date: MON });
  const week2 = p.workouts.filter((w) => w.week === 2);
  const tue = week2.find((w) => w.weekday === 'tuesday')!;
  const r = evaluateAdaptation({
    posture: 'rest',
    workout: tue,
    plan: { source: 'scora_ai', goal_race_date: null, week: week2, template_week_minutes: p.week_minutes[1] },
    today: '2026-10-26',
  });
  assert.equal(r.type, 'downgraded');
  if (r.type !== 'downgraded') return;
  assert.equal(r.reason_code, 'posture_rest_hard_no_window');
  assert.equal(r.to_intensity, 'easy');
  assert.equal(r.duration_min, tue.planned_duration_min);
});
