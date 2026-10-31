import { validateVoice, buildFallbackVoice, Driver, ValidationResult } from './validator';
import { trackVoice, type VoiceSurface } from './telemetry';

// Generate a voice read and guarantee it passes the validators before it's
// emitted (§3.2). Flow: LLM draft -> validate -> if it fails, one retry with
// the violations fed back -> if it still fails, a deterministic fallback built
// only from drivers. Every catch is logged for telemetry (§8.6).

interface GenerateParams {
  systemPrompt: string;
  userPrompt: string;
  drivers: Driver[];
  model?: string;
  maxTokens?: number;
  leadIn?: string; // prefix for the deterministic fallback
  surface?: VoiceSurface; // for the telemetry line
  // Surface-specific checks (the daily read's posture). Each hit is treated
  // like a banned phrase: fed back for the retry, then the fallback.
  check?: (voice: string) => string[];
  log?: { warn: (msg: string) => void; error: (msg: string) => void; info?: (msg: string) => void };
  // When the OpenAI call itself fails (network, timeout, 429, 5xx) on the
  // first draft, return the deterministic fallback instead of throwing. Opted
  // into by the daily read and the weekly review so an outage still sends a
  // validated read; other surfaces keep their own catch.
  fallbackOnLlmError?: boolean;
}

export interface GenerateResult {
  voice: string;
  validation: ValidationResult;
  usedFallback: boolean;
  attempts: number;
  // True when an OpenAI call failed outright (not a validator rejection).
  llmError: boolean;
}

// Per-call cap on the OpenAI request. Two calls at most per read, so a hung
// upstream costs the route at most twice this before the fallback.
const OPENAI_TIMEOUT_MS = 20_000;

class OpenAIHttpError extends Error {
  constructor(readonly status: number) {
    super(`OpenAI ${status}`);
  }
}

// What kind of failure, for logs: never the error body or message.
function llmErrorKind(e: unknown): string {
  if (e instanceof OpenAIHttpError) return `http_${e.status}`;
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'timeout';
  return 'network';
}

async function callOpenAI(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.5,
    }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });
  if (!res.ok) {
    // The body can echo the prompt (athlete values); it stays out of the error.
    await res.body?.cancel().catch(() => {});
    throw new OpenAIHttpError(res.status);
  }
  const json: any = await res.json();
  return (json.choices?.[0]?.message?.content || '').trim();
}

// For logs: labels and a count only. The unbacked numbers themselves can be
// health values the model invented or misquoted (doc 10 §6.5, no PHI in logs).
function logNote(v: ValidationResult): string {
  return `banned: ${v.bannedHits.join(', ') || 'none'}; unbacked numbers: ${v.unbackedNumbers.length}`;
}

function violationNote(v: ValidationResult): string {
  const bits: string[] = [];
  if (v.bannedHits.length) bits.push(`banned phrasing (${v.bannedHits.join(', ')})`);
  if (v.unbackedNumbers.length)
    bits.push(`numbers not in the drivers (${v.unbackedNumbers.join(', ')})`);
  return bits.join('; ');
}

export async function generateValidatedVoice(params: GenerateParams): Promise<GenerateResult> {
  const {
    systemPrompt,
    userPrompt,
    drivers,
    model = 'gpt-4o',
    maxTokens = 320,
    leadIn = 'Where things sit',
    surface,
    log,
    check,
    fallbackOnLlmError = false,
  } = params;
  const llmFailed = (attempt: number, e: unknown) =>
    log?.error(`voice_llm_error ${JSON.stringify({ event: 'voice_llm_error', surface: surface ?? null, attempt, kind: llmErrorKind(e) })}`);
  const validate = (text: string): ValidationResult => {
    const v = validateVoice(text, drivers);
    const extra = check ? check(text) : [];
    return extra.length ? { ...v, ok: false, bannedHits: [...v.bannedHits, ...extra] } : v;
  };
  // Every catch across both drafts, for the hit-rate telemetry.
  const seen: string[] = [];
  let unbacked = 0;
  const done = (r: GenerateResult): GenerateResult => {
    // A model draft is only returned once it passed; the fallback is checked
    // here too, so a fail-through would show in the gate report.
    const finalOk = r.usedFallback ? validate(r.voice).ok : r.validation.ok;
    if (surface) trackVoice(log, { surface, attempts: r.attempts, fallback: r.usedFallback, bannedHits: seen, unbackedCount: unbacked, finalOk });
    return r;
  };
  const note = (v: ValidationResult) => { seen.push(...v.bannedHits); unbacked += v.unbackedNumbers.length; };

  // Attempt 1. A hard failure propagates unless the caller opted into the
  // fallback; then no retry, since a second call into an outage only adds
  // latency before the same fallback.
  let first: string;
  try {
    first = await callOpenAI(model, systemPrompt, userPrompt, maxTokens);
  } catch (e) {
    if (!fallbackOnLlmError) throw e;
    llmFailed(1, e);
    const voice = buildFallbackVoice(drivers, leadIn);
    return done({ voice, validation: validate(voice), usedFallback: true, attempts: 1, llmError: true });
  }
  let validation = validate(first);
  if (validation.ok) {
    return done({ voice: first, validation, usedFallback: false, attempts: 1, llmError: false });
  }
  note(validation);

  log?.warn(`voice validator caught draft 1: ${logNote(validation)}`);

  // Attempt 2 — feed the violations back. A hard failure here falls through to
  // the deterministic fallback rather than 500ing on an already-bad draft.
  let llmError = false;
  try {
    const retryUser = `${userPrompt}

Your previous draft was rejected for: ${violationNote(validation)}.
Rewrite it. Use ONLY the driver values above, reference no number that isn't a driver, no banned phrasing, no exclamation points, no emoji.`;
    const second = await callOpenAI(model, systemPrompt, retryUser, maxTokens);
    const secondValidation = validate(second);
    if (secondValidation.ok) {
      return done({ voice: second, validation: secondValidation, usedFallback: false, attempts: 2, llmError: false });
    }
    note(secondValidation);
    log?.warn(`voice validator caught draft 2: ${logNote(secondValidation)}`);
    validation = secondValidation;
  } catch (e) {
    llmError = true;
    llmFailed(2, e);
  }

  // Last resort: guaranteed-clean deterministic read.
  log?.warn('voice fell back to deterministic driver read');
  return done({
    voice: buildFallbackVoice(drivers, leadIn),
    validation,
    usedFallback: true,
    attempts: 2,
    llmError,
  });
}
