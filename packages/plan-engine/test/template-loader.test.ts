import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  TEMPLATE_DIR, TemplateError, loadTemplates, phaseOf, templateWeekMinutes, validateTemplate, workoutFor,
} from '../src/index';
import type { TemplateErrorCode } from '../src/index';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const FIXTURES = here('./fixtures/');
const raw = () => parseYaml(readFileSync(here('./fixtures/four-week.yaml'), 'utf8')) as Record<string, any>;
const draftsOk = { allowDrafts: true };

function rejects(mutate: (t: Record<string, any>) => void, code: TemplateErrorCode, match?: RegExp) {
  const t = raw();
  mutate(t);
  assert.throws(
    () => validateTemplate(t, 'fixture.yaml', draftsOk),
    (e: unknown) => e instanceof TemplateError && e.code === code && (!match || match.test(e.message)),
    `expected ${code}`,
  );
}

test('the fixture template loads, with durations derived from each structure', () => {
  const [t] = loadTemplates(FIXTURES, draftsOk);
  assert.equal(t.slug, 'test-fixture-4wk');
  assert.equal(t.workout_definitions.fartlek.duration_min, 42); // 10 + 6x2 + 5x2 + 10
  assert.equal(t.workout_definitions.threshold_intervals.duration_min, 50); // 10 + 3x8 + 2x3 + 10
  assert.deepEqual(t.weekly_volume_range_km, [30, 45]);
});

test('week minutes follow the pattern, the phase rotation and the load percent', () => {
  const [t] = loadTemplates(FIXTURES, draftsOk);
  // w1 42+40+40+90+40, w2 long_steady, w3 threshold. w4 at 80% scales only
  // continuous steps: fartlek 8+22+8, tempo 8+16+8, easy 32 x2, long 72.
  assert.deepEqual(templateWeekMinutes(t), [252, 262, 270, 206]);
});

test('each phase cycles its slot list in order', () => {
  const [t] = loadTemplates(FIXTURES, draftsOk);
  assert.equal(workoutFor(t, 1, 'long_effort'), 'long_easy');
  assert.equal(workoutFor(t, 2, 'long_effort'), 'long_steady');
  assert.equal(workoutFor(t, 3, 'quality_a'), 'threshold_intervals');
  assert.deepEqual(phaseOf(t, 3), { phase: t.phases[1], weekInPhase: 1 });
  assert.throws(() => phaseOf(t, 5), RangeError);
});

test('drafts do not load unless the caller opts in; reviewed templates need a reviewer and date', () => {
  assert.throws(() => loadTemplates(FIXTURES), (e: unknown) => e instanceof TemplateError && e.code === 'unreviewed');
  rejects((t) => { t.status = 'reviewed'; }, 'unreviewed', /reviewed_by/);
  const t = raw();
  Object.assign(t, { status: 'reviewed', reviewed_by: 'A Coach', reviewed_on: '2026-11-01' });
  assert.equal(validateTemplate(t, 'fixture.yaml').status, 'reviewed');
});

test('the real library folder exists and loads (empty until templates are authored)', () => {
  assert.deepEqual(loadTemplates(TEMPLATE_DIR), []);
});

test('duplicate slugs across files are refused', () => {
  assert.throws(
    () => loadTemplates(here('./fixtures-dup/'), draftsOk),
    (e: unknown) => e instanceof TemplateError && e.code === 'duplicate_slug',
  );
});

test('volume ban: no week more than 10% over the highest earlier week (CLAUDE.md §4.3)', () => {
  rejects((t) => { t.week_load_percent = [100, 115, 100, 80]; }, 'volume_jump', /week 2/);
  // A cutback week may return to its earlier peak.
  const t = raw();
  t.week_load_percent = [100, 100, 85, 100];
  assert.doesNotThrow(() => validateTemplate(t, 'fixture.yaml', draftsOk));
});

test('header fields: required, enumerated, well-formed', () => {
  rejects((t) => { delete t.slug; }, 'missing_field', /slug/);
  rejects((t) => { t.slug = 'Not Kebab'; }, 'bad_value', /kebab/);
  rejects((t) => { t.sport = 'rowing'; }, 'bad_value', /sport/);
  rejects((t) => { t.experience_level = 'elite'; }, 'bad_value', /experience_level/);
  rejects((t) => { t.version = 'v1'; }, 'bad_value', /semver/);
  rejects((t) => { t.duration_weeks = 0; }, 'bad_value', /duration_weeks/);
  rejects((t) => { t.weekly_volume_range_km = [50, 30]; }, 'bad_value', /weekly_volume_range_km/);
  assert.throws(() => validateTemplate([], 'x.yaml', draftsOk), (e: unknown) => e instanceof TemplateError && e.code === 'not_mapping');
});

