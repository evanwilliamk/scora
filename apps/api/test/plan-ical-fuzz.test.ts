// Seeded randomized tests for the calendar importer. The input is whatever a
// plan app or an attacker puts in a feed, so: mutated and malformed .ics text
// only ever fails with IcalImportError, finishes quickly, and every number
// kept can be traced to that session's own words. The seed in a failure message
// is the iteration to replay. Test input, not training content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importIcs, IcalImportError } from '../src/plan-ical';
import type { IcalImportResult } from '../src/plan-ical';
import { KM_PER_MI } from '../src/units';

const ITERATIONS = 2500;
const TODAY = '2026-10-22';
const SLOW_MS = 1000; // far above a normal import, far below a stalled event loop

// mulberry32: small, seeded, no dependency.
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];
  return { next, int, pick };
}
type R = ReturnType<typeof prng>;

const SESSION_WORDS = [
  'Easy run 40 min', 'Long run', '18 km at an easy\\, conversational effort', 'Tempo 45 min', '3x8 min at threshold',
  'Rest day', 'Group run 6:30', '1h30 ride', '1 hr 15 min', '6M easy', '8x400m', 'at 5k pace', '7:30 min/mi',
  'Z2 HR', '10k', '1,5 km', 'Bike 2.5 h', 'Swim 1:05:00', 'brick', 'recovery shakeout', "45' steady", 'off day', '0:00:20',
  '99999 km', '0 min', '1440 min', '1441 min', '٣ km', 'ｋｍ', 'Runna', '12 miles', '\\n', '\;',
];
const ZONES = ['Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati', 'UTC', 'Not/AZone', '', '__proto__', '"', 'America/Santiago'];
const ATHLETE_ZONES = [undefined, 'UTC', 'America/New_York', 'Pacific/Kiritimati', 'Not/AZone', '', '__proto__'];
const NOISE = [
  '\r\n', '\n', '\r', '\r\n ', '\r\n\t', ':', ';', '=', '"', '\\', ',', '\0', '\u2028', '\ud800', '\u00a0', 'x', '9',
  'BEGIN:VEVENT', 'END:VEVENT', 'BEGIN:VALARM', 'END:VALARM', 'BEGIN:VCALENDAR', 'END:VCALENDAR', 'BEGIN:', 'END:',
  'RRULE:FREQ=DAILY', 'STATUS:CANCELLED', 'DTSTART:', 'DTSTART;TZID=', 'SUMMARY:', 'DESCRIPTION:', 'UID:', 'constructor', '__proto__',
];

function dtstart(r: R): string {
  const offset = r.int(240) - 20;
  const d = new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  switch (r.int(8)) {
    case 0: return `DTSTART;VALUE=DATE:${d}`;
    case 1: return `DTSTART:${d}T060000Z`;
    case 2: return `DTSTART;TZID=${r.pick(ZONES)}:${d}T233000`;
    case 3: return `DTSTART:${d}T0600`;
    case 4: return `DTSTART:${r.pick(['20261301', '20260230T060000Z', '20261023T250000Z', '99991231T235959Z', '00000101T000000Z', 'tomorrow', ''])}`;
    case 5: return `DTSTART;TZID="${r.pick(ZONES)}";X=a;Y;=b:${d}T000000`;
    default: return `DTSTART;VALUE=DATE:${d}`;
  }
}

function event(r: R): string {
  const lines = ['BEGIN:VEVENT'];
  if (r.next() < 0.8) lines.push(`UID:${r.int(1e6)}`);
  if (r.next() < 0.95) lines.push(dtstart(r));
  if (r.next() < 0.9) lines.push(`SUMMARY:${r.pick(SESSION_WORDS)}${r.next() < 0.3 ? ` ${r.pick(SESSION_WORDS)}` : ''}`);
  if (r.next() < 0.5) lines.push(`DESCRIPTION:${r.pick(SESSION_WORDS)} ${r.pick(SESSION_WORDS)}`);
  if (r.next() < 0.05) lines.push('RRULE:FREQ=WEEKLY');
  if (r.next() < 0.05) lines.push('STATUS:CANCELLED');
  if (r.next() < 0.1) lines.push('BEGIN:VALARM', 'DESCRIPTION:50 km alarm', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

function mutate(r: R, text: string): string {
  const at = r.int(text.length + 1);
  switch (r.int(7)) {
    case 0: return text.slice(0, at) + text.slice(at + 1 + r.int(40)); // delete
    case 1: return text.slice(0, at) + r.pick(NOISE) + text.slice(at); // insert
    case 2: return text.slice(0, at); // truncate
    case 3: { // duplicate a chunk
      const chunk = text.slice(at, at + r.int(200));
      return text.slice(0, at) + chunk + chunk + text.slice(at);
    }
    case 4: { // shuffle two lines
      const lines = text.split('\r\n');
      const i = r.int(lines.length);
      const j = r.int(lines.length);
      [lines[i], lines[j]] = [lines[j], lines[i]];
      return lines.join('\r\n');
    }
    case 5: return text.slice(0, at) + String.fromCharCode(r.int(0x10000)) + text.slice(at + 1); // any code unit
    default: return text.replace(/\r\n/g, r.pick(['\n', '\r', '\r\n ', '\r\n'])); // line endings
  }
}

function feed(r: R): string {
  const events = Array.from({ length: r.int(8) }, () => event(r));
  let text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Plan//EN', ...events, 'END:VCALENDAR'].join('\r\n');
  for (let n = r.int(6); n > 0; n--) text = mutate(r, text);
  return text;
}

// A number the row keeps, recomputed from the digits of its own description
// and nothing from plan-parse.ts, so a wrong regex there cannot excuse itself.
const digitsOf = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));

