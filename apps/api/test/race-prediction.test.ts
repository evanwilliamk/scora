import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREDICTION, predictRace, riegel } from '../src/race-prediction';
import { fetchActivitiesSince } from '../src/strava';

const run = (date: string, km: number, min: number, extra: Record<string, unknown> = {}) => ({
  type: 'Run', start_date_local: `${date}T07:00:00Z`, distance: km * 1000, moving_time: min * 60, elapsed_time: min * 60 + 30, ...extra,
});
const TODAY = '2026-10-18';
const training = [
  run('2026-10-04', 10, 50), run('2026-10-08', 8, 42), run('2026-10-11', 22, 125),
  run('2026-10-14', 5, 24), run('2026-10-16', 2, 9), // under 3 km: not an effort
];

test('a range from the three best projections, every effort returned with it', () => {
  const p = predictRace(training, 'half_marathon', TODAY);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(p.efforts.length, 3);
  assert.ok(p.efforts.every((e) => e.distance_m >= 3000));
  const sorted = [...p.efforts].map((e) => e.projected_s);
  assert.deepEqual(sorted, [...sorted].sort((a, b) => a - b));
  assert.ok(p.low_s <= sorted[0] && p.high_s >= sorted[2]);
  assert.ok(p.high_s > p.low_s);
  assert.equal(p.efforts[0].projected_s, Math.round(riegel(50 * 60, 10000, 21097.5))); // the 10 km projects fastest
  assert.equal(p.used_races, false);
});

test('a Strava race joins the pool with training runs and is timed start to finish', () => {
  // Was 'a Strava race wins over training runs': races alone were used, so the
  // range came from one race. Now the race is pooled with training runs.
  const acts = [...training, run('2026-09-27', 10, 44, { workout_type: 1 })];
  const p = predictRace(acts, '10k', TODAY);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(p.efforts.length, 3);
  assert.equal(p.efforts[0].race, true);
  assert.equal(p.efforts[0].time_s, 44 * 60 + 30);
  assert.ok(p.efforts.slice(1).every((e) => !e.race));
  assert.equal(p.used_races, false); // a mix, not races only
  const races = [10, 10, 10].map((km, i) => run(`2026-10-0${i + 1}`, km, 44, { workout_type: 1 }));
  const r = predictRace([...races, run('2026-10-11', 22, 125)], '10k', TODAY);
  assert.ok(r.ok && r.used_races);
});

test('one old race does not hide stronger recent training, and races keep the 3-effort floor', () => {
  // 5K race 7 weeks ago, 22 km at a strong pace last week.
  const race = run('2026-08-30', 5, 25, { workout_type: 1, elapsed_time: 25 * 60 });
  const long = run('2026-10-11', 22, 105);
  const two = predictRace([race, long], 'half_marathon', TODAY);
  assert.equal(two.ok, false);
  assert.equal(!two.ok && two.reason, 'not_enough_runs');
  const p = predictRace([race, long, run('2026-10-04', 10, 50), run('2026-10-08', 8, 40)], 'half_marathon', TODAY);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(p.efforts[0].date, '2026-10-11');
  assert.equal(p.efforts[0].projected_s, Math.round(riegel(105 * 60, 22000, 21097.5)));
  assert.ok(p.low_s <= p.efforts[0].projected_s);
});

test('no data, no claim: too few runs, no long run, unknown race', () => {
  assert.deepEqual(predictRace([], '10k', TODAY), { ok: false, race: '10k', reason: 'not_enough_runs', needed: '3 runs of 3 km or more in the last 8 weeks' });
  assert.equal((predictRace(training.slice(0, 2), '10k', TODAY) as any).reason, 'not_enough_runs');
  const noLong = [run('2026-10-04', 10, 50), run('2026-10-08', 8, 42), run('2026-10-14', 5, 24)];
  const m = predictRace(noLong, 'marathon', TODAY);
  assert.deepEqual(m, { ok: false, race: 'marathon', reason: 'no_long_run', needed: 'a run of at least 22 km in the last 8 weeks' });
  assert.equal((predictRace(training, 'ultra', TODAY) as any).reason, 'unknown_race');
});

test('only the last 8 weeks and only runs count', () => {
  const old = [run('2026-08-01', 10, 38), run('2026-08-02', 10, 38), run('2026-08-03', 10, 38)];
  const rides = [{ ...run('2026-10-10', 40, 60), type: 'Ride' }];
  const p = predictRace([...training, ...old, ...rides], '10k', TODAY);
  assert.ok(p.ok && p.efforts.every((e) => e.date >= '2026-08-24'));
});


test('activities are paged until a short page, so the newest runs are not dropped', async () => {
  const urls: string[] = [];
  const pages = [Array(200).fill({ type: 'Run' }), Array(200).fill({ type: 'Run' }), [{ type: 'Run', id: 'newest' }]];
  const fake = (async (url: string) => { urls.push(url); const b = pages[urls.length - 1]; return { ok: true, json: async () => b } as any; }) as any;
  const all = await fetchActivitiesSince('t', 1000, fake);
  assert.equal(all.length, 401);
  assert.equal(all[400].id, 'newest');
  assert.deepEqual(urls.map((u) => new URL(u).searchParams.get('page')), ['1', '2', '3']);
  await assert.rejects(fetchActivitiesSince('t', 1000, (async () => ({ ok: false, status: 401 })) as any), /Strava 401/);
});

test('treadmill runs never feed a race prediction (distance is an estimate)', () => {
  const treadmill = training.map((a) => ({ ...a, type: 'VirtualRun', sport_type: 'VirtualRun' }));
  assert.equal(predictRace(training, 'half_marathon', TODAY).ok, true);
  const p = predictRace(treadmill, 'half_marathon', TODAY);
  assert.equal(p.ok, false);
  assert.equal(!p.ok && p.reason, 'not_enough_runs');
});
