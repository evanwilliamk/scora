// Manual plan paste -> scheduled workouts (doc 09 §1.4, PRD 5.A.6).
//
// gpt-4o-mini turns free text ("Tue: 45 min tempo, 3x8 at threshold") into
// rows. The LLM only transcribes; this module decides what is kept. Like the
// voice's driver-existence rule, every number in a kept row must appear in the
// athlete's own text, dates must resolve inside a sane window, and enums are
// closed. Anything else is rejected with a reason the app can show.

export const INTENSITIES = ['easy', 'moderate', 'hard', 'tempo', 'threshold', 'intervals', 'long', 'recovery', 'rest'] as const;
export const TYPES = ['run', 'ride', 'swim', 'strength', 'brick', 'other'] as const;
export type Intensity = (typeof INTENSITIES)[number];
export type WorkoutType = (typeof TYPES)[number];

export const MAX_PLAN_CHARS = 8000;
export const MAX_PLAN_DAYS = 182; // about 26 weeks ahead
const KM_PER_MI = 1.609344;

export interface ParsedRow {
  date: string; // YYYY-MM-DD
  type: WorkoutType;
  intensity: Intensity | null;
  duration_min: number | null;
  distance_km: number | null;
  description: string;
}

export interface Rejected {
  row: unknown;
  reason: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  rejected: Rejected[];
}

export function buildPlanParsePrompt(text: string, today: string): { system: string; user: string } {
  const system = `You transcribe an athlete's pasted training plan into JSON. You do not plan, suggest, or fill gaps.

Return {"workouts": [...]} where each item is:
{"date": "YYYY-MM-DD", "type": one of ${TYPES.join('|')}, "intensity": one of ${INTENSITIES.join('|')} or null,
 "duration_min": number or null, "distance": number or null, "distance_unit": "km" | "mi" | null,
 "description": the athlete's own words for that day, trimmed}

Rules:
- One item per planned session. Rest days: type "other", intensity "rest".
- Resolve weekday names and relative dates against TODAY. Use the next occurrence on or after TODAY unless the text gives a date.
- Copy numbers exactly as written. Never compute, convert, or estimate a duration or distance that is not written.
- "description" must be copied from that session's own text, word for word.
- If a field is not in the text, use null.
- Output JSON only.`;
  const user = `TODAY: ${today}\n\nPLAN TEXT:\n${text}`;
  return { system, user };
}

// Every number that appears in the athlete's text, as written (3x8 -> 3, 8).
export function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const num = (s: string) => Number(s.replace(',', '.'));
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;

// Numbers written with a given unit right after them ("45 min", "1.5 h").
function withUnit(text: string, units: string): number[] {
  const re = new RegExp(`${NUM}\\s*(?:${units})(?![a-z])`, 'gi');
  return [...text.matchAll(re)].map((m) => num(m[1]));
}
const MINUTES = "min|mins|minute|minutes|'";
const HOURS = 'h|hr|hrs|hour|hours';
const KM = 'km|k|kms|kilometers?|kilometres?';
const MI = 'mi|mile|miles';

const isoDate = (s: unknown): string | null => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// Checks the LLM's rows against the source text. `today` is YYYY-MM-DD in the
// athlete's zone. Each row is checked against its own words: the description
// must appear in the paste, and every duration and distance must be written in
// that description with its unit next to it.
export function validateParsedRows(raw: unknown, sourceText: string, today: string): ParseResult {
  const items: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.workouts) ? (raw as any).workouts : [];
  const source = norm(sourceText);
  const rows: ParsedRow[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const r = item as any;
    const reject = (reason: string) => rejected.push({ row: item, reason });
    if (!r || typeof r !== 'object') { reject('not an object'); continue; }

    const date = isoDate(r.date);
    if (!date) { reject('no valid date'); continue; }
    const offset = daysBetween(today, date);
    if (offset < -1) { reject('date is in the past'); continue; }
    if (offset > MAX_PLAN_DAYS) { reject(`date is more than ${MAX_PLAN_DAYS} days out`); continue; }

    const type = (TYPES as readonly string[]).includes(r.type) ? (r.type as WorkoutType) : null;
    if (!type) { reject(`unknown type ${JSON.stringify(r.type)}`); continue; }
    const intensity = r.intensity == null ? null
      : (INTENSITIES as readonly string[]).includes(r.intensity) ? (r.intensity as Intensity) : undefined;
    if (intensity === undefined) { reject(`unknown intensity ${JSON.stringify(r.intensity)}`); continue; }

    const description = typeof r.description === 'string' ? r.description.trim().slice(0, 500) : '';
    if (!description || !source.includes(norm(description).replace(/[.,;:]+$/, ''))) {
      reject('description is not in the text');
      continue;
    }

    let duration: number | null = null;
    if (r.duration_min != null) {
      const d = Number(r.duration_min);
      if (!Number.isFinite(d) || d <= 0 || d > 1440) { reject('duration out of range'); continue; }
      const asMinutes = withUnit(description, MINUTES).some((w) => near(w, d));
      const asHours = withUnit(description, HOURS).some((w) => near(w * 60, d));
      if (!asMinutes && !asHours) { reject(`duration ${d} min is not written for this session`); continue; }
      duration = Math.round(d);
    }

    let distanceKm: number | null = null;
    if (r.distance != null) {
      const v = Number(r.distance);
      const unit = r.distance_unit === 'mi' ? 'mi' : r.distance_unit === 'km' ? 'km' : null;
      if (!Number.isFinite(v) || v <= 0 || !unit) { reject('distance without a valid unit'); continue; }
      if (!withUnit(description, unit === 'mi' ? MI : KM).some((w) => near(w, v))) {
        reject(`distance ${v} ${unit} is not written for this session`);
        continue;
      }
      distanceKm = Math.round((unit === 'mi' ? v * KM_PER_MI : v) * 100) / 100;
    }

    const key = `${date}|${type}|${description.toLowerCase()}`;
    if (seen.has(key)) { reject('duplicate session'); continue; }
    seen.add(key);

    rows.push({ date, type, intensity, duration_min: duration, distance_km: distanceKm, description });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, rejected };
}

export type PlanLlm = (system: string, user: string) => Promise<string>;

export class PlanParseError extends Error {}

export async function parsePlanText(text: string, today: string, llm: PlanLlm): Promise<ParseResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new PlanParseError('The plan is empty.');
  if (trimmed.length > MAX_PLAN_CHARS) throw new PlanParseError(`The plan is longer than ${MAX_PLAN_CHARS} characters.`);
  const { system, user } = buildPlanParsePrompt(trimmed, today);
  const out = await llm(system, user);
  let json: unknown;
  try {
    json = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new PlanParseError('Could not read the plan. Try one session per line with a day or date.');
  }
  return validateParsedRows(json, trimmed, today);
}

// gpt-4o-mini in JSON mode over fetch, like the rest of the API.
export function openAiPlanLlm(apiKey: string, fetchImpl: typeof fetch = fetch): PlanLlm {
  return async (system, user) => {
    const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    return json.choices?.[0]?.message?.content ?? '';
  };
}

// For the read: what today's scheduled workout looks like to the voice matcher.
export function toScheduledWorkout(row: { planned_intensity: string | null; planned_description: string | null; planned_distance_km: number | string | null }) {
  return {
    planned_intensity: row.planned_intensity ?? undefined,
    planned_description: row.planned_description ?? undefined,
    planned_distance_km: row.planned_distance_km == null ? undefined : Number(row.planned_distance_km),
  };
}
