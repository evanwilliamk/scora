// Deterministic dashboard metrics for the free-tier daily read.
//
// Everything here is computed from raw Strava activities — no fabrication.
// Cards that need a data source the athlete hasn't connected (Oura/HealthKit
// for sleep + HRV) are returned as `available: false` with a connect CTA,
// never as invented numbers. This honours the driver-existence rule (§3.2):
// the voice can only cite drivers that actually exist.

import type { OuraSummary } from './oura';
import { isRun } from './activity-types';

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
  // Set only on an unavailable card whose data is missing because this source
  // is not connected; null when the source is linked but has nothing tonight.
  // Clients key the connect action off this, not off the cta text.
  connect?: ConnectSource | null;
}

export type ConnectSource = 'oura' | 'strava' | 'healthkit';

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
  // start_date is true UTC; start_date_local is wall-clock time with a Z.
  const t = new Date(a.start_date || a.start_date_local).getTime();
  return t > fromMs && t <= toMs;
};

const totalMiles = (arr: any[]) => arr.reduce((s, a) => s + (a.distance || 0) / M, 0);
const totalMovingMin = (arr: any[]) =>
  Math.round(arr.reduce((s, a) => s + (a.moving_time || 0), 0) / 60);

const paceMinPerMi = (a: any): string | null => {
  if (!a.distance || !a.moving_time) return null;
  // Round the whole pace first, so 479.6 s reads 8:00, never 7:60.
  const secPerMi = Math.round(a.moving_time / (a.distance / M));
  return `${Math.floor(secPerMi / 60)}:${(secPerMi % 60).toString().padStart(2, '0')}`;
};

const pct = (curr: number, prev: number): string => {
  if (prev <= 0) return 'n/a';
  const d = Math.round(((curr - prev) / prev) * 100); // never "-0%"
  return `${d >= 0 ? '+' : ''}${d}%`;
};

const hoursMin = (seconds: number): string => {
  const total = Math.round(seconds / 60); // round first, so 6:59.5 is 7:00, never 6:60
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
};

// A recovery reading of 0 is a device with no reading, never a measurement: no
// night is 0:00 and no HRV is 0 ms. Null here, the same floor the route applies
// to HealthKit values, so a read never says "HRV 0ms" and no posture fires on it.
export function usableRecovery<T extends OuraSummary>(r: T | null | undefined): T | null {
  if (!r) return null;
  const pos = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? v : null);
  return { ...r, sleepSeconds: pos(r.sleepSeconds), sleepScore: pos(r.sleepScore), hrvMs: pos(r.hrvMs), restingHr: pos(r.restingHr), hrvWeekAvgMs: pos(r.hrvWeekAvgMs) };
}

