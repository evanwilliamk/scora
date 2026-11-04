// Seeded randomized tests for the plan rules (CLAUDE.md 6.2 and 4.3) over the
// whole life of a plan: assemble from the fixture for a random race date, then
// walk it day by day with random postures, applying each decision the way the
// API does. Later decisions read the earlier ones, which a single evaluation
// cannot show. The seed in a failure message is the iteration to replay.
//
// Only the fixture's numbers are used. Shuffling its weekly pattern in memory
// reaches every weekday and opens days a session can move to; it is not a new
// template and not training content. Displacing an easy session is out of reach
// here (its 40 minutes are over 10 percent of any fixture week), and is covered
// by acceptance-6-2.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  DISPLACEABLE_INTENSITIES, HARD_INTENSITIES, WEEKDAYS, assemblePlan, evaluateAdaptation, loadTemplates,
  startDateForRace, templateWeekMinutes, weekMinutes,
} from '../src/index';
import type { AssembledPlan, PlannedWorkout, PlanTemplate, Posture, ReasonCode, Weekday } from '../src/index';
import { addDays, daysBetween, weekEnd, weekStart } from '../src/dates';

const ITERATIONS = 800;
const WALKS = 200; // each one is a whole plan, day by day
const FREEZE_DAYS = 7; // CLAUDE.md 6.2, written here so a changed constant fails this test
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const [FIXTURE] = loadTemplates(FIXTURES, { allowDrafts: true });

const POSTURES: Posture[] = ['primed', 'steady', 'moderate', 'back-off', 'rest', 'taper'];
const REASONS: ReasonCode[] = [
  'posture_rest_hard_scheduled', 'posture_rest_hard_no_window', 'posture_backoff_intervals_scheduled',
  'posture_backoff_threshold_scheduled', 'posture_backoff_tempo_scheduled',
];

// mulberry32: small, seeded, no dependency.
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];
  return { next, int, pick };
}
type R = ReturnType<typeof prng>;

function shuffled(t: PlanTemplate, r: R): PlanTemplate {
  const slots = WEEKDAYS.map((d) => t.weekly_pattern[d]);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const weekly_pattern = {} as Record<Weekday, string>;
  WEEKDAYS.forEach((d, i) => { weekly_pattern[d] = slots[i]; });
  return { ...t, weekly_pattern };
}

const raceDate = (r: R) => addDays('2026-01-01', r.int(1830)); // through 2030, leap day included

function caseOf(seed: number) {
  const r = prng(seed);
  const template = shuffled(FIXTURE, r);
  const race = raceDate(r);
  const start_date = startDateForRace(template, race);
  return { r, template, race, start_date, plan: assemblePlan({ template, start_date, goal_race_date: race }) };
}

