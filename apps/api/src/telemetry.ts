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
}

export function voiceEmissionLine(e: VoiceEmission): string {
  return `telemetry ${JSON.stringify({
    event: 'voice_emission',
    surface: e.surface,
    attempts: e.attempts,
    fallback: e.fallback,
    caught: e.attempts > 1 || e.fallback,
    banned: [...new Set(e.bannedHits)],
    unbacked: e.unbackedCount,
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