function durationIsWritten(minutes: number, words: string): boolean {
  const n = digitsOf(words);
  return n.some((a, i) =>
    Math.round(a) === minutes || Math.round(a * 60) === minutes
    || (i + 1 < n.length && a * 60 + n[i + 1] === minutes)
    || (i + 2 < n.length && Math.round(a * 60 + n[i + 1] + n[i + 2] / 60) === minutes));
}

function distanceIsWritten(km: number, words: string): boolean {
  return digitsOf(words).some((a) => Math.abs(a - km) < 0.006 || Math.abs(a * KM_PER_MI - km) < 0.006);
}

function checkRows(out: IcalImportResult, seed: number) {
  const where = `seed ${seed}`;
  let last = '';
  for (const row of out.rows) {
    const w = `${where}, row ${JSON.stringify(row)}`;
    const real = new Date(`${row.date}T00:00:00Z`);
    assert.equal(real.toISOString().slice(0, 10), row.date, `not a calendar date: ${w}`);
    const days = (real.getTime() - Date.parse(`${TODAY}T00:00:00Z`)) / 86400000;
    assert.ok(days >= -1 && days <= 182, `date outside the window: ${w}`);
    assert.ok(row.date >= last, `rows out of order: ${w}`);
    last = row.date;
    assert.ok(row.description.length <= 500, `description over the cap: ${w}`);
    assert.doesNotMatch(row.description, /[\0\p{Cs}]/u, `description Postgres cannot hold: ${w}`);
    if (row.duration_min !== null) {
      assert.ok(Number.isInteger(row.duration_min) && row.duration_min >= 1 && row.duration_min <= 1440, `duration fails the column check: ${w}`);
      assert.ok(durationIsWritten(row.duration_min, row.description), `invented duration: ${w}`);
    }
    if (row.distance_km !== null) {
      assert.ok(row.distance_km >= 0.01 && row.distance_km <= 9999.99, `distance fails the column check: ${w}`);
      assert.ok(distanceIsWritten(row.distance_km, row.description), `invented distance: ${w}`);
    }
  }
}

function importChecked(text: string, seed: number, zone?: string): IcalImportResult | null {
  const started = performance.now();
  let out: IcalImportResult | null = null;
  try {
    out = importIcs(text, TODAY, zone);
  } catch (e) {
    assert.ok(e instanceof IcalImportError, `seed ${seed}: threw ${e instanceof Error ? e.stack : String(e)}`);
  }
  const ms = performance.now() - started;
  assert.ok(ms < SLOW_MS, `seed ${seed}: took ${Math.round(ms)} ms`);
  return out;
}

test('mutated calendars only ever fail with IcalImportError, and keep only written numbers', () => {
  let kept = 0;
  let numbers = 0;
  let refused = 0;
  for (let seed = 1; seed <= ITERATIONS; seed++) {
    const r = prng(seed);
    const out = importChecked(feed(r), seed, r.pick(ATHLETE_ZONES));
    if (!out) { refused++; continue; }
    checkRows(out, seed);
    kept += out.rows.length;
    numbers += out.rows.filter((x) => x.duration_min !== null || x.distance_km !== null).length;
  }
  // The generator has to keep reaching the code under test, or this proves nothing.
  assert.ok(kept > ITERATIONS / 2, `only ${kept} rows kept`);
  assert.ok(numbers > ITERATIONS / 10, `only ${numbers} rows kept a number`);
  assert.ok(refused > 0, 'no calendar was refused');
});

test('non-string and non-calendar input fails with IcalImportError', () => {
  for (const bad of [undefined, null, 5, {}, [], '', '   ', 'hello', 'BEGIN:VEVENT'] as unknown[]) {
    assert.throws(() => importIcs(bad as string, TODAY), IcalImportError, `input ${String(bad)}`);
  }
});

