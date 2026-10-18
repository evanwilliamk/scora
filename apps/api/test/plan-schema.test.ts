// Plan tier schema (doc 07 v2 §4.2 to §4.5) on an in-process Postgres
// (PGlite). No network, no Supabase project.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
let db: PGlite;

before(async () => {
  db = new PGlite({ extensions: { vector } });
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
});

after(async () => {
  await db.close();
});

const rejects = async (sql: string, params: unknown[] = []) => {
  await assert.rejects(db.query(sql, params));
};

const addTemplate = async (version = '1.0.0', status = 'draft', reviewer: string | null = null) => {
  const r = await db.query<{ id: string }>(
    `insert into plan_templates (slug, version, sport, goal_type, duration_weeks, experience_level,
       weekly_volume_range_km, author, status, reviewed_by, reviewed_on, structure_json)
     values ('test-fixture-4wk', $1, 'run', '10k', 4, 'regular', '[30,45)', 'Test', $2, $3, $4, '{}')
     returning id`,
    [version, status, reviewer, reviewer ? '2026-11-01' : null],
  );
  return r.rows[0].id;
};

const addPlan = async (athlete: string, templateId: string | null, source = 'scora_ai') => {
  const r = await db.query<{ id: string }>(
    `insert into training_plans (athlete_id, source, template_id, start_date, end_date, goal_race_date)
     values ($1, $2, $3, '2026-10-19', '2026-11-15', '2026-11-15') returning id`,
    [athlete, source, templateId],
  );
  return r.rows[0].id;
};

const addWorkout = async (athlete: string, planId: string, intensity: string) => {
  const r = await db.query<{ id: string }>(
    `insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity,
       planned_duration_min, source, workout_structure_json)
     values ($1, $2, '2026-10-20', 'run', $3, 42, 'scora_ai', '[{"type":"steady","duration_min":42,"intensity":"easy"}]')
     returning id`,
    [athlete, planId, intensity],
  );
  return r.rows[0].id;
};

test('templates keep every version; a reviewed template needs a reviewer and date', async () => {
  await addTemplate('1.0.0');
  await addTemplate('1.1.0', 'reviewed', 'A Coach');
  await rejects(
    `insert into plan_templates (slug, version, sport, goal_type, duration_weeks, experience_level,
       weekly_volume_range_km, author, structure_json)
     values ('test-fixture-4wk', '1.0.0', 'run', '10k', 4, 'regular', '[30,45)', 'Test', '{}')`,
  ); // same slug and version
  await rejects(
    `insert into plan_templates (slug, version, sport, goal_type, duration_weeks, experience_level,
       weekly_volume_range_km, author, status, structure_json)
     values ('x', '2.0.0', 'run', '10k', 4, 'regular', '[30,45)', 'Test', 'reviewed', '{}')`,
  );
  await rejects(
    `insert into plan_templates (slug, version, sport, goal_type, duration_weeks, experience_level,
       weekly_volume_range_km, author, structure_json)
     values ('x', 'v1', 'run', '10k', 4, 'regular', '[30,45)', 'Test', '{}')`,
  );
});

test('a SCORA plan names its template; other sources must not; one active SCORA plan per athlete', async () => {
  const t = await addTemplate('3.0.0');
  await addPlan('a1', t);
  await rejects(
    `insert into training_plans (athlete_id, source, start_date, end_date) values ('a2', 'scora_ai', '2026-10-19', '2026-11-15')`,
  );
  await rejects(
    `insert into training_plans (athlete_id, source, template_id, start_date, end_date) values ('a2', 'coach', $1, '2026-10-19', '2026-11-15')`,
    [t],
  );
  await rejects(
    `insert into training_plans (athlete_id, source, template_id, start_date, end_date) values ('a1', 'scora_ai', $1, '2026-10-19', '2026-11-15')`,
    [t],
  );
  // External plans still insert without a template (manual paste path).
  await addPlan('a1', null, 'external');
});

test('scheduled workouts accept the downgrade targets and a WorkoutKit structure', async () => {
  const plan = await addPlan('a3', await addTemplate('4.0.0'));
  for (const i of ['steady_state', 'endurance', 'intervals']) await addWorkout('a3', plan, i);
  await rejects(
    `insert into scheduled_workouts (athlete_id, scheduled_date, planned_type, planned_intensity, source)
     values ('a3', '2026-10-21', 'run', 'brutal', 'scora_ai')`,
  );
});

test('adaptations are named, typed, and cascade with the plan', async () => {
  const plan = await addPlan('a4', await addTemplate('5.0.0'));
  const w = await addWorkout('a4', plan, 'intervals');
  const insert = (type: string, reason: string, from: string | null, to: string | null) =>
    db.query(
      `insert into plan_adaptations (athlete_id, training_plan_id, scheduled_workout_id, adaptation_type,
         original_date, new_date, reason_code, reason_text, engine_version, triggered_by)
       values ('a4', $1, $2, $3, $4, $5, 'posture_rest_hard_scheduled', $6, 'adaptation-v1.0.0', 'auto_engine')`,
      [plan, w, type, from, to, reason],
    );
  await insert('moved', 'Moved to Thursday after a short night.', '2026-10-20', '2026-10-22');
  await insert('downgraded', 'Held at steady effort today.', null, null);
  await assert.rejects(insert('moved', 'No dates.', null, null));
  await assert.rejects(insert('moved', 'Same day.', '2026-10-20', '2026-10-20'));
  await assert.rejects(insert('downgraded', '   ', null, null)); // never silent
  await assert.rejects(insert('vanished', 'Bad type.', null, null));

  await db.query('delete from training_plans where id = $1', [plan]);
  const left = await db.query('select 1 from plan_adaptations where training_plan_id = $1', [plan]);
  assert.equal(left.rows.length, 0);
});
