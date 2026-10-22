// Plain-English reason for a plan adaptation (CLAUDE.md §6.4: "Moved to
// Wednesday because you slept 5.5 hours last night."). The engine has already
// decided; gpt-4o-mini only words the decision, citing the drivers behind
// today's posture. Every sentence is checked in code, and anything that fails
// falls back to the fixed sentence from plan-adapt.ts. Off unless
// ADAPTATION_REASON_LLM=on (each adaptation is one small gpt-4o-mini call).

import type { AdaptationDecision } from '../../../packages/plan-engine/src/index';
import type { Driver } from './metrics';
import { validateVoice } from './validator';

export const reasonLlmEnabled = () => process.env.ADAPTATION_REASON_LLM === 'on';

export type ReasonLlm = (system: string, user: string) => Promise<string>;
type Decided = Exclude<AdaptationDecision, { type: 'none' }>;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (d: string) => WEEKDAYS[new Date(Date.parse(`${d}T00:00:00Z`)).getUTCDay()];

const SYSTEM = `You write one short line for an athlete's training plan explaining a change the plan already made.

RULES:
- State the change and the reason. The change is decided; never suggest, advise or ask.
- Name the day(s) exactly as given. Mention no other day.
- Cite only numbers from DRIVERS, written as they appear there. If a driver is not listed, do not mention it.
- At most two sentences, under 200 characters. Calm, plain English. No exclamation points, no emoji, no "you should", no "coach".

Example: "Tuesday's intervals moved to Thursday. Sleep was 5:40 last night and HRV is 12% under your week."`;

export function reasonPrompt(d: Decided, evidence: Driver[]): { system: string; user: string } {
  const change = d.type === 'moved'
    ? `MOVED: ${weekday(d.from)}'s ${d.facts.workout_intensity} session to ${weekday(d.to)}, unchanged.`
    : `DOWNGRADED: ${weekday(d.facts.workout_date)}'s ${d.from_intensity} session to ${d.to_intensity.replace('_', ' ')}`
      + (d.duration_min ? `, same ${d.duration_min} minutes.` : ', same duration.')
      + (d.reason_code === 'posture_rest_hard_no_window' ? ' No other day this week could take it.' : '');
  const drivers = evidence.map((e) => `- ${e.metric}: ${e.value}${e.trend ? ` (${e.trend})` : ''}`).join('\n');
  return {
    system: SYSTEM,
    user: `CHANGE: ${change}\nTODAY'S POSTURE: ${d.facts.posture}\nDRIVERS:\n${drivers || '- none'}`,
  };
}

// Workout words the line may use, by intensity. Any other workout word means
// the line describes a different session than the engine changed.
const INTENSITY_WORDS: Record<string, RegExp> = {
  intervals: /\bintervals?\b/i,
  tempo: /\btempo\b/i,
  threshold: /\bthreshold\b/i,
  long: /\blong (?:run|effort|session)\b/i,
  hard: /\bhard (?:session|day|workout)\b/i,
  easy: /\beasy (?:run|day|session)\b/i,
  recovery: /\brecovery (?:run|day|session)\b/i,
  endurance: /\bendurance\b/i,
  steady_state: /\bsteady(?:[- ]state)?\b/i,
  moderate: /\bmoderate (?:run|session)\b/i,
};
const POSTURES = ['primed', 'steady', 'moderate', 'back-off', 'rest', 'taper'];
const DAY_FORMS: Record<string, RegExp> = Object.fromEntries(WEEKDAYS.map((day) => [
  day,
  new RegExp(`\\b(?:${day}|${day.slice(0, 3)}${day === 'Tuesday' ? '|Tues' : day === 'Thursday' ? '|Thur|Thurs' : ''})\\.?(?:'s)?\\b`, 'i'),
]));
const ADVICE = /\b(skip|try|consider|make sure|remember to|feel free|listen to your body|keep (?:it|things)|ease|go easy|rest up|aim|take it|should|need to|be sure|focus on|prioriti[sz]e)\b/i;
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ninety|hundred|half|dozen)\b/i;
const UP = /\b(above|up|higher|over|rose|risen|climb(?:ed|ing)?|more)\b/i;
const DOWN = /\b(below|down|under|lower|dropped|fell|fallen|less)\b/i;