// Every way to stretch a 1 MB feed that this file knows about. Not random in
// shape, so the time limit is about the shape and not about the luck of a seed.
const cal = (body: string) => `BEGIN:VCALENDAR\r\n${body}\r\nEND:VCALENDAR`;
const pad = (line: string) => line.repeat(Math.floor(990_000 / line.length));
const hostile: Record<string, string> = {
  'digits in a title': cal(`BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261023\r\nSUMMARY:${'1'.repeat(990_000)}\r\nEND:VEVENT`),
  'digits in notes': cal(`BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261023\r\nDESCRIPTION:${'1 '.repeat(495_000)}\r\nEND:VEVENT`),
  'number and spaces in a title': cal(`BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261023\r\nSUMMARY:1${'\\n'.repeat(495_000)}x\r\nEND:VEVENT`),
  'one long parameter list': cal(`BEGIN:VEVENT\r\nDTSTART${';A="'.repeat(245_000)}:20261023\r\nEND:VEVENT`),
  'no line ends': cal('X'.repeat(990_000)),
  'only folds': cal('\r\n '.repeat(330_000)),
  'nested opens': cal(`BEGIN:VEVENT\r\n${'BEGIN:X\r\n'.repeat(110_000)}`),
  'past events in another zone': cal(pad('BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20200101T060000\r\nSUMMARY:x\r\nEND:VEVENT\r\n')),
  'past events in unknown zones': cal(Array.from({ length: 12_000 }, (_, i) => `BEGIN:VEVENT\r\nDTSTART;TZID=No/Zone${i}:20200101T060000Z\r\nEND:VEVENT`).join('\r\n')),
  'past events in one zone, spelled many ways': cal(Array.from({ length: 12_000 }, (_, i) =>
    `BEGIN:VEVENT\r\nDTSTART;TZID=${[...'america/new_york'].map((c, b) => (i >> b) & 1 ? c.toUpperCase() : c).join('')}:20200101T060000\r\nEND:VEVENT`).join('\r\n')),
  '1000 upcoming full-length sessions': cal(Array.from({ length: 1000 }, (_, i) =>
    `BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20261101T060000\r\nSUMMARY:${i} ${'a '.repeat(240)} 10 km\r\nEND:VEVENT`).join('\r\n')),
};

for (const [name, text] of Object.entries(hostile)) {
  test(`a 1 MB calendar stays quick: ${name}`, () => {
    const started = performance.now();
    try {
      importIcs(text, TODAY, 'America/New_York');
    } catch (e) {
      assert.ok(e instanceof IcalImportError, `threw ${String(e)}`);
    }
    const ms = performance.now() - started;
    // Generous for a busy machine. Before the fixes these took 16 s to many minutes.
    assert.ok(ms < 8000, `took ${Math.round(ms)} ms`);
  });
}

test('the 500 character cap never turns a word into a unit', () => {
  const event = (summary: string) => cal(`BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261023\r\nSUMMARY:${summary}\r\nEND:VEVENT`);
  for (const [words, unit] of [['45 minutes', 'mi'], ['45 Minutes', 'M'], ['30 hard', 'h'], ['8 kettlebell', 'k'], ['5 kilos', 'k']]) {
    const at = words.indexOf(unit, 1);
    const out = importIcs(event(`${'a'.repeat(499 - (at + unit.length))} ${words}`), TODAY);
    const row = out.rows[0];
    assert.equal(row.duration_min, null, `${words}: ${row.description.slice(-12)}`);
    assert.equal(row.distance_km, null, `${words}: ${row.description.slice(-12)}`);
  }
});

test('a date a calendar does not have is refused in every form', () => {
  const event = (start: string) => cal(`BEGIN:VEVENT\r\nDTSTART${start}\r\nSUMMARY:Easy run\r\nEND:VEVENT`);
  for (const start of [':20270230T060000Z', ':20270230T060000', ';VALUE=DATE:20270230', ';TZID=Asia/Tokyo:20270230T060000', ':20261231T240000Z']) {
    assert.deepEqual(importIcs(event(start), '2026-12-22', 'America/New_York').rows, [], start);
  }
});

test('hours then a count of something else is not hours and minutes', () => {
  const event = (summary: string) => cal(`BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261023\r\nSUMMARY:${summary}\r\nEND:VEVENT`);
  const read = (summary: string) => {
    const [row] = importIcs(event(summary), TODAY).rows;
    return [row.duration_min, row.distance_km === null ? null : Math.round(row.distance_km)];
  };
  assert.deepEqual(read('Ride 2 hours 40 km'), [120, 40]);
  assert.deepEqual(read('Bike 2.5 h 12 km'), [150, 12]);
  assert.deepEqual(read('Run 1 hour 3 intervals'), [null, null]);
  assert.deepEqual(read('Run 1h 30 easy'), [null, null]);
  assert.deepEqual(read('Ride 1h30 easy'), [90, null]);
  assert.deepEqual(read('Ride 1 hr 15 min'), [75, null]);
  assert.deepEqual(read('Ride 1 hr 15'), [75, null]);
});

test('text Postgres cannot hold never reaches a row', () => {
  const event = (summary: string) => cal(`BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261023\r\nSUMMARY:${summary}\r\nEND:VEVENT`);
  for (const summary of ['Easy\0 run 40 min', '\ud800Easy run', 'Easy run \udc00']) {
    const [row] = importIcs(event(summary), TODAY).rows;
    assert.doesNotMatch(row.description, /[\0\p{Cs}]/u, JSON.stringify(summary));
    assert.match(row.description, /Easy/);
  }
  const [split] = importIcs(event('Run 4\u00005 km'), TODAY).rows;
  assert.notEqual(split.distance_km, 45, 'a stripped byte joined two numbers');
});
