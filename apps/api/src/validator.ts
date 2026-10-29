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
  { re: /\b(your|an?)\s+ai[\s-]+coach\b/i, label: 'ai coach' },
  { re: /\b(i'?m|as|i am)\s+your\s+(?:\w+\s+)?coach\b|\byour coach here\b|\bcoaching you\b/i, label: 'coach self-reference' },
  { re: /\bas an ai\b|\b(?:i'?m|i am) an ai\b/i, label: 'as an ai' },
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
  { re: /\bdoes that sound (?:right|fair|good|ok|okay)\b|\blet me know what you think\b|\b(?:you (?:may|might|could) be right|fair point|i could be wrong|i may be wrong|i might be wrong)\b/i, label: 'authority surrender' },
  { re: /\b(let me know if that )?resonate/i, label: 'authority surrender' },
  { re: /\bgood catch\b/i, label: 'sycophantic flip' },
  { re: /\byou'?re right,? i\b/i, label: 'sycophantic flip' },
  { re: /\b(medical|diagnos|prescri[bp])/i, label: 'clinical claim' },
  // Advice in other words (CLAUDE.md §1.1, §3.1): "Aim for 45 minutes",
  // "Consider a rest day", "It's a good day to run long", "Make sure to sleep".
  {
    re: /\b(?:aim for|make sure (?:to|you)|you'?ll want to|you (?:ought|have|might want|may want|would want) to|(?:it'?s |it is )?(?:best|wise|smart) to|(?:it'?s |it is )?a (?:good|great|fine|smart) (?:day|time|morning|week) to|(?<!\b(?:coaches|coach|most|many|some|people|runners) would )consider (?:an?|taking|skipping|moving|easing|keeping|resting|going|running|holding)|you (?:might|may|could) (?:go|run|ride|swim|try|take|keep|ease|skip|rest|back off|hold|stay|stick))/i,
    label: 'advice',
  },
  // Commands only at the start of a clause: "Keep the effort low." is an
  // order; "you were able to hold the pace" and "HR did stay in zone 2" are history.
  {
    re: /(?:^|[.;!?]\s+|,\s+(?:so\s+|then\s+|and\s+)?|\s(?:so|and|then)\s+|[—–]\s*)(?:just\s+)?(?:(?:keep|hold) (?:the|your) (?:effort|pace|intensity|heart rate|hr)\b|don'?t (?:push|go hard|run|race|overdo)|avoid (?:intensity|hard|speed|running|racing|pushing)|stay (?:in|under|below|within) (?:zone|z\s?\d|your))/i,
    label: 'advice',
  },
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
      String.raw`(?:go (?:easy|hard|out|run|for|long|slow|do|ride|on)|back off (?:today|tomorrow|now|a bit|this)|swim (?:easy|hard|long|today|tomorrow|an?|\d)|do intervals|move (?:it|the|today'?s|your|tomorrow'?s) \w+ to|take (?:it|the day|a|an|today|tomorrow)|keep (?:it|things|today|the pace|easy)|hit (?:the|your|it)|try (?:a|an|the|to|some|\d)|head (?:out|to)|jog|ease (?:into|up|off|back|in)|stay (?:easy|off|home|in|light|low|aerobic)|ride (?:easy|hard|today|tomorrow|an?|\d)|skip (?:the|it|today|tomorrow|your|this)|rest (?:up|now)|rest (?:today|tomorrow)(?!\s+(?:is|was|sits|stays|on|in|falls|comes)\b)|start (?:with|easy|slow)|do (?:an?|the|some|your)|run (?:an?|the|it|\d+|easy|tempo|hard|long|short|slow|fast|today|tomorrow))\b`,
      'i',
    ),
    label: 'workout imperative',
  },
  // Plan advice in disguise: telling the athlete to recover lost minutes or to
  // trim the plan (CLAUDE.md §1.3; the weekly review states adherence only).
  // Descriptive uses stay allowed: "easy runs make up the bulk", "volume cut
  // back 6%", "sleep fell behind", "next week you start the taper".
  {
    re: /\b(make up (?:for|those|lost|missed|it|(?:the|that|this) (?:lost|missed|missing|gap|difference|minutes|miles|run|tempo|session|workout|long run|\w+ run))|catch up on|catch up|you (?:could |should |might |can )?(?:cut|scale) back|you fell behind|fall behind|next week,? you (?:could|should|might|can|need|will want|'ll want|add|run|do|try|take|keep|go))\b|(?:^|[.;!?]\s+)(?:cut|scale) back\b/i,
    label: 'plan advice',
  },
  { re: /\b(smarter|better) than (?:your|a|any|the) (?:human )?coach(?:es)?\b/i, label: 'anti-coach' },
  { re: /\breplac(?:e|es|ed|ing) (?:your|a|the) coach\b/i, label: 'anti-coach' },
  {
    re: /\b(crush(?:ed|ing)? it|smash(?:ed|ing)?|beast[\s-]mode|let'?s go|keep it up|great job|amazing|you'?ve got this|nail(?:ed)? it|let'?s crush)\b/i,
    label: 'hype',
  },
];

// Talking the athlete out of their plan (CLAUDE.md §1.3). Checked only when
// the read carries a 'Plan today' driver: the voice may name the session and
// the body's state, never change the session.
export const PLAN_DRIVER_METRIC = 'Plan today';
const PLAN_OVERRIDE = /\b((?<!\b(?:was|were|been|got) )skip(s|ping|ped)?\b|swap(s|ping|ped)?\b|postpon(e|es|ing|ed)\b|push(es|ed|ing)? (it|the \w+|today'?s \w+) (back|to)\b|(move|moves|moving|moved|shift|shifting) (it|the \w+|today'?s \w+) to\b|(can|could|should) wait\b|hold(ing)? off\b|sav(e|ing) (it|the \w+) for\b|cut(ting)? (it|the \w+) short\b|shorten(s|ing|ed)?\b|instead\b|(a )?better day for\b|(an )?eas(y|ier) (day|session|run|effort) (would|fits|makes|might)\b|would be better (on|in|as|for)\b|(the )?better fit\b|keep(ing)? (it|the \w+) (short|under|below)\b|lighter (day|session|option)\b|take it easy\b|dial(ing|led)? (it|things|the \w+) back\b|scal(e|ing) (it|the \w+) back\b)/i;

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
    // Days and sessions the change itself names: each hit and the word after
    // it ("moved the tempo to Wednesday"), not context like "after a short
    // Monday night".
    const near = [...clause.matchAll(new RegExp(`(?:${PLAN_OVERRIDE.source})(?:\\s+\\S+)?`, 'gi'))].map((m) => m[0]).join(' ');
    // A hit that names nothing itself ("... an endurance run instead") is
    // judged by the whole clause.
    const named0 = near.match(CHANGE_WORDS) ?? clause.match(CHANGE_WORDS) ?? [];
    const words = [...new Set(named0.map((w) => w.toLowerCase().replace(/s$/, '')))];
    if (words.length === 0) return false;
    const named = (c: string) => words.every((w) => new RegExp(`\\b${w}s?\\b`).test(c));
    if (!changes.some(named)) return false;
  }
  return true;
}

const EXCLAMATION = /[!¡]/;
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

// What the checks read: the model's typography folded to plain text, so a
// curly apostrophe ("I’m your coach"), a doubled or non-breaking space
// ("you  should"), fullwidth or Arabic-Indic digits ("９９", "٩٩") and "½"
// match like their plain forms. The voice itself is never changed.
export function normalizeForCheck(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u2044/g, '/')
    .replace(/\s+/g, ' ');
}

// Numbers written as words are numbers too: "fifty-two", "seven hours".
// Counts like "two nights" or "the second run" stay allowed; a word number
// is checked when it is a compound of tens or carries a unit.
const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WORD_UNITS = String.raw`(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|ms|milliseconds?|bpm|beats|miles?|mi|km|kilomet(?:er|re)s?|percent|per cent|%)`;
function wordNumbers(text: string): { word: string; value: string }[] {
  const out: { word: string; value: string }[] = [];
  const tens = new RegExp(String.raw`\b(${Object.keys(TENS).join('|')})(?:[\s-](${Object.keys(ONES).slice(0, 9).join('|')}))?\b`, 'gi');
  for (const m of text.matchAll(tens)) out.push({ word: m[0], value: String(TENS[m[1].toLowerCase()] + (m[2] ? ONES[m[2].toLowerCase()] : 0)) });
  const withUnit = new RegExp(String.raw`\b(${Object.keys(ONES).filter((w) => w !== 'one').join('|')})\s+${WORD_UNITS}\b`, 'gi');
  for (const m of text.matchAll(withUnit)) out.push({ word: m[0], value: String(ONES[m[1].toLowerCase()]) });
  return out;
}

const UP = /\b(above|up|higher|over|rose|risen|climb(?:ed|ing|s)?|rising|more|gain(?:ed)?)\b/i;
const DOWN = /\b(below|(?<!\b(?:settl\w*|slow\w*|wind\w*|calm\w*) )down|under|lower|dropped|fell|fallen|falling|less|dip(?:ped)?|slipped)\b/i;

// Unit families as the voice and drivers write them.
const UNIT: [RegExp, string][] = [
  [/^(?:ms|milliseconds?)$/i, 'ms'], [/^bpm$/i, 'bpm'], [/^(?:min|mins|minutes?)$/i, 'min'],
  [/^(?:mi|miles?)$/i, 'mi'], [/^(?:km|kilomet(?:er|re)s?)$/i, 'km'], [/^(?:%|percent)$/i, '%'], [/^(?:h|hrs?|hours?)$/i, 'h'],
];
// [number, unit family or '', matched text] for each number in the text.
function unitPairs(text: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  // "7:12" is 7 h 12 min (or 7 min 12 s for a pace): both parts may be said with units.
  for (const m of text.matchAll(/(?<![\d:])(\d{1,2}):([0-5]\d)(?![\d:])/g)) {
    out.push([String(parseFloat(m[1])), 'h', m[0]], [String(parseFloat(m[1])), 'min', m[0]], [String(parseFloat(m[2])), 'min', m[0]], [String(parseFloat(m[2])), '', m[0]]);
  }
  for (const m of text.matchAll(/(?<![\d.:])(\d+(?:\.\d+)?)(?![\d:])\s?(%|[a-z]+)?/gi)) {
    const raw = m[2] ?? '';
    const unit = UNIT.find(([re]) => re.test(raw))?.[1] ?? '';
    out.push([String(parseFloat(m[1])), unit, m[0].trim()]);
  }
  return out;
}

// Check a generated voice string against the drivers it was allowed to cite.
export function validateVoice(rawVoice: string, drivers: Driver[]): ValidationResult {
  const voice = normalizeForCheck(rawVoice);
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
  for (const w of wordNumbers(voice)) if (!allowed.has(w.value)) unbackedNumbers.push(w.word);
  // A driver number cited with a unit must carry a unit the driver has:
  // "HRV 52 bpm" is not backed by "52ms". A number some driver states with no
  // unit (a score, a count) may take any.
  const driverUnits = new Map<string, Set<string>>();
  for (const d of drivers) {
    for (const [num, unit] of unitPairs(`${d.value} ${d.trend ?? ''}`)) {
      driverUnits.set(num, (driverUnits.get(num) ?? new Set()).add(unit));
    }
  }
  for (const [num, unit, text] of unitPairs(voice)) {
    const units = driverUnits.get(num);
    if (unit && units && !units.has(unit) && !units.has('')) unbackedNumbers.push(text);
  }
  // A signed driver cited by its number must move the way the voice says:
  // "HRV down 8%" is not backed by "+8% wk".
  const sentences = voice.split(/(?<=[.!?;])\s+/);
  for (const d of drivers) {
    const m = `${d.value} ${d.trend ?? ''}`.match(/([+-])\s?(\d+(?:\.\d+)?)\s?%/);
    if (!m) continue;
    // Two signed drivers of the same size: the number alone cannot say which.
    const same = drivers.filter((o) => new RegExp(String.raw`[+-]\s?${m[2].replace('.', '\\.')}\s?%`).test(`${o.value} ${o.trend ?? ''}`));
    if (same.length > 1) continue;
    const pct = new RegExp(String.raw`(?<![\d.])${m[2].replace('.', '\\.')}(?![\d])\s?%`);
    for (const sentence of sentences.filter((x) => pct.test(x))) {
      if (m[1] === '+' && DOWN.test(sentence) && !UP.test(sentence)) bannedHits.push(`wrong direction for ${d.metric}`);
      if (m[1] === '-' && UP.test(sentence) && !DOWN.test(sentence)) bannedHits.push(`wrong direction for ${d.metric}`);
    }
  }

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
