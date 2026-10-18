// SCORA plan generation on an in-process Postgres (PGlite), from the
// plan-engine test fixture template. No network, no Supabase.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { loadTemplates } from '../../../packages/plan-engine/src/index';
import { GenerateError, generatePlan, parseGenerateRequest, sqlGenerateStore } from '../src/plan-generate';
import { adaptTomorrow, sqlAdaptStore } from '../src/plan-adapt';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '..', 'supabase', 'migrations');
const templates = loadTemplates(join(here, '..', '..', '..', 'packages', 'plan-engine', 'test', 'fixtures'), { allowDrafts: true });

let db: PGlite;
before(async () => {
  db = new PGlite({ extensions: { vector } });
  for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrations, f), 'utf8'));
  }
});
after(async () => {
  await db.close();
});

// The fixture: 4-week 10K, regular, 30 to 45 km.
const req = parseGenerateRequest({
  sport: 'run', goal_type: '10k', experience_level: 'regular', current_weekly_km: 35, goal_race_date: '2026-11-15',
});

const code = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e instanceof GenerateError ? e.code : String(e); }
  return 'no error';
};

test('request parsing names the bad field', () => {
  const base = { sport: 'run', goal_type: '10k', experience_level: 'regular', current_weekly_km: 35, goal_race_date: '2026-11-15' };
  for (const [over, field] of [
    [{ sport: 'rowing' }, /sport/], [{ goal_type: '' }, /goal_type/], [{ experience_level: 'elite' }, /experience_level/],
    [{ current_weekly_km: -1 }, /current_weekly_km/], [{ current_weekly_km: 'lots' }, /current_weekly_km/],
    [{ goal_race_date: '11/15/2026' }, /goal_race_date/],
  ] as const) {
    assert.throws(() => parseGenerateRequest({ ...base, ...over }), (e: unknown) => e instanceof GenerateError && field.test(e.message));
  }
});

test('stores the plan, its pinned template and every workout from today on, in one call', async () => {
  const store = sqlGenerateStore(db);
  const { planId, plan } = await generatePlan('g1', req, '2026-10-21', templates, store);
  assert.equal(plan.start_date, '2026-10-19');
  // Mon 10-19 and Tue 10-20 are before today; Sunday 11-15 is race day.
  assert.equal(plan.workouts.length, 18);
  const p = (await db.query<any>(
    `select p.source, p.current_status, to_char(p.goal_race_date, 'YYYY-MM-DD') as race, t.slug, t.version
     from training_plans p join plan_templates t on t.id = p.template_id where p.id = $1`, [planId])).rows[0];
  assert.deepEqual(p, { source: 'scora_ai', current_status: 'active', race: '2026-11-15', slug: 'test-fixture-4wk', version: '0.0.1' });
  const w = await db.query<any>(
    `select to_char(scheduled_date, 'YYYY-MM-DD') as d, planned_type, planned_intensity, planned_duration_min, workout_structure_json
     from scheduled_workouts where training_plan_id = $1 order by scheduled_date`, [planId]);
  assert.equal(w.rows.length, 18);
  assert.deepEqual(
    [w.rows[0].d, w.rows[0].planned_type, w.rows[0].planned_intensity, w.rows[0].planned_duration_min],
    ['2026-10-21', 'run', 'easy', 40],
  );
  assert.deepEqual(w.rows[0].workout_structure_json, [{ type: 'steady', duration_min: 40, intensity: 'easy' }]);
});

test('a new plan replaces the active one; the template row is reused, not duplicated', async () => {
  const store = sqlGenerateStore(db);
  const first = (await db.query<any>(`select id from training_plans where athlete_id = 'g1' and current_status = 'active'`)).rows[0].id;
  const { planId } = await generatePlan('g1', { ...req, goal_race_date: '2026-11-22' }, '2026-10-26', templates, store);
  const rows = (await db.query<any>(`select id, current_status from training_plans where athlete_id = 'g1' order by created_at`)).rows;
  assert.deepEqual(rows.map((r) => [r.id === first, r.current_status]), [[true, 'replaced'], [false, 'active']]);
  assert.ok(planId);
  const t = await db.query(`select 1 from plan_templates where slug = 'test-fixture-4wk'`);
  assert.equal(t.rows.length, 1);
});

test('no matching template: a named error, nothing stored, no invented plan', async () => {
  const store = sqlGenerateStore(db);
  assert.equal(await code(generatePlan('g2', { ...req, goal_type: 'marathon' }, '2026-10-21', templates, store)), 'template_not_available');
  assert.equal(await code(generatePlan('g2', { ...req, current_weekly_km: 80 }, '2026-10-21', templates, store)), 'template_not_available');
  assert.equal((await db.query(`select 1 from training_plans where athlete_id = 'g2'`)).rows.length, 0);
});

test('a race too close for the template is refused', async () => {
  const store = sqlGenerateStore(db);
  // Race 11-08: a 4-week plan would have started 10-12, before this week.
  assert.equal(await code(generatePlan('g3', { ...req, goal_race_date: '2026-11-08' }, '2026-10-21', templates, store)), 'race_too_soon');
  assert.equal(await code(generatePlan('g3', { ...req, goal_race_date: '2026-10-01' }, '2026-10-21', templates, store)), 'race_too_soon');
});

test('a generated plan is one the adaptation engine reads and adapts', async () => {
  await generatePlan('g4', req, '2026-10-19', templates, sqlGenerateStore(db));
  const [r] = await adaptTomorrow('g4', '2026-10-28', 'back-off', sqlAdaptStore(db), { allowDrafts: true });
  assert.equal(r.decision.type, 'downgraded');
  assert.ok(r.adaptation_id);
});

test('no SCORA plan is generated while a coach plan is active', async () => {
  await db.query(`insert into training_plans (athlete_id, source, start_date, end_date) values ('k2', 'coach', '2026-10-19', '2026-12-31')`);
  assert.equal(await code(generatePlan('k2', req, '2026-10-21', templates, sqlGenerateStore(db))), 'coach_plan_active');
});
