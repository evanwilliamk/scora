import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChartKind, stripChartLine, buildChartSpec, hasBlockedKey, CHART_KINDS, sixWeekRuns, weekdayRunDates } from '../src/cdv-chart';

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

test('weekday_runs counts weeks with a run per weekday over 6 weeks', () => {
  const spec: any = buildChartSpec('weekday_runs', acts, now);
  const total = spec.data.values.reduce((s: number, x: any) => s + x.weeks, 0);
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
  assert.equal(wd.data.values.find((x: any) => x.day === 'Sun').weeks, 1, 'Oct 18 2026 is a Sunday in Sydney');
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

test('the pace chart leaves treadmill runs out; the HR chart keeps them (review 10-29)', () => {
  const treadmill = { ...run(1, 6, 48, 150), type: 'VirtualRun', sport_type: 'VirtualRun' };
  const mixed = [treadmill, run(2, 5, 45, 140), run(3, 4, 36, 138)];
  const pace = buildChartSpec('recent_pace', mixed, now) as any;
  const hr = buildChartSpec('recent_hr', mixed, now) as any;
  assert.equal(pace.data.values.length, 2);
  assert.equal(hr.data.values.length, 3);
});

test('pace reads as m:ss on the axis and in the tooltip, never 8.5 or 7:60 (review 10-29)', () => {
  const quick = { ...run(1, 1, 7.993), average_heartrate: 150 }; // 479.6 s for the mile
  const spec: any = buildChartSpec('recent_pace', [quick, ...acts], now);
  const v = spec.data.values;
  assert.equal(v.at(-1).label, '8:00');
  assert.equal(v.find((p: any) => p.value === 9).label, '9:00');
  assert.deepEqual(spec.encoding.tooltip[1], { field: 'label', title: 'min/mi' });
  // The axis expression, run with the same functions Vega gives it.
  const expr = spec.encoding.y.axis.labelExpr as string;
  const label = (value: number) => new Function('datum', 'floor', 'round', 'slice', `return ${expr};`)(
    { value }, Math.floor, Math.round, (s: string, a: number, b?: number) => s.slice(a, b));
  assert.equal(label(8.5), '8:30');
  assert.equal(label(8.9999), '9:00');
  assert.equal(label(10.05), '10:03');
  // Heart rate keeps its plain axis.
  assert.equal((buildChartSpec('recent_hr', acts, now) as any).encoding.y.axis, undefined);
});

test("weekday_runs spans the athlete's last 42 local days, so no weekday counts 7 times (review 10-31)", () => {
  // now is Sat Oct 17 12:00; a run every Saturday from Sep 5 to Oct 17.
  const sats = Array.from({ length: 7 }, (_, i) => {
    const t = Date.UTC(2026, 8, 5 + i * 7, i === 6 ? 8 : 15);
    return { type: 'Run', start_date: new Date(t).toISOString(), start_date_local: new Date(t).toISOString(), distance: 8000, moving_time: 2400 };
  });
  const spec: any = buildChartSpec('weekday_runs', sats, now, '2026-10-17');
  assert.equal(spec.data.values.find((x: any) => x.day === 'Sat').weeks, 6);
});

test('weekday_runs counts weeks with a run, matching the voice line (two runs on one Thursday count once)', () => {
  // today Sat Oct 17; Thursdays Oct 15 (two runs), Oct 8, Oct 1, Sep 24.
  const at = (date: string, hh: number) => {
    const iso = `${date}T${String(hh).padStart(2, '0')}:00:00Z`;
    return { type: 'Run', start_date: iso, start_date_local: iso, distance: 8000, moving_time: 2400 };
  };
  const thursdays = [at('2026-10-15', 7), at('2026-10-15', 18), at('2026-10-08', 7), at('2026-10-01', 7), at('2026-09-24', 7)];
  const spec: any = buildChartSpec('weekday_runs', thursdays, now, '2026-10-17');
  const voiceWeeks = weekdayRunDates(sixWeekRuns(thursdays, '2026-10-17'))[4].size;
  assert.equal(voiceWeeks, 4);
  assert.equal(spec.data.values.find((x: any) => x.day === 'Thu').weeks, voiceWeeks);
  assert.equal(spec.encoding.y.title, 'Weeks with a run');
});
