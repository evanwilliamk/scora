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

test('weekly_miles sums real miles into ordered weeks the data covers', () => {
  const spec: any = buildChartSpec('weekly_miles', acts, now);
  const v = spec.data.values;
  assert.equal(v.length, 3); // oldest run is 16 days back
  assert.equal(v[2].week, 'This wk');
  assert.equal(v[2].miles, 11);
  assert.equal(v[1].miles, 14);
  assert.equal(v[0].miles, 8);
  assert.equal(spec.mark.type, 'bar');
});

test('recent_pace is min per mile, oldest first, with a reversed axis', () => {
  const spec: any = buildChartSpec('recent_pace', acts, now);
  const v = spec.data.values;
  assert.equal(v.length, 5);
  assert.ok(v[0].order < v[4].order, 'oldest first');
  assert.equal(spec.encoding.x.type, 'ordinal');
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
  assert.equal(spec.data.values.at(-1).miles, 11);
});

// ---- review findings (2026-10-17) ----

test('the chart tag is found and stripped inline or wrapped in markdown', () => {
  assert.equal(parseChartKind('Load is up. CHART: weekly_miles'), 'weekly_miles');
  assert.equal(parseChartKind('**CHART:** recent_hr'), 'recent_hr');
  assert.equal(stripChartLine('Load is up. CHART: weekly_miles\nMETRIC: a | VALUE: 1'), 'Load is up.\nMETRIC: a | VALUE: 1');
  assert.equal(stripChartLine('Voice.\n**CHART:** recent_hr'), 'Voice.');
});

test('a Sydney morning run lands in this week and on its local date', () => {
  const readAt = Date.UTC(2026, 9, 17, 20, 30); // 07:30 Oct 18 in Sydney
  const sydney = { type: 'Run', start_date: '2026-10-17T19:00:00Z', start_date_local: '2026-10-18T06:00:00Z', distance: 1609.34 * 6, moving_time: 3000, average_heartrate: 150 };
  const acts2 = [sydney, run(2, 5, 45, 150)].map((a) => ({ ...a }));
  const weekly: any = buildChartSpec('weekly_miles', [...acts2, run(9, 4, 36)], readAt);
  assert.equal(weekly.data.values.at(-1).miles, 11);
  const hr: any = buildChartSpec('recent_hr', acts2, readAt);
  assert.equal(hr.data.values.at(-1).date, 'Oct 18');
  const wd: any = buildChartSpec('weekday_runs', acts2, readAt);
  assert.equal(wd.data.values.find((x: any) => x.day === 'Sun').runs, 1, 'Oct 18 2026 is a Sunday in Sydney');
});

test('weeks older than the fetched data are left out, not drawn as zero', () => {
  const spec: any = buildChartSpec('weekly_miles', [run(1, 5, 45), run(9, 6, 54), run(16, 8, 76)], now);
  assert.deepEqual(spec.data.values.map((w: any) => w.week), ['2 wk ago', '1 wk ago', 'This wk']);
});

test('no styling config is sent (the app owns colors and fonts)', () => {
  for (const k of CHART_KINDS) assert.equal('config' in (buildChartSpec(k, acts, now) as object), false, k);
});

test('tag leftovers never become the voice; spaced kinds parse (re-review)', () => {
  assert.equal(stripChartLine('CHART: weekly_miles.\nMETRIC: a | VALUE: 1'), 'METRIC: a | VALUE: 1');
  assert.equal(stripChartLine('Voice.\n[CHART: weekly_miles]'), 'Voice.');
  assert.equal(parseChartKind('CHART: weekly miles'), 'weekly_miles');
  assert.equal(stripChartLine('Load is up. CHART: weekly miles'), 'Load is up.');
});

test('doubles get distinct x labels', () => {
  const spec: any = buildChartSpec('recent_hr', [run(0, 5, 45, 150), { ...run(0, 3, 30, 140), start_date: new Date(now - 3600e3).toISOString(), start_date_local: new Date(now - 3600e3).toISOString() }, run(2, 5, 45, 145)], now);
  const labels = spec.data.values.map((v: any) => v.date);
  assert.equal(new Set(labels).size, labels.length, labels.join(','));
});
