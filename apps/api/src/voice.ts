import { validateVoice, buildFallbackVoice, Driver, ValidationResult } from './validator';

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
  log?: { warn: (msg: string) => void; error: (msg: string) => void };
}

export interface GenerateResult {
  voice: string;
  validation: ValidationResult;
  usedFallback: boolean;
  attempts: number;
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
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }
  const json: any = await res.json();
  return (json.choices?.[0]?.message?.content || '').trim();
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
    log,
  } = params;

  // Attempt 1. A hard failure here propagates so the endpoint can 500 (matches
  // the prior inline behaviour).
  const first = await callOpenAI(model, systemPrompt, userPrompt, maxTokens);
  let validation = validateVoice(first, drivers);
  if (validation.ok) {
    return { voice: first, validation, usedFallback: false, attempts: 1 };
  }

  log?.warn(`voice validator caught draft 1: ${violationNote(validation)}`);

  // Attempt 2 — feed the violations back. A hard failure here falls through to
  // the deterministic fallback rather than 500ing on an already-bad draft.
  try {
    const retryUser = `${userPrompt}

Your previous draft was rejected for: ${violationNote(validation)}.
Rewrite it. Use ONLY the driver values above, reference no number that isn't a driver, no banned phrasing, no exclamation points, no emoji.`;
    const second = await callOpenAI(model, systemPrompt, retryUser, maxTokens);
    const secondValidation = validateVoice(second, drivers);
    if (secondValidation.ok) {
      return { voice: second, validation: secondValidation, usedFallback: false, attempts: 2 };
    }
    log?.warn(`voice validator caught draft 2: ${violationNote(secondValidation)}`);
    validation = secondValidation;
  } catch (e) {
    log?.error(`voice retry LLM call failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Last resort: guaranteed-clean deterministic read.
  log?.warn('voice fell back to deterministic driver read');
  return {
    voice: buildFallbackVoice(drivers, leadIn),
    validation,
    usedFallback: true,
    attempts: 2,
  };
}
