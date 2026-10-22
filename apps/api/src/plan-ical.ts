// Calendar (iCal) import as a plan source (Q17 option B).
//
// Many plan apps publish the athlete's plan as a calendar feed. The app
// fetches the feed and sends its text here; the server never fetches a URL.
// Each VEVENT is one session. No LLM is involved: dates come from DTSTART,
// type and intensity from plain keywords, and a duration or distance is kept
// only when exactly one is written in the event's own text. The rows then go
// through the same validator as a pasted plan (plan-parse.ts), so every kept
// number is written next to its unit in that session's words.

import { writtenDistances, writtenMinutes, validateParsedRows } from './plan-parse';
import type { Intensity, ParseResult, WorkoutType } from './plan-parse';

export const MAX_ICS_CHARS = 1_000_000;
export const MAX_ICS_EVENTS = 1000;
const MAX_DESCRIPTION = 500;

export class IcalImportError extends Error {}

export interface IcsEvent {
  uid: string | null;
  summary: string;
  description: string;
  dtstart: string | null; // raw value, e.g. 20261027 or 20261027T060000Z
  dtstartParams: Record<string, string>;
  recurring: boolean;
  cancelled: boolean;
}

// RFC 5545 §3.3.11 TEXT unescaping.
const unescapeText = (v: string) =>
  v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

const LINE = /^([A-Za-z0-9-]+)((?:;[A-Za-z0-9-]+=(?:"[^"]*"|[^:;"]*)(?:,(?:"[^"]*"|[^:;",]*))*)*):(.*)$/;

// Every VEVENT in the text. Lines inside a nested component (a VALARM has its
// own DESCRIPTION) never leak into the event.
export function parseIcsEvents(text: string): IcsEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events: IcsEvent[] = [];
  let ev: IcsEvent | null = null;
  let nested = 0;
  for (const line of lines) {
    const m = LINE.exec(line);
    if (!m) continue;
    const name = m[1].toUpperCase();
    const value = m[3];
    if (name === 'BEGIN') {
      if (value.toUpperCase() === 'VEVENT' && !ev) {
        ev = { uid: null, summary: '', description: '', dtstart: null, dtstartParams: {}, recurring: false, cancelled: false };
      } else if (ev) {
        nested++;
      }
      continue;
    }
    if (name === 'END') {
      if (!ev) continue;
      if (nested > 0) { nested--; continue; }
      if (value.toUpperCase() === 'VEVENT') {
        events.push(ev);
        ev = null;
        if (events.length > MAX_ICS_EVENTS) throw new IcalImportError(`The calendar has more than ${MAX_ICS_EVENTS} events.`);
      }
      continue;
    }
    if (!ev || nested > 0) continue;
    switch (name) {
      case 'UID': ev.uid = value; break;
      case 'SUMMARY': ev.summary = unescapeText(value).trim(); break;
      case 'DESCRIPTION': ev.description = unescapeText(value).trim(); break;
      case 'DTSTART': {
        ev.dtstart = value.trim();
        const params: Record<string, string> = {};
        for (const p of m[2].split(';').filter(Boolean)) {
          const i = p.indexOf('=');
          params[p.slice(0, i).toUpperCase()] = p.slice(i + 1).replace(/^"|"$/g, '');
        }
        ev.dtstartParams = params;
        break;
      }
      case 'RRULE': case 'RDATE': ev.recurring = true; break;
      case 'STATUS': ev.cancelled = value.trim().toUpperCase() === 'CANCELLED'; break;
    }
  }
  return events;
}

const validZone = (tz: string | undefined): string => {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
};

