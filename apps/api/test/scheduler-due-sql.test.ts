// scora_due_deliveries (migration 20261101010000) against dueDeliveries in
// delivery.ts, on PGlite: for every athlete it returns, the same daily,
// weekly and local date, and it leaves out exactly the athletes with nothing
// due. Zones with DST changes (including Lord Howe's 30-minute one), odd
// offsets, a zone neither side can read, late set times past midnight, and
// every claim state around the local date.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { dueDeliveries, localClock, LATE_WINDOW_MIN, type DeliveryPrefs } from '../src/delivery';
import { migratedPglite, callDue } from './helpers/pglite-db';

let pg: PGlite;
before(async () => { pg = await migratedPglite(); });
after(async () => { await pg.close(); });

const ZONES = ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Pacific/Auckland', 'Australia/Lord_Howe',
  'Pacific/Chatham', 'Asia/Kathmandu', 'UTC', 'Not/A_Zone'];
const MINUTES = [0, 90, 150, 360, 1380, 1439];
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

interface Case extends DeliveryPrefs { athlete_id: string }

// Every zone x set time x claim state, the claims relative to the local date at `now`.
function cases(now: Date): Case[] {
  const out: Case[] = [];
  let n = 0;
  for (const tz of ZONES) {
    const today = localClock(now, tz === 'Not/A_Zone' ? 'America/New_York' : tz).date;
    const y = shift(today, -1);
    const y2 = shift(today, -2);
    // [daily, weekly] claims: none, today's, yesterday's, older, and mixed.
    const claims = [[null, null], [today, null], [today, today], [y, y], [y, today], [y2, null], [y2, y], [shift(today, 1), null]];
    for (const minute of MINUTES) {
      for (const [d, w] of claims) {
        out.push({ athlete_id: `a${String(n++).padStart(5, '0')}`, timezone: tz, delivery_minute: minute, last_daily_sent_on: d, last_weekly_sent_on: w });
      }
    }
  }
  return out;
}

async function load(rows: Case[], noPrefs: string[] = []) {
  await pg.exec('delete from device_tokens; delete from athlete_preferences;');
  const devices = [...rows.map((r) => r.athlete_id), ...noPrefs];
  await pg.query(`insert into device_tokens (athlete_id, token) select id, 'tok-' || id from unnest($1::text[]) id`, [devices]);
  // Two devices for one athlete: still one row.
  if (devices.length) await pg.query(`insert into device_tokens (athlete_id, token) values ($1, 'second-device')`, [devices[0]]);
  await pg.query(
    `insert into athlete_preferences (athlete_id, timezone, delivery_minute, last_daily_sent_on, last_weekly_sent_on)
     select r.athlete_id, r.timezone, r.delivery_minute, r.last_daily_sent_on, r.last_weekly_sent_on
     from jsonb_to_recordset($1::jsonb) as r(athlete_id text, timezone text, delivery_minute smallint, last_daily_sent_on date, last_weekly_sent_on date)`,
    [JSON.stringify(rows)]);
}

const expected = (rows: Case[], now: Date) => rows
  .map((r) => ({ r, d: dueDeliveries(r, now) }))
  .filter(({ d }) => d.daily || d.weekly)
  .map(({ r, d }) => `${r.athlete_id} ${d.localDate} d=${d.daily} w=${d.weekly}`)
  .sort();
const actual = (rows: Record<string, any>[]) => rows.map((r) => `${r.athlete_id} ${r.local_date} d=${r.daily} w=${r.weekly}`).sort();

