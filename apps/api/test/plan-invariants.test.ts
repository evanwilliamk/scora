// scripts/plan-invariants.sql (doc 10 §6.2), run as written on PGlite: each
// bar is broken once on purpose and must show up, and clean changes must not.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(here, '..', 'scripts', 'plan-invariants.sql'), 'utf8');

let db: PGlite;
before(async () => {
  db = new PGlite({ extensions: { vector } });
  const dir = join(here, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
});
after(async () => { await db.close(); });

const audit = async () => (await db.query<any>(SQL)).rows.map((r) => [r.check_name, r.athlete_id]);

let tpl: string;
async function plan(athlete: string, raceInDays: number | null = null): Promise<string> {
  tpl ??= (await db.query<any>(
    `insert into plan_templates (slug, version, sport, goal_type, duration_weeks, experience_level,
       weekly_volume_range_km, author, structure_json)
     values ('inv-fixture', '0.0.1', 'run', '10k', 4, 'regular', '[30,45)', 'Test Fixture', '{}') returning id`)).rows[0].id;
  return (await db.query<any>(
    `insert into training_plans (athlete_id, source, template_id, start_date, end_date, goal_race_date)
     values ($1, 'scora_ai', $2, current_date - 60, current_date + 60,
             case when $3::int is null then null else current_date + $3::int end) returning id`,
    [athlete, tpl, raceInDays])).rows[0].id;
}
// `day` counts from the Monday two weeks back, so a week is days 0 to 6.
async function session(athlete: string, planId: string, day: number, intensity: string, minutes: number | null) {
  return (await db.query<any>(
    `insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity, planned_duration_min, source)
     values ($1, $2, date_trunc('week', current_date - 14)::date + $3::int, 'run', $4, $5, 'scora_ai') returning id`,
    [athlete, planId, day, intensity, minutes])).rows[0].id;
}
async function adapt(athlete: string, planId: string, workoutId: string, type: string, newDay: number | null = null) {
  await db.query(
    `insert into plan_adaptations (athlete_id, training_plan_id, scheduled_workout_id, adaptation_type, original_date, new_date,
       original_workout_json, reason_code, reason_text, triggered_by)
     select $1, $2, w.id, $3, w.scheduled_date,
            case when $4::int is null then null else date_trunc('week', current_date - 14)::date + $4::int end,
            to_jsonb(w), 'test', 'Named.', 'auto_engine'
     from scheduled_workouts w where w.id = $5`,
    [athlete, planId, type, newDay, workoutId]);
  if (type === 'moved') {
    await db.query(`update scheduled_workouts set scheduled_date = date_trunc('week', current_date - 14)::date + $1::int where id = $2`, [newDay, workoutId]);
  } else if (type === 'skipped') {
    await db.query(`update scheduled_workouts set planned_intensity = 'rest', planned_duration_min = null where id = $1`, [workoutId]);
  } else if (type === 'downgraded') {
    await db.query(`update scheduled_workouts set planned_intensity = 'easy' where id = $1`, [workoutId]);
  }
}

test('clean adaptations leave no rows', async () => {
  const p = await plan('clean');
  const tempo = await session('clean', p, 1, 'tempo', 45);
  for (const d of [0, 2, 3, 4]) await session('clean', p, d, 'easy', 40);
  await session('clean', p, 6, 'long', 90);
  await adapt('clean', p, tempo, 'downgraded');
  assert.deepEqual(await audit(), []);
});

test('each broken bar shows up once', async () => {
  // A long run downgraded.
  const a = await plan('long');
  await adapt('long', a, await session('long', a, 6, 'long', 100), 'downgraded');

  // An adaptation 3 days before the race (the plan ends after it).
  const r = await plan('race', 3);
  const raceSession = (await db.query<any>(
    `insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity, planned_duration_min, source)
     values ('race', $1, current_date + 1, 'run', 'tempo', 30, 'scora_ai') returning id`, [r])).rows[0].id;
  await adapt('race', r, raceSession, 'downgraded');

  // A week of 4 x 60 min loses a 60 min session: 25%.
  const v = await plan('volume');
  const easy = await session('volume', v, 0, 'easy', 60);
  for (const d of [2, 4, 5]) await session('volume', v, d, 'easy', 60);
  await adapt('volume', v, easy, 'skipped');

  // A tempo moved to the day before another tempo.
  const h = await plan('hard');
  const moved = await session('hard', h, 1, 'tempo', 45);
  await session('hard', h, 4, 'intervals', 45);
  await session('hard', h, 0, 'easy', 45);
  await adapt('hard', h, moved, 'moved', 3);

  assert.deepEqual(await audit(), [
    ['hard_days_cluster', 'hard'],
    ['long_run_changed', 'long'],
    ['race_week', 'race'],
    ['weekly_volume', 'volume'],
  ]);
});
