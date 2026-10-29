// Log audit for doc 10 gate 1.1.6 (zero PHI in logs) and §6.5 (no secrets in
// logs): scans an exported log for health values and credentials. The report
// names line numbers and categories only, never the matched text, so the
// report itself is safe to paste anywhere.

export type Finding = { line: number; category: string };

// Health values as the API words them (driver values, Strava and Oura
// fields). A bare number is not flagged: ids, counts and timings are fine.
// Keys may be snake_case or quoted JSON, so a key is bounded by anything that
// is not a letter (\b fails on "_"). Three-digit HTTP statuses after a
// service name ("Oura 401") are not values.
const K = '(?<![A-Za-z])';
const SEP = `(?:["':\\s=,]|"?value"?){0,12}?`;
const PATTERNS: [string, RegExp][] = [
  ['hrv', new RegExp(`${K}(?:average_)?hrv(?:_ms)?(?![A-Za-z])[^0-9\\n]{0,24}\\d+(?:\\.\\d+)?`, 'i')],
  ['heart rate', new RegExp(`${K}(?:resting hr|rhr|hr|heart ?rate|(?:resting|average|max|lowest)_heart_?rate|average_heartrate|max_heartrate)(?![A-Za-z])${SEP}\\d{2,3}(?!\\d)`, 'i')],
  ['heart rate', /\b\d{2,3}\s*bpm\b/i],
  ['sleep', new RegExp(`${K}sleep(?![A-Za-z])[^0-9\\n]{0,24}(?:\\d{1,2}h\\s*\\d{1,2}m?|\\d{1,2}:\\d{2}(?!\\s*(?:am|pm))|score${SEP}\\d{1,3})`, 'i')],
  ['sleep', /(?:total|deep|rem|light)_sleep_duration/i],
  ['readiness', new RegExp(`${K}(?:oura|readiness)(?![A-Za-z])(?:${SEP}score)?${SEP}(?!(?:[45]\\d\\d)\\b)\\d{1,3}(?!\\d)`, 'i')],
  ['body weight', new RegExp(`${K}(?:weight|body ?mass)(?![A-Za-z])${SEP}\\d+(?:\\.\\d+)?`, 'i')],
  ['calories', new RegExp(`${K}(?:calories|kilojoules)(?![A-Za-z])${SEP}(?![45]\\d\\d\\s+error)\\d+`, 'i')],
  ['location', /(?:start_latlng|end_latlng|summary_polyline)/i],
  ['secret', /(?:access_token|refresh_token|client_secret|service_role)["':\s=]{1,4}[A-Za-z0-9._-]{12,}/i],
  ['secret', /\bBearer\s+[A-Za-z0-9._-]{20,}/],
  ['secret', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['secret', /\beyJ[\w-]{8,}\.[\w-]{8,}\./],
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
