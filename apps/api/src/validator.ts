// Voice validators. CLAUDE.md is explicit that these run in app code, not the
// LLM (§8.5), before any voice is emitted (§3.2 HARD RULE, §4 post-render check).
// The gpt-4o prompt is the first line of defence; this is the guarantee.

export interface Driver {
  metric: string;
  value: string;
  trend?: string;
}

export interface ValidationResult {
  ok: boolean;
  bannedHits: string[]; // banned phrases found in the voice
  unbackedNumbers: string[]; // numbers in the voice with no matching driver
}

// §4.1 voice-level bans. Targeted so we don't false-positive on legitimate
// interpretation. "coach" is only flagged in self-referential forms (§4.2
// allows third-person "most coaches would…"), which shouldn't appear in a read.
const BANNED_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(your|an?)\s+ai\s+coach\b/i, label: 'ai coach' },
  { re: /\b(i'?m|as|i am)\s+your\s+coach\b/i, label: 'coach self-reference' },
  { re: /\bas an ai\b/i, label: 'as an ai' },
  { re: /\bi'?m just an ai\b/i, label: 'just an ai' },
  { re: /\byou should\b/i, label: 'you should' },
  { re: /\byou need to\b/i, label: 'you need to' },
  { re: /\byou must\b/i, label: 'you must' },
  { re: /\b(go for a|go do a?|run a|do an easy|do a hard)\b/i, label: 'workout imperative' },
  { re: /\btime to (run|go|get|train)\b/i, label: 'workout imperative' },
  { re: /\bdoes that sound right\b/i, label: 'authority surrender' },
  { re: /\b(let me know if that )?resonate/i, label: 'authority surrender' },
  { re: /\bgood catch\b/i, label: 'sycophantic flip' },
  { re: /\byou'?re right,? i\b/i, label: 'sycophantic flip' },
  { re: /\b(medical|diagnos|prescrib)/i, label: 'clinical claim' },
  { re: /\btake a rest day\b/i, label: 'rest-day imperative' },
  {
    re: /\b(crush it|smash|beast mode|let'?s go|keep it up|great job|amazing|you'?ve got this|nailed it|let'?s crush)\b/i,
    label: 'hype',
  },
];

const EXCLAMATION = /!/;
// Any pictographic emoji (§3.7 no emoji).
const EMOJI = /\p{Extended_Pictographic}/u;

// Pull number tokens out of text. Times like 15:09 and decimals like 24.9 are
// split the same way on both the driver side and the voice side, so formats
// line up (15:09 -> "15","09"; 24.9 -> "24.9").
function numberTokens(text: string): string[] {
  return (text.match(/\d+(?:\.\d+)?/g) || []).map((n) => String(parseFloat(n)));
}

// Check a generated voice string against the drivers it was allowed to cite.
export function validateVoice(voice: string, drivers: Driver[]): ValidationResult {
  const bannedHits: string[] = [];
  for (const { re, label } of BANNED_PATTERNS) {
    if (re.test(voice)) bannedHits.push(label);
  }
  if (EXCLAMATION.test(voice)) bannedHits.push('exclamation point');
  if (EMOJI.test(voice)) bannedHits.push('emoji');

  // Driver-existence: every number in the voice must appear in some driver.
  const allowed = new Set<string>();
  for (const d of drivers) {
    for (const tok of numberTokens(`${d.metric} ${d.value} ${d.trend ?? ''}`)) {
      allowed.add(tok);
    }
  }
  const unbackedNumbers = [...new Set(numberTokens(voice))].filter((n) => !allowed.has(n));

  return {
    ok: bannedHits.length === 0 && unbackedNumbers.length === 0,
    bannedHits,
    unbackedNumbers,
  };
}

// Deterministic, guaranteed-valid voice built only from driver values. Used as
// the last resort when the LLM can't produce a clean read. Numeric-first,
// non-prescriptive, no banned phrases by construction.
export function buildFallbackVoice(drivers: Driver[], leadIn = 'Where things sit'): string {
  if (drivers.length === 0) return `${leadIn}: not enough data to read yet.`;
  const parts = drivers.map(
    (d) => `${d.metric} ${d.value}${d.trend ? ` (${d.trend})` : ''}`
  );
  return `${leadIn}: ${parts.join('. ')}.`;
}
