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

export function fillTemplate(
  template: string,
  values: Record<string, string | number>
): FilledTemplate {
  const missing: string[] = [];
  const text = template.replace(SLOT, (_, key: string) => {
    const v = values[key];
    if (v === undefined || v === null) {
      if (!missing.includes(key)) missing.push(key);
      return `{{${key}}}`; // leave intact so the gap is visible, never invent
    }
    return String(v);
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
