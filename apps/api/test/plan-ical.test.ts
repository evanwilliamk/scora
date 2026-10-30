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

test('a TZID start time is moved from its own zone to the athlete\'s', () => {
  const at = (dtstart: string, TZID: string, tz: string) => eventDate({ dtstart, dtstartParams: { TZID } }, tz);
  // 01:00 UTC on Nov 3 is 18:00 on Nov 2 in Los Angeles.
  assert.equal(at('20261103T010000', 'Etc/UTC', 'America/Los_Angeles'), '2026-11-02');
  // 22:00 in New York on Oct 23 is already Oct 24 in Berlin.
  assert.equal(at('20261023T220000', 'America/New_York', 'Europe/Berlin'), '2026-10-24');
  // Across the US DST change (Nov 1): 23:30 New York on Nov 1 is 04:30 UTC Nov 2.
  assert.equal(at('20261101T233000', 'America/New_York', 'UTC'), '2026-11-02');
  // Same zone as the athlete: the written date.
  assert.equal(at('20261023T060000', 'America/New_York', 'America/New_York'), '2026-10-23');
  // Unknown TZID: the written date, as before.
  assert.equal(at('20261103T010000', 'Not/AZone', 'America/Los_Angeles'), '2026-11-03');
  // An all-day date keeps its date whatever the zone.
  assert.equal(eventDate({ dtstart: '20261103', dtstartParams: { VALUE: 'DATE', TZID: 'Etc/UTC' } }, 'America/Los_Angeles'), '2026-11-03');
  // Through the import itself.
  const r = importIcs(cal(ev('UID:t', 'DTSTART;TZID=Etc/UTC:20261103T010000', 'SUMMARY:Easy run 30 min')), TODAY, 'America/Los_Angeles');
  assert.equal(r.rows[0].date, '2026-11-02');
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

test('a refresh replaces only a calendar plan, never a plan pasted since (review)', async () => {
  const store = sqlPlanStore(db);
  const { rows } = importIcs(FEED, TODAY, 'UTC');
  assert.equal(await store.refreshIcalPlan('rf1', rows), null, 'no calendar plan yet: nothing happens');
  await store.saveIcalPlan('rf1', rows);
  assert.ok(await store.refreshIcalPlan('rf1', rows), 'still the calendar plan: refreshed');
  const pasted = validateParsedRows([{ date: '2026-10-23', type: 'run', intensity: 'easy', description: 'easy 30' }], 'Fri easy 30', TODAY);
  await store.saveManualPlan('rf1', 'Fri easy 30', pasted.rows);
  assert.equal(await store.refreshIcalPlan('rf1', rows), null, 'a paste since the import wins');
  const week = await store.workoutsBetween('rf1', '2026-10-23', '2026-10-23');
  assert.deepEqual(week.map((w) => w.planned_description), ['easy 30']);
});

test('a calendar refresh keeps done/missed marks on sessions it brings back (review 6)', async () => {
  const store = sqlPlanStore(db);
  const { rows } = importIcs(FEED, TODAY, 'UTC');
  await store.saveIcalPlan('rf2', rows);
  const [first] = await store.workoutsBetween('rf2', '2026-10-23', '2026-10-23');
  assert.equal(await store.markCompleted('rf2', first.id, true, '2026-10-23'), true);
  await store.refreshIcalPlan('rf2', rows);
  const [again] = await store.workoutsBetween('rf2', '2026-10-23', '2026-10-23');
  assert.notEqual(again.id, first.id, 'a new row');
  assert.equal(again.athlete_completed, true, 'the mark came along');
});

test('a refresh keeps two identical sessions marked apart and keeps the Watch send (review 2026-10-30)', async () => {
  const store = sqlPlanStore(db);
  // The importer drops exact repeats, but the function takes any rows, and
  // two sessions can share day, sport and words.
  const row = (date: string) => ({ date, type: 'run', intensity: 'easy', duration_min: 30, distance_km: null, description: 'Easy run 30 min' });
  const rows = [row('2026-10-23'), row('2026-10-23'), row('2026-10-24')] as any;
  await store.saveIcalPlan('rf3', rows);
  const [a, b] = await store.workoutsBetween('rf3', '2026-10-23', '2026-10-23');
  const [c] = await store.workoutsBetween('rf3', '2026-10-24', '2026-10-24');
  assert.equal(a.planned_description, b.planned_description, 'identical sessions');
  assert.equal(await store.markCompleted('rf3', a.id, true, '2026-10-24'), true);
  assert.equal(await store.markCompleted('rf3', b.id, false, '2026-10-24'), true);
  assert.equal(await store.markWatchSent('rf3', c.id), true);
  const sent = (await db.query<{ t: string }>(`select workout_kit_pushed_at::text as t from scheduled_workouts where id = $1`, [c.id])).rows[0].t;

  await store.refreshIcalPlan('rf3', rows);
  const day = await store.workoutsBetween('rf3', '2026-10-23', '2026-10-23');
  assert.equal(day.length, 2);
  assert.ok(day.every((w) => w.id !== a.id && w.id !== b.id), 'new rows');
  assert.deepEqual(day.map((w) => w.athlete_completed), [true, false], 'one done, one missed, in the same order');
  const [c2] = await store.workoutsBetween('rf3', '2026-10-24', '2026-10-24');
  const after = (await db.query<{ t: string | null }>(`select workout_kit_pushed_at::text as t from scheduled_workouts where id = $1`, [c2.id])).rows[0].t;
  assert.notEqual(c2.id, c.id);
  assert.equal(after, sent, 'the Watch send came along');
});

test('the Supabase store orders same-day sessions by creation, then id', async () => {
  const { supabasePlanStore } = await import('../src/plan-store');
  const orders: any[] = [];
  const q: any = {
    select: () => q, eq: () => q, gte: () => q, lte: () => q,
    order: (col: string, o?: any) => { orders.push([col, o?.ascending ?? true]); return q; },
    then: (res: any) => res({ data: [], error: null }),
  };
  const store = supabasePlanStore({ from: () => q, rpc: async () => ({ data: null, error: null }) });
  await store.workoutsBetween('ath', '2026-10-23', '2026-10-25');
  assert.deepEqual(orders, [['scheduled_date', true], ['created_at', true], ['id', true]]);
});
