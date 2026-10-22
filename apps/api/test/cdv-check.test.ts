import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCdvReply } from '../src/cdv-check';

// Shaped like the CDV data block in index.ts. Test input only.
const DATA = {
  thisWeek: { miles: 18.4, runs: 3 },
  lastWeek: { miles: 22.1, runs: 4 },
  weekOverWeekMiles: '-17%',
  recentRuns: [{ date: '2026-10-21', miles: 6.2, min: 52 }],
  weekdayPatterns: [{ weekday: 'Thursday', weeksSeen: '4/6', avgMiles: 9, avgMin: 90 }],
};

test('a reply whose numbers are all in the data passes untouched', () => {
  const r = checkCdvReply(
    '18.4 miles over 3 runs this week, down 17% from 22.1 last week.',
    [{ metric: 'This week', value: '18.4 mi', trend: '-17%' }, { metric: 'Runs', value: '3', trend: 'steady' }],
    DATA, 'How is my week going?',
  );
  assert.equal(r.fallback, false);
  assert.equal(r.drivers.length, 2);
});

test('an invented number falls back, even when the model also invented a METRIC line for it', () => {
  const r = checkCdvReply(
    'You have run 25 miles this week, your biggest in 8 weeks.',
    [{ metric: 'This week', value: '25 mi' }, { metric: 'Runs', value: '3' }],
    DATA, 'How is my week going?',
  );
  assert.equal(r.fallback, true);
  assert.deepEqual(r.unbackedNumbers.sort(), ['25', '8']);
  assert.deepEqual(r.drivers, [{ metric: 'Runs', value: '3' }], 'the invented METRIC line is dropped');
  assert.equal(r.voice, 'Here: Runs 3.');
});

test("numbers from the athlete's own question are theirs to repeat", () => {
  const r = checkCdvReply('Over your last 5 runs the pattern holds: Thursday is the long one, 9 miles in 4/6 weeks.', [], DATA, 'What about my last 5 runs?');
  assert.equal(r.fallback, false);
});

test('banned phrasing still falls back, and posture-only trends need no numbers', () => {
  const r = checkCdvReply('You should run 9 miles today.', [{ metric: 'Thursday', value: '9 mi', trend: 'primed' }], DATA, 'Thursday?');
  assert.equal(r.fallback, true);
  assert.ok(r.bannedHits.includes('you should'));
  assert.equal(r.drivers.length, 1);
});
