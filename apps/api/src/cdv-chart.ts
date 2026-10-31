// CDV charts (CLAUDE.md §3.4: every claim visibly backed by data).
//
// The LLM only picks a chart KIND from a fixed list (one CHART: line in its
// answer). The Vega-Lite spec and every data point in it are built here from
// the athlete's real activities, so a chart can never show an invented number.
// Specs carry data inline and contain no url/href keys (the iOS WebView rejects
// those).

import { isOutdoorRun, isRun } from './activity-types';

const M = 1609.34;
const DAY = 86400000;

export const CHART_KINDS = ['weekly_miles', 'recent_pace', 'recent_hr', 'weekday_runs'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

// For the CDV system prompt: what each kind shows.
export const CHART_MENU = `- weekly_miles: total run miles per week, last 8 weeks
- recent_pace: pace of the last 10 runs
- recent_hr: average heart rate of the last 10 runs
- weekday_runs: how many runs fell on each weekday, last 6 weeks
- none: no chart helps this question`;

// `CHART: <kind>` anywhere in the reply, with or without markdown around the
// label ("**CHART:** weekly_miles").
const CHART_TAG = /[*_`\[(]*\bCHART\b[*_`]*\s*:\s*[*_`]*\s*([a-z]+(?:[_ ][a-z]+)?)[*_`\])]*/i;

// Unknown kinds and `none` give null.
export function parseChartKind(text: string): ChartKind | null {
  const m = CHART_TAG.exec(text);
  if (!m) return null;
  const k = m[1].toLowerCase().replace(/ /g, '_');
  return (CHART_KINDS as readonly string[]).includes(k) ? (k as ChartKind) : null;
}

// Removes the chart tag wherever it sits so it never reaches the voice or
// driver parsing; a line left empty is dropped.
export function stripChartLine(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (!CHART_TAG.test(line)) { out.push(line); continue; }
    const rest = line.replace(new RegExp(CHART_TAG.source, 'gi'), '').trimEnd();
    // Drop what's left if it is only punctuation ("CHART: weekly_miles.").
    if (/[\p{L}\p{N}]/u.test(rest)) out.push(rest);
  }
  return out.join('\n');
}

// start_date is true UTC (windows); start_date_local is the athlete's wall
// clock with a misleading Z (labels and weekdays, read with UTC getters).
const startMs = (a: any) => new Date(a.start_date || a.start_date_local).getTime();
const localDate = (a: any) => new Date(a.start_date_local || a.start_date);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (a: any) => { const d = localDate(a); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };

// Layout only. Colors and fonts come from the app's own Vega config (a server
// config.axis would replace it wholesale and drop the iOS label colors).
const base = (title: string) => ({
  title: { text: title, anchor: 'start' },
  width: 'container',
  height: 160,
  background: 'transparent',
});

