// scripts/plan-gates.sql (doc 10 3.1.10 and 3.1.11), run as written on PGlite
// against the real migrations. Dates are relative to the database's today.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(here, '..', 'scripts', 'plan-gates.sql'), 'utf8');

let db: PGlite;
before(async () => {
  db = new PGlite({ extensions: { vector } });
  const dir = join(here, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
});
after(async () => { await db.close(); });

async function gates() {
  const r = await db.query<any>(SQL);
  return r.rows.map((x) => ({ ...x, scheduled: Number(x.scheduled), done: Number(x.done), adaptations: Number(x.adaptations) }));
}

test('no SCORA plans: no data', async () => {
  const rows = await gates();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, '3.1.10 NO DATA; 3.1.11 NO DATA; 3.1.9 NO DATA');
});

test('adherence and adaptation frequency per athlete and overall', async () => {
  const tpl = (await db.query<any>(
    `insert into plan_templates (slug, version, sport, goal_type, duration_weeks, experience_level,
       weekly_volume_range_km, author, structure_json)
     values ('gate-fixture', '0.0.1', 'run', '10k', 4, 'regular', '[30,45)', 'Test Fixture', '{}') returning id`)).rows[0].id;
  const plan = async (athlete: string, source = 'scora_ai') => (await db.query<any>(
    `insert into training_plans (athlete_id, source, template_id, start_date, end_date)
     values ($1, $2, $3, current_date - 40, current_date + 40) returning id`,
    [athlete, source, source === 'scora_ai' ? tpl : null])).rows[0].id;
  const session = async (athlete: string, planId: string, daysAgo: number, intensity: string, completed: boolean | null) => (await db.query<any>(
    `insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity, planned_duration_min, source, athlete_completed)
     values ($1, $2, current_date - $3::int, 'run', $4, 30, 'scora_ai', $5) returning id`,
    [athlete, planId, daysAgo, intensity, completed])).rows[0].id;

  const a = await plan('a');
  const wa = await session('a', a, 3, 'tempo', true);
  await session('a', a, 4, 'easy', true);
  await session('a', a, 5, 'easy', false);
  await session('a', a, 6, 'rest', null); // left out
  await session('a', a, 40, 'easy', false); // outside the window
  await session('a', a, 0, 'easy', null); // today is not yet past
  const b = await plan('b');
  await session('b', b, 2, 'long', true);
  await session('b', b, 3, 'easy', null);
  const c = await plan('c', 'coach'); // coach plans are not Plan tier
  await session('c', c, 2, 'easy', false);
  // A plan abandoned in the window still counts; a replaced one does not.
  const d = await plan('d');
  await session('d', d, 2, 'easy', true);
  await db.query(`update training_plans set current_status = 'abandoned' where id = $1`, [d]);
  const e = await plan('e');
  await session('e', e, 2, 'easy', false);
  await db.query(`update training_plans set current_status = 'replaced' where id = $1`, [e]);

  for (let i = 0; i < 3; i++) {
    await db.query(
      `insert into plan_adaptations (athlete_id, training_plan_id, scheduled_workout_id, adaptation_type, reason_code, reason_text, triggered_by, triggered_at)
       values ('a', $1, $2, 'downgraded', 'posture_backoff_tempo', 'Named.', 'auto_engine', now() - interval '3 days')`, [a, wa]);
  }
  await db.query(
    `insert into plan_adaptations (athlete_id, training_plan_id, scheduled_workout_id, adaptation_type, reason_code, reason_text, triggered_by, triggered_at)
     values ('a', $1, $2, 'downgraded', 'old', 'Named.', 'auto_engine', now() - interval '60 days')`, [a, wa]);
  // Today's is outside the window (it ends yesterday), and an athlete's own change is not the engine's.
  await db.query(
    `insert into plan_adaptations (athlete_id, training_plan_id, scheduled_workout_id, adaptation_type, reason_code, reason_text, triggered_by)
     values ('a', $1, $2, 'downgraded', 'today', 'Named.', 'auto_engine'), ('a', $1, $2, 'downgraded', 'mine', 'Named.', 'athlete_manual')`, [a, wa]);

  const rows = await gates();
  assert.deepEqual(rows.map((r) => [r.athlete_id, r.scheduled, r.done, r.adaptations]), [
    ['a', 3, 2, 3],
    ['b', 2, 1, 0],
    ['d', 1, 1, 0],
    ['ALL', 6, 4, 3],
  ]);
  // 4 of 6 done is 66.7%; 3 adaptations over 3 athletes and 4 weeks.
  assert.equal(rows.at(-1).verdict, '3.1.10 adherence 66.7% FAIL; 3.1.11 0.25 adaptations per athlete per week, highest 0.75 PASS; 3.1.9 NO DATA');

  // 3.1.9 counts sessions with steps (the only ones the app can send), from
  // each athlete's first send on. a: steps on days 5, 4, 3 and 1 ago; sent 4
  // and 3; day 5 is before the first send. b never sent, so b is left out.
  await session('a', a, 1, 'easy', null);
  await db.query(`update scheduled_workouts set workout_structure_json = '[]' where athlete_id = 'a' and scheduled_date in (current_date - 5, current_date - 4, current_date - 3, current_date - 1)`);
  await db.query(`update scheduled_workouts set workout_structure_json = '[]' where athlete_id = 'b'`);
  await db.query(`update scheduled_workouts set workout_kit_pushed_at = now() where athlete_id = 'a' and scheduled_date in (current_date - 3, current_date - 4)`);
  const after = await gates();
  assert.deepEqual(after.map((r) => [r.athlete_id, Number(r.watch_sent), Number(r.sendable)]), [['a', 2, 3], ['b', 0, 0], ['d', 0, 0], ['ALL', 2, 3]]);
  assert.match(after.at(-1).verdict, /; 3\.1\.9 66\.7% sent to the Watch FAIL$/);
  await db.query(`update scheduled_workouts set workout_kit_pushed_at = now() where athlete_id = 'a' and scheduled_date = current_date - 1`);
  assert.match((await gates()).at(-1).verdict, /; 3\.1\.9 100\.0% sent to the Watch PASS$/);
});

