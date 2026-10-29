// Plan adaptations end to end on an in-process Postgres (PGlite): a plan
// assembled from the plan-engine test fixture, tomorrow's workout through the
// rules, the change written in one transaction. No network, no Supabase.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { parse as parseYaml } from 'yaml';
import { assemblePlan, validateTemplate } from '../../../packages/plan-engine/src/index';
import { adaptTomorrow, downgradedStructure, planChangeContext, sqlAdaptStore } from '../src/plan-adapt';
import { validateVoice } from '../src/validator';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '..', 'supabase', 'migrations');
const fixture = join(here, '..', '..', '..', 'packages', 'plan-engine', 'test', 'fixtures', 'four-week.yaml');
const rawTemplate = parseYaml(readFileSync(fixture, 'utf8'));
const template = validateTemplate(rawTemplate, 'four-week.yaml', { allowDrafts: true });

let db: PGlite;
let store: ReturnType<typeof sqlAdaptStore>;
// workout ids by "w<week>:<weekday>", per athlete
const ids = new Map<string, Map<string, string>>();

async function seedPlan(athlete: string, templateId: string, source: 'scora_ai' | 'coach' = 'scora_ai') {
  const plan = assemblePlan({ template, start_date: '2026-10-19' });
  const p = await db.query<{ id: string }>(
    `insert into training_plans (athlete_id, source, template_id, start_date, end_date)
     values ($1, $2, $3, $4, $5) returning id`,
    [athlete, source, source === 'scora_ai' ? templateId : null, plan.start_date, plan.end_date],
  );
  const map = new Map<string, string>();
  for (const w of plan.workouts) {
    const r = await db.query<{ id: string }>(
      `insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity,
         planned_duration_min, source, workout_structure_json)
       values ($1, $2, $3, 'run', $4, $5, 'scora_ai', $6) returning id`,
      [athlete, p.rows[0].id, w.scheduled_date, w.planned_intensity, w.planned_duration_min, JSON.stringify(w.structure)],
    );
    map.set(`w${w.week}:${w.weekday}`, r.rows[0].id);
  }
  ids.set(athlete, map);
  return p.rows[0].id;
}

const row = async (id: string) =>
  (await db.query<any>(
    `select to_char(scheduled_date, 'YYYY-MM-DD') as date, planned_intensity, planned_duration_min, workout_structure_json
     from scheduled_workouts where id = $1`,
    [id],
  )).rows[0];

let templateId: string;
const DRAFTS = { allowDrafts: true };

before(async () => {
  db = new PGlite({ extensions: { vector } });
  for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrations, f), 'utf8'));
  }
  const t = await db.query<{ id: string }>(
    `insert into plan_templates (slug, version, sport, goal_type, duration_weeks, experience_level,
       weekly_volume_range_km, author, structure_json)
     values ('test-fixture-4wk', '0.0.1', 'run', '10k', 4, 'regular', '[30,45)', 'Test Fixture', $1) returning id`,
    [JSON.stringify(rawTemplate)],
  );
  templateId = t.rows[0].id;
  store = sqlAdaptStore(db);
});

after(async () => {
  await db.close();
});

test('back-off today, tempo tomorrow: downgraded to endurance at the same 40 minutes, with a named reason', async () => {
  await seedPlan('a1', templateId);
  const thu = ids.get('a1')!.get('w2:thursday')!;
  const [r] = await adaptTomorrow('a1', '2026-10-28', 'back-off', store, DRAFTS);
  assert.equal(r.workout_id, thu);
  assert.equal(r.decision.type, 'downgraded');
  assert.ok(r.adaptation_id);

  const w = await row(thu);
  assert.equal(w.planned_intensity, 'endurance');
  assert.equal(w.planned_duration_min, 40);
  assert.deepEqual(w.workout_structure_json, downgradedStructure('endurance', 40));

  const [a] = await store.recent('a1', 5);
  assert.equal(a.adaptation_type, 'downgraded');
  assert.equal(a.reason_code, 'posture_backoff_tempo_scheduled');
  assert.equal(a.reason_text, "Thursday's tempo is now an endurance run at the same 40 minutes. Today's posture reads back-off.");
  assert.deepEqual(validateVoice(a.reason_text, [{ metric: 'Duration', value: '40 min' } as any]).bannedHits, []);
});

test('reruns are harmless: one automatic adaptation per workout', async () => {
  const [again] = await adaptTomorrow('a1', '2026-10-28', 'back-off', store, DRAFTS);
  assert.equal(again.adaptation_id, null);
  assert.equal((await store.recent('a1', 10)).length, 1);
});

