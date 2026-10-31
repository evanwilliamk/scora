// Inline chart-expansion (Plan tier, CLAUDE.md §3.4): every driver the read
// cites is tappable to a mini-chart of the raw data behind it. This module
// finds where each driver appears in the final read text and builds the
// dated daily series for it. No LLM: the spans are found in code, and every
// chart point is a recorded value (Strava activity or Oura night), never an
// estimate. Off unless INLINE_CHARTS=on; Plan tier gating waits for Stripe.

import type { Driver } from './metrics';
import type { OuraSummary } from './oura';
import { isRun } from './activity-types';
import { computeDriverRecord } from './drivers';

export const inlineChartsEnabled = () => process.env.INLINE_CHARTS === 'on';

export type SeriesKey =
  | 'load' | 'volume' | 'sleep' | 'sleep_score' | 'hrv' | 'resting_hr'
  | 'acwr' | 'hard_days' | 'days_since_long_effort' | 'peak_hr';

export interface SeriesPoint {
  date: string; // YYYY-MM-DD, the athlete's local day
  value: number;
}

export interface DriverSeries {
  key: SeriesKey;
  label: string;
  unit: string;
  points: SeriesPoint[]; // oldest first
  // What the read compares the newest point with: the 7 nights before it for
  // body signals, last week's total for load and volume.
  baseline: number | null;
  // How the app names the baseline; absent means "average before".
  baselineLabel?: string;
}

// A span of the read text, in UTF-16 code units (Swift NSRange, JS indices).
export interface DriverLink {
  start: number;
  end: number;
  key: SeriesKey;
}

// Driver metric names (metrics.ts, drivers.ts EVIDENCE) to the series behind
// them. The newest point of each series is the number the read cites; the
// "vs week" deltas link to the signal's own chart, whose newest point and
// baseline are the two numbers the delta compares.
export const METRIC_KEYS: Record<string, SeriesKey> = {
  'Sleep': 'sleep',
  'Sleep (last night)': 'sleep',
  'Sleep score': 'sleep_score',
  'Sleep score vs week': 'sleep_score',
  'Load': 'load',
  'Load (7d)': 'load',
  'Weekly volume': 'volume',
  'HRV': 'hrv',
  'HRV vs week': 'hrv',
  'Resting HR': 'resting_hr',
  'Resting HR vs week': 'resting_hr',
  'Acute:chronic load': 'acwr',
  'Hard days in a row': 'hard_days',
  'Days since long effort': 'days_since_long_effort',
  'Peak avg HR (7d)': 'peak_hr',
};

// Drivers the read may cite that have no honest 28-day chart. They are never
// linked; the reason says why, so a new driver has to land in one map or the
// other (test/driver-links.test.ts checks every driver in the source).
export const NOT_CHARTABLE: Record<string, string> = {
  // Nights in a row below the 25th percentile of the 28 nights before each
  // one: the fetch holds ~30 nights, so only the newest points would have
  // their own baseline. The Sleep score chart shows the scores themselves.
  'Low sleep score nights in a row': '28-night baseline, not enough fetched history for 28 points',
  // Longest run in the 30 days before each day: the fetch holds 35 days, so
  // only the newest few points would cover their window.
  'Long effort': '30-day window, not enough fetched history for 28 points',
  // The plan, not body data. The Plan Today card shows it.
  'Plan today': 'the plan, shown on the Plan Today card',
  'Plan change': 'the plan, shown on the Plan Today card',
  'Race within 7 days': 'the plan\'s race date, not body data',
  // Weekly review drivers: the weekly review has no inline charts.
  'Plan, last 7 full days': 'weekly review only',
  'Days trained': 'weekly review only',
  'Long run': 'weekly review only',
  'Peak avg HR': 'weekly review only',
};

export const isChartable = (metric: string): boolean => metric in METRIC_KEYS;

