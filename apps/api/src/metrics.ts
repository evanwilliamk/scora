// Deterministic dashboard metrics for the free-tier daily read.
//
// Everything here is computed from raw Strava activities — no fabrication.
// Cards that need a data source the athlete hasn't connected (Oura/HealthKit
// for sleep + HRV) are returned as `available: false` with a connect CTA,
// never as invented numbers. This honours the driver-existence rule (§3.2):
// the voice can only cite drivers that actually exist.

import type { OuraSummary } from './oura';

const M = 1609.34; // metres per mile

export interface Card {
  id: string;
  title: string;
  available: boolean;
  value?: string; // primary raw number, e.g. "412"
  unit?: string; // e.g. "min", "mi", "bpm"
  translation?: string; // plain-English meaning
  trend?: string; // e.g. "+12% wk", "flat", "6 days"
  source?: string; // "Strava" | "Oura" | "Apple Health"
  cta?: string; // shown when available === false
}

// A driver is one raw value the read is allowed to reference. The voice
// validator (§3.2) checks every claim against this list.
export interface Driver {
  metric: string;
  value: string;
  trend?: string;
}

export interface DashboardData {
  cards: Card[];
  drivers: Driver[];
  connections: { strava: boolean; oura: boolean; healthKit: boolean };
}

const inWindow = (a: any, fromMs: number, toMs: number) => {
  const t = new Date(a.start_date_local || a.start_date).getTime();
  return t > fromMs && t <= toMs;
};

const totalMiles = (arr: any[]) => arr.reduce((s, a) => s + (a.distance || 0) / M, 0);
const totalMovingMin = (arr: any[]) =>
  Math.round(arr.reduce((s, a) => s + (a.moving_time || 0), 0) / 60);

