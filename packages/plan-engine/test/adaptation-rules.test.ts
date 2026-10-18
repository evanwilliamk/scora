import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSTURES } from '@scora/posture';
import { evaluateAdaptation, matchRule, weekMinutes } from '../src/index';
import type { AdaptationInput, Intensity, PlanContext, PlannedWorkout } from '../src/index';
import { addDays, daysBetween, weekEnd } from '../src/dates';

// Synthetic plan week, Monday 2026-10-19 to Sunday 2026-10-25. These are test
// inputs for the rules, not training content.
const w = (id: string, date: string, planned_intensity: Intensity, planned_duration_min: number | null, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
  id, scheduled_date: date, planned_intensity, planned_duration_min, ...extra,
});

const TUE = w('tue', '2026-10-20', 'intervals', 60);
const spacedWeek: PlannedWorkout[] = [
  TUE,
  w('wed', '2026-10-21', 'easy', 40),
  w('thu', '2026-10-22', 'rest', null),
  w('fri', '2026-10-23', 'easy', 30),
  w('sat', '2026-10-24', 'long', 100, { planned_distance_km: 18 }),
];
// 60 + 40 + 30 + 100 = 230 minutes

const plan = (over: Partial<PlanContext> = {}): PlanContext => ({
  source: 'scora_ai', goal_race_date: null, week: spacedWeek, template_week_minutes: 230, ...over,
});

const input = (over: Partial<AdaptationInput> = {}): AdaptationInput => ({
  posture: 'rest', workout: TUE, plan: plan(), today: '2026-10-19', ...over,
});

test('rest + intervals tomorrow: moves to the next clear day and leaves the week intact', () => {
  // Wed would drop 40 of 230 minutes (17%), so the rest day Thursday wins.
  const r = evaluateAdaptation(input());
  assert.equal(r.type, 'moved');
  if (r.type !== 'moved') return;
  assert.equal(r.from, '2026-10-20');
  assert.equal(r.to, '2026-10-22');
  assert.equal(r.displaced_workout_id, null);
  assert.equal(r.reason_code, 'posture_rest_hard_scheduled');
  assert.deepEqual(r.facts, {
    posture: 'rest', workout_date: '2026-10-20', workout_intensity: 'intervals', workout_duration_min: 60,
    week_minutes_before: 230, week_minutes_after: 230, template_week_minutes: 230,
  });
});

test('a move may displace a short easy session when the week stays within 10%', () => {
  const week = spacedWeek.map((x) => (x.id === 'wed' ? { ...x, planned_duration_min: 20 } : x));
  const r = evaluateAdaptation(input({ plan: plan({ week, template_week_minutes: 210 }) }));
  assert.equal(r.type, 'moved');
  if (r.type !== 'moved') return;
  assert.equal(r.to, '2026-10-21');
  assert.equal(r.displaced_workout_id, 'wed');
  assert.equal(r.facts.week_minutes_after, 190); // 190 / 210 = 9.5% under
});

test('volume guard: a move that would drop the week more than 10% is skipped, and says which rule it blocked', () => {
  // Only Wednesday is a window (Thu sits next to Friday's threshold, Fri-Sun are hard).
  const week = [
    TUE,
    w('wed', '2026-10-21', 'easy', 40),
    w('thu', '2026-10-22', 'easy', 20),
    w('fri', '2026-10-23', 'threshold', 50),
    w('sat', '2026-10-24', 'long', 100),
    w('sun', '2026-10-25', 'hard', 40),
  ];
  const r = evaluateAdaptation(input({ plan: plan({ week, template_week_minutes: weekMinutes(week) }) }));
  assert.deepEqual(r, { type: 'none', code: 'skip_volume_guard', blocked_rule: 'posture_rest_hard_scheduled' });
});

test('no window: never clusters the moved session next to another hard day', () => {
  const week = [
    TUE,
    w('wed', '2026-10-21', 'easy', 40),
    w('thu', '2026-10-22', 'tempo', 50),
    w('fri', '2026-10-23', 'rest', null),
    w('sat', '2026-10-24', 'long', 100),
    w('sun', '2026-10-25', 'easy', 45),
  ];
  const r = evaluateAdaptation(input({ plan: plan({ week, template_week_minutes: weekMinutes(week) }) }));
  assert.deepEqual(r, { type: 'none', code: 'skip_no_window', blocked_rule: 'posture_rest_hard_scheduled' });
});

test('a move never leaves the plan week', () => {
  const sat = w('sat', '2026-10-24', 'tempo', 50);
  const week = [sat, w('sun', '2026-10-25', 'long', 100)];
  const r = evaluateAdaptation(input({ workout: sat, plan: plan({ week, template_week_minutes: 150 }) }));
  assert.deepEqual(r, { type: 'none', code: 'skip_no_window', blocked_rule: 'posture_rest_hard_scheduled' });
});

