import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { eventDate, importIcs, parseIcsEvents, IcalImportError, MAX_ICS_EVENTS } from '../src/plan-ical';
import { sqlPlanStore } from '../src/plan-store';
import { validateParsedRows } from '../src/plan-parse';

// Synthetic calendar, shaped like a plan app's feed. Test input, not training content.
const TODAY = '2026-10-22';
const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Plan//EN', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

const FEED = cal(
  ev('UID:a', 'DTSTART;VALUE=DATE:20261023', 'SUMMARY:Easy run 40 min'),
  ev('UID:b', 'DTSTART;VALUE=DATE:20261024', 'SUMMARY:Long run', 'DESCRIPTION:18 km at an easy\\, conversational effort'),
  ev('UID:c', 'DTSTART;VALUE=DATE:20261025', 'SUMMARY:Rest day'),
  ev('UID:d', 'DTSTART;VALUE=DATE:20261027', 'SUMMARY:Tempo 45 min', 'DESCRIPTION:3x8 min at threshold with 3 min easy'),
  ev('UID:e', 'DTSTART;VALUE=DATE:20261028', 'SUMMARY:Intervals', 'DESCRIPTION:10 min warm up\\n6x800m\\n10 min cool down'),
  ev('UID:f', 'DTSTART;VALUE=DATE:20261029', 'SUMMARY:Bike 1h30 endurance'),
  ev('UID:old', 'DTSTART;VALUE=DATE:20261001', 'SUMMARY:Easy run 30 min'),
);

test('a plan feed becomes dated sessions; numbers only when exactly one is written', () => {
  const r = importIcs(FEED, TODAY, 'America/New_York');
  assert.deepEqual(
    r.rows.map((w) => [w.date, w.type, w.intensity, w.duration_min, w.distance_km]),
    [
      ['2026-10-23', 'run', 'easy', 40, null],
      ['2026-10-24', 'run', 'long', null, 18],
      ['2026-10-25', 'other', 'rest', null, null],
      ['2026-10-27', 'run', 'tempo', 45, null], // summary wins; the description's 8 and 3 are not guessed between
      ['2026-10-28', 'other', 'intervals', null, null], // no sport named; two durations written, so none is kept
      ['2026-10-29', 'ride', null, 90, null],
    ],
  );
  assert.equal(r.rows[1].description, 'Long run | 18 km at an easy, conversational effort');
  assert.equal(r.skipped_past, 1);
  assert.deepEqual(r.rejected, []);
});

test('folded lines, escapes and nested alarms are read correctly', () => {
  const ics = cal(ev(
    'UID:x',
    'DTSTART:20261023T063000',
    'SUMMARY:Easy run 35 min',
    'DESCRIPTION:Keep it relaxed\\; nose breathing only. Th',
    ' en 4 strides.',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder 99 km',
    'END:VALARM',
  ));
  const [e] = parseIcsEvents(ics);
  assert.equal(e.description, 'Keep it relaxed; nose breathing only. Then 4 strides.');
  const r = importIcs(ics, TODAY, 'UTC');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].distance_km, null, 'the alarm text never reaches the session');
  assert.equal(r.rows[0].duration_min, 35);
});

test('a UTC start time is placed on the athlete\'s own calendar day', () => {
  // 03:00 UTC on the 24th is the evening of the 23rd in New York.
  assert.equal(eventDate({ dtstart: '20261024T030000Z' }, 'America/New_York'), '2026-10-23');
  assert.equal(eventDate({ dtstart: '20261024T030000Z' }, 'Europe/Berlin'), '2026-10-24');
  assert.equal(eventDate({ dtstart: '20261024T030000Z' }, 'Not/AZone'), '2026-10-24'); // unknown zone: UTC
  assert.equal(eventDate({ dtstart: '20261024T060000' }, 'America/New_York'), '2026-10-24'); // floating keeps its date
  assert.equal(eventDate({ dtstart: 'garbage' }, 'UTC'), null);
});

