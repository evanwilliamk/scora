import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotCache, planCardExpansion, relatedDrivers } from '../src/card-expand';
import { buildDashboard } from '../src/metrics';
import { validateVoice } from '../src/validator';
import type { OuraSummary } from '../src/oura';

const now = Date.now();
const day = 86400000;
const run = (daysAgo: number, meters: number, secs: number, hr?: number) => ({
  type: 'Run',
  start_date: new Date(now - daysAgo * day).toISOString(),
  start_date_local: new Date(now - daysAgo * day).toISOString(),
  distance: meters,
  moving_time: secs,
  average_heartrate: hr,
});
const activities = [run(2, 10000, 2700, 165), run(4, 8000, 2600, 140), run(6, 22000, 7200, 150), run(9, 9000, 2900, 138)];
const oura: OuraSummary = {
  sleepSeconds: 7 * 3600 + 12 * 60, sleepScore: 84, hrvMs: 52, restingHr: 48, readinessScore: 80, hrvWeekAvgMs: 48,
};

const withOura = buildDashboard(activities, { strava: true, oura: true, healthKit: false }, oura);
const noOura = buildDashboard(activities, { strava: true, oura: false, healthKit: false }, null);
const snap = (d = withOura, posture: string | null = 'steady') => ({ cards: d.cards, drivers: d.drivers, posture, at: now });
const card = (d: typeof withOura, id: string) => d.cards.find((c) => c.id === id)!;

test('snapshot cache expires after its TTL and evicts the oldest at capacity', () => {
  const c = new SnapshotCache(1000, 2);
  c.set('a', { cards: [], drivers: [], posture: null }, 0);
  assert.ok(c.get('a', 999));
  assert.equal(c.get('a', 1001), null);

  c.set('a', { cards: [], drivers: [], posture: null }, 0);
  c.set('b', { cards: [], drivers: [], posture: null }, 0);
  c.set('c', { cards: [], drivers: [], posture: null }, 0);
  assert.equal(c.get('a', 1), null);
  assert.ok(c.get('b', 1));
  assert.ok(c.get('c', 1));
});

test('related drivers put the card metric first and skip missing ones', () => {
  assert.deepEqual(relatedDrivers('recovery_signal', withOura.drivers).map((d) => d.metric), ['HRV', 'Resting HR', 'Sleep', 'Load']);
  assert.deepEqual(relatedDrivers('training_load', noOura.drivers).map((d) => d.metric), ['Load', 'Weekly volume', 'Peak avg HR (7d)', 'Long effort']);
  assert.deepEqual(relatedDrivers('connections', withOura.drivers), []);
});

test('an unavailable card answers with its own prompt, no LLM', () => {
  const plan = planCardExpansion(card(noOura, 'sleep'), snap(noOura));
  assert.equal(plan.kind, 'static');
  assert.match((plan as any).reply, /Connect Oura or Apple Health/);
});

test('the connections card is not interpreted by the LLM', () => {
  const plan = planCardExpansion(card(withOura, 'connections'), snap());
  assert.deepEqual(plan, { kind: 'static', reply: 'Connected: Strava, Oura.' });
});

test('an available card builds a non-prescriptive prompt with only related drivers and the posture', () => {
  const plan = planCardExpansion(card(withOura, 'sleep'), snap(withOura, 'back-off'));
  assert.equal(plan.kind, 'llm');
  if (plan.kind !== 'llm') return;
  assert.deepEqual(plan.drivers.map((d) => d.metric), ['Sleep', 'HRV', 'Resting HR', 'Load']);
  assert.match(plan.userPrompt, /^CARD: Sleep: 7:12 hrs \(Oura 84\), from Oura/);
  assert.match(plan.userPrompt, /POSTURE \(decided by SCORA's rules\): back-off/);
  assert.doesNotMatch(plan.userPrompt, /Weekly volume/);
  assert.match(plan.systemPrompt, /never prescribe/);
  // The prompt itself would pass the banned-phrase check if echoed (quoted bans aside).
  const echoed = plan.userPrompt;
  assert.deepEqual(validateVoice(echoed, plan.drivers).bannedHits, []);
});

test('no posture line when the read had none', () => {
  const plan = planCardExpansion(card(withOura, 'training_load'), snap(withOura, null));
  assert.equal(plan.kind, 'llm');
  if (plan.kind === 'llm') assert.doesNotMatch(plan.userPrompt, /POSTURE/);
});

test('the validator rejects an expansion that invents a number', () => {
  const plan = planCardExpansion(card(withOura, 'recovery_signal'), snap());
  if (plan.kind !== 'llm') throw new Error('expected llm plan');
  assert.equal(validateVoice('HRV 52ms sits above the week, resting HR 48 bpm.', plan.drivers).ok, true);
  assert.equal(validateVoice('HRV 61ms is the highest this month.', plan.drivers).ok, false);
});
