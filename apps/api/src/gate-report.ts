// Gate report (doc 10 §7): reads exported API logs, finds the `telemetry {...}`
// lines (telemetry.ts) and checks them against the doc 10 voice bars and the
// morning delivery gate. Run: npx tsx scripts/voice-gate-report.ts <logfile>

export interface SurfaceStats {
  emissions: number;
  caught: number; // needed a retry or fell back
  fallbacks: number;
  bannedEmissions: number; // emissions with at least one banned-phrase hit
}

export interface GateReport {
  bySurface: Record<string, SurfaceStats>;
  total: SurfaceStats;
  bannedRate: number;
  lines: string[];
}

// doc 10 §6.1: banned-phrase hit rate < 0.5%.
export const BANNED_RATE_MAX = 0.005;

// Every `telemetry {...}` payload in a log export, plain or JSON-wrapped.
export function telemetryEvents(logText: string): any[] {
  const out: any[] = [];
  for (const line of logText.split('\n')) {
    const i = line.indexOf('telemetry {');
    if (i < 0) continue;
    // A JSON log line wraps the message in a string, escaping its quotes, and
    // a log export may wrap that again: unescape one level at a time. The
    // payload is flat, so it ends at the first closing brace.
    let c = line.slice(i + 'telemetry '.length);
    let e: any;
    for (let level = 0; level < 4 && e === undefined; level++) {
      try { e = JSON.parse(c.slice(0, c.indexOf('}') + 1)); } catch { c = c.replace(/\\(["\\])/g, '$1'); }
    }
    if (e && typeof e === 'object') out.push(e);
  }
  return out;
}

export function voiceGateReport(logText: string): GateReport {
  const bySurface: Record<string, SurfaceStats> = {};
  const total: SurfaceStats = { emissions: 0, caught: 0, fallbacks: 0, bannedEmissions: 0 };
  for (const e of telemetryEvents(logText)) {
    if (e.event !== 'voice_emission') continue;
    const s = (bySurface[e.surface] ??= { emissions: 0, caught: 0, fallbacks: 0, bannedEmissions: 0 });
    for (const t of [s, total]) {
      t.emissions++;
      if (e.caught) t.caught++;
      if (e.fallback) t.fallbacks++;
      if (Array.isArray(e.banned) && e.banned.length) t.bannedEmissions++;
    }
  }
  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');
  const bannedRate = total.emissions ? total.bannedEmissions / total.emissions : 0;
  const lines = [
    'surface            emissions  caught  fallback  banned',
    ...Object.entries(bySurface).sort().map(([k, s]) =>
      `${k.padEnd(18)} ${String(s.emissions).padStart(9)}  ${pct(s.caught, s.emissions).padStart(6)}  ${pct(s.fallbacks, s.emissions).padStart(8)}  ${pct(s.bannedEmissions, s.emissions).padStart(6)}`),
    `${'all'.padEnd(18)} ${String(total.emissions).padStart(9)}  ${pct(total.caught, total.emissions).padStart(6)}  ${pct(total.fallbacks, total.emissions).padStart(8)}  ${pct(total.bannedEmissions, total.emissions).padStart(6)}`,
    '',
    `Banned-phrase hit rate ${pct(total.bannedEmissions, total.emissions)} (bar: under 0.5%): ${total.emissions === 0 ? 'NO DATA' : bannedRate < BANNED_RATE_MAX ? 'PASS' : 'FAIL'}`,
  ];
  return { bySurface, total, bannedRate, lines };
}

// doc 10 1.1.1: the morning read lands within 5 minutes of the set time on
// at least 13 of 14 mornings.
export const ON_TIME_MAX_LATE_MIN = 5;
export const ON_TIME_RATE_MIN = 13 / 14;

export interface AthleteDelivery {
  mornings: number; // local days from the first to the last logged daily
  onTime: number;
  late: number; // delivered, but more than 5 minutes late
  failed: number; // a line with delivered false and no later success that day
  missing: number; // days in the range with no daily line at all
}

export interface DeliveryReport {
  byAthlete: Record<string, AthleteDelivery>;
  lines: string[];
  pass: boolean | null; // null: no daily lines
}

function dayIndex(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

export function deliveryGateReport(logText: string): DeliveryReport {
  // athlete -> local date -> best outcome that day (a failure is released and
  // retried on a later tick, so one success makes the day delivered).
  const days = new Map<string, Map<string, { delivered: boolean; lateMin: number }>>();
  for (const e of telemetryEvents(logText)) {
    if (e.event !== 'push_delivery' || e.kind !== 'daily') continue;
    if (typeof e.athlete !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || typeof e.late_min !== 'number') continue;
    const a = days.get(e.athlete) ?? new Map();
    days.set(e.athlete, a);
    const prev = a.get(e.date);
    if (!prev || (!prev.delivered && e.delivered)) a.set(e.date, { delivered: e.delivered === true, lateMin: e.late_min });
  }
  const byAthlete: Record<string, AthleteDelivery> = {};
  for (const [athlete, a] of days) {
    const idx = [...a.keys()].map(dayIndex);
    const mornings = Math.max(...idx) - Math.min(...idx) + 1;
    const d: AthleteDelivery = { mornings, onTime: 0, late: 0, failed: 0, missing: mornings - a.size };
    for (const v of a.values()) {
      if (!v.delivered) d.failed++;
      else if (v.lateMin <= ON_TIME_MAX_LATE_MIN) d.onTime++;
      else d.late++;
    }
    byAthlete[athlete] = d;
  }
  const athletes = Object.keys(byAthlete).sort();
  if (athletes.length === 0) {
    return { byAthlete, pass: null, lines: ['Morning delivery within 5 min (bar: 13 of 14 mornings): NO DATA'] };
  }
  const pass = athletes.every((k) => byAthlete[k].onTime / byAthlete[k].mornings >= ON_TIME_RATE_MIN);
  return {
    byAthlete,
    pass,
    lines: [
      'athlete                               mornings  on time  late  failed  missing',
      ...athletes.map((k) => {
        const d = byAthlete[k];
        return `${k.padEnd(36)} ${String(d.mornings).padStart(9)}  ${String(d.onTime).padStart(7)}  ${String(d.late).padStart(4)}  ${String(d.failed).padStart(6)}  ${String(d.missing).padStart(7)}`;
      }),
      '',
      `Morning delivery within 5 min (bar: 13 of 14 mornings, every athlete): ${pass ? 'PASS' : 'FAIL'}`,
      'Days with no line at all (server down all morning) count only between an athlete\'s first and last logged day.',
    ],
  };
}

// doc 10 1.1.2: the app is opened from the push within 4 hours on at least 12
// of 14 mornings. doc 10 1.1.7: every morning message leads with the numbers.
export const OPEN_WITHIN_MIN = 240;
export const OPEN_RATE_MIN = 12 / 14;

export interface MorningReport {
  byAthlete: Record<string, { sent: number; opened: number; numericFirst: number }>;
  openPass: boolean | null;
  numericPass: boolean | null;
  lines: string[];
}

export function morningGateReport(logText: string): MorningReport {
  const sent = new Map<string, Map<string, boolean>>(); // athlete -> date -> numeric first
  const opened = new Map<string, Set<string>>(); // athlete -> dates opened in time
  for (const e of telemetryEvents(logText)) {
    if (e.kind !== 'daily' || typeof e.athlete !== 'string' || typeof e.date !== 'string') continue;
    if (e.event === 'push_sent') {
      const a = sent.get(e.athlete) ?? new Map();
      sent.set(e.athlete, a);
      a.set(e.date, e.numeric_first === true);
    } else if (e.event === 'push_open' && typeof e.after_min === 'number' && e.after_min <= OPEN_WITHIN_MIN) {
      const a = opened.get(e.athlete) ?? new Set();
      opened.set(e.athlete, a);
      a.add(e.date);
    }
  }
  const byAthlete: MorningReport['byAthlete'] = {};
  for (const [athlete, days] of sent) {
    const o = opened.get(athlete) ?? new Set();
    byAthlete[athlete] = {
      sent: days.size,
      opened: [...days.keys()].filter((d) => o.has(d)).length,
      numericFirst: [...days.values()].filter(Boolean).length,
    };
  }
  const athletes = Object.keys(byAthlete).sort();
  if (athletes.length === 0) {
    return { byAthlete, openPass: null, numericPass: null, lines: [
      'Opened within 4h (bar: 12 of 14 mornings): NO DATA',
      'Numeric-first morning messages (bar: 100%): NO DATA',
    ] };
  }
  const openPass = athletes.every((k) => byAthlete[k].opened / byAthlete[k].sent >= OPEN_RATE_MIN);
  const numericPass = athletes.every((k) => byAthlete[k].numericFirst === byAthlete[k].sent);
  return {
    byAthlete,
    openPass,
    numericPass,
    lines: [
      'athlete                               sent  opened 4h  numbers first',
      ...athletes.map((k) => {
        const d = byAthlete[k];
        return `${k.padEnd(36)} ${String(d.sent).padStart(5)}  ${String(d.opened).padStart(9)}  ${String(d.numericFirst).padStart(13)}`;
      }),
      '',
      `Opened within 4h (bar: 12 of 14 mornings, every athlete): ${openPass ? 'PASS' : 'FAIL'}`,
      `Numeric-first morning messages (bar: 100%): ${numericPass ? 'PASS' : 'FAIL'}`,
    ],
  };
}
