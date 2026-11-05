// Every voice path, rendered with awkward but legal driver values (nulls, zero,
// negative trends, very large values, one day of data, a first-week athlete,
// sleep without HRV, a plan with no session today). Nothing here calls a vendor.
// To add a case: add a scenario or a plan below; every check runs on it.
// docs/voice-spec-audit.md lists what this found.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, buildWeeklySummary } from '../src/metrics';
import { postureForRead } from '../src/drivers';
import { planForRead, planTodayCard, todayLine, type PlanForRead } from '../src/plan-read';
import { planChangeContext, reasonText, displacedReasonText } from '../src/plan-adapt';
import { numericLine, pushBody } from '../src/numeric-line';
import { buildFallbackVoice, validateVoice, type Driver } from '../src/validator';
import { weekSoFar } from '../src/week-so-far';
import { weeklyPlanDriver } from '../src/weekly';
import { composeDoorbell, fixedReply } from '../src/whatsapp';
import { planCardExpansion, cardErrorFallback } from '../src/card-expand';
import { checkCdvReply } from '../src/cdv-check';
import { reasonIssues } from '../src/adaptation-reason';
import { fillTemplate, getPatterns, templateSlots } from '../../../packages/voice/src/index';
import { describeWorkout } from '../../../packages/plan-engine/src/index';
import type { StoredWorkout } from '../src/plan-store';
import type { OuraSummary } from '../src/oura';

const DAY = 86_400_000;
const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const CONNECTED = { strava: true, oura: true, healthKit: false };

const run = (daysAgo: number, mins: number, miles: number, hr?: number) => {
  const at = new Date(now - daysAgo * DAY).toISOString();
  return { type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, moving_time: mins * 60, distance: miles * 1609.34, average_heartrate: hr, utc_offset: 0 };
};
const oura = (o: Partial<OuraSummary>): OuraSummary => ({
  sleepSeconds: null, sleepScore: null, hrvMs: null, restingHr: null, readinessScore: null, hrvWeekAvgMs: null, ...o,
} as OuraSummary);

const SCENARIOS: Record<string, { activities: any[]; recovery: OuraSummary | null }> = {
  'no data at all': { activities: [], recovery: null },
  'all recovery fields null': { activities: [], recovery: oura({}) },
  'one day of data': { activities: [run(0.1, 30, 3, 150)], recovery: null },
  'first week, two runs': { activities: [run(1, 30, 3, 150), run(3, 25, 2.5)], recovery: oura({ sleepSeconds: 25_920 }) },
  'a run with no time, distance or HR': { activities: [run(1, 0, 0)], recovery: null },
  'time but no distance': { activities: [run(2, 45, 0, 150)], recovery: null },
  'runs last week only': { activities: [run(10, 60, 6, 150)], recovery: null },
  'sleep only': { activities: [], recovery: oura({ sleepSeconds: 25_920, sleepScore: 84 }) },
  'sleep without HRV': { activities: [run(1, 45, 5, 150)], recovery: oura({ sleepSeconds: 25_000 }) },
  'HRV with no week average': { activities: [run(1, 45, 5, 150)], recovery: oura({ hrvMs: 52 }) },
  'every recovery value zero': { activities: [run(1, 45, 5)], recovery: oura({ sleepSeconds: 0, sleepScore: 0, hrvMs: 0, restingHr: 0, hrvWeekAvgMs: 0 }) },
  'negative trends': {
    activities: [run(1, 45, 5, 150), run(8, 90, 9, 150)],
    recovery: oura({ sleepSeconds: 20_000, sleepScore: 50, hrvMs: 30, hrvWeekAvgMs: 60, restingHr: 70, restingHrHistory: [50, 50, 50, 50], sleepScoreHistory: [80, 80, 80, 80, 80, 80, 80] }),
  },
  'a change that rounds to zero': { activities: [run(1, 45, 5, 150), run(8, 45.1, 5, 150)], recovery: oura({ hrvMs: 999, hrvWeekAvgMs: 1000 }) },
  'very large values': {
    activities: Array.from({ length: 50 }, (_, i) => run(i / 10 + 0.1, 600, 50, 199)),
    recovery: oura({ sleepSeconds: 86_400, sleepScore: 100, hrvMs: 300, restingHr: 200, hrvWeekAvgMs: 1 }),
  },
};

