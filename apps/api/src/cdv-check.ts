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
const questionCounts = (q: string) => (q.match(/\b\d+\b/g) ?? []).filter((n) => Number(n) <= 12).join(' ');

export function checkCdvReply(voice: string, metricLines: Driver[], data: unknown, question: string): CdvChecked {
  const source: Driver[] = [
    { metric: '', value: dataValues(data).join(' ') },
    { metric: '', value: questionCounts(question) },
  ];
  // A METRIC line is shown to the athlete as a driver, so its name, value and
  // trend must all be in the data. Posture words and "flat" carry no numbers.
  const drivers = metricLines.filter((d) => validateVoice(`${d.metric} ${d.value} ${d.trend ?? ''}`, source).unbackedNumbers.length === 0);
  const v = validateVoice(voice, source);
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
): Promise<{ raw: string; checked: CdvChecked; attempts: 1 | 2 }> {
  const check = (r: string) => {
    const p = parseCdvLines(r);
    return checkCdvReply(p.voice, p.metricLines, data, question);
  };
  const first = check(raw);
  if (!first.fallback) return { raw, checked: first, attempts: 1 };
  const issues = [
    ...first.bannedHits.map((b) => `banned phrasing (${b})`),
    ...(first.unbackedNumbers.length ? [`numbers not in the data: ${first.unbackedNumbers.join(', ')}`] : []),
  ].join('; ');
  try {
    const raw2 = await retry(`Your previous answer was rejected for: ${issues}. Rewrite it in the same format. Use only numbers written exactly as they appear in the data.`);
    return { raw: raw2, checked: check(raw2), attempts: 2 };
  } catch {
    return { raw, checked: first, attempts: 2 };
  }
}
