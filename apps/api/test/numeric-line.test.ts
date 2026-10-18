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