const paceMinPerMi = (a: any): string | null => {
  if (!a.distance || !a.moving_time) return null;
  const secPerMi = a.moving_time / (a.distance / M);
  const min = Math.floor(secPerMi / 60);
  const sec = Math.round(secPerMi % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const pct = (curr: number, prev: number): string => {
  if (prev <= 0) return 'n/a';
  const d = ((curr - prev) / prev) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`;
};

const hoursMin = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
};

// Build the six free-tier dashboard cards + the driver list the read may cite.
// `connections` reflects which data sources the athlete has linked; only
// Strava is wired today, so sleep + recovery come back as connect prompts.
export function buildDashboard(
  activities: any[],
  connections: { strava: boolean; oura: boolean; healthKit: boolean },
  oura?: OuraSummary | null
): DashboardData {
  const now = Date.now();
  const day = 86400000;
  const runs = activities.filter((a) => a.type === 'Run');

  const thisWeek = runs.filter((a) => inWindow(a, now - 7 * day, now));
  const lastWeek = runs.filter((a) => inWindow(a, now - 14 * day, now - 7 * day));

  const thisWeekMin = totalMovingMin(thisWeek);
  const lastWeekMin = totalMovingMin(lastWeek);
  const thisWeekMiles = +totalMiles(thisWeek).toFixed(1);
  const lastWeekMiles = +totalMiles(lastWeek).toFixed(1);

  const cards: Card[] = [];
  const drivers: Driver[] = [];

  // --- Sleep (from Oura) ---
  if (oura && oura.sleepSeconds != null) {
    const dur = hoursMin(oura.sleepSeconds);
    const scoreTrend = oura.sleepScore != null ? `Oura ${oura.sleepScore}` : undefined;
    cards.push({
      id: 'sleep',
      title: 'Sleep',
      available: true,
      value: dur,
      unit: 'hrs',
      trend: scoreTrend,
      source: 'Oura',
      translation: `Slept ${dur} last night${oura.sleepScore != null ? `, Oura score ${oura.sleepScore}` : ''}.`,
    });
    drivers.push({ metric: 'Sleep', value: dur, trend: scoreTrend });
  } else {
    cards.push({
      id: 'sleep',
      title: 'Sleep',
      available: false,
      source: 'Oura / Apple Health',
      cta: connections.oura
        ? 'No sleep recorded last night.'
        : 'Connect Oura or Apple Health to read your sleep.',
    });
  }

  // --- Training Load: 7-day moving minutes vs the week before ---
  if (thisWeek.length > 0 || lastWeek.length > 0) {
    const trend = pct(thisWeekMin, lastWeekMin);
    cards.push({
      id: 'training_load',
      title: 'Training Load',
      available: true,
      value: String(thisWeekMin),
      unit: 'min',
      trend: `${trend} wk`,
      source: 'Strava',
      translation: `${thisWeekMin} min across ${thisWeek.length} run${thisWeek.length === 1 ? '' : 's'} this week.`,
    });
    drivers.push({ metric: 'Load', value: `${thisWeekMin} min`, trend: `${trend} wk` });
    drivers.push({
      metric: 'Weekly volume',
      value: `${thisWeekMiles} mi`,
      trend: `${pct(thisWeekMiles, lastWeekMiles)} wk`,
    });
  } else {
    cards.push({
      id: 'training_load',
      title: 'Training Load',
      available: false,
      source: 'Strava',
      cta: 'No runs in the last two weeks.',
    });
  }

  // --- Recent Intensity: hardest session in the last 7 days (by avg HR, else pace) ---
  const withHr = thisWeek.filter((a) => a.average_heartrate);
  if (withHr.length > 0) {
    const hardest = withHr.reduce((m, a) =>
      a.average_heartrate > m.average_heartrate ? a : m
    );
    const hr = Math.round(hardest.average_heartrate);
    const pace = paceMinPerMi(hardest);
    cards.push({
      id: 'recent_intensity',
      title: 'Recent Intensity',
      available: true,
      value: String(hr),
      unit: 'bpm',
      trend: pace ? `${pace}/mi` : undefined,
      source: 'Strava',
      translation: `Hardest session this week averaged ${hr} bpm${pace ? ` at ${pace}/mi` : ''}.`,
    });
    drivers.push({ metric: 'Peak avg HR (7d)', value: `${hr} bpm`, trend: pace ? `${pace}/mi` : undefined });
  } else {
    cards.push({
      id: 'recent_intensity',
      title: 'Recent Intensity',
      available: false,
      source: 'Strava',
      cta: withHr.length === 0 && thisWeek.length > 0
        ? 'No heart-rate data on recent runs.'
        : 'No runs in the last week.',
    });
  }

  // --- Recovery Signal (HRV + resting HR from Oura) ---
  if (oura && oura.hrvMs != null) {
    const trend =
      oura.hrvWeekAvgMs != null ? `${pct(oura.hrvMs, oura.hrvWeekAvgMs)} wk` : undefined;
    cards.push({
      id: 'recovery_signal',
      title: 'Recovery Signal',
      available: true,
      value: String(oura.hrvMs),
      unit: 'ms HRV',
      trend,
      source: 'Oura',
      translation: `HRV ${oura.hrvMs}ms last night${oura.hrvWeekAvgMs != null ? ` (week avg ${oura.hrvWeekAvgMs}ms)` : ''}${oura.restingHr != null ? `, resting HR ${oura.restingHr} bpm` : ''}.`,
    });
    drivers.push({ metric: 'HRV', value: `${oura.hrvMs}ms`, trend });
    if (oura.restingHr != null) {
      drivers.push({ metric: 'Resting HR', value: `${oura.restingHr} bpm` });
    }
  } else {
    cards.push({
      id: 'recovery_signal',
      title: 'Recovery Signal',
      available: false,
      source: 'Oura',
      cta: connections.oura
        ? 'No HRV recorded last night.'
        : 'Connect Oura to read HRV and resting heart rate.',
    });
  }

  // --- Long Effort Recency: longest run in the last 30 days ---
  const last30 = runs.filter((a) => inWindow(a, now - 30 * day, now));
  if (last30.length > 0) {
    const longest = last30.reduce((m, a) => ((a.distance || 0) > (m.distance || 0) ? a : m));
    const longestMiles = +((longest.distance || 0) / M).toFixed(1);
    const daysSince = Math.floor(
      (now - new Date(longest.start_date_local || longest.start_date).getTime()) / day
    );
    cards.push({
      id: 'long_effort',
      title: 'Long Effort Recency',
      available: true,
      value: String(daysSince),
      unit: daysSince === 1 ? 'day ago' : 'days ago',
      trend: `${longestMiles} mi`,
      source: 'Strava',
      translation: `Longest recent run was ${longestMiles} mi, ${daysSince === 0 ? 'today' : `${daysSince} day${daysSince === 1 ? '' : 's'} ago`}.`,
    });
    drivers.push({
      metric: 'Long effort',
      value: `${longestMiles} mi`,
      trend: daysSince === 0 ? 'today' : `${daysSince}d ago`,
    });
  } else {
    cards.push({
      id: 'long_effort',
      title: 'Long Effort Recency',
      available: false,
      source: 'Strava',
      cta: 'No runs in the last 30 days.',
    });
  }

  // --- Connections ---
  const connected = [
    connections.strava && 'Strava',
    connections.oura && 'Oura',
    connections.healthKit && 'Apple Health',
  ].filter(Boolean) as string[];
  cards.push({
    id: 'connections',
    title: 'Connections',
    available: true,
    value: String(connected.length),
    unit: connected.length === 1 ? 'source' : 'sources',
    source: 'SCORA',
    translation: connected.length > 0 ? `Connected: ${connected.join(', ')}.` : 'No sources connected yet.',
  });

  return { cards, drivers, connections };
}
