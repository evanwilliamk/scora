// Driver-existence for chat replies (CLAUDE.md §3.2: the same rule applies to
// CDV interpretations). The model returns a voice line plus METRIC lines; both
// are its own words, so neither can vouch for a number. What can is the data
// block the server sent it, and the athlete's own question ("my last 3 runs").

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

export function checkCdvReply(voice: string, metricLines: Driver[], data: unknown, question: string): CdvChecked {
  const source: Driver[] = [
    { metric: 'data', value: JSON.stringify(data) },
    { metric: 'question', value: question },
  ];
  // A METRIC line is shown to the athlete as a driver, so its value and trend
  // must be in the data too. Posture words and "flat" carry no numbers and pass.
  const drivers = metricLines.filter((d) => validateVoice(`${d.value} ${d.trend ?? ''}`, source).unbackedNumbers.length === 0);
  const v = validateVoice(voice, [...source, ...drivers]);
  if (v.ok) return { voice, drivers, fallback: false, bannedHits: [], unbackedNumbers: [] };
  return {
    voice: buildFallbackVoice(drivers, 'Here'),
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
