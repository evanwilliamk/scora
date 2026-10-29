import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numericLine, pushBody } from '../src/numeric-line';

test('the PRD example line, from the drivers as metrics.ts builds them', () => {
  const line = numericLine([
    { metric: 'Load', value: '412 min', trend: '+5% wk' },
    { metric: 'Sleep', value: '7:12', trend: 'Oura 84' },
    { metric: 'HRV', value: '52ms', trend: '+8% wk' },
    { metric: 'Peak avg HR (7d)', value: '161 bpm' },
  ]);
  assert.equal(line, 'Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412');
});

test('missing data is left out, never filled in', () => {
  assert.equal(numericLine([{ metric: 'Load', value: '95 min', trend: '-40% wk' }]), 'Load 95');
  assert.equal(numericLine([{ metric: 'Sleep', value: '6:40' }, { metric: 'HRV', value: '48ms' }]), 'Sleep 6:40 · HRV 48ms');
  assert.equal(numericLine([]), '');
});

test('push body: numbers on the first line, the read below, trimmed', () => {
  assert.equal(pushBody('Load 412', 'Body is  settled.\nLoad is steady.'), 'Load 412\nBody is settled. Load is steady.');
  const long = pushBody('Sleep 7:12 · Load 412', 'x'.repeat(300));
  assert.equal(long.length, 178);
  assert.ok(long.startsWith('Sleep 7:12 · Load 412\n') && long.endsWith('…'));
  assert.equal(pushBody('', 'Plain.'), 'Plain.');
});

test('HRV with no week average shows no trend, never "n/a" (review 4)', () => {
  assert.equal(numericLine([{ metric: 'HRV', value: '52ms', trend: 'n/a wk' }]), 'HRV 52ms');
  assert.equal(numericLine([{ metric: 'HRV', value: '52ms', trend: '-12% wk' }]), 'HRV 52ms (-12% wk)');
});

test('pushBody keeps the Today line whole; the voice gives way to it', () => {
  const today = 'Today: 45-minute tempo. 10 minutes easy, 25 minutes at tempo, 10 minutes easy.';
  const short = pushBody('Load 412', 'Body is settled.', 178, today);
  assert.equal(short, `Load 412\nBody is settled.\n${today}`);
  const long = pushBody('Sleep 7:12 · Load 412', 'y'.repeat(300), 178, today);
  assert.ok(long.length <= 178);
  assert.ok(long.endsWith(`…\n${today}`));
  assert.ok(long.startsWith('Sleep 7:12 · Load 412\n'));
});

test('pushBody: a long Today line is trimmed so the read keeps room (review)', () => {
  const today = 'Today: ' + 'z'.repeat(200);
  const body = pushBody('Sleep 7:12 · Load 412', 'Body is settled and HRV is climbing for the second night.', 178, today);
  assert.ok(body.length <= 178, `length ${body.length}`);
  const [nums, voice, line] = body.split('\n');
  assert.equal(nums, 'Sleep 7:12 · Load 412');
  assert.equal(voice, 'Body is settled and HRV is climbing for the second night.', 'a short voice is kept whole');
  assert.ok(line.startsWith('Today: ') && line.endsWith('…'));
  // A short read is never padded: the Today line takes the room it leaves.
  const short = pushBody('', 'Settled.', 178, 'Today: ' + 'q'.repeat(150));
  assert.equal(short, 'Settled.\nToday: ' + 'q'.repeat(150));
});

test('pushBody: the voice keeps its room however long the numbers line is (review 2)', () => {
  const numbers = 'Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · RHR 48 · Load 412 (+12% wk)';
  const body = pushBody(numbers, 'Body is settled and HRV is climbing for the second night in a row.', 178, 'Today: ' + 'z'.repeat(200));
  assert.ok(body.length <= 178);
  const [, voice, line] = body.split('\n');
  assert.ok(voice.length >= 58, `voice kept ${voice.length}`);
  assert.ok(line.startsWith('Today: '));
  // No room for a useful line: it is left off, never a stub.
  const tight = pushBody(numbers, 'v'.repeat(300), 140, 'Today: 45-minute tempo.');
  assert.equal(tight.split('\n').length, 2);
  assert.ok(tight.length <= 140);
  // Nothing to read: the line alone, no leading newline.
  assert.equal(pushBody('', '', 178, 'Today: 45-minute tempo.'), 'Today: 45-minute tempo.');
});