// Words the voice uses for a driver when it does not quote the number.
const NAMES: Record<SeriesKey, RegExp> = {
  // Not the "sleep" of "sleep score", which is the score's own chart.
  sleep: /\bsle(?:pt|ep)\b(?! score)/i,
  sleep_score: /\b(?:sleep|Oura) score\b/i,
  load: /\bload\b/i,
  volume: /\b(?:volume|mileage)\b/i,
  hrv: /\bHRV\b/,
  resting_hr: /\bresting (?:HR|heart rate)\b/i,
  acwr: /\bacute:?\s?chronic\b|\bACWR\b/i,
  hard_days: /\bhard (?:days?|sessions?)\b/i,
  days_since_long_effort: /\blong effort\b/i,
  peak_hr: /\b(?:peak|hardest)[^.]{0,24}?\b(?:HR|heart rate)\b/i,
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "52ms" also matches "52 ms"; "412 min" also matches "412min". Never part
// of a longer token: "45 mi" is not in "45 min", "7:12" is not in "7:12/mi".
function valuePattern(value: string): RegExp | null {
  const m = value.trim().match(/^([\d:.]+)\s*([a-z%]*)$/i);
  if (!m) return null;
  const unit = m[2] ? `\\s?${escapeRe(m[2])}` : '';
  return new RegExp(`(?<![\\d.:])${escapeRe(m[1])}${unit}(?![\\w/]|[.:]\\d)`, 'gi');
}

// One link per series, first mention wins, never overlapping. The quoted
// value is preferred over the driver's name.
export function linkDrivers(voice: string, drivers: Driver[], available: Set<SeriesKey>): DriverLink[] {
  const links: DriverLink[] = [];
  const taken = (s: number, e: number) => links.some((l) => s < l.end && e > l.start);
  const seen = new Set<SeriesKey>();
  for (const d of drivers) {
    const key = METRIC_KEYS[d.metric];
    if (!key || seen.has(key) || !available.has(key)) continue;
    // A bare whole number ("3" hard days) would match any "3" in the read,
    // so those link by name only.
    const bare = /^\d+$/.test(d.value.trim());
    for (const re of [bare ? null : valuePattern(d.value), NAMES[key]]) {
      if (!re) continue;
      // The first mention not already linked to another driver.
      const all = re.global ? [...voice.matchAll(re)] : [re.exec(voice)].filter((x): x is RegExpExecArray => x !== null);
      const m = all.find((x) => !taken(x.index!, x.index! + x[0].length));
      if (m) {
        links.push({ start: m.index!, end: m.index! + m[0].length, key });
        seen.add(key);
        break;
      }
    }
  }
  return links.sort((a, b) => a.start - b.start);
}

const DAY = 86_400_000;
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

// Body signals: the baseline is the mean of the nights in the 7 days before
// the newest, as the read's "wk" comparisons use (oura.ts hrvWeekAvgMs).
// The baseline keeps the series' own precision: HRV and resting HR are whole
// numbers, as the read's week average is (oura.ts Math.round).
const series = (key: SeriesKey, label: string, unit: string, points: SeriesPoint[], dp: number): DriverSeries => {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const newest = sorted[sorted.length - 1]?.date;
  const weekFrom = newest ? new Date(Date.parse(`${newest}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10) : '';
  const prior = sorted.slice(0, -1).filter((p) => p.date >= weekFrom).map((p) => p.value);
  return {
    key, label, unit, points: sorted,
    baseline: prior.length > 0 ? round(prior.reduce((s, v) => s + v, 0) / prior.length, dp) : null,
  };
};

// Load and volume: the read compares this week's total with last week's.
const totals = (key: SeriesKey, label: string, unit: string, points: SeriesPoint[]): DriverSeries => ({
  key, label, unit, points,
  baseline: points.length > 7 ? points[points.length - 8].value : null,
  baselineLabel: 'last week',
});

// Series for the last `days` local days ending today. Load and volume are
// rolling 7-day totals (rest days count as 0); Oura nights with no value are
// left out.
export function buildDriverSeries(
  activities: any[],
  oura: OuraSummary | null | undefined,
  today: string,
  days = 28,
  now = Date.now(),
): Partial<Record<SeriesKey, DriverSeries>> {
  const out: Partial<Record<SeriesKey, DriverSeries>> = {};
  const first = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY).toISOString().slice(0, 10);
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.parse(`${first}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10));

  const startMs = (a: any) => new Date(a.start_date || a.start_date_local).getTime();
  const runs = activities.filter((a) => isRun(a) && Number.isFinite(startMs(a)));
  if (runs.length > 0) {
    // Each point is the same window the read's Load and Weekly volume use
    // (metrics.ts: the 168 hours before now, by start_date), ending k days
    // before now and labelled with the athlete's day; the newest point is the
    // number the read cites.
    const week = (end: number, f: (a: any) => number) =>
      runs.reduce((sum, a) => { const t = startMs(a); return t > end - 7 * DAY && t <= end ? sum + f(a) : sum; }, 0);
    const ends = dates.map((date, i) => ({ date, end: now - (days - 1 - i) * DAY }));
    out.load = totals('load', 'Run minutes, last 7 days', 'min', ends.map(({ date, end }) => ({ date, value: Math.round(week(end, (a) => (a.moving_time || 0) / 60)) })));
    out.volume = totals('volume', 'Miles, last 7 days', 'mi', ends.map(({ date, end }) => ({ date, value: round(week(end, (a) => (a.distance || 0) / 1609.34), 1) })));

    // The read's Peak avg HR (7d), metrics.ts: the highest average HR of a run
    // in the same 168 hours, rounded. Windows with no HR are left out.
    const peak = ends.flatMap(({ date, end }) => {
      const hrs = runs.filter((a) => { const t = startMs(a); return t > end - 7 * DAY && t <= end && a.average_heartrate; }).map((a) => a.average_heartrate as number);
      return hrs.length > 0 ? [{ date, value: Math.round(Math.max(...hrs)) }] : [];
    });
    if (peak.length > 0) out.peak_hr = { key: 'peak_hr', label: 'Hardest run avg HR, last 7 days', unit: 'bpm', points: peak, baseline: null };

    // Posture drivers, each day as the posture engine saw it on that day: the
    // same computeDriverRecord, run with that day's clock, so the newest
    // point is the number in the read. Days the record has no value (ACWR
    // before 27 days of history) are left out.
    const records = ends.map(({ date, end }) => ({ date, d: computeDriverRecord(runs, null, { now: end, localToday: date }).drivers }));
    const pts = (f: (d: (typeof records)[number]['d']) => number | null | undefined) =>
      records.flatMap(({ date, d }) => { const v = f(d); return v == null ? [] : [{ date, value: v }]; });
    const acwr = pts((d) => d.acwr);
    const hard = pts((d) => d.consecutive_hard_days);
    const long = pts((d) => d.days_since_long_effort);
    if (acwr.length > 0) out.acwr = { key: 'acwr', label: 'Acute:chronic load, 7 days against 28', unit: 'ratio', points: acwr, baseline: null };
    if (hard.length > 0) out.hard_days = { key: 'hard_days', label: 'Hard days in a row', unit: 'days', points: hard, baseline: null };
    if (long.length > 0) out.days_since_long_effort = { key: 'days_since_long_effort', label: 'Days since a run of 90+ min', unit: 'days', points: long, baseline: null };
  }

  const nights = (oura?.nights ?? []).filter((n) => n.day >= first && n.day <= today);
  const pick = (f: (n: (typeof nights)[number]) => number | null, dp: number) =>
    nights.flatMap((n) => { const v = f(n); return v == null ? [] : [{ date: n.day, value: round(v, dp) }]; });
  const sleep = pick((n) => (n.sleepSeconds == null ? null : n.sleepSeconds / 3600), 2);
  const hrv = pick((n) => n.hrvMs, 0);
  const rhr = pick((n) => n.restingHr, 0);
  if (sleep.length >= 2) out.sleep = series('sleep', 'Hours slept', 'h', sleep, 2);
  if (hrv.length >= 2) out.hrv = series('hrv', 'HRV, nightly average', 'ms', hrv, 0);
  if (rhr.length >= 2) out.resting_hr = series('resting_hr', 'Resting heart rate', 'bpm', rhr, 0);

  // Oura daily sleep score, 0-100. The newest point must be the score the
  // read cites (oura.ts sleepScore); if it is not, there is no chart. The
  // baseline is what "Sleep score vs week" compares with (drivers.ts
  // sleep_7d_avg_delta): the mean of the 7 scored nights before, by count,
  // when there are at least 3. Two decimals so newest minus baseline rounds
  // to the read's delta.
  const seen = new Set<string>();
  const scores = (oura?.sleepScoreNights ?? [])
    .filter((n) => n.day >= first && n.day <= today && !seen.has(n.day) && seen.add(n.day))
    .map((n) => ({ date: n.day, value: n.score }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const cited = oura?.sleepScore;
  if (scores.length >= 2 && (cited == null || scores[scores.length - 1].value === cited)) {
    const prior7 = (oura?.sleepScoreHistory ?? []).slice(0, 7);
    out.sleep_score = {
      key: 'sleep_score', label: 'Oura sleep score', unit: 'pts', points: scores,
      baseline: prior7.length >= 3 ? round(prior7.reduce((s, v) => s + v, 0) / prior7.length, 2) : null,
      baselineLabel: 'average of the 7 nights before',
    };
  }
  return out;
}

// HealthKit nights from the app (HealthSummary.nights). Untrusted input: keep
// at most 35 well-formed days, and drop any value outside a plausible range
// rather than charting it.
export function parseHealthNights(raw: unknown): NonNullable<OuraSummary['nights']> {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  const seen = new Set<string>();
  const out: NonNullable<OuraSummary['nights']> = [];
  for (const n of raw.slice(-35)) {
    if (!n || typeof n !== 'object') continue;
    const day = (n as any).day;
    // A real calendar day: 2026-02-31 rolls over in Date.parse, so round-trip it.
    const t = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
    if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== day || seen.has(day)) continue;
    seen.add(day);
    const night = {
      day,
      sleepSeconds: num((n as any).sleepSeconds, 1, 86_400),
      hrvMs: num((n as any).hrvMs, 1, 300),
      restingHr: num((n as any).restingHr, 20, 200),
    };
    if (night.sleepSeconds != null || night.hrvMs != null || night.restingHr != null) out.push(night);
  }
  return out;
}
