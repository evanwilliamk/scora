// Log audit for doc 10 gate 1.1.6 (zero PHI in logs) and §6.5 (no secrets in
// logs): scans an exported log for health values and credentials. The report
// names line numbers and categories only, never the matched text, so the
// report itself is safe to paste anywhere.

export type Finding = { line: number; category: string };

// Health values as the API words them (driver values, Strava and Oura
// fields). A bare number is not flagged: ids, counts and timings are fine.
const PATTERNS: [string, RegExp][] = [
  ['hrv', /\bhrv\b[^0-9\n]{0,20}\d+(?:\.\d+)?\s*ms\b/i],
  ['heart rate', /\b(?:resting hr|rhr|heart ?rate|average_heartrate|max_heartrate|lowest_heart_rate)\b["':\s=]{0,4}\d+/i],
  ['heart rate', /\b\d{2,3}\s*bpm\b/i],
  ['sleep', /\bsleep\b[^0-9\n]{0,20}\d{1,2}(?::\d{2}|h\s*\d{1,2}m?)\b/i],
  ['sleep', /\b(?:total_sleep_duration|deep_sleep_duration|rem_sleep_duration)\b/i],
  ['readiness', /\b(?:oura|readiness)(?: score)?\b["':\s=]{0,4}\d{1,3}\b/i],
  ['body weight', /\b(?:weight|body ?mass)\b["':\s=]{0,4}\d+(?:\.\d+)?\s*(?:kg|lb|lbs)?\b/i],
  ['calories', /\b(?:calories|kilojoules)\b["':\s=]{0,4}\d+/i],
  ['location', /\b(?:start_latlng|end_latlng|summary_polyline)\b/i],
  ['secret', /\b(?:access_token|refresh_token|client_secret|service_role)\b["':\s=]{1,4}[A-Za-z0-9._-]{12,}/i],
  ['secret', /\bBearer\s+[A-Za-z0-9._-]{20,}/],
  ['secret', /\bsk-[A-Za-z0-9_-]{20,}/],
];

export function auditLog(logText: string): Finding[] {
  const out: Finding[] = [];
  logText.split('\n').forEach((text, i) => {
    const seen = new Set<string>();
    for (const [category, re] of PATTERNS) {
      if (!seen.has(category) && re.test(text)) {
        seen.add(category);
        out.push({ line: i + 1, category });
      }
    }
  });
  return out;
}

export function auditReport(logText: string): { findings: Finding[]; lines: string[] } {
  const findings = auditLog(logText);
  const byCategory = new Map<string, number[]>();
  for (const f of findings) byCategory.set(f.category, [...(byCategory.get(f.category) ?? []), f.line]);
  const lines = [...byCategory].sort().map(([c, ls]) =>
    `${c.padEnd(12)} ${String(ls.length).padStart(5)} lines (first: ${ls.slice(0, 5).join(', ')}${ls.length > 5 ? ', ...' : ''})`);
  lines.push('', `Health values or secrets in logs (bar: none): ${findings.length === 0 ? 'PASS' : 'FAIL'}`);
  return { findings, lines };
}
