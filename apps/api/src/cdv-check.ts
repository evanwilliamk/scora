// Driver-existence for chat replies (CLAUDE.md §3.2: the same rule applies to
// CDV interpretations). The model returns a voice line plus METRIC lines; both
// are its own words, so neither can vouch for a number. What can is the
// measured values in the data block the server sent it, and small counts in
// the athlete's own question ("my last 3 runs").

import { buildFallbackVoice, validateVoice } from './validator';
import { stripChartLine } from './cdv-chart';
import type { Driver } from './validator';

export interface CdvChecked {
  voice: string;
  drivers: Driver[]; // METRIC lines whose numbers are all in the data
  fallback: boolean; // true when the voice line was replaced
  bannedHits: string[];
  unbackedNumbers: string[];
}

// Fields whose numbers are not measurements: dates and run names would let
// almost any number from 1 to 31 through ("HRV is 21 ms").
const NOT_MEASURES = new Set(['name', 'date', 'dow', 'weekday', 'today']);

// Every measured value in the data block, as text the validator can read.
export function dataValues(data: unknown, out: string[] = []): string[] {
  if (typeof data === 'number') out.push(String(data));
  else if (typeof data === 'string') out.push(data);
  else if (Array.isArray(data)) data.forEach((d) => dataValues(d, out));
  else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) if (!NOT_MEASURES.has(k)) dataValues(v, out);
  }
  return out;
}

// Small counts the athlete asked about ("my last 3 runs", "6 weeks") may be
// repeated; a figure they assert ("did I run 50 miles?") is not evidence.
const questionCounts = (q: string) =>
  [...q.matchAll(/\b(\d+)\s+(?:runs?|weeks?|days?|months?|sessions?|workouts?|rides?)\b/gi)]
    .map((m) => m[1]).filter((n) => Number(n) <= 12).join(' ');

// A clock time or pace ("8:47") is one value. Split into 8 and 47, its
// seconds would vouch for any number from 0 to 59 ("HRV 47 ms").
const timesWhole = (t: string) => t.replace(/\b(\d{1,2}):([0-5]\d)\b/g, '$1.$2');

// TREND is a short direction, never a posture: postures are decided by
// SCORA's rules, and the chat has none to cite. A METRIC line that puts one
// there is dropped; any other long-form trend is cut back to nothing.
const POSTURE_WORD = /\b(?:primed|steady|moderate|back[\s-]?off|rest(?:ing)?|taper(?:ing)?)\b/i;
const SHORT_TREND = /^(?:(?:up|down|flat)(?:\s+[+-]?\d+(?:\.\d+)?\s?%)?|[+-]?\d+(?:\.\d+)?\s?%(?:\s+(?:up|down))?)(?:\s+(?:wk|week|w\/w|vs last week|on the week))?$/i;
export function trendIssue(trend: string | undefined): 'posture' | 'long' | null {
  if (!trend) return null;
  if (POSTURE_WORD.test(trend)) return 'posture';
  return SHORT_TREND.test(trend.trim()) ? null : 'long';
}

export function checkCdvReply(voice: string, metricLines: Driver[], data: unknown, question: string): CdvChecked {
  const source: Driver[] = [
    { metric: '', value: timesWhole(dataValues(data).join(' ')) },
    { metric: '', value: questionCounts(question) },
  ];
  // A METRIC line is shown to the athlete as a driver, so its name, value and
  // trend must all be in the data.
  const drivers = metricLines
    .filter((d) => trendIssue(d.trend) !== 'posture')
    .map((d) => (trendIssue(d.trend) === 'long' ? { metric: d.metric, value: d.value } : d))
    .filter((d) => validateVoice(timesWhole(`${d.metric} ${d.value} ${d.trend ?? ''}`), source).unbackedNumbers.length === 0);
  const v = validateVoice(timesWhole(voice), source);
  // Folding makes "8:47" read as 8.47, so a decimal the voice writes as a
  // decimal is backed only by a decimal in the data, never by a clock time
  // ("HRV 7.12" is not backed by a 7:12 pace).
  const dataDecimals = new Set((dataValues(data).join(' ').match(/(?<![\d:])\d+\.\d+/g) ?? []).map((n) => String(parseFloat(n))));
  for (const dec of voice.match(/(?<![\d:.])\d+\.\d+(?![\d])/g) ?? []) {
    const n = String(parseFloat(dec));
    if (!dataDecimals.has(n) && !v.unbackedNumbers.includes(n)) v.unbackedNumbers.push(n);
  }
  v.ok = v.ok && v.unbackedNumbers.length === 0;
  if (v.ok) return { voice, drivers, fallback: false, bannedHits: [], unbackedNumbers: [] };
  return {
    voice: drivers.length
      ? buildFallbackVoice(drivers, 'Here')
      : 'That answer could not be checked against your data, so it is not shown.',
    drivers,
    fallback: true,
    bannedHits: v.bannedHits,
    unbackedNumbers: v.unbackedNumbers,
  };
}

// The model's reply as the route reads it: line 1 is the voice, then METRIC
// lines; the CHART line is read separately (cdv-chart.ts).
export function parseCdvLines(text: string): { voice: string; metricLines: Driver[] } {
  const lines = stripChartLine(text).split('\n');
  const metricLines: Driver[] = [];
  for (const line of lines.slice(1)) {
    if (!line.includes('METRIC:')) continue;
    const metric = line.match(/METRIC:\s*([^|]+)/)?.[1]?.trim();
    const value = line.match(/VALUE:\s*([^|]+)/)?.[1]?.trim();
    const trend = line.match(/TREND:\s*(.+)$/)?.[1]?.trim();
    if (metric && value) metricLines.push({ metric, value, ...(trend ? { trend } : {}) });
  }
  return { voice: lines[0] || '', metricLines };
}

// Check the reply; on a catch, ask once more with the violations named (as
// the daily read does), then fall back. A failed retry call falls back too.
export async function checkCdvWithRetry(
  raw: string,
  data: unknown,
  question: string,
  retry: (note: string) => Promise<string>,
): Promise<{ raw: string; checked: CdvChecked; attempts: 1 | 2; seenBanned: string[]; seenUnbacked: number }> {
  const check = (r: string) => {
    const p = parseCdvLines(r);
    return checkCdvReply(p.voice, p.metricLines, data, question);
  };
  const first = check(raw);
  // Every catch across both drafts, for the telemetry line.
  const seen = (...cs: CdvChecked[]) => ({
    seenBanned: cs.flatMap((c) => c.bannedHits),
    seenUnbacked: cs.reduce((n, c) => n + c.unbackedNumbers.length, 0),
  });
  if (!first.fallback) return { raw, checked: first, attempts: 1, ...seen(first) };
  const issues = [
    ...first.bannedHits.map((b) => `banned phrasing (${b})`),
    ...(first.unbackedNumbers.length ? [`numbers not in the data: ${first.unbackedNumbers.join(', ')}`] : []),
  ].join('; ');
  try {
    const raw2 = await retry(`Your previous answer was rejected for: ${issues}. Rewrite it in the same format. Use only numbers written exactly as they appear in the data.`);
    const second = check(raw2);
    return { raw: raw2, checked: second, attempts: 2, ...seen(first, second) };
  } catch {
    return { raw, checked: first, attempts: 2, ...seen(first) };
  }
}
