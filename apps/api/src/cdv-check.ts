// Driver-existence for chat replies (CLAUDE.md §3.2: the same rule applies to
// CDV interpretations). The model returns a voice line plus METRIC lines; both
// are its own words, so neither can vouch for a number. What can is the
// measured values in the data block the server sent it, and small counts in
// the athlete's own question ("my last 3 runs").

import { buildFallbackVoice, normalizeForCheck, promptEchoHits, validateVoice } from './validator';
import { stripChartLine } from './cdv-chart';
import { postureClaimHits } from './drivers';
import { keepWholeSentences } from './voice';
import type { Driver } from './validator';
import type { VoiceEmission } from './telemetry';

export interface CdvChecked {
  voice: string;
  drivers: Driver[]; // METRIC lines whose numbers are all in the data
  fallback: boolean; // true when the voice line was replaced
  bannedHits: string[];
  unbackedNumbers: string[];
  // Whether the text in `voice` (what the athlete is sent) passes the same
  // checks as a model answer (doc 10 1.1.4). A fallback is checked too.
  finalOk: boolean;
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
// SCORA's rules, and the chat has none to cite. A trend with a posture word
// (or any other long-form trend) is cut back to nothing; the METRIC line and
// its measured value stay ("steady" meaning flat must not lose a real value).
const POSTURE_WORD = /\b(?:primed|steady|moderate|back[\s-]?off|rest(?:ing)?|taper(?:ing)?)\b/i;
const SHORT_TREND = /^(?:(?:up|down|flat)(?:\s+[+-]?\d+(?:\.\d+)?\s?%)?|[+-]?\d+(?:\.\d+)?\s?%(?:\s+(?:up|down))?)(?:\s+(?:wk|week|w\/w|vs last week|on the week))?$/i;
function trendIssue(trend: string | undefined): 'posture' | 'long' | null {
  if (!trend) return null;
  if (POSTURE_WORD.test(trend)) return 'posture';
  return SHORT_TREND.test(trend.trim()) ? null : 'long';
}

// What vouches for a number in a chat reply: the measured values in the data
// block and small counts in the athlete's question.
function dataKeys(data: unknown): string[] {
  if (Array.isArray(data)) return data.flatMap(dataKeys);
  return data && typeof data === 'object' ? Object.entries(data).flatMap(([k, v]) => [k, ...dataKeys(v)]) : [];
}

function cdvSource(data: unknown, question: string): Driver[] {
  return [
    // The field names say which measures the data has ("hrv"); numbers still
    // come only from the values.
    { metric: dataKeys(data).join(' ').replace(/\d/g, ''), value: timesWhole(dataValues(data).join(' ')) },
    { metric: '', value: questionCounts(question) },
  ];
}

// Decimals in `text` that only a clock time could back. Folding makes "8:47"
// read as 8.47, so a decimal written as a decimal is backed only by a decimal
// in the data ("HRV 7.12" is not backed by a 7:12 pace).
function clockOnlyDecimals(text: string, data: unknown, already: string[] = []): string[] {
  const dataDecimals = new Set((dataValues(data).join(' ').match(/(?<![\d:])\d+\.\d+/g) ?? []).map((n) => String(parseFloat(n))));
  const out: string[] = [];
  for (const dec of text.match(/(?<![\d:.])\d+\.\d+(?![\d])/g) ?? []) {
    const n = String(parseFloat(dec));
    if (!dataDecimals.has(n) && !already.includes(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

// Chat's data is runs only, so unless a field says otherwise a word about sleep, HRV or readiness has nothing
// behind it, with or without a number ("Your HRV crashed"). Saying it is not in
// the data is what the prompt asks for and stays allowed.
const NOT_IN_RUN_DATA = /\b(?:hrv|heart rate variability|sleep|slept|resting (?:hr|heart rate)|readiness)\b/i;
const NAMES_A_GAP = /\b(?:not|no|without|cannot|never|none|missing|lacks?|only)\b|n't\b|\boutside (?:this|the) (?:\w+ )?(?:read|data|record)\b/i;
// Field names only: a run named "sleep" backs nothing.
const hasHealthField = (data: unknown): boolean => {
  if (Array.isArray(data)) return data.some(hasHealthField);
  if (!data || typeof data !== 'object') return false;
  return Object.entries(data).some(([k, v]) => /hrv|sleep|resting|readiness/i.test(k) || hasHealthField(v));
};
const unbackedTopic = (voice: string, data: unknown) =>
  !hasHealthField(data) && voice.split(/(?<=[.;!?])\s+/).some((s) => NOT_IN_RUN_DATA.test(s) && !NAMES_A_GAP.test(s));

// The full check on one voice line, as checkCdvReply runs it.
function checkCdvText(voice: string, data: unknown, question: string, prompt = '') {
  const v = validateVoice(timesWhole(voice), cdvSource(data, question), { seriesInData: true });
  v.bannedHits.push(...promptEchoHits(voice, prompt));
  if (unbackedTopic(normalizeForCheck(voice), data)) v.bannedHits.push('unbacked topic');
  v.unbackedNumbers.push(...clockOnlyDecimals(voice, data, v.unbackedNumbers));
  // Claims with no driver count and read like numbers on this surface's note.
  v.unbackedNumbers.push(...v.unbackedClaims);
  // The prompt says the chat names no posture; this is the guarantee.
  v.bannedHits.push(...postureClaimHits(voice, null));
  v.ok = v.ok && v.bannedHits.length === 0;
  // An empty voice is no answer, so it falls back like a failed one.
  v.ok = v.bannedHits.length === 0 && v.unbackedNumbers.length === 0 && voice.trim() !== '';
  return v;
}

// Whether a chat voice line passes the checks: what the telemetry line
// reports as final_ok for the text actually sent.
export function cdvTextOk(voice: string, data: unknown, question: string): boolean {
  return checkCdvText(voice, data, question).ok;
}

// A METRIC line is a short name and a number with its unit. Anything longer is
// a sentence wearing a metric's clothes, and the app shows it as a driver.
const METRIC_NAME = /^\p{L}[\p{L}\p{N} '()/%&.,-]{0,39}$/u;
const METRIC_VALUE_PART = /^[~+-]?\d[\d.,:/]*\s?(?:%|[a-z]+(?:\/[a-z]+)?(?:\s[a-z]+){0,2})?$/i;
const metricShapeOk = (d: Driver) =>
  METRIC_NAME.test(d.metric) && d.metric.split(/\s+/).length <= 5
  && d.value.length <= 32 && d.value.split(' / ').every((part) => METRIC_VALUE_PART.test(part.trim()));

// Outside text bound for a prompt: one line, no control or invisible characters.
export function promptText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  return v.replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').trim().slice(0, max);
}

// `prompt`, when given, is the system prompt: a reply repeating it is caught.
export function checkCdvReply(voice: string, metricLines: Driver[], data: unknown, question: string, prompt = ''): CdvChecked {
  const source = cdvSource(data, question);
  // A METRIC line is shown to the athlete as a driver, so its name, value and
  // trend must all be in the data, and none of it may be banned phrasing.
  const drivers = metricLines
    .map((d) => (trendIssue(d.trend) ? { metric: d.metric, value: d.value } : d))
    .filter(metricShapeOk)
    .filter((d) => {
      const line = `${d.metric} ${d.value} ${d.trend ?? ''}`;
      // The same decimal rule as the voice: the fallback quotes these lines.
      return validateVoice(timesWhole(line), source, { seriesInData: true }).ok && clockOnlyDecimals(line, data).length === 0;
    });
  const v = checkCdvText(voice, data, question, prompt);
  if (v.ok) return { voice, drivers, fallback: false, bannedHits: [], unbackedNumbers: [], finalOk: true };
  const fallback = drivers.length
    ? buildFallbackVoice(drivers, 'Here')
    : 'That answer could not be checked against your data, so it is not shown.';
  return {
    voice: fallback,
    drivers,
    fallback: true,
    bannedHits: v.bannedHits,
    unbackedNumbers: v.unbackedNumbers,
    finalOk: cdvTextOk(fallback, data, question),
  };
}

// The model's reply as the route reads it: line 1 is the voice, then METRIC
// lines; the CHART line is read separately (cdv-chart.ts).
export function parseCdvLines(text: string): { voice: string; metricLines: Driver[] } {
  const lines = stripChartLine(text).split('\n');
  // The voice is the first prose line: never a blank line or a METRIC line.
  const voiceAt = lines.findIndex((l) => l.trim() !== '' && !l.includes('METRIC:'));
  const metricLines: Driver[] = [];
  for (const line of lines) {
    if (!line.includes('METRIC:')) continue;
    const metric = line.match(/METRIC:\s*([^|]+)/)?.[1]?.trim();
    const value = line.match(/VALUE:\s*([^|]+)/)?.[1]?.trim();
    const trend = line.match(/TREND:\s*(.+)$/)?.[1]?.trim();
    if (metric && value) metricLines.push({ metric, value, ...(trend ? { trend } : {}) });
  }
  return { voice: voiceAt >= 0 ? lines[voiceAt].trim() : '', metricLines };
}

// A reply the token cap stopped: its last line is unfinished, and a METRIC value
// cut from 18.4 to 18 would still read as a number. With only the voice line
// there, its whole sentences. Empty means no answer (the outage path and refund).
export function uncutCdvReply(text: string): string {
  const lines = text.trimEnd().split('\n');
  const kept = lines.slice(0, -1).join('\n');
  return kept.trim() ? kept : keepWholeSentences(text);
}

// Check the reply; on a catch, ask once more with the violations named (as
// the daily read does), then fall back. A failed retry call falls back too.
export async function checkCdvWithRetry(
  raw: string,
  data: unknown,
  question: string,
  retry: (note: string) => Promise<string>,
  prompt = '',
): Promise<{ raw: string; checked: CdvChecked; attempts: 1 | 2; seenBanned: string[]; seenUnbacked: number }> {
  const check = (r: string) => {
    const p = parseCdvLines(r);
    return checkCdvReply(p.voice, p.metricLines, data, question, prompt);
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
  ].join('; ') || 'no one-sentence answer on line 1';
  try {
    const raw2 = await retry(`Your previous answer was rejected for: ${issues}. Rewrite it in the same format. Use only numbers written exactly as they appear in the data.`);
    const second = check(raw2);
    return { raw: raw2, checked: second, attempts: 2, ...seen(first, second) };
  } catch {
    return { raw, checked: first, attempts: 2, ...seen(first) };
  }
}

// The CDV telemetry line for what the route sends (doc 10 1.1.4 and 2.1.5).
// Labels and counts only: never the text or a value.
export function cdvEmission(final: { checked: CdvChecked; attempts: 1 | 2; seenBanned: string[]; seenUnbacked: number }): VoiceEmission {
  return {
    surface: 'cdv',
    attempts: final.attempts,
    fallback: final.checked.fallback,
    bannedHits: final.seenBanned,
    unbackedCount: final.seenUnbacked,
    finalOk: final.checked.finalOk,
  };
}
