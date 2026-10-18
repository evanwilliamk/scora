// Inline chart-expansion (Plan tier, CLAUDE.md §3.4): every driver the read
// cites is tappable to a mini-chart of the raw data behind it. This module
// finds where each driver appears in the final read text and builds the
// dated daily series for it. No LLM: the spans are found in code, and every
// chart point is a recorded value (Strava activity or Oura night), never an
// estimate. Off unless INLINE_CHARTS=on; Plan tier gating waits for Stripe.

import type { Driver } from './metrics';
import type { OuraSummary } from './oura';

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
  // Mean of every point but the newest: the line the newest is read against.
  baseline: number | null;
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

// "52ms" also matches "52 ms"; "412 min" also matches "412min".
function valuePattern(value: string): RegExp | null {
  const m = value.trim().match(/^([\d:.]+)\s*([a-z%]*)$/i);
  if (!m) return null;
  const unit = m[2] ? `\\s?${escapeRe(m[2])}` : '';
  return new RegExp(`(?<![\\d.:])${escapeRe(m[1])}${unit}(?![\\d])`, 'i');
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
      const m = re.exec(voice);
      if (m && !taken(m.index, m.index + m[0].length)) {
        links.push({ start: m.index, end: m.index + m[0].length, key });
        seen.add(key);
        break;
      }
    }
  }
  return links.sort((a, b) => a.start - b.start);
}

const DAY = 86_400_000;
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

const series = (key: SeriesKey, label: string, unit: string, points: SeriesPoint[]): DriverSeries => {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const prior = sorted.slice(0, -1).map((p) => p.value);
  return {
    key, label, unit, points: sorted,
    baseline: prior.length > 0 ? round(prior.reduce((s, v) => s + v, 0) / prior.length, 1) : null,
  };
};

// Daily series for the last `days` local days ending today. Run days with no
// run read 0 (a rest day is data); Oura nights with no value are left out.
export function buildDriverSeries(
  activities: any[],
  oura: OuraSummary | null | undefined,
  today: string,
  days = 28,
): Partial<Record<SeriesKey, DriverSeries>> {
  const out: Partial<Record<SeriesKey, DriverSeries>> = {};
  const first = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY).toISOString().slice(0, 10);
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.parse(`${first}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10));

  const runs = activities.filter((a) => a.type === 'Run' && typeof a.start_date_local === 'string');
  if (runs.length > 0) {
    const minutes = new Map<string, number>();
    const miles = new Map<string, number>();
    for (const a of runs) {
      const d = a.start_date_local.slice(0, 10);
      if (d < first || d > today) continue;
      minutes.set(d, (minutes.get(d) ?? 0) + (a.moving_time || 0) / 60);
      miles.set(d, (miles.get(d) ?? 0) + (a.distance || 0) / 1609.344);
    }
    out.load = series('load', 'Run minutes per day', 'min', dates.map((date) => ({ date, value: Math.round(minutes.get(date) ?? 0) })));
    out.volume = series('volume', 'Miles per day', 'mi', dates.map((date) => ({ date, value: round(miles.get(date) ?? 0, 1) })));
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