// The calendar date of an event's start, in the athlete's zone. An all-day
// date, a floating time and a TZID time keep their written date; a UTC time
// ("Z") is converted to the athlete's zone first.
export function eventDate(e: Pick<IcsEvent, 'dtstart'>, timeZone?: string): string | null {
  const v = e.dtstart;
  if (!v) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}Z`);
    if (Number.isNaN(t)) return null;
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: validZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  }
  return `${y}-${mo}-${d}`;
}

const TYPE_WORDS: [WorkoutType, RegExp][] = [
  ['brick', /\bbrick\b/],
  ['swim', /\bswim/],
  ['ride', /\b(ride|bike|biking|cycling|cycle|zwift|trainer ride)\b/],
  ['strength', /\b(strength|gym|weights|lifting)\b/],
  ['run', /\b(run|runs|running|jog|tempo|fartlek|strides|track|parkrun|race)\b/],
];

const INTENSITY_WORDS: [Intensity, RegExp][] = [
  ['rest', /\b(rest|day off|off day)\b/],
  ['recovery', /\b(recovery|shakeout|shake-out)\b/],
  ['intervals', /\b(intervals?|repeats|vo2|fartlek)\b|\d+\s*[x×]\s*\d+/],
  ['threshold', /\b(threshold|lt|cruise)\b/],
  ['tempo', /\btempo\b/],
  ['long', /\blong\b/],
  ['easy', /\b(easy|aerobic|z2|zone 2)\b/],
  ['hard', /\bhard\b/],
  ['moderate', /\b(moderate|steady)\b/],
];

const first = <T>(table: [T, RegExp][], text: string): T | null => {
  const t = text.toLowerCase();
  for (const [k, re] of table) if (re.test(t)) return k;
  return null;
};

// Durations written in a text, one per mention: "1h30" is 90, not also 60.
function durations(text: string): number[] {
  const hm: number[] = [];
  const rest = text.replace(/(\d{1,2})\s*(?:h|hr|hrs|hours?)\s*(\d{1,2})(?:\s*(?:min|mins|minutes|m))?(?![a-z\d])/gi, (_m, h: string, mm: string) => {
    hm.push(Number(h) * 60 + Number(mm));
    return ' ';
  });
  return [...hm, ...writtenMinutes(rest)];
}

// One number when exactly one is written in the summary, else in the
// description; otherwise none. "45 min tempo, 3x8 min at threshold" and
// "10 min warm up ... 10 min cool down" hold more than one, so none is guessed.
function onlyOne(summary: string, description: string, pick: (s: string) => number[]): number | null {
  for (const part of [summary, description]) {
    const found = pick(part);
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
  }
  return null;
}

function onlyDistance(summary: string, description: string): { value: number; unit: 'km' | 'mi' } | null {
  for (const part of [summary, description]) {
    const { km, mi } = writtenDistances(part);
    if (km.length + mi.length === 1) return km.length ? { value: km[0], unit: 'km' } : { value: mi[0], unit: 'mi' };
    if (km.length + mi.length > 1) return null;
  }
  return null;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface IcalImportResult extends ParseResult {
  skipped_past: number;
}

// Calendar text -> validated plan rows. `today` is YYYY-MM-DD in the
// athlete's zone; `timeZone` is their IANA zone (UTC if missing or unknown).
export function importIcs(ics: string, today: string, timeZone?: string): IcalImportResult {
  if (typeof ics !== 'string' || !ics.trim()) throw new IcalImportError('The calendar is empty.');
  if (ics.length > MAX_ICS_CHARS) throw new IcalImportError('The calendar file is too large.');
  if (!/BEGIN:VCALENDAR/i.test(ics)) throw new IcalImportError('This does not look like a calendar (.ics) file.');

  const raw: unknown[] = [];
  const texts: string[] = [];
  const pre: { row: unknown; reason: string }[] = [];
  let skipped_past = 0;

  for (const e of parseIcsEvents(ics)) {
    const label = e.summary || e.uid || '(untitled event)';
    if (e.cancelled) { pre.push({ row: label, reason: 'cancelled event' }); continue; }
    if (e.recurring) { pre.push({ row: label, reason: 'repeating events are not imported' }); continue; }
    const date = eventDate(e, timeZone);
    if (!date) { pre.push({ row: label, reason: 'no readable start date' }); continue; }
    // Past sessions are history, not plan: leave them out quietly.
    if (date < today && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`) > 86400000) {
      skipped_past++;
      continue;
    }

    const summary = oneLine(e.summary);
    const details = oneLine(e.description);
    const text = (details ? `${summary} | ${details}` : summary).slice(0, MAX_DESCRIPTION).trim();
    if (!text) { pre.push({ row: label, reason: 'event has no title or notes' }); continue; }
    // Numbers are read from the same capped text the validator checks.
    const capSummary = text.slice(0, summary.length);
    const capDetails = details ? text.slice(summary.length + 3) : '';

    const intensity = first(INTENSITY_WORDS, summary) ?? first(INTENSITY_WORDS, details);
    const type: WorkoutType = intensity === 'rest' ? 'other' : first(TYPE_WORDS, summary) ?? first(TYPE_WORDS, details) ?? 'other';
    const duration = intensity === 'rest' ? null : onlyOne(capSummary, capDetails, durations);
    const distance = intensity === 'rest' ? null : onlyDistance(capSummary, capDetails);

    texts.push(text);
    raw.push({
      date,
      type,
      intensity,
      duration_min: duration,
      distance: distance?.value ?? null,
      distance_unit: distance?.unit ?? null,
      description: text,
    });
  }

  const checked = validateParsedRows(raw, texts.join('\n'), today);
  return { ...checked, rejected: [...pre, ...checked.rejected], skipped_past };
}
