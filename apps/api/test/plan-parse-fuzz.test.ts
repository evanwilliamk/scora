// Seeded randomized tests for the plan-paste validator. Whatever JSON the model
// returns, validateParsedRows never throws and never keeps a number the
// session's own words do not write. The seed in a failure message is the
// iteration to replay. Test input, not training content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanParseError, parsePlanText, validateParsedRows, writtenDistances, writtenMinutes } from '../src/plan-parse';
import type { ParseResult } from '../src/plan-parse';
import { KM_PER_MI } from '../src/units';

const ITERATIONS = 4000;
const TODAY = '2026-10-22';

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

const LINES = [
  'Tue: 45 min tempo', 'Wed easy 8 km', 'Thu 3x8 min at threshold', 'Sat long run 18 km', 'Sun 6M easy', 'Mon rest',
  'Fri 1h30 ride', 'Swim 1:05:00', 'Run 1.5 h', '8x400m at 5k pace', '7:30 min/mi for 40 min', 'Z2 HR 50 min', '10 miles', '1,5 km shakeout',
];

// Values JSON can hold that plain coercion chokes on. Parsed, so "toString" and
// "__proto__" are real own properties, as they would be from the model.
const HOSTILE = [
  '{"toString":1}', '{"valueOf":1,"toString":1}', '{"toString":null,"valueOf":null}', '{"__proto__":{"x":1}}', '{"toJSON":1}',
  '{"length":3}', '[45]', '[[45]]', '[]', '{}', 'null', 'true', 'false', '0', '-1', '1e999', '1e308', '-0', '0.0001', '""', '" "',
  '"45"', '"45 min"', '"NaN"', '"Infinity"', '"0x2d"', '"1e1"', '"\\ud800"', '"\\u0000"', '"constructor"', '"__proto__"',
].map((s) => JSON.parse(s) as unknown);

function anyJson(r: R, depth = 0): unknown {
  const kind = r.int(depth > 3 ? 4 : 6);
  switch (kind) {
    case 0: return r.pick(HOSTILE);
    case 1: return r.next() < 0.5 ? r.int(2000) : r.next() * 1e6 - 5e5;
    case 2: return r.pick(LINES);
    case 3: return r.pick([null, true, false]);
    case 4: return Array.from({ length: r.int(4) }, () => anyJson(r, depth + 1));
    default: return Object.fromEntries(Array.from({ length: r.int(4) }, () => [r.pick(['date', 'type', 'workouts', 'x', 'toString', 'valueOf', 'description']), anyJson(r, depth + 1)]));
  }
}

const date = (offset: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);

function row(r: R, lines: string[]): unknown {
  const line = r.pick(lines);
  const fromLine = (read: (s: string) => number[]) => r.pick(read(line).concat(r.int(200)));
  const { km, mi } = writtenDistances(line);
  const unit = r.pick(['km', 'mi'] as const);
  const out: Record<string, unknown> = {
    date: r.next() < 0.9 ? date(r.int(190) - 2) : r.pick(['2026-02-30', 'tomorrow', '', '2026-1-1']),
    type: r.pick(['run', 'run', 'ride', 'swim', 'strength', 'brick', 'other']),
    intensity: r.pick(['easy', 'tempo', 'long', 'rest', null, null]),
    duration_min: r.next() < 0.7 ? fromLine(writtenMinutes) : null,
    distance: r.next() < 0.7 ? r.pick((unit === 'km' ? km : mi).concat(r.int(40))) : null,
    distance_unit: unit,
    // Word for word, reworded, or spanning the next session's words.
    description: r.next() < 0.7 ? line : r.next() < 0.5 ? `${line} plus ${r.int(90)} min` : lines.join(' '),
  };
  // Then break any field with any JSON value.
  for (let n = r.int(3); n > 0; n--) out[r.pick(Object.keys(out))] = anyJson(r);
  return out;
}

const digitsOf = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));

function check(out: ParseResult, source: string, seed: number) {
  const flat = source.toLowerCase().replace(/\s+/g, ' ');
  for (const k of out.rows) {
    const w = `seed ${seed}, row ${JSON.stringify(k)}`;
    assert.ok(['run', 'ride', 'swim', 'strength', 'brick', 'other'].includes(k.type), `unknown type: ${w}`);
    assert.ok(k.intensity === null || ['easy', 'moderate', 'hard', 'tempo', 'threshold', 'intervals', 'long', 'recovery', 'rest'].includes(k.intensity), `unknown intensity: ${w}`);
    assert.ok(typeof k.description === 'string', `description is not text: ${w}`);
    assert.doesNotMatch(k.description, /[\0\p{Cs}]/u, `description Postgres cannot hold: ${w}`);
    if (k.description) assert.ok(flat.includes(k.description.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '')), `description is not in the text: ${w}`);
    const n = digitsOf(k.description);
    if (k.duration_min !== null) {
      assert.ok(Number.isInteger(k.duration_min) && k.duration_min >= 1 && k.duration_min <= 1440, `duration fails the column check: ${w}`);
      const written = n.some((a, i) => Math.round(a) === k.duration_min || Math.round(a * 60) === k.duration_min
        || (i + 1 < n.length && a * 60 + n[i + 1] === k.duration_min)
        || (i + 2 < n.length && Math.round(a * 60 + n[i + 1] + n[i + 2] / 60) === k.duration_min));
      assert.ok(written, `invented duration: ${w}`);
    }
    if (k.distance_km !== null) {
      assert.ok(k.distance_km >= 0.01 && k.distance_km <= 9999.99, `distance fails the column check: ${w}`);
      assert.ok(n.some((a) => Math.abs(a - k.distance_km!) < 0.006 || Math.abs(a * KM_PER_MI - k.distance_km!) < 0.006), `invented distance: ${w}`);
    }
  }
}