const workout = (o: Partial<StoredWorkout>): StoredWorkout => ({
  scheduled_date: today, planned_type: 'run', planned_intensity: 'tempo', planned_duration_min: 45, planned_distance_km: null,
  planned_description: null, workout_structure_json: null, ...o,
} as StoredWorkout);
const STEPS = [{ type: 'steady', duration_min: 45, intensity: 'tempo' }];

const PLANS: Record<string, StoredWorkout[]> = {
  'no plan': [],
  'no session today': [workout({ scheduled_date: '2099-01-01' })],
  'rest day': [workout({ planned_intensity: 'rest', planned_duration_min: null })],
  'no intensity, zero amounts': [workout({ planned_intensity: null, planned_duration_min: 0, planned_distance_km: 0 })],
  'blank intensity': [workout({ planned_intensity: '', planned_duration_min: null })],
  'distance only': [workout({ planned_intensity: 'long', planned_duration_min: null, planned_distance_km: 21.08 })],
  'steady state, one minute, tiny distance': [workout({ planned_intensity: 'steady_state', planned_duration_min: 1, planned_distance_km: 0.05 })],
  'SCORA session with steps': [workout({ workout_structure_json: STEPS as any })],
};

const CHANGE = planChangeContext([{
  id: 'a1', adaptation_type: 'moved', original_date: today, new_date: today, reason_code: 'x', triggered_at: '',
  reason_text: "Tuesday's tempo moved to Thursday. Today's posture reads rest, and Thursday keeps the week's hard days apart.",
}]);

// What must never reach an athlete, on any path.
const JUNK: [RegExp, string][] = [
  [/\bundefined\b/, 'undefined'], [/\bNaN\b/, 'NaN'], [/\bInfinity\b/, 'Infinity'], [/\bnull\b/, 'null'], [/\[object/, 'object'],
  [/\{\{|\}\}/, 'unfilled slot'], [/-0(?:\.0+)?%/, '-0%'], [/n\/a/, 'n/a'],
  [/(?<![\d.:])1 (?:\w+ )?(?:runs|days|nights|hours|minutes|weeks|sessions|workouts)\b/, 'singular with plural'],
  // A week with no runs is a real 0 ("Weekly volume 0 mi (-100% wk)"); any other 0 mi is a missing distance.
  [/(?<![\d.:])0 mi\b(?! \(-100% wk\))/, '0 mi'], [/(?<![\d:])0:00\b/, '0:00'], [/(?<![\d.])0 ?ms\b/, '0ms'], [/, 0 (?:min|mi)\b(?! since)/, 'tempo, 0 min'],
  [/\.\./, 'double period'], [/\s[.,;:]/, 'space before punctuation'], [/ {2}/, 'double space'], [/\w_\w/, 'snake_case'], [/\(\s*\)/, 'empty parentheses'],
  [/!/, 'exclamation point'], [/\p{Extended_Pictographic}/u, 'emoji'], [/\u2014/, 'em dash'],
];
function assertClean(text: string, where: string) {
  for (const [re, label] of JUNK) assert.ok(!re.test(text), `${label} in ${where}: ${text}`);
}

function readDrivers(s: { activities: any[]; recovery: OuraSummary | null }, plan: PlanForRead, withChange: boolean): Driver[] {
  const d = buildDashboard(s.activities, CONNECTED, s.recovery, 'Oura', today);
  const p = postureForRead(s.activities, s.recovery, { localToday: today });
  return [...d.drivers, ...p.evidence, ...(plan.driver ? [plan.driver] : []), ...(withChange ? CHANGE.drivers : [])];
}

for (const [name, s] of Object.entries(SCENARIOS)) {
  test(`awkward values, ${name}: every card reads clean`, () => {
    for (const c of buildDashboard(s.activities, CONNECTED, s.recovery, 'Oura', today).cards) {
      assertClean(c.translation ?? c.cta ?? '', `card ${c.id}`);
      assert.ok(c.translation || c.cta, `card ${c.id} says nothing`);
    }
  });

  test(`awkward values, ${name}: the numeric line is raw values in the fixed order, or nothing`, () => {
    const line = numericLine(readDrivers(s, planForRead([], today), false));
    assertClean(line, 'numeric line');
    if (!line) return;
    const parts = line.split(' · ');
    const order = ['Sleep', 'Oura', 'HRV', 'Load'];
    const seen = parts.map((p) => order.indexOf(p.split(' ')[0]));
    assert.ok(seen.every((n) => n >= 0), line);
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b), line);
    for (const p of parts) assert.match(p, /^(Sleep \d+:\d\d|Oura \d+|HRV \d+ms(?: \([+-]\d+% wk\))?|Load \d+)$/, line);
  });

  for (const [planName, rows] of Object.entries(PLANS)) {
    test(`awkward values, ${name} + ${planName}: the fallback read passes its own validators`, () => {
      const plan = planForRead(rows, today);
      for (const withChange of [false, true]) {
        const drivers = readDrivers(s, plan, withChange);
        const voice = buildFallbackVoice(drivers, "Today's numbers");
        assertClean(voice, 'fallback');
        assert.deepEqual(validateVoice(voice, drivers), { ok: true, bannedHits: [], unbackedNumbers: [], unbackedClaims: [] }, voice);
      }
    });
  }

  test(`awkward values, ${name}: push, doorbell, Week So Far and weekly read clean`, () => {
    const plan = planForRead(PLANS['SCORA session with steps'], today);
    const drivers = readDrivers(s, plan, false);
    const voice = buildFallbackVoice(drivers, "Today's numbers");
    const numbers = numericLine(drivers);
    const line = todayLine(plan.workout, describeWorkout)!;
    assertClean(pushBody(numbers, voice, 4000, line), 'push');
    const message = composeDoorbell({ numbers, voice, today: line, link: 'https://scora.app/r/a', drivers });
    assert.equal(message.match(/Today:/g)?.length, 1, message);
    if (numbers) assert.ok(message.startsWith(numbers), 'numbers come first');
    assertClean(weekSoFar(s.activities, today).line, 'week so far');
    const w = buildWeeklySummary(s.activities, s.recovery, today);
    const weekly = buildFallbackVoice(w.drivers, 'This week');
    assertClean(weekly, 'weekly fallback');
    assert.equal(validateVoice(weekly, w.drivers).ok, true, weekly);
  });

  test(`awkward values, ${name}: card expansions cite only drivers, and their fallback passes`, () => {
    const d = buildDashboard(s.activities, CONNECTED, s.recovery, 'Oura', today);
    const p = postureForRead(s.activities, s.recovery, { localToday: today });
    const snapshot = { cards: d.cards, drivers: [...d.drivers, ...p.evidence], posture: p.backed ? p.result.posture : null, at: now };
    for (const card of d.cards) {
      const plan = planCardExpansion(card, snapshot);
      if (plan.kind === 'static') { assertClean(plan.reply, `static ${card.id}`); continue; }
      assertClean(plan.userPrompt, `card prompt ${card.id}`);
      const f = cardErrorFallback(plan.drivers, card.title, snapshot.posture);
      assertClean(f.reply, `card fallback ${card.id}`);
      assert.equal(f.emission.finalOk, true, f.reply);
    }
  });
}

