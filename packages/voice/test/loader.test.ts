import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPatterns, validateEntry, PatternSchemaError } from '../src/loader';

test('the shipped library loads and is internally consistent', () => {
  const entries = loadPatterns();
  assert.ok(entries.length >= 12, `expected >=12 entries, got ${entries.length}`);

  // sorted by descending priority
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i - 1].priority >= entries[i].priority, 'entries must be priority-sorted');
  }

  // ids unique
  const ids = new Set(entries.map((e) => e.id));
  assert.equal(ids.size, entries.length, 'ids must be unique');

  // the cornerstone is present
  assert.ok(ids.has('plan-says-hard-body-says-back-off-v1'));

  // every entry has a template and a valid posture set (load already compiled rules)
  for (const e of entries) {
    assert.ok(e.template.length > 0, `${e.id} missing template`);
    assert.ok(e.posture_filter.length > 0, `${e.id} missing posture_filter`);
    assert.deepEqual(e.context_filter?.length ? true : false, true);
  }
});

// A minimal valid entry object for mutating in the rejection tests.
const base = () => ({
  id: 'x-v1',
  priority: 50,
  posture_filter: ['primed'],
  template: 'Body is settled.',
});

test('validateEntry applies defaults', () => {
  const e = validateEntry(base(), 'x.yaml');
  assert.equal(e.requires_scheduled_workout, false);
  assert.equal(e.min_data_completeness, 0);
  assert.deepEqual(e.context_filter, ['daily']);
  assert.equal(e.tier_filter, undefined);
  assert.equal(e.voice_version, 'v0.3.0');
});

const bad: [string, any][] = [
  ['missing id', { ...base(), id: undefined }],
  ['non-number priority', { ...base(), priority: 'high' }],
  ['missing template', { ...base(), template: undefined }],
  ['unknown posture', { ...base(), posture_filter: ['sprinting'] }],
  ['empty posture_filter', { ...base(), posture_filter: [] }],
  ['bad context', { ...base(), context_filter: ['hourly'] }],
  ['bad tier', { ...base(), tier_filter: ['premium'] }],
  ['completeness out of range', { ...base(), min_data_completeness: 1.5 }],
  ['unparseable driver_rule', { ...base(), driver_rule: 'acwr >' }],
  ['non-boolean requires_scheduled_workout', { ...base(), requires_scheduled_workout: 'yes' }],
  ['entry not a mapping', ['not', 'a', 'map']],
];

for (const [label, raw] of bad) {
  test(`validateEntry rejects: ${label}`, () => {
    assert.throws(() => validateEntry(raw, 'bad.yaml'), PatternSchemaError, label);
  });
}

test('a valid driver_rule passes validation', () => {
  const e = validateEntry({ ...base(), driver_rule: 'acwr > 1.2 AND hrv_7d_avg_delta < -5' }, 'ok.yaml');
  assert.equal(e.driver_rule, 'acwr > 1.2 AND hrv_7d_avg_delta < -5');
});
