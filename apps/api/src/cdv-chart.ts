// CDV charts (CLAUDE.md §3.4: every claim visibly backed by data).
//
// The LLM only picks a chart KIND from a fixed list (one CHART: line in its
// answer). The Vega-Lite spec and every data point in it are built here from
// the athlete's real activities, so a chart can never show an invented number.
// Specs carry data inline and contain no url/href keys (the iOS WebView rejects
// those).

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

// Finds a `CHART: <kind>` line. Unknown kinds and `none` give null.
export function parseChartKind(text: string): ChartKind | null {
  const m = /^\s*CHART:\s*([a-z_]+)\s*$/im.exec(text);
  if (!m) return null;
  const k = m[1].toLowerCase();
  return (CHART_KINDS as readonly string[]).includes(k) ? (k as ChartKind) : null;
}

// Drops the CHART: line so it never reaches the voice or driver parsing.
export function stripChartLine(text: string): string {
  return text.split('\n').filter((l) => !/^\s*CHART:/i.test(l)).join('\n');
}

const startMs = (a: any) => new Date(a.start_date_local || a.start_date).getTime();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Shared look: transparent, system font, no actions. The app supplies the frame.
const base = (title: string) => ({
  title: { text: title, anchor: 'start', fontSize: 13, fontWeight: 600 },
  width: 'container',
  height: 160,
  background: 'transparent',
  config: {
    font: '-apple-system, system-ui, sans-serif',
    view: { stroke: null },
    axis: { labelFontSize: 11, titleFontSize: 11, grid: false },
  },
});

export function buildChartSpec(kind: ChartKind, activities: any[], now = Date.now()): Record<string, unknown> | null {
  const runs = activities
    .filter((a) => a.type === 'Run' && Number.isFinite(startMs(a)) && startMs(a) <= now)
    .sort((a, b) => startMs(b) - startMs(a)); // newest first

  if (kind === 'weekly_miles') {
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const to = now - i * 7 * DAY;
      const from = to - 7 * DAY;
      const mi = runs.filter((a) => startMs(a) > from && startMs(a) <= to)
        .reduce((s, a) => s + (a.distance || 0) / M, 0);
      return { week: i === 0 ? 'This wk' : `${i} wk ago`, order: 8 - i, miles: +mi.toFixed(1) };
    }).reverse();
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
    const last = runs.slice(0, 10).reverse();
    const values = last
      .map((a) => {
        const date = new Date(startMs(a)).toISOString().slice(0, 10);
        if (kind === 'recent_hr') {
          return typeof a.average_heartrate === 'number' ? { date, value: Math.round(a.average_heartrate) } : null;
        }
        if (!a.distance || !a.moving_time) return null;
        return { date, value: +((a.moving_time / 60) / (a.distance / M)).toFixed(2) }; // min per mile
      })
      .filter((v): v is { date: string; value: number } => v !== null);
    if (values.length < 2) return null;
    const pace = kind === 'recent_pace';
    return {
      ...base(pace ? 'Pace, last runs' : 'Average heart rate, last runs'),
      data: { values },
      mark: { type: 'line', point: true },
      encoding: {
        x: { field: 'date', type: 'temporal', title: null, axis: { format: '%b %d' } },
        // Faster pace reads as higher on the chart.
        y: {
          field: 'value', type: 'quantitative', title: pace ? 'min/mi' : 'bpm',
          scale: { zero: false, ...(pace ? { reverse: true } : {}) },
        },
        tooltip: [{ field: 'date', type: 'temporal' }, { field: 'value', title: pace ? 'min/mi' : 'bpm' }],
      },
    };
  }

  // weekday_runs
  const six = runs.filter((a) => startMs(a) > now - 42 * DAY);
  if (six.length < 2) return null;
  const counts = WEEKDAYS.map((day, i) => ({
    day, order: i, runs: six.filter((a) => new Date(startMs(a)).getDay() === i).length,
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
