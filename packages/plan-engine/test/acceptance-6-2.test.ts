// Acceptance criteria doc 10 §6.2 (plan content, always), checked as
// properties over many generated plan weeks rather than one example each.
// The weeks are synthetic test inputs for the rules, not training content.
//
// For every decision the engine makes:
//   - only rest + hard and back-off + intervals/threshold/tempo ever adapt
//   - every adaptation carries a reason code (the plain-English reason is
//     written from it, see apps/api/test/acceptance-gaps.test.ts)
//   - no adaptation takes the week more than 10% away from the template call
//   - a long run is never downgraded, and a move keeps its duration
//   - a workout 0 to 7 days before the race never adapts, and nothing moves
//     into that window
//   - a move stays in the plan week, lands later, and never next to a hard day

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSTURES } from '@scora/posture';
import { evaluateAdaptation, weekMinutes } from '../src/index';
import type { Intensity, PlannedWorkout } from '../src/index';
import { addDays, daysBetween } from '../src/dates';

const HARD: Intensity[] = ['hard', 'intervals', 'threshold', 'tempo', 'long'];
const POOL: Intensity[] = ['rest', 'recovery', 'easy', 'moderate', 'endurance', 'steady_state', 'tempo', 'threshold', 'intervals', 'hard', 'long'];
const MONDAY = '2026-10-19';
const SUNDAY = '2026-10-25';

// Small seeded generator so a failure reproduces exactly.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Case {
  week: PlannedWorkout[];
  template: number;
  race: string | null;
}

function makeCase(r: () => number, n: number): Case {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const week: PlannedWorkout[] = [];
  // Monday to Sunday, plus the next Monday for the adjacency check.
  for (let d = 0; d < 8; d++) {
    const date = addDays(MONDAY, d);
    const sessions = r() < 0.15 ? 2 : 1;
    for (let k = 0; k < sessions; k++) {
      const i = pick(POOL);
      week.push({
        id: `w${n}-${d}-${k}`,
        scheduled_date: date,
        planned_intensity: i,
        planned_duration_min: i === 'rest' ? null : r() < 0.05 ? null : 20 + Math.floor(r() * 100),
        planned_distance_km: i === 'long' ? 14 + Math.floor(r() * 16) : null,
        athlete_completed: r() < 0.05 ? true : null,
      });
    }
  }
  const inWeek = week.filter((w) => daysBetween(w.scheduled_date, SUNDAY) >= 0);
  // The template call is sometimes the week as stored, sometimes up to 20% off.
  const template = Math.max(1, Math.round(weekMinutes(inWeek) * (r() < 0.5 ? 1 : 0.8 + r() * 0.4)));
  const race = r() < 0.5 ? null : addDays(MONDAY, Math.floor(r() * 20) - 2);
  return { week, template, race };
}

const near = (week: PlannedWorkout[], self: string, date: string) =>
  week.some((w) => w.id !== self && w.scheduled_date === date && HARD.includes(w.planned_intensity));

test('§6.2 properties hold for every posture and session across 400 generated weeks', () => {
  const r = rng(20261102);
  let adapted = 0;
  let moved = 0;
  let frozen = 0;
  for (let n = 0; n < 400; n++) {
    const c = makeCase(r, n);
    for (const workout of c.week.filter((w) => daysBetween(w.scheduled_date, SUNDAY) >= 0)) {
      for (const posture of POSTURES) {
        const plan = { source: 'scora_ai' as const, goal_race_date: c.race, week: c.week, template_week_minutes: c.template };
        const today = addDays(workout.scheduled_date, -1);
        const d = evaluateAdaptation({ posture, workout, plan, today });
        const where = `case ${n}, ${workout.id} ${workout.planned_intensity}, posture ${posture}, race ${c.race}`;

        const toRace = c.race ? daysBetween(workout.scheduled_date, c.race) : null;
        if (toRace !== null && toRace >= 0 && toRace <= 7) {
          assert.equal(d.type, 'none', `race week adapted: ${where}`);
          frozen++;
        }
        if (d.type === 'none') continue;
        adapted++;

        // Only the deterministic rules adapt (CLAUDE.md §6.2).
        const i = workout.planned_intensity;
        const ruleFits = (posture === 'rest' && HARD.includes(i)) || (posture === 'back-off' && ['intervals', 'threshold', 'tempo'].includes(i));
        assert.ok(ruleFits, `no rule should fire: ${where}`);
        assert.equal(workout.athlete_completed === true, false, `completed session adapted: ${where}`);

        // A named reason, always.
        assert.ok(d.reason_code, `adaptation without a reason: ${where}`);

        // Weekly volume: never further than 10% from the template call.
        const { week_minutes_before: before, week_minutes_after: after, template_week_minutes: tmpl } = d.facts;
        if (after !== before) {
          const off = Math.abs(after - tmpl);
          assert.ok(off / tmpl <= 0.1 + 1e-9 || off <= Math.abs(before - tmpl), `volume ${before} -> ${after} vs ${tmpl}: ${where}`);
        }

        if (d.type === 'downgraded') {
          assert.notEqual(i, 'long', `long run downgraded: ${where}`);
          assert.equal(d.duration_min, workout.planned_duration_min, `downgrade changed duration: ${where}`);
          assert.equal(after, before, `downgrade changed the week: ${where}`);
        } else {
          moved++;
          assert.equal(posture, 'rest', `only rest moves: ${where}`);
          assert.equal(d.facts.workout_duration_min, workout.planned_duration_min, `move changed duration: ${where}`);
          assert.ok(daysBetween(d.from, d.to) > 0, `move not later: ${where}`);
          assert.ok(daysBetween(d.to, SUNDAY) >= 0, `move left the plan week: ${where}`);
          if (c.race) {
            const k = daysBetween(d.to, c.race);
            assert.ok(!(k >= 0 && k <= 7), `moved into race week: ${where}`);
          }
          assert.ok(!near(c.week, workout.id, addDays(d.to, -1)) && !near(c.week, workout.id, addDays(d.to, 1)), `hard days clustered: ${where}`);
        }
      }
    }
  }
  // The generator must actually exercise every branch, or the test proves nothing.
  assert.ok(adapted > 100, `only ${adapted} adaptations`);
  assert.ok(moved > 20, `only ${moved} moves`);
  assert.ok(frozen > 50, `only ${frozen} frozen`);
});

test('§6.2 a coach or external plan never adapts, whatever the posture', () => {
  const r = rng(7);
  for (let n = 0; n < 50; n++) {
    const c = makeCase(r, n);
    for (const source of ['coach', 'external'] as const) {
      for (const workout of c.week) {
        for (const posture of POSTURES) {
          const d = evaluateAdaptation({
            posture, workout, today: addDays(workout.scheduled_date, -1),
            plan: { source, goal_race_date: c.race, week: c.week, template_week_minutes: c.template },
          });
          assert.equal(d.type, 'none');
        }
      }
    }
  }
});
