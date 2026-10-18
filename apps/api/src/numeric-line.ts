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
  if (hrv) parts.push(`HRV ${hrv.value}${hrv.trend ? ` (${hrv.trend})` : ''}`);
  const load = get('Load');
  if (load) parts.push(`Load ${load.value.replace(/\s*min$/, '')}`);
  return parts.join(' · ');
}

// APNs body: the numbers on the first line, the read below, trimmed to what
// a notification shows (~178 characters).
export function pushBody(numbers: string, voice: string, max = 178): string {
  const read = voice.replace(/\s+/g, ' ').trim();
  const text = numbers ? `${numbers}\n${read}` : read;
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}