test('rest today, hard session tomorrow with an open day: the session moves and the log names both dates', async () => {
  await seedPlan('a2', templateId);
  const m = ids.get('a2')!;
  // Week 3: make Thursday a rest day so it is an open window next to Tuesday.
  await db.query(`update scheduled_workouts set planned_intensity = 'rest', planned_duration_min = null where id = $1`, [m.get('w3:thursday')]);
  const [r] = await adaptTomorrow('a2', '2026-11-02', 'rest', store, DRAFTS);
  assert.equal(r.decision.type, 'moved');
  const tue = await row(m.get('w3:tuesday')!);
  assert.equal(tue.date, '2026-11-05');
  assert.equal(tue.planned_intensity, 'threshold'); // the session itself is untouched
  const [a] = await store.recent('a2', 5);
  assert.deepEqual([a.adaptation_type, a.original_date, a.new_date], ['moved', '2026-11-03', '2026-11-05']);
  assert.match(a.reason_text, /^Tuesday's threshold session moved to Thursday\./);
  assert.deepEqual(validateVoice(a.reason_text, []).bannedHits, []);
});

test('rest today in a standard week: no open day, so the session drops to easy at the same duration (Q19)', async () => {
  await seedPlan('a3', templateId);
  const [r] = await adaptTomorrow('a3', '2026-10-26', 'rest', store, DRAFTS);
  assert.equal(r.decision.type, 'downgraded');
  if (r.decision.type !== 'downgraded') return;
  assert.equal(r.decision.reason_code, 'posture_rest_hard_no_window');
  assert.equal(r.decision.to_intensity, 'easy');
  const [a] = await store.recent('a3', 5);
  assert.equal(a.adaptation_type, 'downgraded');
  assert.equal(a.reason_code, 'posture_rest_hard_no_window');
  assert.match(a.reason_text, /is now an easy run at the same \d+ minutes\. Today's posture reads rest, and no other day this week could take it\.$/);
  assert.deepEqual(validateVoice(a.reason_text, []).bannedHits, []);
});

test('a displaced easy session becomes a rest day and is logged as skipped, in the same transaction', async () => {
  await seedPlan('a4', templateId);
  const m = ids.get('a4')!;
  const plan = (await store.activeScoraPlan('a4'))!;
  const id = await store.apply({
    athlete_id: 'a4', training_plan_id: plan.id, scheduled_workout_id: m.get('w1:tuesday')!, type: 'moved',
    new_date: '2026-10-21', new_workout: null, displaced_workout_id: m.get('w1:wednesday')!,
    reason_code: 'posture_rest_hard_scheduled', reason_text: "Tuesday's intervals moved to Wednesday.",
    displaced_reason_text: "Wednesday's easy run gives way to Tuesday's intervals.", engine_version: 'adaptation-v1.0.0',
  });
  assert.ok(id);
  const wed = await row(m.get('w1:wednesday')!);
  assert.deepEqual([wed.planned_intensity, wed.planned_duration_min, wed.workout_structure_json], ['rest', null, null]);
  const log = await store.recent('a4', 5);
  assert.deepEqual(log.map((x) => x.adaptation_type).sort(), ['moved', 'skipped']);

  // A blank displaced reason fails the whole write: nothing moves.
  const before = await row(m.get('w2:tuesday')!);
  await assert.rejects(store.apply({
    athlete_id: 'a4', training_plan_id: plan.id, scheduled_workout_id: m.get('w2:tuesday')!, type: 'moved',
    new_date: '2026-10-28', new_workout: null, displaced_workout_id: m.get('w2:wednesday')!,
    reason_code: 'posture_rest_hard_scheduled', reason_text: 'Moved.', displaced_reason_text: null, engine_version: 'x',
  }));
  assert.deepEqual(await row(m.get('w2:tuesday')!), before);
});

test("the write refuses another athlete's workout", async () => {
  const plan = (await store.activeScoraPlan('a4'))!;
  await assert.rejects(store.apply({
    athlete_id: 'a4', training_plan_id: plan.id, scheduled_workout_id: ids.get('a1')!.get('w3:tuesday')!, type: 'downgraded',
    new_date: null, new_workout: { planned_intensity: 'steady_state', workout_structure_json: null }, displaced_workout_id: null,
    reason_code: 'posture_backoff_intervals_scheduled', reason_text: 'x', displaced_reason_text: null, engine_version: 'x',
  }), /not on this athlete/);
});

test("no active SCORA plan (none, or a coach's plan): nothing to adapt", async () => {
  assert.deepEqual(await adaptTomorrow('nobody', '2026-10-28', 'back-off', store, DRAFTS), []);
  await seedPlan('c1', templateId, 'coach');
  assert.deepEqual(await adaptTomorrow('c1', '2026-10-28', 'back-off', store, DRAFTS), []);
});

test('downgraded structure: one continuous step at the same duration', () => {
  assert.deepEqual(downgradedStructure('steady_state', 50), [{ type: 'steady', duration_min: 50, intensity: 'steady' }]);
  assert.equal(downgradedStructure('endurance', null), null);
  // Review (Today line): no planned minutes, but template steps: keep their total.
  assert.deepEqual(
    downgradedStructure('endurance', null, [{ type: 'steady', duration_min: 10, intensity: 'easy' }, { type: 'steady', duration_min: 25, intensity: 'tempo' }, { type: 'steady', duration_min: 10, intensity: 'easy' }]),
    [{ type: 'steady', duration_min: 45, intensity: 'easy' }],
  );
});

test('review fixes: a draft template never adapts unless opted in', async () => {
  await seedPlan('d1', templateId);
  assert.deepEqual(await adaptTomorrow('d1', '2026-10-28', 'back-off', store), []);
  assert.equal((await adaptTomorrow('d1', '2026-10-28', 'back-off', store, DRAFTS)).length, 1);
});

test("review fixes: an active coach plan stops SCORA's plan adapting", async () => {
  await seedPlan('k1', templateId);
  await db.query(
    `insert into training_plans (athlete_id, source, start_date, end_date) values ('k1', 'coach', '2026-10-19', '2026-12-31')`,
  );
  assert.deepEqual(await adaptTomorrow('k1', '2026-10-28', 'back-off', store, DRAFTS), []);
});

test('review fixes: two hard sessions on one day never both land on the same later day', async () => {
  const planId = await seedPlan('t1', templateId);
  const m = ids.get('t1')!;
  // Week 2: Wed intervals 45 + tempo 30, Thu rest, Sat easy 100.
  await db.query(`update scheduled_workouts set planned_intensity = 'intervals', planned_duration_min = 45 where id = $1`, [m.get('w2:wednesday')]);
  await db.query(
    `insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity, planned_duration_min, source)
     values ('t1', $1, '2026-10-28', 'run', 'tempo', 30, 'scora_ai')`, [planId]);
  await db.query(`update scheduled_workouts set planned_intensity = 'rest', planned_duration_min = null where id = $1`, [m.get('w2:thursday')]);
  await db.query(`update scheduled_workouts set planned_intensity = 'easy' where id = $1`, [m.get('w2:saturday')]);

  const results = await adaptTomorrow('t1', '2026-10-27', 'rest', store, DRAFTS);
  const moved = results.filter((r) => r.decision.type === 'moved');
  assert.equal(moved.length, 1);
  const dates = (await db.query<any>(
    `select to_char(scheduled_date, 'YYYY-MM-DD') as d from scheduled_workouts
     where training_plan_id = $1 and planned_intensity in ('intervals', 'tempo') and scheduled_date between '2026-10-28' and '2026-11-01'`, [planId],
  )).rows.map((r) => r.d).sort();
  // Intervals to Friday; the tempo has no window left, so it is now easy on Wednesday (Q19).
  assert.deepEqual(dates, ['2026-10-30']);
  const downgraded = results.filter((r) => r.decision.type === 'downgraded');
  assert.equal(downgraded.length, 1);
  assert.equal(downgraded[0].decision.type === 'downgraded' && downgraded[0].decision.reason_code, 'posture_rest_hard_no_window');
});

test('review fixes: recent() timestamps are ISO 8601 UTC, like the Supabase store', async () => {
  const [a] = await store.recent('a1', 1);
  assert.match(a.triggered_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('a reason writer, when given, words the stored reason and gets the fixed sentence as its fallback', async () => {
  await seedPlan('r1', templateId);
  let fallbackSeen = '';
  const [r] = await adaptTomorrow('r1', '2026-10-28', 'back-off', store, {
    ...DRAFTS,
    writeReason: async (_d, fallback) => { fallbackSeen = fallback; return "Thursday's tempo is now an endurance run. HRV sits under your week."; },
  });
  assert.ok(r.adaptation_id);
  assert.match(fallbackSeen, /^Thursday's tempo is now an endurance run at the same 40 minutes\./);
  const [a] = await store.recent('r1', 1);
  assert.equal(a.reason_text, "Thursday's tempo is now an endurance run. HRV sits under your week.");
});

test('review fixes: recent() shows only changes on an active plan, and not dismissed ones', async () => {
  await seedPlan('v1', templateId);
  await adaptTomorrow('v1', '2026-10-28', 'back-off', store, DRAFTS);
  assert.equal((await store.recent('v1', 5)).length, 1);
  await db.query(`update plan_adaptations set dismissed_at = now() where athlete_id = 'v1'`);
  assert.equal((await store.recent('v1', 5)).length, 0);
  await db.query(`update plan_adaptations set dismissed_at = null where athlete_id = 'v1'`);
  await db.query(`update training_plans set current_status = 'replaced' where athlete_id = 'v1'`);
  assert.equal((await store.recent('v1', 5)).length, 0);
});

test('the read sees changes touching today, as quotable drivers (CLAUDE.md §1.3)', async () => {
  await seedPlan('p1', templateId);
  await adaptTomorrow('p1', '2026-10-28', 'back-off', store, DRAFTS); // Thursday 10-29 downgraded
  assert.equal((await store.forDay('p1', '2026-10-28')).length, 0);
  const rows = await store.forDay('p1', '2026-10-29');
  assert.equal(rows.length, 1);
  const ctx = planChangeContext(rows);
  assert.match(ctx.promptLine, /^PLAN CHANGE \(already made by SCORA's plan engine; you may observe it, never argue with it/);
  assert.deepEqual(ctx.drivers, [{ metric: 'Plan change', value: "Thursday's tempo is now an endurance run at the same 40 minutes." }]); // first sentence only: no stale posture
  // The stored reason passes the voice validator when it is a driver.
  assert.deepEqual(validateVoice(ctx.drivers[0].value, ctx.drivers as any), { ok: true, bannedHits: [], unbackedNumbers: [] });
  assert.deepEqual(planChangeContext([]), { drivers: [], promptLine: '' });
});

test('dismissing a plan change: only the athlete, only once; it leaves the list and the read (doc 07 §5)', async () => {
  await seedPlan('dm1', templateId);
  await adaptTomorrow('dm1', '2026-10-28', 'back-off', store, DRAFTS);
  const [a] = await store.recent('dm1', 5);
  assert.ok(a, 'a change to dismiss');
  assert.equal(await store.dismiss('someone-else', a.id), false, "not another athlete's");
  assert.equal(await store.dismiss('dm1', a.id), true);
  assert.equal(await store.dismiss('dm1', a.id), false, 'already dismissed');
  assert.deepEqual(await store.recent('dm1', 5), []);
  assert.deepEqual(await store.forDay('dm1', '2026-10-29'), []);
  const kept = await db.query<{ n: number }>(`select count(*)::int as n from plan_adaptations where athlete_id = 'dm1'`);
  assert.equal(kept.rows[0].n, 1, 'the change itself is kept');
});

test("dismissing a move also dismisses the change it displaced (review 6)", async () => {
  const planId = await seedPlan('dm2', templateId);
  const m = ids.get('dm2')!;
  const add = async (type: string, workout: string, from: string, to: string | null, code: string) =>
    (await db.query<{ id: string }>(
      `insert into plan_adaptations (athlete_id, training_plan_id, scheduled_workout_id, adaptation_type,
         original_date, new_date, reason_code, reason_text, engine_version, triggered_by)
       values ('dm2', $1, $2, $3, $4, $5, $6, 'Named.', 'adaptation-v1.2.0', 'auto_engine') returning id`,
      [planId, workout, type, from, to, code],
    )).rows[0].id;
  const move = await add('moved', m.get('w3:tuesday')!, '2026-11-03', '2026-11-05', 'posture_rest_hard_scheduled');
  await add('skipped', m.get('w3:thursday')!, '2026-11-05', null, 'displaced_by_move');
  const other = await add('skipped', m.get('w3:thursday')!, '2026-11-06', null, 'displaced_by_move');
  assert.equal(await store.dismiss('dm2', move), true);
  const live = (await db.query<{ id: string }>(`select id from plan_adaptations where athlete_id = 'dm2' and dismissed_at is null`)).rows.map((r) => r.id);
  assert.deepEqual(live, [other], 'only the paired change goes with the move');
});

test('history: every change on the active plan, dismissed ones kept and marked (PRD 5.B.1)', async () => {
  await seedPlan('h1', templateId);
  await adaptTomorrow('h1', '2026-10-28', 'back-off', store, DRAFTS);
  const [a] = await store.recent('h1', 5);
  await store.dismiss('h1', a.id);
  const rows = await store.history('h1', 50);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, a.id);
  assert.equal(rows[0].dismissed, true);
  assert.match(rows[0].triggered_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(await store.history('someone-else', 50), []);
  await db.query(`update training_plans set current_status = 'replaced' where athlete_id = 'h1'`);
  assert.deepEqual(await store.history('h1', 50), [], 'a replaced plan takes its changes with it');
});
