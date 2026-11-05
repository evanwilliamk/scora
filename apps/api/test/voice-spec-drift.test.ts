// One test per drift fix from the voice audit against doc 08, doc 06 and
// CLAUDE.md §3 (docs/voice-spec-audit.md). All mocks.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';
import { buildFallbackVoice, validateVoice, type Driver } from '../src/validator';
import { buildDashboard, buildWeeklySummary, usableRecovery } from '../src/metrics';
import { computeDriverRecord } from '../src/drivers';
import { composeDoorbell, expansionReply, whyPrompt } from '../src/whatsapp';
import { checkCdvReply } from '../src/cdv-check';
import { citesDriver, openAiReasonLlm, reasonPrompt, writeReason } from '../src/adaptation-reason';
import { reasonText } from '../src/plan-adapt';
import { knowledgeForRead } from '../src/knowledge-retrieval';

blankEnv();

let app: any;
let rest: FakeRest;
let guard: FetchGuard;
before(async () => {
  rest = await fakeRest();
  guard = installFetchGuard(rest.url);
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  app = (await import('../src/index')).default;
  await app.ready();
});
after(async () => {
  await app.close();
  guard.restore();
  await rest.close();
});
beforeEach(() => {
  rest.reset();
  guard.reset();
});

const DAY = 86_400_000;
const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const run = (daysAgo: number, mins: number) => {
  const at = new Date(now - daysAgo * DAY).toISOString();
  return { type: 'Run', sport_type: 'Run', start_date: at, start_date_local: at, distance: mins * 170, moving_time: mins * 60, elapsed_time: mins * 60, average_heartrate: 140 };
};
const connected = () => rest.answer('athletes', {
  body: [{ strava_access_token: 'tok-a1', strava_refresh_token: 'ref-a1', strava_expires_at: Math.floor(now / 1000) + 3600 }],
});
const post = (url: string) => app.inject({ method: 'POST', url, payload: { athleteId: '42', today } });
const llm = () => guard.calls.filter((c) => c.host === 'api.openai.com');
const CONNECTED = { strava: true, oura: true, healthKit: false };

// Doc 08 §3.2, §12.2, §12.3.
test('daily read prompt and call match doc 08: 2-4 sentences, temperature 0.6, 250 tokens', async () => {
  connected();
  guard.stravaActivities([run(1, 50), run(3, 50)]);
  guard.openAi('Training has been even this week. Nothing in the record stands out.');
  assert.equal((await post('/api/read')).statusCode, 200);
  const { body } = llm()[0];
  assert.match(body.messages[0].content, /OUTPUT: 2-4 sentences/);
  assert.equal(body.temperature, 0.6);
  assert.equal(body.max_tokens, 250);
});

// Doc 08 §4.2, §12.2, §12.3.
test('weekly read prompt and call match doc 08: 3-5 sentences, temperature 0.7, 400 tokens', async () => {
  connected();
  guard.stravaActivities([run(1, 50), run(3, 50)]);
  guard.openAi('The week held its shape. Two days of running. Nothing else in the record.');
  assert.equal((await post('/api/weekly')).statusCode, 200);
  const { body } = llm()[0];
  assert.match(body.messages[0].content, /OUTPUT: 3-5 sentences/);
  assert.equal(body.temperature, 0.7);
  assert.equal(body.max_tokens, 400);
});

// The weekly read is given no posture, so naming one has no driver (§3.2).
test('weekly read: the prompt offers no posture, and a draft naming one falls back', async () => {
  connected();
  guard.stravaActivities([run(1, 50), run(3, 50)]);
  guard.openAi('The week reads primed.', 'Your posture is steady this week.');
  const r = await post('/api/weekly');
  assert.equal(r.statusCode, 200);
  assert.doesNotMatch(llm()[0].body.messages[0].content, /You may name a posture/);
  assert.equal(llm().length, 2);
  assert.match(r.json().read.voice, /^This week: /);
});

