// Voice gate report (doc 10 §7): reads exported API logs, finds the
// `telemetry {"event":"voice_emission",...}` lines (telemetry.ts) and checks
// them against the doc 10 voice bars. Run: npx tsx scripts/voice-gate-report.ts <logfile>

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

export function voiceGateReport(logText: string): GateReport {
  const bySurface: Record<string, SurfaceStats> = {};
  const total: SurfaceStats = { emissions: 0, caught: 0, fallbacks: 0, bannedEmissions: 0 };
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
    if (!e || e.event !== 'voice_emission') continue;
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
