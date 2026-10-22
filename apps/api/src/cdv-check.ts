// Driver-existence for chat replies (CLAUDE.md §3.2: the same rule applies to
// CDV interpretations). The model returns a voice line plus METRIC lines; both
// are its own words, so neither can vouch for a number. What can is the data
// block the server sent it, and the athlete's own question ("my last 3 runs").

import { buildFallbackVoice, validateVoice } from './validator';
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
