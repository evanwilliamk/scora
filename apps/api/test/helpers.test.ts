// Exported helpers that had no direct test (fallback pass, 2026-10-28).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { athleteLocalToday, postureEvidence } from '../src/drivers';
import { displacedReasonText, withTimeout } from '../src/plan-adapt';
import { writtenDistances, writtenMinutes } from '../src/plan-parse';
import { dataValues } from '../src/cdv-check';
import { supabaseGenerateStore } from '../src/plan-generate';
import { validateVoice } from '../src/validator';
import { fakeSupabase } from './helpers/fake-supabase';

test("athleteLocalToday uses the newest activity's UTC offset, not the server's day", () => {
  // 03:00 UTC on Oct 29 is still Oct 28 in Los Angeles (UTC-7 in October).
  const now = Date.UTC(2026, 9, 29, 3, 0);
  const la = [
    { start_date: '2026-10-20T14:00:00Z', utc_offset: 3600 }, // older, other zone
    { start_date: '2026-10-28T14:00:00Z', utc_offset: -25200 },
  ];
  assert.equal(athleteLocalToday(la, now), '2026-10-28');
  assert.equal(athleteLocalToday([], now), '2026-10-29', 'no activities: UTC');
  assert.equal(athleteLocalToday([{ start_date: 'not a date', utc_offset: -25200 }], now), '2026-10-29', 'unparseable starts are ignored');
});

test('postureEvidence: only the fired rule, only met clauses with values, one driver per metric', () => {
  const clause = (driver: string, met: boolean, value: number | null) => ({ driver, met, value });
  const result: any = {
    rule: 'r1',
    reasoning: [
      { rule: 'r0', evidence: [clause('days_since_long_effort', true, 9)] },
      { rule: 'r1', evidence: [clause('days_since_long_effort', true, 3), clause('days_since_long_effort', true, 3), clause('days_since_long_effort', false, 5), clause('unknown_driver', true, 1), clause('days_since_long_effort', true, null)] },
    ],
  };
  assert.deepEqual(postureEvidence(result), [{ metric: 'Days since long effort', value: '3' }]);
  assert.deepEqual(postureEvidence({ ...result, rule: 'default' }), []);
  assert.deepEqual(postureEvidence({ ...result, rule: 'missing' }), []);
});

test('withTimeout passes a fast result through and rejects a slow one', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(() => r(1), 200)), 20), /timed out after 20 ms/);
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 50), /boom/);
});

test('displacedReasonText names both sessions by weekday and stays observational', () => {
  const text = displacedReasonText(
    { type: 'moved', from: '2026-11-03', facts: { workout_intensity: 'tempo' } } as any,
    { scheduled_date: '2026-11-05', planned_intensity: 'easy' } as any,
  );
  assert.equal(text, "Thursday's easy run gives way to Tuesday's tempo.");
  assert.deepEqual(validateVoice(text, []).bannedHits, []);
});

test('writtenMinutes reads minutes, hours, clock and h+m forms, not paces', () => {
  assert.deepEqual(writtenMinutes('45 min tempo').sort(), [45]);
  assert.ok(writtenMinutes('long run 1:30').includes(90));
  assert.ok(writtenMinutes('1h30 easy').includes(90));
  assert.ok(writtenMinutes('2 hours steady').includes(120));
  assert.equal(writtenMinutes('6 x 800 at 4:30/km').includes(270), false, 'a pace is not a duration');
});

test('writtenDistances: km and miles; capital M is miles, small m is metres', () => {
  assert.deepEqual(writtenDistances('10 km easy'), { km: [10], mi: [] });
  assert.deepEqual(writtenDistances('6M easy'), { km: [], mi: [6] });
  assert.deepEqual(writtenDistances('8x400m'), { km: [], mi: [] });
  assert.deepEqual(writtenDistances('13.1 miles'), { km: [], mi: [13.1] });
});

test('writtenMinutes: h:mm:ss, paces in min/mi and zones are not durations', () => {
  assert.ok(writtenMinutes('Sun: long run 1:05:00').includes(65));
  assert.deepEqual(writtenMinutes('5 mi at 7:30 min/mi'), []);
  assert.deepEqual(writtenMinutes('40 min easy, Z2 HR'), [40]);
  assert.deepEqual(writtenMinutes('3x8 min at threshold'), [8]);
});

test('unit numbers right after a colon, comma or period still count', () => {
  assert.deepEqual(writtenMinutes('WU:10 min, Tempo:20min'), [10, 20]);
  assert.deepEqual(writtenDistances('Long run:16km'), { km: [16], mi: [] });
  assert.deepEqual(writtenDistances('8km,10km'), { km: [8, 10], mi: [] });
  assert.deepEqual(writtenMinutes('Run 5k.10 min cooldown'), [10]);
});

test('writtenDistances: race paces and all-caps words are not distances', () => {
  assert.deepEqual(writtenDistances('Tue: 6x800m at 5k pace'), { km: [], mi: [] });
  assert.deepEqual(writtenDistances('10 mi at half marathon pace, 1M pace finish'), { km: [], mi: [10] });
  assert.deepEqual(writtenDistances('TUE: 45 MIN TEMPO'), { km: [], mi: [] });
  assert.deepEqual(writtenDistances('SAT: 6M EASY'), { km: [], mi: [6] });
});

test('dataValues collects measures and skips names and dates', () => {
  const data = { name: 'Morning Run', date: '2026-10-28', dow: 'Wed', km: 10.2, splits: [{ pace: '5:01' }, 42] };
  assert.deepEqual(dataValues(data), ['10.2', '5:01', '42']);
});

test('supabaseGenerateStore: coach check and one RPC per plan, errors named', async () => {
  const sb = fakeSupabase([{ data: [{ id: 'p' }] }, { data: 'plan-1' }]);
  const store = supabaseGenerateStore(sb);
  assert.equal(await store.hasActiveCoachPlan('a1'), true);
  assert.equal(await store.createPlan({ athlete_id: 'a1' } as any), 'plan-1');
  assert.deepEqual(sb.queries[1], { table: 'rpc:create_scora_plan', calls: [['rpc', { p: { athlete_id: 'a1' } }]] });
  const failing = fakeSupabase([{ error: { message: 'down' } }]);
  await assert.rejects(supabaseGenerateStore(failing).hasActiveCoachPlan('a1'), /Load coach plan: down/);
});
