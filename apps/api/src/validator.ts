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
  { re: /\b(go for an?|go do an?|do an easy|do a hard)\b/i, label: 'workout imperative' },
  // "Run a tempo today" is an order; "your last long run a week ago" is history.
  {
    re: /(?<!\b(?:long|easy|tempo|recovery|hard|last|first|next|the|your|this|that|one|steady|threshold|interval|group|morning|evening|trail|track|race|you|did|didn't)\s)\brun an?\b(?!\s+(?:week|day|month|year|while|few|couple|bit|lot)\b)/i,
    label: 'workout imperative',
  },
  { re: /\btime to (run|go|get|train)\b/i, label: 'workout imperative' },
  { re: /\bdoes that sound right\b/i, label: 'authority surrender' },
  { re: /\b(let me know if that )?resonate/i, label: 'authority surrender' },
  { re: /\bgood catch\b/i, label: 'sycophantic flip' },
  { re: /\byou'?re right,? i\b/i, label: 'sycophantic flip' },
  { re: /\b(medical|diagnos|prescrib)/i, label: 'clinical claim' },
  // "Most coaches would call this a rest day" (descriptive) stays allowed.
  // "Have a rest day" only as an order at the start of a clause; "you have a
  // rest day scheduled Sunday" describes the plan.
  {
    re: /\b(take|make (?:it|today|tomorrow|this)|treat (?:it|today|tomorrow|this) as) an? (?:\w+ )?rest day\b|(?:^|[.;:!?]\s+|,\s+|[—–]\s*)have an? (?:\w+ )?rest day\b/i,
    label: 'rest-day imperative',
  },
  // A clause that opens on a command verb: "Go easy today.", "Take the day
  // off.", "Run 30 easy minutes.", "— go easy today". Verbs that are also
  // nouns or idioms ("Keep in mind", "Hit rate", "Take last week") count only
  // with a workout object. A colon is not a clause start ("Plan today: run
  // tempo" describes the plan).
  {
    re: new RegExp(
      String.raw`(?:^|[.;!?]\s+|,\s+(?:so\s+|then\s+|and\s+)?|[—–]\s*|\s-\s+|\(\s*)(?:just\s+)?` +
      String.raw`(?:go (?:easy|hard|out|run|for|long|slow|do|ride|on)|take (?:it|the day|a|an|today|tomorrow)|keep (?:it|things|today|the pace|easy)|hit (?:the|your|it)|try (?:a|an|the|to|some|\d)|head (?:out|to)|jog|ease (?:into|up|off|back|in)|stay (?:easy|off|home|in|light|low|aerobic)|ride (?:easy|hard|today|tomorrow|an?|\d)|skip (?:the|it|today|tomorrow|your|this)|rest (?:today|tomorrow|up|now|this)|start (?:with|easy|slow)|do (?:an?|the|some|your)|run (?:an?|the|it|\d+|easy|tempo|hard|long|short|slow|fast|today|tomorrow))\b`,
      'i',
    ),
    label: 'workout imperative',
  },
  { re: /\b(smarter|better) than (?:your|a|any|the) (?:human )?coach(?:es)?\b/i, label: 'anti-coach' },
  { re: /\breplac(?:e|es|ed|ing) (?:your|a|the) coach\b/i, label: 'anti-coach' },
  {
    re: /\b(crush it|smash|beast mode|let'?s go|keep it up|great job|amazing|you'?ve got this|nailed it|let'?s crush)\b/i,
    label: 'hype',
  },
];

// Talking the athlete out of their plan (CLAUDE.md §1.3). Checked only when
// the read carries a 'Plan today' driver: the voice may name the session and
// the body's state, never change the session.
export const PLAN_DRIVER_METRIC = 'Plan today';
const PLAN_OVERRIDE = /\b(skip(s|ping|ped)?\b|swap(s|ping|ped)?\b|postpon(e|es|ing|ed)\b|push(es|ed|ing)? (it|the \w+|today'?s \w+) (back|to)\b|(move|moves|moving|moved|shift|shifting) (it|the \w+|today'?s \w+) to\b|(can|could|should) wait\b|hold(ing)? off\b|sav(e|ing) (it|the \w+) for\b|cut(ting)? (it|the \w+) short\b|shorten(s|ing|ed)?\b|instead\b|(a )?better day for\b|(an )?eas(y|ier) (day|session|run|effort) (would|fits|makes|might)\b|lighter (day|session|option)\b|take it easy\b|dial(ing|led)? (it|things|the \w+) back\b|scal(e|ing) (it|the \w+) back\b)/i;

// Words that only describe a change the plan engine already made: "the plan
// moved the tempo to Wednesday", "is now an endurance run instead".
const OBSERVED_CHANGE = /^(moved (it|the \w+|today'?s \w+) to|instead)$/i;
// Any sign the sentence argues or advises rather than observes. A clause that
// opens on "moved" or "instead" has no subject, so it reads as an instruction.
const ADVICE_CUE = /\b(you (could|should|might|can|may|need)|could|should|consider|try|maybe|perhaps|why not|better|would|let'?s|if you|yours)\b|^\s*(move|moved|instead|skip|swap|push|shift|save|cut|shorten|hold|take|keep|go|run|do|make|ease|rest)\b/i;
// An observation says the change happened: "is now", "was moved", "the plan".
const CHANGE_MARKER = /\b(is now|was|were|has been|moved|the plan|plan engine)\b/i;
// Days and sessions a sentence names. Each must come from one recorded change.
const CHANGE_WORDS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tempo|threshold|intervals?|long|hard|easy|recovery|endurance|steady|moderate|rest)\b/gi;

// True when every plan-override hit in the voice is a plain observation of a
// change the engine made (a 'Plan change' driver), CLAUDE.md §1.3: the clause
// says the change happened, gives no advice, and names only days and sessions
// that one recorded change names. Anything else is treated as an override.
function overrideIsObservation(voice: string, drivers: Driver[]): boolean {
  const changes = drivers.filter((d) => d.metric === 'Plan change').map((d) => d.value.toLowerCase());
  if (changes.length === 0) return false;
  const clauses = voice.split(/(?<=[.?:;])\s+/);
  for (const clause of clauses) {
    const hits = [...clause.matchAll(new RegExp(PLAN_OVERRIDE.source, 'gi'))].map((m) => m[0]);
    if (hits.length === 0) continue;
    if (!hits.every((h) => OBSERVED_CHANGE.test(h)) || ADVICE_CUE.test(clause) || !CHANGE_MARKER.test(clause)) return false;
    const words = [...new Set((clause.match(CHANGE_WORDS) ?? []).map((w) => w.toLowerCase().replace(/s$/, '')))];
    if (words.length === 0) return false;
    const named = (c: string) => words.every((w) => new RegExp(`\\b${w}s?\\b`).test(c));
    if (!changes.some(named)) return false;
  }
  return true;
}

const EXCLAMATION = /!/;
// Any pictographic emoji (§3.7 no emoji).
const EMOJI = /\p{Extended_Pictographic}/u;

// Pull number tokens out of text. Times like 15:09 and decimals like 24.9 are
// split the same way on both the driver side and the voice side, so formats
// line up (15:09 -> "15","09"; 24.9 -> "24.9").
function numberTokens(text: string): string[] {
  // "1,540" is one number, not 1 and 540.
  const joined = text.replace(/\b(\d{1,3})((?:,\d{3})+)\b/g, (_m, a: string, b: string) => a + b.replace(/,/g, ''));
  return (joined.match(/\d+(?:\.\d+)?/g) || []).map((n) => String(parseFloat(n)));
}

// Check a generated voice string against the drivers it was allowed to cite.
export function validateVoice(voice: string, drivers: Driver[]): ValidationResult {
  const bannedHits: string[] = [];
  for (const { re, label } of BANNED_PATTERNS) {
    if (re.test(voice)) bannedHits.push(label);
  }
  if (drivers.some((d) => d.metric === PLAN_DRIVER_METRIC) && PLAN_OVERRIDE.test(voice) && !overrideIsObservation(voice, drivers)) {
    bannedHits.push('plan override');
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