test('awkward values: Plan Today card and plan driver read clean for every plan', () => {
  for (const [name, rows] of Object.entries(PLANS)) {
    const card = planTodayCard(rows, today);
    if (name === 'no plan') { assert.equal(card, null); continue; }
    assertClean(card!.translation ?? '', `plan card, ${name}`);
    const d = planForRead(rows, today).driver;
    if (d) assertClean(d.value, `plan driver, ${name}`);
    assert.ok(card!.value !== '0', `plan card shows 0, ${name}`);
  }
});

test('the Today line: only a session with steps, never a rest day, a pasted plan or no session', () => {
  const line = (name: string) => todayLine(planForRead(PLANS[name], today).workout, describeWorkout);
  assert.match(line('SCORA session with steps')!, /^Today: 45-minute tempo\.$/);
  for (const name of ['no plan', 'no session today', 'rest day', 'no intensity, zero amounts', 'blank intensity', 'distance only']) {
    assert.equal(line(name), null, name);
  }
});

test('the plan prompt line says nothing scheduled, and names no session, when today is empty', () => {
  const p = planForRead(PLANS['no session today'], today);
  assert.equal(p.driver, null);
  assert.equal(p.promptLine, 'PLAN TODAY: nothing scheduled.');
  assert.equal(planForRead([], today).promptLine, '');
});

test('the weekly plan driver: 0 of a plan reads clean, and no plan minutes is no driver', () => {
  const from = today;
  assert.equal(weeklyPlanDriver([], [], from, from), null);
  const d = weeklyPlanDriver([workout({})], [], from, from)!;
  assert.equal(d.value, '0 of 45 planned run min');
});

