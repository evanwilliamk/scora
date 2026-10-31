// The Sunday weekly review's plan line (PRD 5.A.5, 5.A.6): planned vs done run
// minutes over a Monday-to-Sunday week must read the same numbers the Week So
// Far card showed for that week (PRD 5.A.3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyPlanDriver } from '../src/weekly';
import { weekSoFar, plannedRunMinutes } from '../src/week-so-far';
import { validateVoice } from '../src/validator';

// Mon 2026-10-26 to Sun 2026-11-01; delivered Monday 2026-11-02 (Free tier).
const FROM = '2026-10-26';
const TO = '2026-11-01';
const rows = [
  { scheduled_date: '2026-10-25', planned_type: 'run', planned_intensity: 'easy', planned_duration_min: 60 }, // the Sunday before
  { scheduled_date: '2026-10-26', planned_type: 'run', planned_intensity: 'easy', planned_duration_min: 30 },
  { scheduled_date: '2026-10-27', planned_type: 'run', planned_intensity: 'tempo', planned_duration_min: 30 },
  { scheduled_date: '2026-10-28', planned_type: 'run', planned_intensity: 'rest', planned_duration_min: null },
  { scheduled_date: '2026-10-29', planned_type: 'run', planned_intensity: 'easy', planned_duration_min: 30 },
  { scheduled_date: '2026-10-30', planned_type: 'strength', planned_intensity: null, planned_duration_min: 40 },
  { scheduled_date: '2026-10-31', planned_type: 'run', planned_intensity: 'easy', planned_duration_min: 30 },
  { scheduled_date: '2026-11-01', planned_type: 'run', planned_intensity: 'long', planned_duration_min: 30 },
];
// Strava moving times in seconds, not whole minutes: 30.4 min runs.
const run = (day: string) => ({ type: 'Run', sport_type: 'Run', start_date_local: `${day}T07:00:00Z`, moving_time: 1824 });
const runs = ['2026-10-26', '2026-10-27', '2026-10-29', '2026-10-31', '2026-11-01'].map(run);

test('weekly plan line reads the same done and planned minutes as Week So Far on that Sunday', () => {
  const wsf = weekSoFar(runs, TO, plannedRunMinutes(rows.filter((r) => r.scheduled_date >= FROM)));
  const d = weeklyPlanDriver(rows, runs, FROM, TO);
  assert.ok(d);
  assert.equal(d!.value, `${wsf.total_min} of ${wsf.planned_to_date_min} planned run min`);
  assert.equal(d!.value, '150 of 150 planned run min');
  const v = validateVoice('The week tracked the plan: 150 of 150 planned run minutes.', [d!]);
  assert.deepEqual([v.bannedHits, v.unbackedNumbers], [[], []]);
});

test('weekly plan line: days outside the week and other sports never count', () => {
  const extra = [...runs, run('2026-10-25'), run('2026-11-02'), { type: 'Ride', start_date_local: '2026-10-30T07:00:00Z', moving_time: 3600 }];
  assert.equal(weeklyPlanDriver(rows, extra, FROM, TO)!.value, '150 of 150 planned run min');
});

test('weekly plan line: no planned run minutes, or a run with no duration, means no line', () => {
  assert.equal(weeklyPlanDriver(rows.filter((r) => r.planned_type !== 'run'), runs, FROM, TO), null);
  const unknown = rows.map((r) => (r.scheduled_date === TO ? { ...r, planned_duration_min: null } : r));
  assert.equal(weeklyPlanDriver(unknown, runs, FROM, TO), null);
  assert.equal(weeklyPlanDriver([], runs, FROM, TO), null);
});

test('weekly push: once per week, even when the athlete changes time zone that Monday', async () => {
  const { dueDeliveries, defaultPrefs } = await import('../src/delivery');
  // Sent Monday 06:00 in Tokyo (Sun 21:00 UTC), then moved to Los Angeles.
  const sentTokyo = { ...defaultPrefs(), timezone: 'America/Los_Angeles', last_weekly_sent_on: '2026-11-02' };
  assert.equal(dueDeliveries(sentTokyo, new Date(Date.UTC(2026, 10, 2, 14, 5))).weekly, false, 'LA Monday 06:05');
  // Sent Monday 06:00 in Los Angeles, then moved to Tokyo: Tokyo is on Tuesday.
  const sentLa = { ...defaultPrefs(), timezone: 'Asia/Tokyo', last_weekly_sent_on: '2026-11-02' };
  for (let h = 0; h < 48; h++) {
    assert.equal(dueDeliveries(sentLa, new Date(Date.UTC(2026, 10, 2, 14) + h * 3600_000)).weekly, false, `hour ${h}`);
  }
  // The next Monday it is due again.
  assert.equal(dueDeliveries({ ...sentTokyo, delivery_minute: 360 }, new Date(Date.UTC(2026, 10, 9, 14, 5))).weekly, true);
});
