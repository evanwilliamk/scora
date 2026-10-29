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
  assert.equal(rows[0].verdict, '3.1.10 NO DATA; 3.1.11 NO DATA');
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
  assert.equal(rows.at(-1).verdict, '3.1.10 adherence 66.7% FAIL; 3.1.11 0.25 adaptations per athlete per week PASS');
});
