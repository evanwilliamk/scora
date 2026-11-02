// Telemetry for doc 10 §6.1 and §5.1 (banned-phrase hit rate, validator catch
// rate) until PostHog is set up: one structured log line per voice emission,
// countable from the Railway logs. Labels and counts only: never the text,
// never a health value (doc 10 §6.5, no PHI in logs).

export type VoiceSurface = 'daily' | 'weekly' | 'card' | 'cdv' | 'adaptation_reason' | 'why' | 'more';

export interface VoiceEmission {
  surface: VoiceSurface;
  attempts: number;
  fallback: boolean;
  bannedHits: string[];
  unbackedCount: number;
  // Whether the text actually sent passes the validators, model draft or
  // fallback alike (doc 10 1.1.4, zero fail-throughs). Required: every
  // surface checks what it sends.
  finalOk: boolean;
}

// A catch as logged: the fixed label only. "wrong direction for HRV vs week"
// names a driver, and a driver name next to a count ("HRV vs week"],
// "unbacked":2) reads as a health value to the log audit (gate 1.1.6).
export function catchLabel(hit: string): string {
  return hit.startsWith('wrong direction for ') ? 'wrong direction' : hit;
}

export function voiceEmissionLine(e: VoiceEmission): string {
  return `telemetry ${JSON.stringify({
    event: 'voice_emission',
    surface: e.surface,
    attempts: e.attempts,
    fallback: e.fallback,
    caught: e.attempts > 1 || e.fallback,
    banned: [...new Set(e.bannedHits.map(catchLabel))],
    unbacked: e.unbackedCount,
    final_ok: e.finalOk,
  })}`;
}

export function trackVoice(log: { info?: (m: string) => void } | undefined, e: VoiceEmission): void {
  log?.info?.(voiceEmissionLine(e));
}

// One line per scheduled push (doc 10 1.1.1 and §5.1 delivery rate). The
// athlete id is the opaque uuid, already in the scheduler's warn lines; no
// read text and no health value.
export interface PushDelivery {
  kind: 'daily' | 'weekly';
  athleteId: string;
  localDate: string;
  lateMin: number;
  delivered: boolean;
}

export function pushDeliveryLine(d: PushDelivery): string {
  return `telemetry ${JSON.stringify({
    event: 'push_delivery',
    kind: d.kind,
    athlete: d.athleteId,
    date: d.localDate,
    late_min: d.lateMin,
    delivered: d.delivered,
  })}`;
}

// One line per generated push: whether the daily message led with the numbers
// line (doc 10 1.1.7) and how many devices APNs accepted.
export function pushSentLine(d: { kind: 'daily' | 'weekly'; athleteId: string; localDate: string; numericFirst: boolean; devices: number; accepted: number }): string {
  return `telemetry ${JSON.stringify({
    event: 'push_sent',
    kind: d.kind,
    athlete: d.athleteId,
    date: d.localDate,
    numeric_first: d.numericFirst,
    devices: d.devices,
    accepted: d.accepted,
  })}`;
}

// The athlete opened the app from a scheduled push (doc 10 1.1.2), with the
// minutes since it was sent.
export function pushOpenLine(d: { kind: 'daily' | 'weekly'; athleteId: string; localDate: string; afterMin: number }): string {
  return `telemetry ${JSON.stringify({
    event: 'push_open',
    kind: d.kind,
    athlete: d.athleteId,
    date: d.localDate,
    after_min: d.afterMin,
  })}`;
}

// One line per daily read on a day with a planned session (not rest): whether
// the read named the plan (doc 10 2.1.8).
export function readPlanLine(d: { athleteId: string; localDate: string; named: boolean }): string {
  return `telemetry ${JSON.stringify({ event: 'read_plan', athlete: d.athleteId, date: d.localDate, named: d.named })}`;
}
