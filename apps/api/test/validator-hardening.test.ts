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