test('phases cover every week exactly once, in order', () => {
  rejects((t) => { t.phases[2].weeks = [3]; }, 'phase_weeks', /cover weeks 1 to 4/); // week 3 twice, 4 missing
  rejects((t) => { t.phases[1].weeks = []; }, 'phase_weeks');
  rejects((t) => { t.phases[1].name = 'Base'; }, 'phase_weeks', /unique/);
  rejects((t) => { t.duration_weeks = 5; t.week_load_percent.push(100); }, 'phase_weeks');
});

test('week_load_percent: one number per week, within 40 to 150', () => {
  rejects((t) => { t.week_load_percent = [100, 100]; }, 'load_percent', /4 numbers/);
  rejects((t) => { t.week_load_percent = [100, 100, 100, 20]; }, 'load_percent', /week 4/);
});

test('weekly pattern: all seven days, rest or a slot', () => {
  rejects((t) => { delete t.weekly_pattern.friday; }, 'pattern_day', /friday/);
  rejects((t) => { t.weekly_pattern.funday = 'rest'; }, 'pattern_day', /funday/);
});

test('every slot is filled in every phase with workouts that exist', () => {
  rejects((t) => { delete t.workout_types_by_phase.Taper.long_effort; }, 'slot_unmapped', /long_effort.*Taper/);
  rejects((t) => { delete t.workout_types_by_phase.Build; }, 'slot_unmapped', /Build/);
  rejects((t) => { t.workout_types_by_phase.Peak = {}; }, 'slot_unmapped', /unknown phase "Peak"/);
  rejects((t) => { t.workout_types_by_phase.Base.easy = ['mystery_run']; }, 'unknown_workout', /mystery_run/);
});

test('workout structures: known step types, positive numbers, honest estimates', () => {
  rejects((t) => { t.workout_definitions.easy_run.intensity = 'brutal'; }, 'bad_value', /brutal/);
  rejects((t) => { t.workout_definitions.easy_run.structure = []; }, 'bad_step');
  rejects((t) => { t.workout_definitions.easy_run.structure[0].type = 'sprint_finish'; }, 'bad_step', /sprint_finish/);
  rejects((t) => { t.workout_definitions.easy_run.structure[0].duration_min = -5; }, 'bad_step', /duration_min/);
  rejects((t) => { t.workout_definitions.fartlek.structure[1].reps = 1.5; }, 'bad_step', /reps/);
  rejects((t) => { delete t.workout_definitions.fartlek.structure[1].rest_duration_min; }, 'bad_step', /rest_duration_min/);
  rejects((t) => { t.workout_definitions.fartlek.structure[1].work_intensity = 'all-out'; }, 'bad_step', /all-out/);
  rejects((t) => { t.workout_definitions.fartlek.total_duration_est_min = 55; }, 'duration_mismatch', /42/);
});

test('a single rep needs no rest', () => {
  const t = raw();
  t.workout_definitions.fartlek.structure[1] = { type: 'interval', reps: 1, work_duration_min: 12, work_intensity: 'moderate' };
  delete t.workout_definitions.fartlek.total_duration_est_min;
  const v = validateTemplate(t, 'fixture.yaml', draftsOk);
  assert.equal(v.workout_definitions.fartlek.duration_min, 32);
});

test('review fixes: easy labels cannot hide quality work, all-rest weeks and bad review dates are refused', () => {
  rejects((t) => { t.workout_definitions.easy_run.structure[0].intensity = 'threshold'; }, 'intensity_mismatch', /easy_run/);
  rejects((t) => {
    t.workout_definitions.easy_run.structure.push({ type: 'interval', reps: 4, work_duration_min: 3, work_intensity: 'vo2max', rest_duration_min: 2, rest_intensity: 'easy' });
  }, 'intensity_mismatch', /vo2max/);
  // Strides are fine on an easy day.
  const ok = raw();
  ok.workout_definitions.easy_run.structure.push({ type: 'interval', reps: 4, work_duration_min: 0.5, work_intensity: 'sprint', rest_duration_min: 1, rest_intensity: 'easy' });
  assert.doesNotThrow(() => validateTemplate(ok, 'fixture.yaml', draftsOk));

  rejects((t) => { for (const d of Object.keys(t.weekly_pattern)) t.weekly_pattern[d] = 'rest'; }, 'pattern_day', /no sessions/);
  rejects((t) => { Object.assign(t, { status: 'reviewed', reviewed_by: 'A Coach', reviewed_on: 'soon' }); }, 'bad_value', /reviewed_on/);
  rejects((t) => { Object.assign(t, { status: 'reviewed', reviewed_by: 'A Coach', reviewed_on: '2026-02-30' }); }, 'bad_value', /reviewed_on/);
});

test('two versions of one slug load side by side; the same version twice does not', () => {
  const all = loadTemplates(here('./fixtures-versions/'), draftsOk);
  assert.deepEqual(all.map((t) => t.version).sort(), ['0.0.1', '0.0.2']);
  assert.throws(() => loadTemplates(here('./fixtures-dup/'), draftsOk), /test-fixture-4wk@0.0.1 is also defined/);
});
