// Card tap-to-expand (Free tier, card level; doc 08 §7, CLAUDE.md §3.4).
//
// The athlete taps a dashboard card and gets a 2-3 sentence interpretation of
// that card, citing only drivers from the same read. Free tier: no word-level
// chart links (Plan-tier inline chart-expansion is a separate feature).
//
// The read route stores a snapshot of what it showed; the expansion reads from
// it, so a tap costs one LLM call and no Strava or Oura call.

import type { Card, Driver } from './metrics';

export interface ReadSnapshot {
  cards: Card[];
  drivers: Driver[];
  posture: string | null;
  at: number;
}

export const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

export class SnapshotCache {
  private m = new Map<string, ReadSnapshot>();
  constructor(private ttl = SNAPSHOT_TTL_MS, private max = 5000) {}

  set(athleteId: string, s: Omit<ReadSnapshot, 'at'>, now = Date.now()): void {
    if (this.m.size >= this.max) {
      const oldest = this.m.keys().next().value;
      if (oldest !== undefined) this.m.delete(oldest);
    }
    this.m.delete(athleteId); // re-insert so iteration order tracks recency
    this.m.set(athleteId, { ...s, at: now });
  }

  get(athleteId: string, now = Date.now()): ReadSnapshot | null {
    const s = this.m.get(athleteId);
    if (!s) return null;
    if (now - s.at > this.ttl) { this.m.delete(athleteId); return null; }
    return s;
  }
}

// Which drivers give a card its context. The card's own metric comes first.
const RELATED: Record<string, string[]> = {
  sleep: ['Sleep', 'HRV', 'Resting HR', 'Load'],
  training_load: ['Load', 'Weekly volume', 'Peak avg HR (7d)', 'Long effort'],
  recent_intensity: ['Peak avg HR (7d)', 'Load', 'Sleep', 'HRV'],
  recovery_signal: ['HRV', 'Resting HR', 'Sleep', 'Load'],
  long_effort: ['Long effort', 'Weekly volume', 'Load'],
};

export const EXPANDABLE_CARDS = Object.keys(RELATED);

export function relatedDrivers(cardId: string, drivers: Driver[]): Driver[] {
  const names = RELATED[cardId] ?? [];
  return names
    .map((n) => drivers.find((d) => d.metric === n))
    .filter((d): d is Driver => d !== undefined);
}

export type CardExpansionPlan =
  | { kind: 'static'; reply: string }
  | { kind: 'llm'; systemPrompt: string; userPrompt: string; drivers: Driver[] };

// Decides how to answer a tap. Cards with no data, or with nothing to cite,
// get their own text back and never reach the LLM.
export function planCardExpansion(card: Card, snapshot: ReadSnapshot): CardExpansionPlan {
  if (!card.available) return { kind: 'static', reply: card.cta ?? 'Not available yet.' };
  const drivers = relatedDrivers(card.id, snapshot.drivers);
  if (!EXPANDABLE_CARDS.includes(card.id) || drivers.length === 0) {
    return { kind: 'static', reply: card.translation ?? '' };
  }

  const systemPrompt = `You are SCORA, an interpretation layer for endurance athletes. You READ and NAME what the data shows. You are NOT a coach and you never prescribe.

The athlete tapped one dashboard card. Write 2-3 sentences that interpret that card in the context of today's other numbers.

HARD RULES:
- Every number you write must appear in DRIVERS. Never invent a value or reference data that isn't listed.
- Numeric-first: give the card's raw value, then say what it means alongside the related drivers.
- Never tell the athlete what to do: no "you should / you need to / do a / go for", no workout suggestions.
- If a POSTURE is given you may name it as an observation, never a different one.
- Tone: calm, considered, short sentences, plain English. No exclamation points, no emoji, no hype. No "coach".

OUTPUT: 2-3 sentences of plain prose. Nothing else.`;

  const driverBlock = drivers.map((d) => `- ${d.metric}: ${d.value}${d.trend ? ` (${d.trend})` : ''}`).join('\n');
  const userPrompt = `CARD: ${card.title}: ${card.value ?? ''}${card.unit ? ` ${card.unit}` : ''}${card.trend ? ` (${card.trend})` : ''}, from ${card.source ?? 'SCORA'}
DRIVERS (the only values you may cite):
${driverBlock}
${snapshot.posture ? `POSTURE (decided by SCORA's rules): ${snapshot.posture}\n` : ''}
Interpret the ${card.title} card.`;

  return { kind: 'llm', systemPrompt, userPrompt, drivers };
}