test('a move skips days with two sessions or a completed one', () => {
  const week = [
    TUE,
    w('wed1', '2026-10-21', 'easy', 20),
    w('wed2', '2026-10-21', 'recovery', 20),
    w('thu', '2026-10-22', 'easy', 10, { athlete_completed: true }),
    w('fri', '2026-10-23', 'rest', null),
  ];
  const r = evaluateAdaptation(input({ plan: plan({ week, template_week_minutes: weekMinutes(week) }) }));
  assert.equal(r.type, 'moved');
  if (r.type === 'moved') assert.equal(r.to, '2026-10-23');
});

test('rest + long run: the long run moves whole (distance and duration untouched)', () => {
  const sat = w('sat', '2026-10-24', 'long', 100, { planned_distance_km: 18 });
  const week = [w('thu', '2026-10-22', 'easy', 40), sat];
  const r = evaluateAdaptation(input({ workout: sat, plan: plan({ week, template_week_minutes: 140 }), today: '2026-10-23' }));
  assert.equal(r.type, 'moved');
  if (r.type !== 'moved') return;
  assert.equal(r.to, '2026-10-25');
  assert.equal(r.facts.workout_duration_min, 100);
  assert.equal(sat.planned_distance_km, 18);
});

test('back-off downgrades intervals and threshold to steady state, tempo to endurance, same duration', () => {
  for (const [from, to, reason] of [
    ['intervals', 'steady_state', 'posture_backoff_intervals_scheduled'],
    ['threshold', 'steady_state', 'posture_backoff_threshold_scheduled'],
    ['tempo', 'endurance', 'posture_backoff_tempo_scheduled'],
  ] as const) {
    const workout = w('tue', '2026-10-20', from, 55);
    const r = evaluateAdaptation(input({ posture: 'back-off', workout }));
    assert.equal(r.type, 'downgraded', from);
    if (r.type !== 'downgraded') continue;
    assert.equal(r.from_intensity, from);
    assert.equal(r.to_intensity, to);
    assert.equal(r.duration_min, 55);
    assert.equal(r.reason_code, reason);
    assert.equal(r.facts.week_minutes_before, r.facts.week_minutes_after);
  }
});

test('a downgrade is not blocked by the volume guard when the week was already off template', () => {
  const r = evaluateAdaptation(input({ posture: 'back-off', plan: plan({ template_week_minutes: 400 }) }));
  assert.equal(r.type, 'downgraded');
});

test('back-off never touches a long run or an easy day', () => {
  for (const i of ['long', 'easy', 'recovery', 'hard', 'moderate'] as const) {
    const r = evaluateAdaptation(input({ posture: 'back-off', workout: w('tue', '2026-10-20', i, 60) }));
    assert.deepEqual(r, { type: 'none', code: 'no_rule_matched', blocked_rule: null }, i);
  }
});

test('primed never pushes the athlete beyond the plan', () => {
  for (const i of ['easy', 'recovery', 'intervals', 'long'] as const) {
    const r = evaluateAdaptation(input({ posture: 'primed', workout: w('tue', '2026-10-20', i, 40) }));
    assert.deepEqual(r, { type: 'none', code: 'no_rule_matched', blocked_rule: null }, i);
  }
});

test('exhaustive: only rest + hard and back-off + intervals/threshold/tempo adapt', () => {
  const all: Intensity[] = [
    'rest', 'recovery', 'easy', 'moderate', 'endurance', 'steady_state', 'tempo', 'threshold', 'intervals', 'hard', 'long',
  ];
  const expected = new Set([
    'rest/hard', 'rest/intervals', 'rest/threshold', 'rest/tempo', 'rest/long',
    'back-off/intervals', 'back-off/threshold', 'back-off/tempo',
  ]);
  for (const p of POSTURES) {
    for (const i of all) {
      assert.equal(matchRule(p, i) !== null, expected.has(`${p}/${i}`), `${p}/${i}`);
    }
  }
});

test('race week freezes every adaptation, and says which rule it froze', () => {
  for (const race of ['2026-10-20', '2026-10-27']) { // race day itself, and T-7
    const r = evaluateAdaptation(input({ plan: plan({ goal_race_date: race }) }));
    assert.deepEqual(r, { type: 'none', code: 'race_week_freeze', blocked_rule: 'posture_rest_hard_scheduled' }, race);
  }
  const d = evaluateAdaptation(input({ posture: 'back-off', plan: plan({ goal_race_date: '2026-10-25' }) }));
  assert.equal(d.type, 'none');
});

test('T-8 still adapts, but a move cannot land inside race week', () => {
  // Race Fri 10-30: T-7 is Fri 10-23. Tue (T-10) may move, but only to Wed or Thu.
  const r = evaluateAdaptation(input({ plan: plan({ goal_race_date: '2026-10-30' }) }));
  assert.equal(r.type, 'moved');
  if (r.type === 'moved') assert.equal(r.to, '2026-10-22');

  const blocked = evaluateAdaptation(input({ plan: plan({ goal_race_date: '2026-10-29' }) }));
  // T-7 is Thu 10-22, so only Wed is left and it breaks the volume band.
  assert.deepEqual(blocked, { type: 'none', code: 'skip_volume_guard', blocked_rule: 'posture_rest_hard_scheduled' });
});