// Build the six free-tier dashboard cards + the driver list the read may cite.
// `connections` reflects which data sources the athlete has linked; only
// Strava is wired today, so sleep + recovery come back as connect prompts.
export function buildDashboard(
  activities: any[],
  connections: { strava: boolean; oura: boolean; healthKit: boolean },
  ouraRaw?: OuraSummary | null,
  recoverySource: string = 'Oura',
  // The athlete's local date, for calendar-day counts ("2 days ago").
  localToday: string = new Date().toISOString().slice(0, 10)
): DashboardData {
  const oura = usableRecovery(ouraRaw);
  const now = Date.now();
  const day = 86400000;
  const runs = activities.filter(isRun);

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
      source: recoverySource,
      translation: `Slept ${dur} last night${oura.sleepScore != null ? `, Oura score ${oura.sleepScore}` : ''}.`,
    });
    drivers.push({ metric: 'Sleep', value: dur, trend: scoreTrend });
  } else {
    cards.push({
      id: 'sleep',
      title: 'Sleep',
      available: false,
      source: 'Oura / Apple Health',
      connect: connections.oura ? null : 'oura',
      cta: connections.oura
        ? 'No sleep recorded last night.'
        : 'Connect Oura or Apple Health to read your sleep.',
    });
  }

  // --- Training Load: 7-day moving minutes vs the week before ---
  if (thisWeek.length > 0 || lastWeek.length > 0) {
    // No runs last week: no week-over-week trend, never "n/a wk".
    const wk = (t: string) => (t === 'n/a' ? undefined : `${t} wk`);
    const trend = wk(pct(thisWeekMin, lastWeekMin));
    cards.push({
      id: 'training_load',
      title: 'Training Load',
      available: true,
      value: String(thisWeekMin),
      unit: 'min',
      trend,
      source: 'Strava',
      translation: `${thisWeekMin} min across ${thisWeek.length} run${thisWeek.length === 1 ? '' : 's'} this week.`,
    });
    drivers.push({ metric: 'Load', value: `${thisWeekMin} min`, trend });
    // Runs with no recorded distance have no volume to state; a week with no
    // runs at all is a real 0.
    if (thisWeekMiles > 0 || thisWeek.length === 0) {
      drivers.push({
        metric: 'Weekly volume',
        value: `${thisWeekMiles} mi`,
        trend: wk(pct(thisWeekMiles, lastWeekMiles)),
      });
    }
  } else {
    cards.push({
      id: 'training_load',
      title: 'Training Load',
      available: false,
      source: 'Strava',
      connect: connections.strava ? null : 'strava',
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
      connect: connections.strava ? null : 'strava',
      cta: withHr.length === 0 && thisWeek.length > 0
        ? 'No heart-rate data on recent runs.'
        : 'No runs in the last week.',
    });
  }

  // --- Recovery Signal (HRV + resting HR from Oura) ---
  if (oura && oura.hrvMs != null) {
    // No trend without a week average to compare against (never "n/a wk").
    const trend =
      oura.hrvWeekAvgMs != null && oura.hrvWeekAvgMs > 0 ? `${pct(oura.hrvMs, oura.hrvWeekAvgMs)} wk` : undefined;
    cards.push({
      id: 'recovery_signal',
      title: 'Recovery Signal',
      available: true,
      value: String(oura.hrvMs),
      unit: 'ms HRV',
      trend,
      source: recoverySource,
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
      connect: connections.oura ? null : 'oura',
      cta: connections.oura
        ? 'No HRV recorded last night.'
        : 'Connect Oura to read HRV and resting heart rate.',
    });
  }

  // --- Longest Run (30d): longest run by distance in the last 30 days. Not
  // the posture's "long effort" (last run of 90+ moving minutes, drivers.ts):
  // the two can disagree, so they carry different names (Q31 B). ---
  const last30 = runs.filter((a) => inWindow(a, now - 30 * day, now));
  const longest = last30.reduce<any>((m, a) => (!m || (a.distance || 0) > (m.distance || 0) ? a : m), null);
  const longestMiles = longest ? +((longest.distance || 0) / M).toFixed(1) : 0;
  // Runs with no recorded distance (a manual entry, a watch with no GPS) have
  // no longest run to name: never "0 mi".
  if (longestMiles > 0) {
    // Calendar days on the athlete's clock: last night's run is 1 day ago at 08:00.
    const ranOn = typeof longest.start_date_local === 'string'
      ? longest.start_date_local.slice(0, 10)
      : new Date(longest.start_date).toISOString().slice(0, 10);
    const daysSince = Math.max(0, Math.round((Date.parse(`${localToday}T00:00:00Z`) - Date.parse(`${ranOn}T00:00:00Z`)) / day));
    cards.push({
      id: 'long_effort',
      title: 'Longest Run (30d)',
      available: true,
      // "Today", never "0 days ago": the card line handed to card expansion
      // must match the driver's own "today".
      value: daysSince === 0 ? 'Today' : String(daysSince),
      unit: daysSince === 0 ? '' : daysSince === 1 ? 'day ago' : 'days ago',
      trend: `${longestMiles} mi`,
      source: 'Strava',
      translation: `Longest recent run was ${longestMiles} mi, ${daysSince === 0 ? 'today' : `${daysSince} day${daysSince === 1 ? '' : 's'} ago`}.`,
    });
    drivers.push({
      metric: 'Longest run (30d)',
      value: `${longestMiles} mi`,
      trend: daysSince === 0 ? 'today' : `${daysSince}d ago`,
    });
  } else {
    cards.push({
      id: 'long_effort',
      title: 'Longest Run (30d)',
      available: false,
      source: 'Strava',
      connect: connections.strava ? null : 'strava',
      cta: last30.length > 0 ? 'No run distance recorded in the last 30 days.' : 'No runs in the last 30 days.',
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

export interface WeeklyStat {
  label: string;
  value: string;
  trend?: string;
}

export interface WeeklySummary {
  stats: WeeklyStat[]; // compact tiles for the weekly view
  drivers: Driver[]; // the only values the weekly read may cite
  hasData: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// YYYY-MM-DD shifted by n calendar days.
const shiftDay = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The athlete's local calendar day of an activity.
const localDay = (a: any) => String(a.start_date_local || a.start_date).slice(0, 10);

// Reduce the last 7 days (vs the prior 7) into a weekly review: the stats the
// weekly view shows and the drivers the weekly read is allowed to cite. Same
// discipline as buildDashboard — every number is real; Oura fields only appear
// when a summary is passed. With the athlete's `today`, the week is the 7
// complete local days [today-7, today-1], the same days the weekly plan
// driver reads; without it, the last 7x24 hours.
export function buildWeeklySummary(activities: any[], ouraRaw?: OuraSummary | null, today?: string | null): WeeklySummary {
  const oura = usableRecovery(ouraRaw);
  const now = Date.now();
  const day = 86400000;
  const runs = activities.filter(isRun);

  const inDays = (a: any, t: string, from: number, to: number) => {
    const d = localDay(a);
    return d >= shiftDay(t, from) && d <= shiftDay(t, to);
  };
  const thisWeek = runs.filter((a) => (today ? inDays(a, today, -7, -1) : inWindow(a, now - 7 * day, now)));
  const lastWeek = runs.filter((a) => (today ? inDays(a, today, -14, -8) : inWindow(a, now - 14 * day, now - 7 * day)));

  const stats: WeeklyStat[] = [];
  const drivers: Driver[] = [];

  if (thisWeek.length === 0) {
    return { stats, drivers, hasData: false };
  }

  // Volume + load, week over week.
  const miles = +totalMiles(thisWeek).toFixed(1);
  const lastMiles = +totalMiles(lastWeek).toFixed(1);
  const min = totalMovingMin(thisWeek);
  const lastMin = totalMovingMin(lastWeek);
  const wk = (t: string) => (t === 'n/a' ? undefined : `${t} wk`);
  const volTrend = wk(pct(miles, lastMiles));
  const loadTrend = wk(pct(min, lastMin));

  if (miles > 0) stats.push({ label: 'Volume', value: `${miles} mi`, trend: volTrend });
  stats.push({ label: 'Load', value: `${min} min`, trend: loadTrend });
  if (miles > 0) drivers.push({ metric: 'Weekly volume', value: `${miles} mi`, trend: volTrend });
  drivers.push({ metric: 'Load', value: `${min} min`, trend: loadTrend });

  // Distinct days trained.
  const days = new Set(thisWeek.map(localDay)).size;
  stats.push({ label: 'Days run', value: `${days}/7` });
  drivers.push({ metric: 'Days trained', value: `${days} of 7` });

  // Longest run of the week.
  const longest = thisWeek.reduce((m, a) => ((a.distance || 0) > (m.distance || 0) ? a : m));
  const longMiles = +((longest.distance || 0) / M).toFixed(1);
  // start_date_local is the athlete's wall time marked Z: read it in UTC so
  // the server's own time zone never shifts the day.
  const longDay = WEEKDAYS[new Date(longest.start_date_local || longest.start_date).getUTCDay()];
  if (longMiles > 0) {
    stats.push({ label: 'Long run', value: `${longMiles} mi`, trend: longDay });
    drivers.push({ metric: 'Long run', value: `${longMiles} mi`, trend: longDay });
  }

  // Hardest session (avg HR), if HR present.
  const withHr = thisWeek.filter((a) => a.average_heartrate);
  if (withHr.length > 0) {
    const hardest = withHr.reduce((m, a) => (a.average_heartrate > m.average_heartrate ? a : m));
    const hr = Math.round(hardest.average_heartrate);
    const pace = paceMinPerMi(hardest);
    stats.push({ label: 'Peak HR', value: `${hr} bpm`, trend: pace ? `${pace}/mi` : undefined });
    drivers.push({ metric: 'Peak avg HR', value: `${hr} bpm`, trend: pace ? `${pace}/mi` : undefined });
  }

  // Oura weekly context (last night as the reference point + week HRV trend).
  if (oura) {
    if (oura.sleepSeconds != null) {
      const dur = hoursMin(oura.sleepSeconds);
      stats.push({ label: 'Sleep', value: dur, trend: oura.sleepScore != null ? `Oura ${oura.sleepScore}` : undefined });
      drivers.push({ metric: 'Sleep (last night)', value: dur, trend: oura.sleepScore != null ? `Oura ${oura.sleepScore}` : undefined });
    }
    if (oura.hrvMs != null) {
      const trend = oura.hrvWeekAvgMs != null && oura.hrvWeekAvgMs > 0 ? `${pct(oura.hrvMs, oura.hrvWeekAvgMs)} vs wk avg` : undefined;
      stats.push({ label: 'HRV', value: `${oura.hrvMs} ms`, trend });
      drivers.push({ metric: 'HRV', value: `${oura.hrvMs}ms`, trend });
    }
  }

  return { stats, drivers, hasData: true };
}