// Problems with a candidate line, empty when it may be stored.
export function reasonIssues(text: string, d: Decided, evidence: Driver[]): string[] {
  const issues: string[] = [];
  const t = text.trim();
  if (!t) return ['empty'];
  if (t.length > 220) issues.push('too long');
  if ((t.match(/[.?]\s/g) ?? []).length > 1) issues.push('more than two sentences');
  if (/\?/.test(t)) issues.push('asks a question');
  if (ADVICE.test(t)) issues.push('advice');
  if (/\bcoach/i.test(t)) issues.push('coach');
  if (NUMBER_WORDS.test(t)) issues.push('number in words');

  // Days: the right ones, in any case or short form, and no others.
  const allowedDays = new Set([weekday(d.facts.workout_date), ...(d.type === 'moved' ? [weekday(d.to)] : [])]);
  for (const day of WEEKDAYS) {
    const named = DAY_FORMS[day].test(t);
    if (allowedDays.has(day) && !named) issues.push(`missing ${day}`);
    if (!allowedDays.has(day) && named) issues.push(`names ${day}`);
  }

  // Session: only the changed workout's words (and, for a downgrade, the new one).
  const allowedTypes = new Set<string>([d.facts.workout_intensity, ...(d.type === 'downgraded' ? [d.to_intensity] : [])]);
  for (const [kind, re] of Object.entries(INTENSITY_WORDS)) {
    if (!allowedTypes.has(kind) && re.test(t)) issues.push(`names ${kind}`);
  }

  // Posture: if the line names one, it is today's.
  for (const p of POSTURES) {
    if (p !== d.facts.posture && p !== 'steady' && p !== 'moderate' && new RegExp(`\\bposture (?:reads |is )?${p}\\b`, 'i').test(t)) {
      issues.push(`wrong posture ${p}`);
    }
  }

  // Direction: a signed driver cited by its number must be described the way
  // it moved. "-12%" is never "above".
  const sentences = t.split(/(?<=[.!?])\s+/);
  for (const e of evidence) {
    const m = `${e.value} ${e.trend ?? ''}`.match(/([+-])\s?(\d+(?:\.\d+)?)%/);
    if (!m) continue;
    const num = new RegExp(`(?<![\\d.])${m[2]}(?![\\d])\\s?%`);
    for (const s of sentences.filter((x) => num.test(x))) {
      if (m[1] === '-' && UP.test(s) && !DOWN.test(s)) issues.push(`says up for ${e.metric}`);
      if (m[1] === '+' && DOWN.test(s) && !UP.test(s)) issues.push(`says down for ${e.metric}`);
    }
  }

  // Banned phrases and driver-existence: every number must come from the
  // posture drivers or the change itself (same validator as the voice).
  const mins = d.facts.workout_duration_min;
  const facts: Driver[] = mins ? [{ metric: 'Duration', value: `${mins} min` }] : [];
  const v = validateVoice(t, [...evidence, ...facts]);
  issues.push(...v.bannedHits.map((h) => `banned: ${h}`), ...v.unbackedNumbers.map((n) => `unbacked number ${n}`));
  return issues;
}

export interface WrittenReason {
  text: string;
  source: 'llm' | 'fallback';
  issues: string[];
}

// One attempt, then the fixed sentence. The adaptation is never held up by
// the wording.
export async function writeReason(d: Decided, evidence: Driver[], llm: ReasonLlm, fallback: string): Promise<WrittenReason> {
  const { system, user } = reasonPrompt(d, evidence);
  let text = '';
  try {
    text = (await llm(system, user)).trim().replace(/^"(.*)"$/s, '$1');
  } catch (e) {
    return { text: fallback, source: 'fallback', issues: [`llm failed: ${e instanceof Error ? e.message : e}`] };
  }
  const issues = reasonIssues(text, d, evidence);
  return issues.length === 0 ? { text, source: 'llm', issues } : { text: fallback, source: 'fallback', issues };
}

export function openAiReasonLlm(apiKey: string, fetchImpl: typeof fetch = fetch): ReasonLlm {
  return async (system, user) => {
    const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 120,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    return json.choices?.[0]?.message?.content ?? '';
  };
}