// Instants around each DST change in the zones above, plus ordinary days and a
// Monday (weekly) on both sides of midnight.
const INSTANTS: string[] = [];
const around = (iso: string, mins: number[]) => { for (const m of mins) INSTANTS.push(new Date(Date.parse(iso) + m * 60_000).toISOString()); };
// Minutes either side of each change: the gap or repeated hour, and the
// edges of a 120-minute window opened before, during and after it.
const near = [-120, -61, -31, -1, 0, 1, 29, 30, 60, 89, 119, 120, 180, 330];
around('2026-11-01T05:00:00Z', near); // New York fall back (02:00 EDT -> 01:00 EST)
around('2027-03-14T07:00:00Z', near); // New York spring forward (02:00 EST -> 03:00 EDT)
around('2026-10-25T01:00:00Z', near); // London fall back
around('2026-09-26T14:00:00Z', near); // Auckland spring forward (02:00 -> 03:00 NZDT)
around('2026-10-03T15:30:00Z', near); // Lord Howe spring forward (02:00 -> 02:30)
around('2027-04-04T14:30:00Z', near); // Lord Howe fall back (02:00 -> 01:30)
around('2026-09-26T13:45:00Z', near.slice(0, 8)); // Chatham spring forward
around('2026-11-02T00:00:00Z', [-90, -1, 0, 1, 30, 360, 1380, 1410, 1439]); // a Monday, UTC
around('2026-11-03T04:59:00Z', [0, 1, 2, 31, 61, 121]); // Tuesday just past a Monday local midnight in New York

test('scora_due_deliveries returns exactly the athletes dueDeliveries says are due', async () => {
  let compared = 0;
  let due = 0;
  for (const iso of INSTANTS) {
    const now = new Date(iso);
    const rows = cases(now);
    await load(rows);
    const got = await callDue(pg, { p_now: iso, p_window_minutes: LATE_WINDOW_MIN, p_limit: 100_000 });
    const want = expected(rows, now);
    assert.deepEqual(actual(got), want, `at ${iso}`);
    compared += rows.length;
    due += want.length;
  }
  // The cases cover both sides: plenty due, plenty not.
  assert.ok(due > 1000 && compared - due > 10_000, `${due} due of ${compared}`);
});

test('the rows carry the stored preferences the scheduler needs for release and telemetry', async () => {
  const now = new Date('2026-11-03T11:00:00Z'); // 06:00 in New York, Tuesday
  await load([{ athlete_id: 'x1', timezone: 'Not/A_Zone', delivery_minute: 360, last_daily_sent_on: '2026-11-02', last_weekly_sent_on: '2026-11-02' }], ['nopref']);
  const got = await callDue(pg, { p_now: now.toISOString() });
  assert.deepEqual(got, [
    // No preferences row: the defaults (06:00 New York), nothing sent yet.
    { athlete_id: 'nopref', timezone: 'America/New_York', delivery_minute: 360, last_daily_sent_on: null, last_weekly_sent_on: null, local_date: '2026-11-03', daily: true, weekly: false },
    // An unreadable zone is read as New York, and returned as stored.
    { athlete_id: 'x1', timezone: 'Not/A_Zone', delivery_minute: 360, last_daily_sent_on: '2026-11-02', last_weekly_sent_on: '2026-11-02', local_date: '2026-11-03', daily: true, weekly: false },
  ]);
  assert.deepEqual(dueDeliveries({ timezone: 'Not/A_Zone', delivery_minute: 360, last_daily_sent_on: '2026-11-02', last_weekly_sent_on: '2026-11-02' }, now),
    { daily: true, weekly: false, localDate: '2026-11-03' });
});

test('pages by athlete id after p_after, at most p_limit rows', async () => {
  const now = new Date('2026-11-03T11:00:00Z');
  const rows: Case[] = Array.from({ length: 25 }, (_, i) => ({
    athlete_id: `p${String(i).padStart(2, '0')}`, timezone: 'America/New_York', delivery_minute: 360, last_daily_sent_on: null, last_weekly_sent_on: null,
  }));
  await load(rows);
  const seen: string[] = [];
  let after: string | null = null;
  for (let pages = 0; pages < 10; pages++) {
    const page = await callDue(pg, { p_now: now.toISOString(), p_after: after, p_limit: 10 });
    seen.push(...page.map((r) => r.athlete_id));
    if (page.length < 10) break;
    after = page[page.length - 1].athlete_id;
  }
  assert.deepEqual(seen, rows.map((r) => r.athlete_id));
});