// The same guard the read and the card have (§3.2).
test('why and more replies may name only the decided posture', async () => {
  const drivers: Driver[] = [{ metric: 'HRV', value: '38ms', trend: '-9% wk' }];
  guard.openAi('HRV at 38ms reads primed.', 'The body is primed at 38ms.');
  assert.match(await expansionReply('why', 'read', 'back-off', drivers), /^Behind today's read: HRV 38ms/);
  guard.reset();
  guard.openAi('HRV at 38ms shows the back-off posture.');
  assert.equal(await expansionReply('why', 'read', 'back-off', drivers), 'HRV at 38ms shows the back-off posture.');
});

test('why and more prompts leave out the posture line when none was decided', () => {
  assert.doesNotMatch(whyPrompt('read', '', []).userPrompt, /POSTURE/);
  assert.match(whyPrompt('read', 'rest', []).userPrompt, /TODAY'S POSTURE: rest posture/);
});

// §3.2: "If a sentence references a driver that doesn't exist".
test('driver existence: a claim about a measure the record does not have is stopped, numbers or not', () => {
  const load: Driver[] = [{ metric: 'Load', value: '412 min' }];
  for (const [line, kind] of [
    ['HRV is climbing this morning.', 'HRV'],
    ['Sleep held for the second night.', 'sleep'],
    ['You slept well.', 'sleep'],
    ['Resting heart rate is back where it sits.', 'resting HR'],
    ['Your Oura score looks good.', 'Oura'],
  ]) {
    const r = validateVoice(line, load);
    assert.equal(r.ok, false, line);
    assert.deepEqual(r.unbackedClaims, [kind], line);
    assert.deepEqual(r.bannedHits, [], 'a driver check, not a banned phrase');
  }
  const all: Driver[] = [{ metric: 'Sleep', value: '7:12', trend: 'Oura 84' }, { metric: 'HRV', value: '52ms' }, { metric: 'Resting HR', value: '48 bpm' }];
  for (const line of ['HRV is climbing.', 'Sleep held.', 'Resting heart rate is flat.', 'Oura reads well.']) {
    assert.equal(validateVoice(line, all).ok, true, line);
  }
  // Saying the data is absent is not a claim (§3.6, and the chat prompt asks for it).
  for (const line of ['There is no sleep data yet.', "HRV isn't in the record.", 'Without HRV, load is what there is to read.']) {
    assert.equal(validateVoice(line, load).ok, true, line);
  }
});

test('driver existence: a direction in words beside the name must agree with the driver', () => {
  const down: Driver[] = [{ metric: 'HRV', value: '30ms', trend: '-8% wk' }, { metric: 'Load', value: '412 min', trend: '+12% wk' }];
  for (const line of ['HRV is climbing.', 'HRV is up this morning.', 'Load is down this week.', 'Load is falling.']) {
    assert.equal(validateVoice(line, down).ok, false, line);
  }
  for (const line of ['HRV is down.', 'Load is up.', 'HRV has come down with it.', 'Load dropped the week before.', 'Load is up and HRV is lower.']) {
    assert.equal(validateVoice(line, down).ok, true, line);
  }
  assert.equal(validateVoice('HRV is up.', [{ metric: 'HRV', value: '30ms', trend: '+0% wk' }]).ok, true, 'zero has no direction');
});

test('a claim no driver backs goes back to the model named, then falls back', async () => {
  const { generateValidatedVoice } = await import('../src/voice');
  guard.openAi('HRV is climbing.', 'Sleep is holding.');
  const r = await generateValidatedVoice({ systemPrompt: 's', userPrompt: 'u', drivers: [{ metric: 'Load', value: '412 min' }] });
  assert.equal(r.usedFallback, true);
  assert.equal(r.voice, 'Where things sit: Load 412 min.');
  assert.match(llm()[1].body.messages[1].content, /claims no driver backs \(HRV\)/);
});

test('the chat: a measure not in the data block is stopped; one in it passes; saying it is absent passes', () => {
  const data = { miles: 18.4 };
  assert.equal(checkCdvReply('HRV is climbing.', [], data, 'q').fallback, true);
  assert.equal(checkCdvReply('HRV is climbing.', [], { hrv: 52 }, 'q').fallback, false);
  assert.equal(checkCdvReply('Sleep is not in the data, and the week sits at 18.4 miles.', [], data, 'q').fallback, false);
});

test('the chat names no posture, as its prompt says', () => {
  assert.equal(checkCdvReply('The body reads primed at 18.4 miles.', [], { miles: 18.4 }, 'q').fallback, true);
});

test('an unfilled slot, or a value that never existed, is stopped by the validator', () => {
  for (const line of ['{{days_to_race}} days out.', 'HRV is undefined.', 'Sleep NaN:NaN.', 'Load is Infinity.', 'Load [object Object].']) {
    assert.ok(validateVoice(line, [{ metric: 'HRV', value: '1' }, { metric: 'Sleep', value: '1:01' }]).bannedHits.includes('unfilled template'), line);
  }
});

// Doc 06 §4.2, §4.3.
test('doc 06 bans reach the validator', () => {
  for (const line of ['You should think about the week.', 'Consider whether the tempo fits.', 'In my experience this passes.', 'If I were you I would wait.',
    'Do this workout.', "Today's workout should be easy.", 'Move this to tomorrow.']) {
    assert.ok(validateVoice(line, []).bannedHits.length > 0, line);
  }
  for (const line of ["Today's workout is tempo.", 'The plan calls for a rest day.', 'Most coaches would call this a rest morning.', "Today's tempo was moved to Wednesday."]) {
    assert.deepEqual(validateVoice(line, []).bannedHits, [], line);
  }
});

// The pattern's "{{long_distance_km}}k" against a plan in miles.
test('a distance in k is not backed by the same number in miles', () => {
  assert.equal(validateVoice("Today's 13.1k long.", [{ metric: 'Plan today', value: 'long, 13.1 mi' }]).ok, false);
  assert.equal(validateVoice("Today's 21k long.", [{ metric: 'Plan today', value: 'long, 21 km' }]).ok, true);
  assert.equal(validateVoice('The 13.1 mi long.', [{ metric: 'Plan today', value: 'long, 13.1 mi' }]).ok, true);
});

test('fallback: a driver value that is its own sentence gets one period', () => {
  const v = buildFallbackVoice([{ metric: 'Plan change', value: "Tuesday's tempo moved to Thursday." }, { metric: 'Load', value: '5 min' }]);
  assert.equal(v, "Where things sit: Plan change Tuesday's tempo moved to Thursday. Load 5 min.");
  assert.equal(buildFallbackVoice([{ metric: 'Plan change', value: 'Moved.' }]), 'Where things sit: Plan change Moved.');
});

test('the doorbell: a line that already says Today: is not labelled twice', () => {
  const m = composeDoorbell({ numbers: 'Load 5', voice: 'Settled.', today: 'Today: 45-minute tempo.', link: 'L', drivers: [] });
  assert.equal(m, 'Load 5\n\nSettled.\n\nToday: 45-minute tempo.\n\nFull read: L');
});

// A zero is a device with no reading: same floor as the HealthKit values.
test('a recovery reading of 0 is no reading: no driver, no card value, no posture', () => {
  const zero = { sleepSeconds: 0, sleepScore: 0, hrvMs: 0, restingHr: 0, readinessScore: null, hrvWeekAvgMs: 50, sleepScoreHistory: [80, 80, 80, 80, 80, 80, 80] } as any;
  assert.deepEqual(usableRecovery(null), null);
  const d = buildDashboard([], CONNECTED, zero, 'Oura', today);
  assert.deepEqual(d.drivers, []);
  assert.equal(d.cards.find((c) => c.id === 'sleep')!.cta, 'No sleep recorded last night.');
  assert.equal(d.cards.find((c) => c.id === 'recovery_signal')!.cta, 'No HRV recorded last night.');
  const record = computeDriverRecord([], zero, { localToday: today }).drivers;
  assert.equal(record.hrv_7d_avg_delta, null, 'never -100% from a 0');
  assert.equal(record.sleep_last_night_score, null);
  assert.equal(record.sleep_7d_avg_delta, null);
  const w = buildWeeklySummary([run(1, 50)], zero, today).drivers.map((x) => x.metric);
  assert.ok(!w.includes('HRV') && !w.includes('Sleep (last night)'));
});

test('runs with no recorded distance name no longest run', () => {
  const noMiles = { ...run(2, 45), distance: 0 };
  const d = buildDashboard([noMiles], CONNECTED, null, 'Oura', today);
  const card = d.cards.find((c) => c.id === 'long_effort')!;
  assert.equal(card.available, false);
  assert.equal(card.cta, 'No run distance recorded in the last 30 days.');
  assert.ok(!d.drivers.some((x) => x.metric === 'Longest run (30d)'));
  assert.ok(!buildWeeklySummary([noMiles], null, today).drivers.some((x) => x.metric === 'Long run'));
  assert.equal(buildDashboard([], CONNECTED, null, 'Oura', today).cards.find((c) => c.id === 'long_effort')!.cta, 'No runs in the last 30 days.');
});

// Doc 08 §10.
const downgrade = {
  type: 'downgraded', from_intensity: 'tempo', to_intensity: 'endurance', duration_min: 1, reason_code: 'posture_backoff_tempo_scheduled',
  facts: { posture: 'back-off', workout_date: '2026-11-03', workout_intensity: 'tempo', workout_duration_min: 1 },
} as any;

test('adaptation reason: one minute is singular, in the prompt and the fixed sentence', () => {
  assert.match(reasonText(downgrade), /at the same 1 minute\./);
  assert.match(reasonPrompt(downgrade, []).user, /same 1 minute\./);
});

test('adaptation reason: a model line must cite a driver value when there is one (doc 08 §10.4)', async () => {
  const evidence: Driver[] = [{ metric: 'HRV vs week', value: '-12%' }];
  const noNumber = "Tuesday's tempo is now endurance. The body is carrying load.";
  const withNumber = "Tuesday's tempo is now endurance. HRV is 12% under your week.";
  const fixed = reasonText(downgrade);
  const none = await writeReason(downgrade, evidence, async () => noNumber, fixed);
  assert.equal(none.source, 'fallback');
  assert.deepEqual(none.issues, ['cites no driver']);
  assert.equal(none.finalOk, true, 'the fixed sentence still stands in');
  const cited = await writeReason(downgrade, evidence, async () => withNumber, fixed);
  assert.equal(cited.source, 'llm');
  assert.equal((await writeReason(downgrade, [{ metric: 'Race within 7 days', value: 'yes' }], async () => noNumber, fixed)).source, 'llm', 'no number to cite');
  assert.equal(citesDriver('at 12%', evidence), true);
  assert.equal(citesDriver('at 112%', evidence), false);
});

test('adaptation reason call matches doc 08: temperature 0.4, 100 tokens', async () => {
  let sent: any;
  const fake = (async (_u: unknown, init: any) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }));
  }) as typeof fetch;
  await openAiReasonLlm('k', fake)('s', 'u');
  assert.equal(sent.temperature, 0.4);
  assert.equal(sent.max_tokens, 100);
});

// Doc 06 §7.
test("a pattern's numeric slots are named in the prompt", async () => {
  const k = await knowledgeForRead(
    { posture: 'back-off', drivers: { acwr: 1.5, hrv_7d_avg_delta: -9, consecutive_hard_days: 2 }, completeness: 1, scheduled: { planned_intensity: 'tempo' }, sleepSeconds: 24_000 },
    { enabled: false },
  );
  assert.equal(k.pattern?.id, 'plan-says-hard-body-says-back-off-v1');
  assert.match(k.promptBlock, /Numbers this read shows when DRIVERS has them: sleep_hours_minutes, hrv_pct_change\./);
});
