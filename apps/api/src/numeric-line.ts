// The numeric line that opens every daily read (CLAUDE.md §3.3, PRD §5.A.2):
// "Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412". Raw driver values
// only, in a fixed order; anything the athlete has no data for is left out.

import type { Driver } from './metrics';

export function numericLine(drivers: Driver[]): string {
  const get = (m: string) => drivers.find((d) => d.metric === m);
  const parts: string[] = [];
  const sleep = get('Sleep');
  if (sleep) {
    parts.push(`Sleep ${sleep.value}`);
    if (sleep.trend && /^Oura \d+$/.test(sleep.trend)) parts.push(sleep.trend);
  }
  const hrv = get('HRV');
  // Only a real percentage is shown; a missing comparison shows nothing.
  if (hrv) parts.push(`HRV ${hrv.value}${hrv.trend && /^[+-]?\d+% wk$/.test(hrv.trend) ? ` (${hrv.trend})` : ''}`);
  const load = get('Load');
  if (load) parts.push(`Load ${load.value.replace(/\s*min$/, '')}`);
  return parts.join(' · ');
}

// APNs body: the numbers on the first line, the read below, trimmed to what
// a notification shows (~178 characters).
// The Plan tier's "Today:" line (CLAUDE.md §3.3) goes last. The voice gives
// way to it but keeps about VOICE_ROOM characters of its own, so a very long
// session line is trimmed rather than pushing the read out. A line that would
// be trimmed to a stub is left off.
const VOICE_ROOM = 60;
const MIN_LINE = 20;
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, Math.max(0, n - 1)).trimEnd() + '…');

export function pushBody(numbers: string, voice: string, max = 178, today = ''): string {
  const read = voice.replace(/\s+/g, ' ').trim();
  const text = numbers ? `${numbers}\n${read}` : read;
  const kept = (numbers ? numbers.length + 1 : 0) + Math.min(read.length, VOICE_ROOM);
  const room = max - (text ? 1 : 0) - kept;
  const line = today && room >= MIN_LINE ? clip(today, room) : '';
  if (!line) return clip(text, max);
  return text ? `${clip(text, max - line.length - 1)}\n${line}` : line;
}