// ---- the curated patterns ------------------------------------------------

// Slot values as a caller would fill them. A key maps to the awkward values
// for that slot; each pattern renders with every value of every slot it has.
const SLOT_VALUES: Record<string, (number | string)[]> = {
  hrv_pct_change: [-9, -0.4, 8, 8.5, 0, 1234],
  sleep_hours: [6, 0, 12],
  sleep_minutes_padded: ['09', '00', '59'],
  consecutive_hard_days: [1, 2, 3, 40],
  days_since_long_effort: [5, 6, 365],
  days_to_race: [1, 2, 7],
  long_distance_km: [5, 21.1, 160.9],
  workouts_completed_this_week: [0, 1, 7],
  workouts_planned_this_week: [1, 7],
  'scheduled_workout.planned_intensity': ['tempo', 'rest', 'steady_state'],
  yesterday_workout_planned_intensity: ['long', 'steady_state'],
  coach_name: ['Sarah Jones', 'James', "O'Neil"],
};

// Each value one at a time, the others at their first value.
function renderings(template: string): { values: Record<string, string | number>; text: string; missing: string[] }[] {
  const slots = templateSlots(template);
  const base = Object.fromEntries(slots.map((k) => [k, SLOT_VALUES[k]?.[0]]));
  const out = [];
  for (const k of slots) {
    for (const v of SLOT_VALUES[k] ?? []) {
      const values = { ...base, [k]: v } as Record<string, string | number>;
      out.push({ values, ...fillTemplate(template, values) });
    }
  }
  return out.length ? out : [{ values: {}, ...fillTemplate(template, {}) }];
}

const backing = (values: Record<string, string | number>): Driver[] => [
  { metric: 'Sleep', value: '6:42' },
  { metric: 'HRV', value: '40ms' },
  { metric: 'Plan today', value: 'tempo' },
  { metric: 'Slots', value: Object.values(values).join(' ') },
];

for (const p of getPatterns()) {
  test(`pattern ${p.id}: every slot has awkward values, and each rendering is clean and valid`, () => {
    for (const slot of templateSlots(p.template)) assert.ok(SLOT_VALUES[slot], `add ${slot} to SLOT_VALUES`);
    for (const r of renderings(p.template.trim())) {
      assert.deepEqual(r.missing, [], r.text);
      assertClean(r.text, p.id);
      assert.deepEqual(validateVoice(r.text, backing(r.values)), { ok: true, bannedHits: [], unbackedNumbers: [], unbackedClaims: [] }, r.text);
    }
  });

  test(`pattern ${p.id}: a null, NaN, Infinity or blank value stays a visible gap, reported`, () => {
    const slots = templateSlots(p.template);
    for (const bad of [null, undefined, NaN, Infinity, -Infinity, '', ' ', 'NaN', 'undefined']) {
      const values = Object.fromEntries(slots.map((k) => [k, bad])) as Record<string, string | number>;
      const r = fillTemplate(p.template.trim(), values);
      assert.deepEqual(r.missing, slots, String(bad));
      assert.ok(!/\b(?:NaN|undefined|null|Infinity)\b/.test(r.text.replace(/\{\{.*?\}\}/g, '')), r.text);
    }
  });

  test(`pattern ${p.id}: an echoed, unfilled slot is stopped by the validator`, () => {
    if (templateSlots(p.template).length === 0) return;
    assert.ok(validateVoice(p.template.trim(), backing({})).bannedHits.includes('unfilled template'));
  });
}