// 3.1.11 on a fresh database each: plan age, moves, and the per-athlete limit.
async function fresh() {
  const f = new PGlite({ extensions: { vector } });
  const dir = join(here, '..', 'supabase', 'migrations');
  for (const x of readdirSync(dir).filter((y) => y.endsWith('.sql')).sort()) {
    await f.exec(readFileSync(join(dir, x), 'utf8'));
  }
  const tpl = (await f.query<any>(
    `insert into plan_templates (slug, version, sport, goal_type, duration_weeks, experience_level,
       weekly_volume_range_km, author, structure_json)
     values ('gate-fixture', '0.0.1', 'run', '10k', 4, 'regular', '[30,45)', 'Test Fixture', '{}') returning id`)).rows[0].id;
  // A plan started startedDaysAgo with one done easy session a day since (up to 27 days).
  const plan = async (athlete: string, startedDaysAgo: number) => {
    const id = (await f.query<any>(
      `insert into training_plans (athlete_id, source, template_id, start_date, end_date)
       values ($1, 'scora_ai', $2, current_date - $3::int, current_date + 40) returning id`, [athlete, tpl, startedDaysAgo])).rows[0].id;
    const ws: string[] = [];
    for (let d = Math.min(startedDaysAgo, 28); d >= 1; d--) {
      ws.push((await f.query<any>(
        `insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity, planned_duration_min, source, athlete_completed)
         values ($1, $2, current_date - $3::int, 'run', 'easy', 30, 'scora_ai', true) returning id`, [athlete, id, d])).rows[0].id);
    }
    return { id, ws };
  };
  const adapt = async (athlete: string, p: { id: string; ws: string[] }, i: number, type = 'downgraded', reason = 'posture_backoff_tempo') => {
    await f.query(
      `insert into plan_adaptations (athlete_id, training_plan_id, scheduled_workout_id, adaptation_type, original_date, new_date, reason_code, reason_text, triggered_by, triggered_at)
       values ($1, $2, $3, $4, case when $4 = 'moved' then current_date - 3 end, case when $4 = 'moved' then current_date - 2 end,
         $5, 'Named.', 'auto_engine', now() - interval '2 days')`, [athlete, p.id, p.ws[i], type, reason]);
  };
  const all = async () => (await f.query<any>(SQL)).rows.map((x) => ({ ...x, adaptations: Number(x.adaptations), adaptations_per_week: Number(x.adaptations_per_week) }));
  return { f, plan, adapt, all };
}

test('3.1.11 divides by the weeks the plan overlaps the window, not always 4', async () => {
  const { f, plan, adapt, all } = await fresh();
  const young = await plan('young', 6); // under a week: counts as 1 week
  for (let i = 0; i < 3; i++) await adapt('young', young, i);
  const two = await plan('two', 14); // two weeks
  for (let i = 0; i < 3; i++) await adapt('two', two, i);
  const rows = await all();
  assert.deepEqual(rows.map((r) => [r.athlete_id, r.adaptations, r.adaptations_per_week]), [
    ['two', 3, 1.5],
    ['young', 3, 3],
    ['ALL', 6, 2],
  ]);
  assert.match(rows.at(-1).verdict, /3\.1\.11 2\.00 adaptations per athlete per week, highest 3\.00 FAIL/);
  await f.close();
});

test('3.1.11 counts a move once, not again for the session it displaced', async () => {
  const { f, plan, adapt, all } = await fresh();
  const p = await plan('m', 40);
  for (let i = 0; i < 5; i++) {
    await adapt('m', p, 2 * i, 'moved', 'posture_rest_hard');
    await adapt('m', p, 2 * i + 1, 'skipped', 'displaced_by_move');
  }
  const rows = await all();
  assert.deepEqual(rows.map((r) => [r.athlete_id, r.adaptations, r.adaptations_per_week]), [['m', 5, 1.25], ['ALL', 5, 1.25]]);
  assert.match(rows.at(-1).verdict, /highest 1\.25 PASS/);
  await f.close();
});

test('3.1.11 fails when any one athlete is over 2 a week, even if the average is under', async () => {
  const { f, plan, adapt, all } = await fresh();
  const x = await plan('x', 40);
  for (let i = 0; i < 9; i++) await adapt('x', x, i); // 2.25 a week
  await plan('y', 40);
  await plan('z', 40);
  const rows = await all();
  assert.deepEqual(rows.map((r) => [r.athlete_id, r.adaptations_per_week]), [['x', 2.25], ['y', 0], ['z', 0], ['ALL', 0.75]]);
  assert.match(rows.at(-1).verdict, /3\.1\.11 0\.75 adaptations per athlete per week, highest 2\.25 FAIL/);
  await f.close();
});
