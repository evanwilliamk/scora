import { validateVoice, buildFallbackVoice, promptEchoHits, Driver, ValidationResult } from './validator';
import { catchLabel, trackVoice, type VoiceSurface } from './telemetry';
import { vendorErrorKind, vendorHttpError } from './vendor-error';
import { meteredFetch } from './llm-meter';

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
  temperature?: number; // doc 08 §12.2, by surface
  leadIn?: string; // prefix for the deterministic fallback
  surface?: VoiceSurface; // for the telemetry line
  athleteId?: unknown; // whose use this is (the llm_call line)
  // Surface-specific checks (the daily read's posture). Each hit is treated
  // like a banned phrase: fed back for the retry, then the fallback.
  check?: (voice: string) => string[];
  log?: { warn: (msg: string) => void; error: (msg: string) => void; info?: (msg: string) => void };
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
// upstream costs the route at most twice this before the fallback. Chat
// (index.ts) uses the same cap.
export const OPENAI_TIMEOUT_MS = 20_000;

async function callOpenAI(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
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
      temperature,
    }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });
  if (!res.ok) {
    // The body can echo the prompt (athlete values); it stays out of the error.
    throw await vendorHttpError(res, 'OpenAI');
  }
  const json: any = await res.json();
  const text = (json.choices?.[0]?.message?.content || '').trim();
  // No text is no answer, as in chat. Empty passes every validator (nothing to
  // catch), so it would go out as a blank read, and the scheduler would then
  // spend another call on it every 15 minutes.
  if (!text) throw new Error('OpenAI reply had no text');
  return text;
}

// For logs: labels and a count only. The unbacked numbers themselves can be
// health values the model invented or misquoted (doc 10 §6.5, no PHI in logs).
function logNote(v: ValidationResult): string {
  return `banned: ${[...new Set(v.bannedHits.map(catchLabel))].join(', ') || 'none'}; unbacked numbers: ${v.unbackedNumbers.length + v.unbackedClaims.length}`;
}

function violationNote(v: ValidationResult): string {
  const bits: string[] = [];
  if (v.bannedHits.length) bits.push(`banned phrasing (${v.bannedHits.join(', ')})`);
  if (v.unbackedNumbers.length)
    bits.push(`numbers not in the drivers (${v.unbackedNumbers.join(', ')})`);
  if (v.unbackedClaims.length)
    bits.push(`claims no driver backs (${v.unbackedClaims.join(', ')})`);
  return bits.join('; ');
}

export async function generateValidatedVoice(params: GenerateParams): Promise<GenerateResult> {
  const {
    systemPrompt,
    userPrompt,
    drivers,
    model = 'gpt-4o',
    maxTokens = 320,
    temperature = 0.5,
    leadIn = 'Where things sit',
    surface,
    athleteId,
    log,
    check,
  } = params;
  const metered = meteredFetch(surface ?? 'voice', athleteId, log);
  const llmFailed = (attempt: number, e: unknown) =>
    log?.error(`voice_llm_error ${JSON.stringify({ event: 'voice_llm_error', surface: surface ?? null, attempt, kind: vendorErrorKind(e) })}`);
  const validate = (text: string): ValidationResult => {
    const v = validateVoice(text, drivers);
    const extra = [...promptEchoHits(text, systemPrompt), ...(check ? check(text) : [])];
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
  const note = (v: ValidationResult) => { seen.push(...v.bannedHits); unbacked += v.unbackedNumbers.length + v.unbackedClaims.length; };

  // Attempt 1. A hard failure (network, timeout, 429, 5xx) on any surface
  // ends in the deterministic fallback with its telemetry line, so an outage
  // still sends validated text and still counts in gates 1.1.4 and 2.1.5. No
  // retry: a second call into an outage only adds latency before the same
  // fallback. Callers never log the emission themselves.
  let first: string;
  try {
    first = await callOpenAI(model, systemPrompt, userPrompt, maxTokens, temperature, metered);
  } catch (e) {
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
    const second = await callOpenAI(model, systemPrompt, retryUser, maxTokens, temperature, metered);
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
