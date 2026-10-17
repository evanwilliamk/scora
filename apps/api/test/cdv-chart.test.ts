import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChartKind, stripChartLine, buildChartSpec, hasBlockedKey, CHART_KINDS } from '../src/cdv-chart';

const now = Date.UTC(2026, 9, 17, 12); // Saturday
const day = 86400000;
const run = (daysAgo: number, miles: number, mins: number, hr?: number) => ({
  type: 'Run',
  start_date: new Date(now - daysAgo * day).toISOString(),
  start_date_local: new Date(now - daysAgo * day).toISOString(),
  distance: miles * 1609.34,
  moving_time: mins * 60,
  average_heartrate: hr,
});
const acts = [run(1, 5, 45, 150), run(3, 6, 54, 148), run(8, 10, 95, 140), run(10, 4, 36), run(16, 8, 76, 145)];

test('parseChartKind reads a known kind and ignores none or unknown', () => {
  assert.equal(parseChartKind('Load is up.\nMETRIC: x | VALUE: 1\nCHART: weekly_miles'), 'weekly_miles');
  assert.equal(parseChartKind('chart: Recent_HR'), 'recent_hr');
  assert.equal(parseChartKind('CHART: none'), null);
  assert.equal(parseChartKind('CHART: pie_of_feelings'), null);
  assert.equal(parseChartKind('No chart line here'), null);
});

test('stripChartLine removes only the chart line', () => {
  assert.equal(stripChartLine('Voice.\nMETRIC: a | VALUE: 1\nCHART: recent_pace'), 'Voice.\nMETRIC: a | VALUE: 1');
});

test('weekly_miles sums real miles into 8 ordered weeks', () => {
  const spec: any = buildChartSpec('weekly_miles', acts, now);
  const v = spec.data.values;
  assert.equal(v.length, 8);
  assert.equal(v[7].week, 'This wk');
  assert.equal(v[7].miles, 11);
  assert.equal(v[6].miles, 14);
  assert.equal(v[5].miles, 8);
  assert.equal(spec.mark.type, 'bar');
});

test('recent_pace is min per mile, oldest first, with a reversed axis', () => {
  const spec: any = buildChartSpec('recent_pace', acts, now);
  const v = spec.data.values;
  assert.equal(v.length, 5);
  assert.ok(v[0].date < v[4].date);
  assert.equal(v[4].value, 9); // 45 min / 5 mi
  assert.equal(spec.encoding.y.scale.reverse, true);
});

test('recent_hr skips runs without heart rate', () => {
  const spec: any = buildChartSpec('recent_hr', acts, now);
  assert.deepEqual(spec.data.values.map((x: any) => x.value), [145, 140, 148, 150]);
});

test('weekday_runs counts runs per weekday over 6 weeks', () => {
  const spec: any = buildChartSpec('weekday_runs', acts, now);
  const total = spec.data.values.reduce((s: number, x: any) => s + x.runs, 0);
  assert.equal(total, 5);
  assert.equal(spec.data.values.length, 7);
});

test('too little data gives no chart rather than a misleading one', () => {
  const one = [run(1, 5, 45, 150)];
  for (const k of CHART_KINDS) assert.equal(buildChartSpec(k, one, now), null, k);
  assert.equal(buildChartSpec('recent_hr', [run(1, 5, 45), run(2, 5, 45)], now), null);
});

test('no spec ever contains a url or href key (the iOS guard would drop it)', () => {
  for (const k of CHART_KINDS) {
    const spec = buildChartSpec(k, acts, now);
    assert.ok(spec, k);
    assert.equal(hasBlockedKey(spec), false, k);
    assert.equal('$schema' in (spec as object), false);
  }
  assert.equal(hasBlockedKey({ data: { URL: 'x' } }), true);
});

test('non-runs and future-dated activities are ignored', () => {
  const spec: any = buildChartSpec('weekly_miles', [...acts, { ...run(2, 30, 120), type: 'Ride' }, run(-1, 20, 100)], now);
  assert.equal(spec.data.values[7].miles, 11);
});