// `todayLocal` (YYYY-MM-DD) is the athlete's date, the same one the chat's
// weekday patterns count from.
export function buildChartSpec(kind: ChartKind, activities: any[], now = Date.now(), todayLocal?: string): Record<string, unknown> | null {
  const runs = activities
    .filter((a) => isRun(a) && Number.isFinite(startMs(a)) && startMs(a) <= now)
    .sort((a, b) => startMs(b) - startMs(a)); // newest first

  if (kind === 'weekly_miles') {
    // Weeks older than the oldest fetched activity are unknown, not zero.
    const times = activities.map(startMs).filter(Number.isFinite);
    const oldest = times.length ? Math.min(...times) : now;
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const to = now - i * 7 * DAY;
      const from = to - 7 * DAY;
      const mi = runs.filter((a) => startMs(a) > from && startMs(a) <= to)
        .reduce((s, a) => s + (a.distance || 0) / M, 0);
      return { week: i === 0 ? 'This wk' : `${i} wk ago`, order: 8 - i, miles: +mi.toFixed(1), to };
    })
      .filter((w) => w.to > oldest) // the fetched data reaches into this week
      .map(({ to: _t, ...w }) => w)
      .reverse();
    if (weeks.filter((w) => w.miles > 0).length < 2) return null;
    return {
      ...base('Weekly miles'),
      data: { values: weeks },
      mark: { type: 'bar', cornerRadiusEnd: 3 },
      encoding: {
        x: { field: 'week', type: 'ordinal', sort: { field: 'order' }, title: null },
        y: { field: 'miles', type: 'quantitative', title: 'mi' },
        tooltip: [{ field: 'week' }, { field: 'miles', title: 'mi' }],
      },
    };
  }

  if (kind === 'recent_pace' || kind === 'recent_hr') {
    // Treadmill pace is an estimate: the pace chart shows outdoor runs only.
    const last = (kind === 'recent_pace' ? runs.filter(isOutdoorRun) : runs).slice(0, 10).reverse();
    // Two runs on one day (doubles) get distinct labels so they don't share
    // an x position.
    const seenLabel = new Map<string, number>();
    const values = last
      .map((a, order) => {
        const base = dayLabel(a);
        const n = (seenLabel.get(base) ?? 0) + 1;
        seenLabel.set(base, n);
        const date = n === 1 ? base : `${base} (${n})`;
        if (kind === 'recent_hr') {
          return typeof a.average_heartrate === 'number' ? { date, order, value: Math.round(a.average_heartrate) } : null;
        }
        if (!a.distance || !a.moving_time) return null;
        // Minutes per mile to plot, and the same pace as a reader says it
        // ("8:30", whole seconds) for the tooltip, as the voice writes it.
        const secs = Math.round(a.moving_time / (a.distance / M));
        return { date, order, value: +(secs / 60).toFixed(4), label: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` };
      })
      .filter((v): v is { date: string; order: number; value: number; label?: string } => v !== null);
    if (values.length < 2) return null;
    const pace = kind === 'recent_pace';
    return {
      ...base(pace ? 'Pace, last runs' : 'Average heart rate, last runs'),
      data: { values },
      mark: { type: 'line', point: true },
      encoding: {
        // Preformatted local dates: no time zone shift in the WebView.
        x: { field: 'date', type: 'ordinal', sort: { field: 'order' }, title: null },
        // Faster pace reads as higher on the chart.
        y: {
          field: 'value', type: 'quantitative', title: pace ? 'min/mi' : 'bpm',
          scale: { zero: false, ...(pace ? { reverse: true } : {}) },
          // Pace ticks as m:ss, never 8.5 (which reads as 8:50).
          ...(pace ? { axis: { labelExpr: "floor(round(datum.value * 60) / 60) + ':' + slice('0' + (round(datum.value * 60) % 60), -2)" } } : {}),
        },
        tooltip: [{ field: 'date' }, pace ? { field: 'label', title: 'min/mi' } : { field: 'value', title: 'bpm' }],
      },
    };
  }

  // weekday_runs: with the athlete's date, the 42 local days the chat's
  // weekday patterns read (exactly six of each weekday); a rolling 42 x 24h
  // window would reach into a seventh.
  const localDay = (a: any) => String(a.start_date_local || a.start_date).slice(0, 10);
  const from = todayLocal ? new Date(Date.parse(`${todayLocal}T00:00:00Z`) - 42 * DAY).toISOString().slice(0, 10) : null;
  const six = from
    ? runs.filter((a) => localDay(a) > from && localDay(a) <= todayLocal!)
    : runs.filter((a) => startMs(a) > now - 42 * DAY);
  if (six.length < 2) return null;
  const counts = WEEKDAYS.map((day, i) => ({
    day, order: i, runs: six.filter((a) => localDate(a).getUTCDay() === i).length,
  }));
  return {
    ...base('Runs by weekday, last 6 weeks'),
    data: { values: counts },
    mark: { type: 'bar', cornerRadiusEnd: 3 },
    encoding: {
      x: { field: 'day', type: 'ordinal', sort: { field: 'order' }, title: null },
      y: { field: 'runs', type: 'quantitative', title: 'runs', axis: { tickMinStep: 1 } },
      tooltip: [{ field: 'day' }, { field: 'runs' }],
    },
  };
}

// True if any key anywhere is url or href (mirrors the iOS guard).
export function hasBlockedKey(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasBlockedKey);
  if (v && typeof v === 'object') {
    return Object.entries(v).some(([k, x]) => ['url', 'href'].includes(k.toLowerCase()) || hasBlockedKey(x));
  }
  return false;
}