test('any JSON from the model never throws and never keeps an invented number', () => {
  let kept = 0;
  let numbers = 0;
  for (let seed = 1; seed <= ITERATIONS; seed++) {
    const r = prng(seed);
    const lines = Array.from({ length: 1 + r.int(5) }, () => r.pick(LINES));
    const source = lines.join('\n');
    const rows = Array.from({ length: r.int(6) }, () => (r.next() < 0.85 ? row(r, lines) : anyJson(r)));
    const shape = r.int(5);
    const raw = shape === 0 ? anyJson(r) : shape === 1 ? rows : shape === 2 ? { workouts: anyJson(r) } : { workouts: rows };
    let out: ParseResult;
    try {
      out = validateParsedRows(raw, source, TODAY);
    } catch (e) {
      assert.fail(`seed ${seed}: threw ${e instanceof Error ? e.stack : String(e)}\ninput ${JSON.stringify(raw)}`);
    }
    check(out, source, seed);
    kept += out.rows.length;
    numbers += out.rows.filter((x) => x.duration_min !== null || x.distance_km !== null).length;
  }
  // The generator has to keep reaching the code under test, or this proves nothing.
  assert.ok(kept > ITERATIONS / 2, `only ${kept} rows kept`);
  assert.ok(numbers > ITERATIONS / 10, `only ${numbers} rows kept a number`);
});

test('a reworded session keeps its day and loses every number', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const r = prng(seed);
    const source = r.pick(LINES);
    const invented = 100 + r.int(800);
    const out = validateParsedRows({
      workouts: [{ date: date(1), type: 'run', intensity: null, duration_min: invented, distance: invented, distance_unit: 'km', description: `${invented} min and ${invented} km` }],
    }, source, TODAY);
    assert.deepEqual(out.rows.map((x) => [x.duration_min, x.distance_km, x.description]), [[null, null, '']], `seed ${seed}`);
  }
});

test('whatever text the model returns, parsePlanText fails only with PlanParseError', async () => {
  const CUTS = ['```json\n', '```', '{"workouts":', '[', ']', '}', 'not json', '\u0000', '{"toString":1}'];
  for (let seed = 1; seed <= 500; seed++) {
    const r = prng(seed);
    const good = JSON.stringify({ workouts: [row(r, LINES)] });
    const reply = r.next() < 0.5 ? good.slice(0, r.int(good.length)) : `${r.pick(CUTS)}${good}${r.pick(CUTS)}`;
    try {
      const out = await parsePlanText(LINES.join('\n'), TODAY, async () => reply);
      check(out, LINES.join('\n'), seed);
    } catch (e) {
      assert.ok(e instanceof PlanParseError, `seed ${seed}: threw ${String(e)}`);
    }
  }
});

test('objects with no usable conversion and very deep values are refused, not thrown', () => {
  let deep: unknown = 1;
  for (let i = 0; i < 200_000; i++) deep = [deep];
  const line = 'Tue: 45 min tempo';
  const base = { date: date(1), type: 'run', intensity: null, description: line };
  for (const bad of [JSON.parse('{"toString":1}'), JSON.parse('{"valueOf":1,"toString":1}'), deep]) {
    for (const row of [{ ...base, duration_min: bad }, { ...base, distance: bad, distance_unit: 'km' }, { ...base, description: bad }]) {
      const out = validateParsedRows([row], line, TODAY);
      assert.equal(out.rows.length, 1);
      assert.equal(out.rows[0].duration_min, null);
      assert.equal(out.rows[0].distance_km, null);
    }
    for (const row of [{ ...base, type: bad }, { ...base, intensity: bad }]) {
      const out = validateParsedRows([row], line, TODAY);
      assert.equal(out.rows.length, 0);
      assert.equal(out.rejected.length, 1);
    }
  }
});

test('a wrapped number is not a number', () => {
  const line = 'Tue: 45 min tempo';
  const out = validateParsedRows([{ date: date(1), type: 'run', intensity: null, duration_min: [45], description: line }], line, TODAY);
  assert.equal(out.rows[0].duration_min, null);
});

test('a description cut at the cap never turns a word into a unit', () => {
  const words = `${'a'.repeat(494)} 45 minutes`;
  const out = validateParsedRows([{ date: date(1), type: 'run', intensity: null, distance: 45, distance_unit: 'mi', description: words }], words, TODAY);
  assert.equal(out.rows[0].distance_km, null, out.rows[0].description.slice(-10));
});

test('bytes Postgres cannot hold are spaces, and cannot join two numbers', () => {
  const words = 'Run 4\u00005 km \ud800';
  const out = validateParsedRows([{ date: date(1), type: 'run', intensity: null, distance: 45, distance_unit: 'km', description: words }], words, TODAY);
  assert.equal(out.rows[0].distance_km, null);
  assert.doesNotMatch(out.rows[0].description, /[\0\p{Cs}]/u);
});

test('hours then a count of something else is not hours and minutes', () => {
  assert.ok(!writtenMinutes('Ride 2 hours 40 km').includes(160));
  assert.ok(!writtenMinutes('Run 1 hour 3 intervals').includes(63));
  assert.ok(!writtenMinutes('Bike 2.5 h 12 miles').includes(312));
  assert.ok(writtenMinutes('Ride 1h30 easy').includes(90));
  assert.ok(writtenMinutes('Ride 1 hr 15 min').includes(75));
});