test('assembled plans hold the race date rules for any race and pattern', () => {
  const seenDow = new Set<number>();
  for (let seed = 1; seed <= ITERATIONS; seed++) {
    const { template, race, start_date, plan } = caseOf(seed);
    const w = `seed ${seed}, race ${race}, start ${start_date}`;
    const dow = (new Date(`${race}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
    seenDow.add(dow);

    assert.equal(new Date(`${start_date}T00:00:00Z`).getUTCDay(), 1, `start is not a Monday: ${w}`);
    assert.equal(plan.goal_race_date, race);
    assert.deepEqual(assemblePlan({ template, start_date, goal_race_date: race }), plan, `not deterministic: ${w}`);
    assert.equal(new Set(plan.workouts.map((x) => x.id)).size, plan.workouts.length, `duplicate id: ${w}`);

    const slots = WEEKDAYS.filter((d) => template.weekly_pattern[d] !== 'rest');
    for (const x of plan.workouts) {
      assert.ok(x.scheduled_date >= start_date, `before the start: ${w}`);
      assert.ok(x.scheduled_date < race, `scheduled on or after race day (${x.scheduled_date}): ${w}`);
      assert.ok(x.scheduled_date <= plan.end_date, `after the plan's end: ${w}`);
      // Every workout and every number comes from the template.
      assert.equal(x.planned_intensity, template.workout_definitions[x.workout_key]?.intensity, `not from the template: ${w}`);
    }

    // Every week but the last is whole, whatever the race day.
    for (let week = 1; week < template.duration_weeks; week++) {
      assert.deepEqual(plan.workouts.filter((x) => x.week === week).map((x) => x.weekday), slots, `week ${week} lost a session: ${w}`);
    }
    const final = plan.workouts.filter((x) => x.week === template.duration_weeks).map((x) => x.weekday);
    if (dow <= 2) {
      // Monday to Wednesday: the whole final week runs first, and the plan ends on race day.
      assert.deepEqual(final, slots, `early-week race lost part of the final week: ${w}`);
      assert.equal(plan.end_date, race, `plan does not end on race day: ${w}`);
      assert.equal(daysBetween(addDays(start_date, 7 * template.duration_weeks - 1), race), dow + 1, `race is not right after the final week: ${w}`);
    } else {
      // Thursday to Sunday: the race is in the final week; it keeps only the days before it.
      assert.deepEqual(final, slots.filter((d) => WEEKDAYS.indexOf(d) < dow), `late-week race kept the wrong days: ${w}`);
      assert.equal(weekStart(race), addDays(start_date, 7 * (template.duration_weeks - 1)), `race is not in the final week: ${w}`);
    }

    // week_minutes is the plan as stored; no week grows more than 10 percent.
    plan.week_minutes.forEach((m, i) => {
      assert.equal(m, weekMinutes(plan.workouts.filter((x) => x.week === i + 1)), `week_minutes ${i + 1}: ${w}`);
      if (i > 0) assert.ok(m <= plan.week_minutes[i - 1] * 1.1 + 1e-9, `week ${i + 1} grows past 10 percent: ${w}`);
    });
  }
  assert.equal(seenDow.size, 7, 'the seeds should reach every race weekday');
});

// One row as the database holds it. Long runs carry a distance so a change would show.
interface Row extends PlannedWorkout {
  was: string;
}

function rowsOf(plan: AssembledPlan, r: R): Row[] {
  return plan.workouts.map((x) => ({
    id: x.id,
    was: x.scheduled_date,
    scheduled_date: x.scheduled_date,
    planned_intensity: x.planned_intensity,
    planned_duration_min: x.planned_duration_min,
    planned_distance_km: x.planned_intensity === 'long' ? 10 + r.int(20) : null,
    athlete_completed: r.next() < 0.05 ? true : null,
  }));
}

const isHard = (w: PlannedWorkout) => HARD_INTENSITIES.includes(w.planned_intensity);

test('a whole plan under random postures keeps the 6.2 and 4.3 rules at every step', () => {
  const stats = { moved: 0, downgraded: 0, frozen: 0, longMoved: 0 };
  for (let seed = 1; seed <= WALKS; seed++) {
    const { r, template, race, start_date, plan } = caseOf(seed);
    let rows = rowsOf(plan, r);
    const original = structuredClone(rows);
    const calls = templateWeekMinutes(template);
    // Days with a run of one posture show repeated decisions on the same session.
    const bias = r.next() < 0.5 ? r.pick(POSTURES) : null;

    for (let today = addDays(start_date, -1); today < race; today = addDays(today, 1)) {
      const tomorrow = addDays(today, 1);
      const posture = bias && r.next() < 0.8 ? bias : r.pick(POSTURES);
      const monday = weekStart(tomorrow);
      const weekIndex = daysBetween(start_date, monday) / 7;
      for (const id of rows.filter((x) => x.scheduled_date === tomorrow).map((x) => x.id)) {
        const workout = rows.find((x) => x.id === id);
        if (!workout || workout.scheduled_date !== tomorrow) continue;
        const week = rows.filter((x) => x.scheduled_date >= monday && x.scheduled_date <= addDays(monday, 7));
        const call = calls[weekIndex] ?? null;
        const w = `seed ${seed}, race ${race}, today ${today}, ${posture}, ${workout.id} ${workout.planned_intensity}`;
        const inWeek = week.filter((x) => x.scheduled_date <= weekEnd(tomorrow));
        const d = evaluateAdaptation({
          posture, workout, today,
          plan: { source: 'scora_ai', goal_race_date: race, week, template_week_minutes: call },
        });

        // Same input, same decision.
        assert.deepEqual(evaluateAdaptation({ posture, workout, today, plan: { source: 'scora_ai', goal_race_date: race, week, template_week_minutes: call } }), d, `not deterministic: ${w}`);

        const toRace = daysBetween(tomorrow, race);
        if (toRace >= 0 && toRace <= FREEZE_DAYS) {
          assert.equal(d.type, 'none', `race week adapted: ${w}`);
          stats.frozen++;
        }
        if (posture !== 'rest' && posture !== 'back-off') {
          assert.equal(d.type, 'none', `${posture} changed the plan: ${w}`);
        }
        if (workout.athlete_completed) assert.equal(d.type, 'none', `completed session changed: ${w}`);
        if (d.type === 'none') continue;

        assert.ok(REASONS.includes(d.reason_code), `no named reason: ${w}`);
        assert.equal(d.workout_id, workout.id, `reason names another session: ${w}`);
        assert.equal(d.facts.workout_date, tomorrow, `facts name another day: ${w}`);
        assert.equal(d.facts.posture, posture, `facts name another posture: ${w}`);
        if (workout.planned_intensity === 'long') assert.equal(d.type, 'moved', `long run reshaped: ${w}`);

        if (d.type === 'downgraded') {
          assert.equal(d.duration_min, workout.planned_duration_min, `downgrade changed the duration: ${w}`);
          assert.ok(!HARD_INTENSITIES.includes(d.to_intensity), `downgrade to a hard session: ${w}`);
          assert.equal(d.facts.week_minutes_after, d.facts.week_minutes_before, `downgrade changed the week: ${w}`);
          workout.planned_intensity = d.to_intensity;
          stats.downgraded++;
          continue;
        }

        assert.ok(d.to > d.from && d.to <= weekEnd(d.from), `moved out of its week or backward: ${w}`);
        const left = daysBetween(d.to, race);
        assert.ok(left > FREEZE_DAYS, `moved into race week or past the race (${d.to}): ${w}`);
        const others = week.filter((x) => x.id !== workout.id && x.id !== d.displaced_workout_id);
        for (const near of [addDays(d.to, -1), addDays(d.to, 1)]) {
          assert.ok(!others.some((x) => x.scheduled_date === near && isHard(x)), `hard days cluster around ${d.to}: ${w}`);
        }
        if (d.displaced_workout_id) {
          const gone = rows.find((x) => x.id === d.displaced_workout_id)!;
          assert.ok(DISPLACEABLE_INTENSITIES.includes(gone.planned_intensity), `displaced a ${gone.planned_intensity}: ${w}`);
          assert.ok(!gone.athlete_completed, `displaced a completed session: ${w}`);
          assert.equal(gone.scheduled_date, d.to, `displaced a session from another day: ${w}`);
          rows = rows.filter((x) => x.id !== gone.id);
        }
        assert.equal(d.facts.week_minutes_before, weekMinutes(inWeek), `facts misstate the week: ${w}`);
        workout.scheduled_date = d.to;
        if (workout.planned_intensity === 'long') stats.longMoved++;
        stats.moved++;
      }
    }

    const w = `seed ${seed}, race ${race}`;
    const end = new Map(rows.map((x) => [x.id, x]));
    for (const was of original) {
      const now = end.get(was.id);
      // Long runs are never removed and never change shape; a move stays inside the week.
      if (was.planned_intensity === 'long') {
        assert.ok(now, `long run removed: ${w}`);
        assert.equal(now.planned_distance_km, was.planned_distance_km, `long run distance changed: ${w}`);
        assert.equal(now.planned_duration_min, was.planned_duration_min, `long run duration changed: ${w}`);
        assert.equal(now.planned_intensity, 'long', `long run intensity changed: ${w}`);
        assert.equal(weekStart(now.scheduled_date), weekStart(was.was), `long run left its week: ${w}`);
      }
      // Race week is exactly as assembled.
      if (daysBetween(was.scheduled_date, race) <= FREEZE_DAYS) {
        assert.deepEqual(now, was, `race week row changed: ${w}`);
      }
      if (was.athlete_completed) assert.deepEqual(now, was, `completed session changed: ${w}`);
    }
    // Nothing arrives in race week and nothing lands on or after race day.
    for (const x of rows) {
      assert.ok(x.scheduled_date < race, `on or after race day (${x.scheduled_date}): ${w}`);
      if (daysBetween(x.scheduled_date, race) <= FREEZE_DAYS) assert.equal(x.scheduled_date, x.was, `moved into race week: ${w}`);
    }
    // Weekly volume after all of it, against the same call the API passes.
    plan.week_minutes.forEach((_, i) => {
      if (i === template.duration_weeks - 1) return; // the race may cut the final week; it never adapts
      const week = rows.filter((x) => daysBetween(start_date, x.scheduled_date) >= 7 * i && daysBetween(start_date, x.scheduled_date) < 7 * (i + 1));
      const off = Math.abs(weekMinutes(week) - calls[i]) / calls[i];
      assert.ok(off <= 0.1 + 1e-9, `week ${i + 1} ends ${Math.round(off * 100)} percent off its call: ${w}`);
    });
  }
  // The walk has to reach the rules, or this proves nothing.
  for (const [k, v] of Object.entries(stats)) assert.ok(v > 0, `the seeds never reached ${k}`);
});

test('a plan that is not SCORA\'s own, a past session and a completed session never change', () => {
  for (let seed = 1; seed <= ITERATIONS; seed++) {
    const { r, race, plan } = caseOf(seed);
    const rows = rowsOf(plan, r);
    const workout = r.pick(rows.filter((x) => isHard(x)));
    const base = { posture: r.pick(['rest', 'back-off'] as Posture[]), workout, plan: { source: 'scora_ai' as const, goal_race_date: race, week: rows } };
    const w = `seed ${seed}`;
    for (const source of ['coach', 'external'] as const) {
      const d = evaluateAdaptation({ ...base, today: addDays(workout.scheduled_date, -1), plan: { ...base.plan, source } });
      assert.equal(d.type, 'none', `${source} plan changed: ${w}`);
    }
    const onOrAfter = addDays(workout.scheduled_date, r.int(30));
    assert.equal(evaluateAdaptation({ ...base, today: onOrAfter }).type, 'none', `past session changed: ${w}`);
    const done = { ...workout, athlete_completed: true };
    assert.equal(evaluateAdaptation({ ...base, workout: done, today: addDays(workout.scheduled_date, -1) }).type, 'none', `completed session changed: ${w}`);
  }
});