// Renderings that are legal and read badly. Wording is Evan's, so they are
// pinned, not fixed: docs/voice-spec-audit.md asks about each one. If a line
// changes on purpose, change it here too.
test('pinned for Evan: curated lines that read badly on legal values', () => {
  const by = (id: string) => getPatterns().find((p) => p.id === id)!.template.trim();
  const sleep = { sleep_hours: 6, sleep_minutes_padded: '10' };
  // The rule fires on sleep or HRV alone, so the hard-day count can be 0.
  assert.match(fillTemplate(by('plan-says-rest-body-agrees-v1'), { ...sleep, consecutive_hard_days: 0 }).text, /^Sleep 6:10 after 0 hard days\./);
  // The rule fires on sleep alone, so HRV can be flat or up in a line about a stubborn body.
  const taper = by('taper-week-body-not-coming-around-v1');
  assert.match(fillTemplate(taper, { days_to_race: 3, hrv_pct_change: 0 }).text, /HRV is still 0% below baseline/);
  assert.match(fillTemplate(taper, { days_to_race: 3, hrv_pct_change: 5 }).text, /HRV is still 5% above baseline\. The body is stubborn/);
  // A race today.
  assert.match(fillTemplate(taper, { days_to_race: 0, hrv_pct_change: -5 }).text, /^0 days out/);
  // No change has no direction, so the template's word stands.
  const hard = by('plan-says-hard-body-says-back-off-v1');
  assert.match(fillTemplate(hard, { ...sleep, hrv_pct_change: 0, 'scheduled_workout.planned_intensity': 'tempo' }).text, /HRV down 0% from last week/);
  // Fires on a recovery session too, which is not rest.
  assert.ok(getPatterns().find((p) => p.id === 'plan-says-rest-body-agrees-v1')!.scheduled_workout_intensity_filter!.includes('recovery'));
  assert.match(by('plan-says-rest-body-agrees-v1'), /The plan says rest today/);
});

// ---- tone: fixed strings only (CLAUDE.md §3.7) ------------------------------

const JARGON = /\b(?:acwr|tsb|ctl|atl|z[1-5]|anaerobic|lactate|mitochondri\w+|parasympathetic|sympathetic|autonomic)\b/i;
const BRO = /\b(?:crush\w*|smash\w*|beast|let'?s go|killing it|on fire|no excuses|hustle|grind|gains?|stoked|pumped|boom)\b/i;

test('tone: fixed voice strings have no exclamation points, emoji, em dashes, jargon or fitness-bro words', () => {
  const decided = {
    type: 'moved', from: '2026-11-03', to: '2026-11-05', reason_code: 'r', displaced_workout_id: null,
    facts: { posture: 'back-off', workout_date: '2026-11-03', workout_intensity: 'tempo', workout_duration_min: 45 },
  } as any;
  const fixed = [
    ...getPatterns().map((p) => p.template.trim()),
    'Not enough recent activity to read yet. Once a few runs land in Strava, the morning read fills in.',
    'No runs logged in the last week. Once the week has some training in it, the Sunday review has something to reflect on.',
    'That answer could not be checked against your data, so it is not shown.',
    'No answer could be reached just now, so nothing is shown for this question.',
    buildFallbackVoice([], 'Where things sit'),
    ...(['pause', 'resume', 'stop', 'help'] as const).map((cmd) => fixedReply({ cmd, days: 3 } as any)!),
    fixedReply({ cmd: 'pause', days: 1 })!,
  ];
  // Plan text, not the voice: it reports a change, so no plan driver applies.
  const planText = [reasonText(decided), displacedReasonText(decided, workout({ scheduled_date: '2026-11-05', planned_intensity: 'easy' }) as any)];
  for (const s of planText) {
    assert.ok(!/[!\u00A1\u2014]/.test(s) && !JARGON.test(s) && !BRO.test(s), s);
    assert.deepEqual(validateVoice(s, []).bannedHits, [], s);
  }
  for (const s of fixed) {
    assert.ok(!/[!\u00A1\u2014]/.test(s), s);
    assert.ok(!/\p{Extended_Pictographic}/u.test(s), s);
    assert.ok(!JARGON.test(s), `jargon: ${s}`);
    assert.ok(!BRO.test(s), `fitness-bro: ${s}`);
    assert.deepEqual(validateVoice(s.replace(/\{\{.*?\}\}/g, 'Sarah'), backing({})).bannedHits, [], s);
  }
  assert.equal(fixedReply({ cmd: 'pause', days: 1 }), 'Paused for 1 day. Reply resume to start again sooner.');
  assert.deepEqual(reasonIssues(reasonText(decided), decided, []), []);
});

test('a CDV fallback on awkward METRIC lines reads clean', () => {
  const r = checkCdvReply('You should run a tempo.', [{ metric: 'Weekly miles', value: '0' }, { metric: 'Runs', value: '1' }], { miles: 0, runs: 1 }, 'how am I doing?');
  assert.equal(r.fallback, true);
  assert.equal(r.finalOk, true, r.voice);
  assertClean(r.voice, 'cdv fallback');
});
