// Per-athlete LLM use (CLAUDE.md 8.6): one log line for every OpenAI request,
// retries and failures included, with the model and the tokens it reports.
// Cost is tokens times the price of that day, worked out from the logs, so a
// price change rewrites no history. Labels and counts only: never a prompt, a
// reply or a vendor error body (gate 1.1.6).

import type { VoiceSurface } from './telemetry';

export type LlmSurface = VoiceSurface | 'plan_parse' | 'retrieval' | 'voice';

export interface LlmCall {
  surface: LlmSurface;
  athleteId: string | null;
  model: string | null;
  attempt: number;
  // The HTTP status, or null when no answer came (timeout, network).
  status: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export function llmCallLine(c: LlmCall): string {
  return `telemetry ${JSON.stringify({
    event: 'llm_call',
    surface: c.surface,
    athlete: c.athleteId,
    model: c.model,
    attempt: c.attempt,
    status: c.status,
    prompt_tokens: c.promptTokens,
    completion_tokens: c.completionTokens,
  })}`;
}

const modelOf = (init?: RequestInit): string | null => {
  try {
    const model = JSON.parse(String(init?.body)).model;
    return typeof model === 'string' ? model : null;
  } catch {
    return null;
  }
};
const count = (v: unknown): number | null => (typeof v === 'number' ? v : null);

// A fetch for one surface and athlete. Each request through it logs one line
// and counts as the next attempt, so every OpenAI wrapper can be metered by
// what it is handed. Telemetry never changes what the caller gets back.
export function meteredFetch(
  surface: LlmSurface,
  athleteId: unknown,
  log: { info?: (m: string) => void } | undefined,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): typeof fetch {
  let attempt = 0;
  return (async (input: any, init?: RequestInit) => {
    attempt++;
    const line = { surface, athleteId: athleteId == null ? null : String(athleteId), model: modelOf(init), attempt };
    const emit = (status: number | null, promptTokens: number | null, completionTokens: number | null) => {
      try {
        log?.info?.(llmCallLine({ ...line, status, promptTokens, completionTokens }));
      } catch { /* a broken log transport is not a failed call */ }
    };
    let res: Response;
    try {
      res = await fetchImpl(input, init);
    } catch (e) {
      emit(null, null, null);
      throw e;
    }
    // A failed answer's body stays unread (vendor-error.ts) and bills nothing.
    if (!res.ok) {
      emit(res.status, null, null);
      return res;
    }
    let usage: any = null;
    try {
      usage = ((await res.clone().json()) as any)?.usage;
    } catch { /* the caller will find the same bad body */ }
    emit(res.status, count(usage?.prompt_tokens), count(usage?.completion_tokens));
    return res;
  }) as typeof fetch;
}
