// WhatsApp doorbell core (Plan tier, PRD §5.B.2, CLAUDE.md §3.3, §7).
//
// Pure pieces only: the morning message, the bounded reply commands, and
// Twilio's webhook signature check. Nothing here sends a message, stores a
// phone number or reads the database; the route, opt-in and Twilio account
// wait on Evan (money, privacy text).

import crypto from 'node:crypto';

// The morning message, numbers first (CLAUDE.md §3.3):
//   Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412
//
//   <the read>
//
//   Today: 45 min tempo · 3 × 8 min at threshold   (Plan and Coach tiers)
//
//   Full read: <link>
export function composeDoorbell(p: { numbers: string; voice: string; today?: string | null; link: string }): string {
  const parts = [p.numbers.trim(), p.voice.replace(/\s+/g, ' ').trim()];
  if (p.today && p.today.trim()) parts.push(`Today: ${p.today.trim()}`);
  parts.push(`Full read: ${p.link}`);
  return parts.filter(Boolean).join('\n\n');
}

export type ReplyCommand =
  | { cmd: 'why' }
  | { cmd: 'more' }
  | { cmd: 'pause'; days: number }
  | { cmd: 'resume' }
  | { cmd: 'stop' }
  | { cmd: 'help' }
  | { cmd: 'unknown' };

export const PAUSE_DEFAULT_DAYS = 3;
export const PAUSE_MAX_DAYS = 30;

// Opt-out words carriers and WhatsApp users expect to work, beyond "stop".
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke']);

// The reply set is bounded (PRD §5.B.2): anything else is 'unknown' and gets
// the help text. Matching folds width and case, drops emoji, zero-width and
// punctuation characters. Opting out must never fail: a message that starts
// with a stop word ("STOP please", "stop sending at 6", "opt-out") stops.
export function parseReply(text: string): ReplyCommand {
  const t = text.normalize('NFKC').toLowerCase()
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  const first = t.split(' ')[0] ?? '';
  // "cancel", "end" and "quit" stop only on their own ("end of week was good"
  // is not an opt-out); the unambiguous words stop wherever a message starts.
  const leading = ['stop', 'stopall', 'unsubscribe', 'optout', 'revoke'];
  if (STOP_WORDS.has(t.replace(/ /g, '')) || leading.includes(first) || /^opt out\b/.test(t) || /^please (stop|unsubscribe)\b/.test(t)) {
    return { cmd: 'stop' };
  }
  if (t === 'why') return { cmd: 'why' };
  if (t === 'more') return { cmd: 'more' };
  if (t === 'resume' || t === 'start' || t === 'unpause') return { cmd: 'resume' };
  if (t === 'help' || t === 'info') return { cmd: 'help' };
  const pause = /^pause(?: (\d{1,3}))?(?: days?)?$/.exec(t);
  if (pause) {
    const n = pause[1] ? Number(pause[1]) : PAUSE_DEFAULT_DAYS;
    return { cmd: 'pause', days: Math.min(Math.max(n, 1), PAUSE_MAX_DAYS) };
  }
  return { cmd: 'unknown' };
}

// Fixed replies for the commands that need no data. 'why' and 'more' come
// from the read (why: an LLM expansion through the validators; more: the
// full voice), so they are not here. Plain text, no emoji (CLAUDE.md §3.7).
export function fixedReply(c: ReplyCommand): string | null {
  switch (c.cmd) {
    case 'pause':
      return `Paused for ${c.days} day${c.days === 1 ? '' : 's'}. Reply resume to start again sooner.`;
    case 'resume':
      return 'Resumed. Your read arrives tomorrow morning.';
    case 'stop':
      return 'Stopped. You will get no more WhatsApp messages from SCORA. Your read stays in the app.';
    case 'help':
    case 'unknown':
      return 'Reply why for the reasoning behind today\'s read, more for the full read, pause 3 to pause for 3 days, resume, or stop.';
    default:
      return null;
  }
}

// Twilio webhook signature (X-Twilio-Signature): base64 HMAC-SHA1 of the full
// URL followed by each POST parameter's name and value, sorted by name, keyed
// with the account auth token. Compared in constant time.
// `url` must be the exact public URL Twilio called (scheme, host, path, query),
// taken from config, not rebuilt from the request behind Railway's proxy. A
// repeated parameter contributes each of its values, sorted.
export function twilioSignature(authToken: string, url: string, params: Record<string, string | string[]>): string {
  const data = Object.keys(params).sort().reduce((s, k) => {
    const v = params[k];
    return s + (Array.isArray(v) ? [...v].sort().map((x) => k + x).join('') : k + v);
  }, url);
  return crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string | string[]>, signature: string | undefined): boolean {
  if (!authToken || !signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// 'why' and 'more' replies (doc 08 §5 and §6): LLM expansions of the morning
// read, sent through generateValidatedVoice with the read's own drivers, so
// they pass the same driver-existence and banned-phrase checks (or fall back).
// Callers must pass the read's full driver list, including 'Plan today' when
// there is one, so the plan-override check runs too.
export interface ExpansionPrompt {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

const EXPANSION_RULES = `RULES:
- Every number must be one of the DRIVERS, written as it appears there. Never invent data.
- Numeric-first: the value, then what it means.
- You read and name what is happening. Never tell the athlete what to do, never suggest a workout, never change or question their plan. No "you should", "you need to", "go", "try", "take".
- If the athlete disagrees, the read stands; do not apologize or change it.
- Calm, plain English. No exclamation points, no emoji, no hype. Never call yourself a coach.
- Plain text only, for a WhatsApp message.`;

// The posture in words, so the model reads a state, not a label it might
// echo as an order ("rest" becoming "rest today").
const POSTURE_WORDS: Record<string, string> = {
  primed: 'primed: the body reads ready', steady: 'steady: nothing pulling either way',
  moderate: 'moderate: some load showing', 'back-off': 'back-off: signs of strain',
  rest: 'rest posture: the body reads depleted', taper: 'taper: load coming down before a race',
};
const postureLine = (p: string) => POSTURE_WORDS[p] ?? p;

const driverBlock = (drivers: { metric: string; value: string; trend?: string }[]) =>
  drivers.map((d) => `- ${d.metric}: ${d.value}${d.trend ? ` (${d.trend})` : ''}`).join('\n') || '- none';

export function whyPrompt(read: string, posture: string, drivers: { metric: string; value: string; trend?: string }[]): ExpansionPrompt {
  return {
    systemPrompt: `You are SCORA, an interpretation layer for endurance athletes. The athlete replied "why" to this morning's read. Answer in 1 or 2 sentences: lead with the driver value that most shaped today's read and say why it matters.\n\n${EXPANSION_RULES}`,
    userPrompt: `THIS MORNING'S READ:\n${read}\n\nTODAY'S POSTURE: ${postureLine(posture)}\n\nDRIVERS (the only values you may cite):\n${driverBlock(drivers)}`,
    maxTokens: 100,
  };
}

export function morePrompt(read: string, posture: string, drivers: { metric: string; value: string; trend?: string }[]): ExpansionPrompt {
  return {
    systemPrompt: `You are SCORA, an interpretation layer for endurance athletes. The athlete replied "more" to this morning's read. Write 3 or 4 sentences that connect today's posture to what the week so far shows, using the drivers. Describe what has happened; say nothing about what comes next.\n\n${EXPANSION_RULES}`,
    userPrompt: `THIS MORNING'S READ:\n${read}\n\nTODAY'S POSTURE: ${postureLine(posture)}\n\nDRIVERS (the only values you may cite):\n${driverBlock(drivers)}`,
    maxTokens: 200,
  };
}
