// Probes from the 2026-10-29 adversarial review of validateVoice: drafts that
// used to pass and must not, and legitimate reads that must keep passing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVoice, normalizeForCheck } from '../src/validator';

const drivers = [
  { metric: 'Sleep (last night)', value: '7:12' },
  { metric: 'HRV', value: '52ms', trend: '+8% wk' },
  { metric: 'Load', value: '412 min', trend: '+12% wk' },
  { metric: 'Plan today', value: 'tempo, 45 min' },
];
const fails = (s: string) => assert.equal(validateVoice(s, drivers).ok, false, `passed: ${s}`);
const passes = (s: string) => {
  const r = validateVoice(s, drivers);
  assert.equal(r.ok, true, `rejected: ${s} (${[...r.bannedHits, ...r.unbackedNumbers].join(', ')})`);
};

test('typography never hides a ban: curly apostrophes, doubled and non-breaking spaces', () => {
  for (const s of ['I’m your coach.', 'I’m just an AI.', 'You’re right, I undersold it.', 'Let’s go.', 'Go  easy today.', 'Go easy today.', 'You  should rest.', 'you should rest.', 'Do  an easy one.']) fails(s);
});

test('advice in other words is still advice', () => {
  for (const s of [
    'Aim for 45 minutes.', 'Consider a rest day.', "It's a good day to run long.", "You'll want to stay aerobic.", 'You might go easy.',
    'Make sure to sleep early.', 'Best to keep the effort low.', 'You ought to rest.', 'You have to rest.', 'Back off today.', 'Swim easy.',
    'Do intervals.', 'Keep the effort low.', "Don't push today.", 'Avoid intensity today.', 'Stay in zone two.', 'Move the tempo to Wednesday.',
  ]) fails(s);
});

test('plan overrides without the old trigger verbs', () => {
  for (const s of ["Today's tempo would be better on Wednesday.", 'Wednesday is the better fit for the tempo.', 'Keep the tempo under 45 min.']) fails(s);
});

test('coach, AI and surrender variants', () => {
  for (const s of ['Your coach here.', 'Coaching you through it.', 'As your AI-coach.', 'I am your training coach.', 'You may be right.', 'Fair point.', 'I could be wrong.', 'Does that sound fair?', 'Let me know what you think.', "I'm an AI.", 'Prescription: easy.']) fails(s);
});

test('numbers the old check could not see', () => {
  for (const s of ['Sleep came in at six hours.', 'HRV is fifty-one.', 'HRV is ninety-nine.', 'HRV ９９ms.', 'HRV ٩٩ms.', 'Load is up by ½.']) fails(s);
  // A word number that is a driver value is backed.
  passes('HRV is fifty-two now, up 8% on the week.');
});

test('hype and exclamation variants', () => {
  for (const s of ['Smashed it this week.', 'Beast-mode week.', 'Settled morning！', '¡Settled morning.', 'Nailed it.']) fails(s);
});

test('legitimate reads keep passing', () => {
  for (const s of [
    'Most coaches would call this a rest day.',
    'Sunday is a rest day on your plan.',
    'Saturday’s run was long.',
    'A run of good nights: sleep held at 7:12 for the second night.',
    'HRV is 52ms, up 8% on the week, and load is 412 min.',
    'Today’s tempo is on your plan, and the body is settled. The plan reads cleanly this morning.',
    'Two nights in a row of steady sleep, and HRV is climbing.',
    'Posture reads back-off: load is up 12% on the week.',
  ]) passes(s);
});

test('normalizeForCheck folds typography only', () => {
  assert.equal(normalizeForCheck('I’m  here now ９'), "I'm here now 9");
});

test('a driver number with the wrong unit or direction is not backed (review 10-29)', () => {
  for (const s of ['HRV 52 bpm this morning.', 'Load is 412 mi.', 'HRV is 52ms, down 8% on the week.', 'Load fell 12% on the week.']) fails(s);
  for (const s of [
    'HRV 52 ms, up 8% on the week.',
    'Load is 412 minutes, 12 percent higher than last week.',
    'Load is up 12% while HRV is 52ms.',
    'Sleep held at 7:12, and HRV rose 8%.',
    'Load 412, up 12% on the week.',
  ]) passes(s);
  // A driver number stated with no unit (a score) may take any unit word.
  assert.equal(validateVoice('Readiness is 84 points.', [{ metric: 'Readiness', value: '84' }]).ok, true);
});

test('descriptive weekly and chat phrasing passes (review 2, 10-29)', () => {
  const d = [
    { metric: 'HRV', value: '52ms', trend: '+8% wk' },
    { metric: 'Weekly volume', value: '22.4 mi', trend: '-8% wk' },
    { metric: 'Sleep (last night)', value: '7:12' },
    { metric: 'Load', value: '412 min', trend: '-6% wk' },
    { metric: 'Pace', value: '8:30/mi' },
    { metric: 'Plan today', value: 'tempo, 45 min' },
  ];
  for (const s of [
    'Easy runs make up the bulk of the week.',
    'Volume cut back 6% this week.',
    'Sleep fell behind on two nights.',
    'Next week you start the taper.',
    'You were able to hold the pace at 8:30/mi.',
    'Your heart rate did stay in zone two.',
    "You don't run the tempo until Wednesday.",
    'Most coaches would consider a rest day here.',
    'Load is down 8%.',
    'The +8% HRV reads as the body settling down.',
    'Sleep was 7 hours 12 minutes.',
    'Sleep ran just over one hour longer than Monday.',
    'Rest today is on your plan.',
    "Yesterday's tempo was skipped, and today's 45 min tempo is still on the plan.",
  ]) {
    const r = validateVoice(s, d);
    assert.equal(r.ok, true, `rejected: ${s} (${[...r.bannedHits, ...r.unbackedNumbers].join(', ')})`);
  }
});

test('a plan change observation may mention context days (review 2, 10-29)', () => {
  const d = [{ metric: 'Plan today', value: 'easy run 40 min' }, { metric: 'Plan change', value: "Tuesday's tempo moved to Wednesday." }];
  assert.deepEqual(validateVoice('The plan moved the tempo to Wednesday after a short Monday night.', d).bannedHits, []);
  assert.ok(validateVoice('The plan moved the tempo to Friday after a short Monday night.', d).bannedHits.includes('plan override'));
});
