// Inline chart-expansion (Plan tier, CLAUDE.md §3.4): every driver the read
// cites is tappable to a mini-chart of the raw data behind it. This module
// finds where each driver appears in the final read text and builds the
// dated daily series for it. No LLM: the spans are found in code, and every
// chart point is a recorded value (Strava activity or Oura night), never an
// estimate. Off unless INLINE_CHARTS=on; Plan tier gating waits for Stripe.

import type { Driver } from './metrics';
import type { OuraSummary } from './oura';
import { isRun } from './activity-types';

export const inlineChartsEnabled = () => process.env.INLINE_CHARTS === 'on';

export type SeriesKey = 'load' | 'volume' | 'sleep' | 'hrv' | 'resting_hr';

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

// Driver metric names (metrics.ts) to the series behind them.
const METRIC_KEYS: Record<string, SeriesKey> = {
  'Sleep': 'sleep',
  'Sleep (last night)': 'sleep',
  'Load': 'load',
  'Weekly volume': 'volume',
  'HRV': 'hrv',
  'Resting HR': 'resting_hr',
};

// Words the voice uses for a driver when it does not quote the number.
const NAMES: Record<SeriesKey, RegExp> = {
  sleep: /\bsle(?:pt|ep)\b/i,
  load: /\bload\b/i,
  volume: /\b(?:volume|mileage)\b/i,
  hrv: /\bHRV\b/,
  resting_hr: /\bresting (?:HR|heart rate)\b/i,
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
    for (const re of [valuePattern(d.value), NAMES[key]]) {
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
const series = (key: SeriesKey, label: string, unit: string, points: SeriesPoint[]): DriverSeries => {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const newest = sorted[sorted.length - 1]?.date;
  const weekFrom = newest ? new Date(Date.parse(`${newest}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10) : '';
  const prior = sorted.slice(0, -1).filter((p) => p.date >= weekFrom).map((p) => p.value);
  return {
    key, label, unit, points: sorted,
    baseline: prior.length > 0 ? round(prior.reduce((s, v) => s + v, 0) / prior.length, 1) : null,
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
  }

  const nights = (oura?.nights ?? []).filter((n) => n.day >= first && n.day <= today);
  const pick = (f: (n: (typeof nights)[number]) => number | null, dp: number) =>
    nights.flatMap((n) => { const v = f(n); return v == null ? [] : [{ date: n.day, value: round(v, dp) }]; });
  const sleep = pick((n) => (n.sleepSeconds == null ? null : n.sleepSeconds / 3600), 2);
  const hrv = pick((n) => n.hrvMs, 0);
  const rhr = pick((n) => n.restingHr, 0);
  if (sleep.length >= 2) out.sleep = series('sleep', 'Hours slept', 'h', sleep);
  if (hrv.length >= 2) out.hrv = series('hrv', 'HRV, nightly average', 'ms', hrv);
  if (rhr.length >= 2) out.resting_hr = series('resting_hr', 'Resting heart rate', 'bpm', rhr);
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