test('repeating, cancelled and undated events are left out with a reason', () => {
  const r = importIcs(cal(
    ev('UID:r', 'DTSTART;VALUE=DATE:20261023', 'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:Easy run 30 min'),
    ev('UID:c', 'DTSTART;VALUE=DATE:20261024', 'STATUS:CANCELLED', 'SUMMARY:Tempo 40 min'),
    ev('UID:n', 'SUMMARY:Long run'),
    ev('UID:far', 'DTSTART;VALUE=DATE:20280101', 'SUMMARY:Easy run 30 min'),
    ev('UID:ok', 'DTSTART;VALUE=DATE:20261026', 'SUMMARY:Recovery jog 20 min'),
  ), TODAY, 'UTC');
  assert.deepEqual(r.rows.map((w) => [w.date, w.intensity, w.duration_min]), [['2026-10-26', 'recovery', 20]]);
  assert.deepEqual(r.rejected.map((x) => x.reason), [
    'repeating events are not imported',
    'cancelled event',
    'no readable start date',
    'date is more than 182 days out',
  ]);
});

test('miles are converted; a pace is not taken for a duration', () => {
  const r = importIcs(cal(
    ev('UID:m', 'DTSTART;VALUE=DATE:20261023', 'SUMMARY:6 mi easy', 'DESCRIPTION:Around 9:30/mi pace'),
  ), TODAY, 'UTC');
  assert.equal(r.rows[0].distance_km, 9.66);
  assert.equal(r.rows[0].duration_min, null);
});

test('not a calendar, empty, too many events', () => {
  assert.throws(() => importIcs('', TODAY), IcalImportError);
  assert.throws(() => importIcs('Tue: 45 min tempo', TODAY), /does not look like a calendar/);
  const many = cal(...Array.from({ length: MAX_ICS_EVENTS + 1 }, (_, i) => ev(`UID:${i}`, 'DTSTART;VALUE=DATE:20261023', 'SUMMARY:x')));
  assert.throws(() => importIcs(many, TODAY), /more than 1000 upcoming events/);
});

// ---- storage on PGlite ----