test('a race already past does not freeze', () => {
  const r = evaluateAdaptation(input({ plan: plan({ goal_race_date: '2026-10-01' }) }));
  assert.equal(r.type, 'moved');
});

test("a coach's or an external plan is never adapted by the engine", () => {
  for (const source of ['coach', 'external'] as const) {
    assert.deepEqual(evaluateAdaptation(input({ plan: plan({ source }) })), {
      type: 'none', code: 'source_not_adaptable', blocked_rule: null,
    });
  }
});

test('never retroactive: today and past workouts are not adapted', () => {
  for (const today of ['2026-10-20', '2026-10-21']) {
    assert.equal((evaluateAdaptation(input({ today })) as { code?: string }).code, 'workout_not_in_future');
  }
});

test('a completed workout is not adapted', () => {
  const r = evaluateAdaptation(input({ workout: { ...TUE, athlete_completed: true } }));
  assert.deepEqual(r, { type: 'none', code: 'workout_completed', blocked_rule: null });
});

test('the evaluated workout counts toward the week even when plan.week omits it', () => {
  const week = spacedWeek.filter((x) => x.id !== 'tue');
  const r = evaluateAdaptation(input({ plan: plan({ week }) }));
  assert.equal(r.type, 'moved');
  if (r.type === 'moved') assert.equal(r.facts.week_minutes_before, 230);
});

test('with no template call, the scheduled week is the baseline', () => {
  const r = evaluateAdaptation(input({ plan: plan({ template_week_minutes: null }) }));
  assert.equal(r.type, 'moved');
  if (r.type === 'moved') assert.equal(r.facts.template_week_minutes, 230);
});

test('deterministic and pure: same input, same output, input untouched', () => {
  const i = input();
  const snapshot = JSON.stringify(i);
  assert.deepEqual(evaluateAdaptation(i), evaluateAdaptation(i));
  assert.equal(JSON.stringify(i), snapshot);
});

test('date helpers: UTC arithmetic, Monday-to-Sunday weeks, bad input throws', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // US DST start
  assert.equal(daysBetween('2026-10-19', '2026-10-27'), 8);
  assert.equal(weekEnd('2026-10-19'), '2026-10-25'); // Monday
  assert.equal(weekEnd('2026-10-25'), '2026-10-25'); // Sunday
  assert.throws(() => addDays('2026-13-40', 1));
  assert.throws(() => daysBetween('10/19/2026', '2026-10-20'));
});

test("a move to Sunday sees the next Monday's hard session (review fix)", () => {
  const sat = w('sat', '2026-10-24', 'tempo', 50);
  const week = [sat, w('sun', '2026-10-25', 'rest', null), w('nextmon', '2026-10-26', 'intervals', 60)];
  const r = evaluateAdaptation(input({ workout: sat, plan: plan({ week, template_week_minutes: 50 }), today: '2026-10-23' }));
  assert.deepEqual(r, { type: 'none', code: 'skip_no_window', blocked_rule: 'posture_rest_hard_scheduled' });
  // Without the Monday session, Sunday is open.
  const open = evaluateAdaptation(input({ workout: sat, plan: plan({ week: week.slice(0, 2), template_week_minutes: 50 }), today: '2026-10-23' }));
  assert.equal(open.type, 'moved');
});

test("rows outside the plan week never count toward the week's minutes", () => {
  const week = [...spacedWeek, w('nextmon', '2026-10-26', 'easy', 60), w('prevsun', '2026-10-18', 'long', 120)];
  const r = evaluateAdaptation(input({ plan: plan({ week }) }));
  assert.equal(r.type, 'moved');
  if (r.type === 'moved') assert.equal(r.facts.week_minutes_before, 230);
});

test('the volume guard lets a change bring the week closer to the template', () => {
  // Week at 270 vs a 200 call (35% over). Displacing Wednesday's 40 leaves
  // 230 (15% over): still outside the band, but closer, so it is allowed and
  // Wednesday wins over the later rest day.
  const week = spacedWeek.map((x) => (x.id === 'fri' ? { ...x, planned_duration_min: 70 } : x));
  const r = evaluateAdaptation(input({ plan: plan({ week, template_week_minutes: 200 }) }));
  assert.equal(r.type, 'moved');
  if (r.type === 'moved') assert.deepEqual([r.to, r.displaced_workout_id, r.facts.week_minutes_after], ['2026-10-21', 'wed', 230]);
});

test('impossible calendar dates are refused, not rolled over (review fix)', () => {
  assert.throws(() => addDays('2026-02-30', 0), /invalid date/);
  assert.throws(() => daysBetween('2026-02-29', '2026-03-01'), /invalid date/); // 2026 is not a leap year
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
});
