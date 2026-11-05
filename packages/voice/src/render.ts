// Template slot filling (doc 06 §7 numeric-first convention).
//
// Patterns declare {{slot}} placeholders and a numeric_slots list of values
// that MUST appear in the rendered read. This fills the placeholders from a
// values map and reports any that couldn't be filled, so the caller can catch a
// numeric-first violation before the read goes out. It does NOT call the LLM —
// it produces the scaffold the LLM renders from, and the guarantee is still the
// driver-existence validator downstream (§3.2).

export interface FilledTemplate {
  text: string;
  missing: string[]; // placeholder keys with no value supplied
}

const SLOT = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

// Direction words a template may put next to a signed numeric slot, each with
// its opposite and the sign it implies ("HRV down {{hrv_pct_change}}%",
// "{{hrv_pct_change}}% below baseline"). The word is chosen from the value's
// sign and the number rendered unsigned, so the read never says "down -9%" or
// "down 4%" for a rise. Only the rendered text changes: the values map (and the
// driver record the validator checks) keeps the real signed value.
const DIRECTION: Record<string, { opposite: string; positive: boolean }> = {
  up: { opposite: 'down', positive: true },
  down: { opposite: 'up', positive: false },
  above: { opposite: 'below', positive: true },
  below: { opposite: 'above', positive: false },
  higher: { opposite: 'lower', positive: true },
  lower: { opposite: 'higher', positive: false },
};
const DIR_WORD = Object.keys(DIRECTION).join('|');
const SLOT_SRC = '\\{\\{\\s*([A-Za-z0-9_.]+)\\s*\\}\\}';
// Case-insensitive, so a sentence that opens on the word ("Down {{x}}%") is
// covered too; the replacement keeps the template's capitalization.
const WORD_BEFORE = new RegExp(`\\b(${DIR_WORD})(\\s+)${SLOT_SRC}`, 'gi');
const WORD_AFTER = new RegExp(`${SLOT_SRC}(%?\\s+)(${DIR_WORD})\\b`, 'gi');

function signedNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*[-+]?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

// Word that agrees with n's sign. Zero has no direction, so the template's
// word stands.
function agreeingWord(word: string, n: number): string {
  const d = DIRECTION[word.toLowerCase()];
  if (n === 0 || n > 0 === d.positive) return word;
  const o = d.opposite;
  if (word === word.toUpperCase()) return o.toUpperCase();
  if (word[0] === word[0].toUpperCase()) return o[0].toUpperCase() + o.slice(1);
  return o;
}

// The value without its sign. A string keeps its own digits ("-8.0" reads
// "8.0", not "8"), as the plain slot fill would print it.
function unsigned(v: string | number, n: number): string {
  if (typeof v === 'string') return v.trim().replace(/^[-+]/, '');
  return String(Math.abs(n));
}

// Count words a template may put after a slot, with an optional word between
// ("{{n}} hard days"). A value of 1 takes the singular.
const COUNT_AFTER = new RegExp(`${SLOT_SRC}(\\s+(?:[a-z]+\\s+)?)(days|nights|runs|rides|weeks|hours|minutes|sessions|workouts)\\b`, 'g');

// A value the slot can print. NaN, Infinity, a blank string and null never
// existed as data: treated like a missing slot, so they stay visible as a gap
// for the caller and never reach the text.
function printable(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  const s = String(v).trim();
  if (!s || /^[-+]?(?:NaN|Infinity|undefined|null)$/i.test(s)) return null;
  return /^-0(?:\.0+)?$/.test(s) ? s.slice(1) : s; // never "-0%"
}

export function fillTemplate(
  template: string,
  values: Record<string, string | number>
): FilledTemplate {
  const missing: string[] = [];
  const directed = template
    .replace(COUNT_AFTER, (whole, key: string, gap: string, noun: string) =>
      (signedNumber(values[key]) === 1 ? `{{${key}}}${gap}${noun.slice(0, -1)}` : whole))
    .replace(WORD_BEFORE, (whole, word: string, gap: string, key: string) => {
      const n = signedNumber(values[key]);
      return n === null ? whole : `${agreeingWord(word, n)}${gap}${unsigned(values[key], n)}`;
    })
    .replace(WORD_AFTER, (whole, key: string, gap: string, word: string) => {
      const n = signedNumber(values[key]);
      return n === null ? whole : `${unsigned(values[key], n)}${gap}${agreeingWord(word, n)}`;
    });
  const text = directed.replace(SLOT, (_, key: string) => {
    const v = printable(values[key]);
    if (v === null) {
      if (!missing.includes(key)) missing.push(key);
      return `{{${key}}}`; // leave intact so the gap is visible, never invent
    }
    // An intensity is stored as steady_state; the read says "steady state".
    return /intensity$/.test(key) ? v.replace(/_/g, ' ') : v;
  });
  return { text, missing };
}

// Names of the {{slots}} a template references, in order of first appearance.
export function templateSlots(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(SLOT)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
