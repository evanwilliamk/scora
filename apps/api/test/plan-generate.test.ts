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
    [{ goal_race_date: '2026-02-30' }, /goal_race_date/], [{ goal_race_date: '2026-13-01' }, /goal_race_date/],
    [{ goal_race_date: '2026-04-31' }, /goal_race_date/], [{ goal_race_date: '2026-02-29' }, /goal_race_date/],
    [{ goal_race_date: '2026-00-10' }, /goal_race_date/], [{ goal_race_date: '2026-11-00' }, /goal_race_date/],
  ] as const) {
    assert.throws(() => parseGenerateRequest({ ...base, ...over }), (e: unknown) => e instanceof GenerateError && field.test(e.message));
  }
});

test('request parsing keeps real dates, leap day included', () => {
  const base = { sport: 'run', goal_type: '10k', experience_level: 'regular', current_weekly_km: 35 };
  for (const d of ['2028-02-29', '2026-12-31', '2027-01-01']) {
    assert.equal(parseGenerateRequest({ ...base, goal_race_date: d }).goal_race_date, d);
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
  const rows = (await db.query<any>(`select id, current_status from training_plans where athlete_id = 'g1' order by current_status`)).rows;
  assert.deepEqual(rows.map((r) => [r.id === first, r.current_status]), [[false, 'active'], [true, 'replaced']]);
  assert.ok(planId);
  const t = await db.query(`select 1 from plan_templates where slug = 'test-fixture-4wk'`);
  assert.equal(t.rows.length, 1);
});

test('no matching template: a named error, nothing stored, no invented plan', async () => {
  const store = sqlGenerateStore(db);
  assert.equal(await code(generatePlan('g2', { ...req, goal_type: 'marathon' }, '2026-10-21', templates, store)), 'template_not_available');
  // Same race, volume above the fixture's [30, 45): named as a volume mismatch (doc 09 §2.6).
  assert.equal(await code(generatePlan('g2', { ...req, current_weekly_km: 80 }, '2026-10-21', templates, store)), 'volume_out_of_range');
  await assert.rejects(generatePlan('g2', { ...req, current_weekly_km: 10 }, '2026-10-21', templates, store),
    (e: any) => e.code === 'volume_out_of_range' && e.message === 'This plan would ramp too fast from your current volume. It starts from 30 km a week.');
  await assert.rejects(generatePlan('g2', { ...req, current_weekly_km: 45 }, '2026-10-21', templates, store),
    (e: any) => e.message === 'This plan is built for under 45 km a week, below your current volume.');
  assert.equal((await db.query(`select 1 from training_plans where athlete_id = 'g2'`)).rows.length, 0);
});

test('with templates of two lengths, the one that still fits before the race is chosen', async () => {
  // In-memory only: a longer, newer variant of the 4-week fixture. Race 11-15
  // from 10-21: 4 weeks starts this Monday, 8 weeks would have started in
  // September. The version tie-break alone picked the 8-week and refused.
  const [four] = templates;
  const eight = { ...four, slug: 'test-fixture-8wk', version: '9.0.0', duration_weeks: 8 };
  let stored: any = null;
  const store = { hasActiveCoachPlan: async () => false, createPlan: async (p: any) => { stored = p; return 'mem-1'; } };
  const { plan } = await generatePlan('mem', req, '2026-10-21', [eight, four], store);
  assert.equal(plan.template_slug, four.slug);
  assert.equal(plan.start_date, '2026-10-19');
  assert.equal(stored.template.slug, four.slug);
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

test('review fixes: a generated plan replaces an active pasted plan too', async () => {
  await db.query(`insert into training_plans (athlete_id, source, external_source, start_date, end_date) values ('m1', 'external', 'manual', '2026-10-19', '2026-11-30')`);
  await generatePlan('m1', req, '2026-10-21', templates, sqlGenerateStore(db));
  const rows = (await db.query<any>(`select source, current_status from training_plans where athlete_id = 'm1' order by source`)).rows;
  assert.deepEqual(rows.map((r) => [r.source, r.current_status]), [['external', 'replaced'], ['scora_ai', 'active']]);
});

test('review fixes: a template changed under the same version is refused; review state may move forward', async () => {
  const store = sqlGenerateStore(db);
  const [t] = templates;
  const changed = { ...t, workout_definitions: { ...t.workout_definitions, easy_run: { ...t.workout_definitions.easy_run, duration_min: 45 } } };
  assert.match(await code(generatePlan('x1', req, '2026-10-21', [changed], store)), /changed without a version bump/);
  const reviewed = { ...t, status: 'reviewed' as const, reviewed_by: 'A Coach', reviewed_on: '2026-10-17' };
  await generatePlan('x2', req, '2026-10-21', [reviewed], store);
  const row = (await db.query<any>(`select status, reviewed_by from plan_templates where slug = 'test-fixture-4wk'`)).rows[0];
  assert.deepEqual(row, { status: 'reviewed', reviewed_by: 'A Coach' });
});

test('planOptions: one entry per sport and goal, each level with its km range and shortest plan (doc 09 §2.3)', async () => {
  const { planOptions, goalLabel } = await import('../src/plan-generate');
  const t = (sport: string, goal_type: string, experience_level: string, km: [number, number], weeks: number) =>
    ({ sport, goal_type, experience_level, weekly_volume_range_km: km, duration_weeks: weeks });
  assert.deepEqual(planOptions([]), []);
  assert.deepEqual(planOptions([
    t('run', 'marathon', 'competitive', [60, 90], 16), t('run', 'half_marathon', 'regular', [30, 50], 12),
    t('run', 'marathon', 'first_timer', [30, 45], 18), t('run', 'marathon', 'first_timer', [40, 60], 16),
    t('ride', 'gravel_century', 'regular', [100, 200], 10),
  ]), [
    { sport: 'ride', goal_type: 'gravel_century', label: 'Gravel century', levels: [{ level: 'regular', weekly_km: [100, 200], min_weeks: 10 }] },
    { sport: 'run', goal_type: 'half_marathon', label: 'Half marathon', levels: [{ level: 'regular', weekly_km: [30, 50], min_weeks: 12 }] },
    { sport: 'run', goal_type: 'marathon', label: 'Marathon', levels: [
      { level: 'first_timer', weekly_km: [30, 60], min_weeks: 16 },
      { level: 'competitive', weekly_km: [60, 90], min_weeks: 16 },
    ] },
  ]);
  assert.equal(goalLabel('trail_30k'), 'Trail 30k');
});

test('planBlock: week of the plan, phases with their weeks, the current one, the race (PRD 5.B.1)', async () => {
  const { planBlock } = await import('../src/plan-generate');
  const plan = {
    start_date: '2026-10-05', goal_race_date: '2026-12-27',
    template: { goal_type: 'half_marathon', duration_weeks: 12, phases: [
      { name: 'Base', weeks: [1, 2, 3, 4], focus: 'aerobic development' },
      { name: 'Build', weeks: [5, 6, 7, 8, 9], focus: 'threshold work' },
      { name: 'Sharpen', weeks: [10, 11, 12], focus: 'race pace and taper' },
    ] },
  };
  const b = planBlock(plan, '2026-10-28'); // day 23: week 4
  assert.deepEqual([b.goal, b.week, b.weeks, b.race_date], ['Half marathon', 4, 12, '2026-12-27']);
  assert.deepEqual(b.phases.map((p) => [p.name, p.first_week, p.last_week, p.current]), [
    ['Base', 1, 4, true], ['Build', 5, 9, false], ['Sharpen', 10, 12, false],
  ]);
  assert.equal(planBlock(plan, '2026-10-05').week, 1);
  const early = planBlock(plan, '2026-09-30');
  assert.deepEqual([early.starts_on, early.phases.some((p) => p.current)], ['2026-10-05', false], 'not started: says when, no phase is current');
  assert.equal(b.starts_on, null);
  assert.equal(planBlock(plan, '2027-02-01').week, 12, 'after the end stays on the last week');
});