let db: PGlite;
const here = dirname(fileURLToPath(import.meta.url));
before(async () => {
  db = new PGlite({ extensions: { vector } });
  const dir = join(here, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
});
after(async () => { await db.close(); });

test('a calendar import replaces a pasted plan, and a paste replaces the import (one external plan)', async () => {
  const store = sqlPlanStore(db);
  const pasted = validateParsedRows([{ date: '2026-10-23', type: 'run', intensity: 'easy', description: 'easy 30' }], 'Fri easy 30', TODAY);
  await store.saveManualPlan('ath', 'Fri easy 30', pasted.rows);

  const { rows } = importIcs(FEED, TODAY, 'UTC');
  await store.saveIcalPlan('ath', rows);
  let week = await store.workoutsBetween('ath', '2026-10-23', '2026-10-25');
  assert.deepEqual(week.map((w) => w.planned_description), ['Easy run 40 min', 'Long run | 18 km at an easy, conversational effort', 'Rest day']);
  const src = await db.query<{ external_source: string; current_status: string; raw_text: string | null }>(
    `select external_source, current_status, raw_text from training_plans where athlete_id = 'ath' order by created_at`);
  assert.deepEqual(src.rows.map((r) => [r.external_source, r.current_status]), [['manual', 'replaced'], ['ical', 'active']]);
  assert.equal(src.rows[1].raw_text, null, 'the calendar text is not stored');
  const ws = await db.query<{ source: string }>(`select distinct w.source from scheduled_workouts w join training_plans p on p.id = w.training_plan_id where p.external_source = 'ical'`);
  assert.deepEqual(ws.rows.map((r) => r.source), ['external_ical']);

  await store.saveManualPlan('ath', 'Fri easy 30', pasted.rows);
  week = await store.workoutsBetween('ath', '2026-10-23', '2026-10-25');
  assert.deepEqual(week.map((w) => w.planned_description), ['easy 30']);
});

test('only one active pasted or imported plan per athlete, enforced by the schema', async () => {
  await assert.rejects(
    db.query(`insert into training_plans (athlete_id, source, external_source, start_date, end_date)
              values ('ath', 'external', 'ical', '2026-10-20', '2026-10-21')`),
    /duplicate key|unique/i,
  );
  await assert.rejects(db.query(`select replace_external_plan('ath', 'runna', null, '[{"date":"2026-10-23","type":"run"}]'::jsonb)`), /Unknown plan source/);
});

test('the Supabase store imports through replace_external_plan without the calendar text', async () => {
  const calls: any[] = [];
  const { supabasePlanStore } = await import('../src/plan-store');
  const store = supabasePlanStore({ from: () => { throw new Error('unused'); }, rpc: async (fn: string, args: any) => { calls.push([fn, args]); return { data: 'p1', error: null }; } });
  const { rows } = importIcs(FEED, TODAY, 'UTC');
  assert.deepEqual(await store.saveIcalPlan('ath', rows), { planId: 'p1' });
  assert.equal(calls[0][0], 'replace_external_plan');
  assert.deepEqual({ ...calls[0][1], p_rows: undefined }, { p_athlete_id: 'ath', p_external_source: 'ical', p_raw_text: null, p_rows: undefined });
  await assert.rejects(store.saveIcalPlan('ath', []), /No workouts/);
});

// ---- review fixes ----

test('a crafted parameter list parses in linear time (no regex backtracking)', () => {
  const evil = 'X;A=' + ',;B='.repeat(5000) + '"';
  const t = Date.now();
  parseIcsEvents(cal(ev('UID:a', evil, 'DTSTART;VALUE=DATE:20261023', 'SUMMARY:Easy run 30 min')));
  assert.ok(Date.now() - t < 500, `took ${Date.now() - t} ms`);
  const [e] = parseIcsEvents(cal(ev('UID:q', 'DTSTART;TZID="America/New_York: Eastern":20261023T060000', 'SUMMARY:x')));
  assert.equal(e.dtstart, '20261023T060000', 'a colon inside quotes is not the value separator');
});

test('"rest" in a description is not a rest day; a rest title still is', () => {
  const r = importIcs(cal(
    ev('UID:1', 'DTSTART;VALUE=DATE:20261023', 'SUMMARY:Track Tuesday', 'DESCRIPTION:6x800m with 90 sec rest'),
    ev('UID:2', 'DTSTART;VALUE=DATE:20261024', 'SUMMARY:Rest day'),
    ev('UID:3', 'DTSTART;VALUE=DATE:20261025', 'SUMMARY:Recovery or rest'),
  ), TODAY, 'UTC');
  assert.deepEqual(r.rows.map((w) => [w.intensity, w.type]), [['intervals', 'run'], ['rest', 'other'], ['recovery', 'other']]);
});

test('an event with notes but no title keeps its first character', () => {
  const r = importIcs(cal(ev('UID:1', 'DTSTART;VALUE=DATE:20261023', 'DESCRIPTION:10 km easy')), TODAY, 'UTC');
  assert.equal(r.rows[0].description, '10 km easy');
  assert.equal(r.rows[0].distance_km, 10);
});

test('a start time is not a duration', () => {
  const r = importIcs(cal(
    ev('UID:1', 'DTSTART;VALUE=DATE:20261023', 'SUMMARY:Group run 6:30'),
    ev('UID:2', 'DTSTART;VALUE=DATE:20261024', 'SUMMARY:Easy run at 6:30am', 'DESCRIPTION:40 min'),
  ), TODAY, 'UTC');
  assert.deepEqual(r.rows.map((w) => w.duration_min), [null, 40]);
});

test('the event cap counts upcoming events only, so a long history still imports', () => {
  const history = Array.from({ length: MAX_ICS_EVENTS + 50 }, (_, i) => ev(`UID:h${i}`, 'DTSTART;VALUE=DATE:20250101', 'SUMMARY:Easy run 30 min'));
  const r = importIcs(cal(...history, ev('UID:n', 'DTSTART;VALUE=DATE:20261023', 'SUMMARY:Easy run 30 min')), TODAY, 'UTC');
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped_past, MAX_ICS_EVENTS + 50);
});

test('importing a calendar also replaces an active SCORA plan, never a coach plan', async () => {
  const t = await db.query<{ id: string }>(
    `insert into plan_templates (slug, version, sport, goal_type, duration_weeks, experience_level, weekly_volume_range_km, author, structure_json)
     values ('test-ical', '1.0.0', 'run', 'half', 12, 'regular', '[20,40)', 'test', '{}') returning id`);
  await db.query(`insert into training_plans (athlete_id, source, template_id, start_date, end_date) values ('ai1', 'scora_ai', $1, '2026-10-19', '2026-12-31')`, [t.rows[0].id]);
  await db.query(`insert into training_plans (athlete_id, source, start_date, end_date) values ('ai1', 'coach', '2026-10-19', '2026-12-31')`);
  await sqlPlanStore(db).saveIcalPlan('ai1', importIcs(FEED, TODAY, 'UTC').rows);
  const rows = (await db.query<any>(`select source, current_status from training_plans where athlete_id = 'ai1' order by source`)).rows;
  assert.deepEqual(rows.map((r) => [r.source, r.current_status]), [['coach', 'active'], ['external', 'active'], ['scora_ai', 'replaced']]);
});
