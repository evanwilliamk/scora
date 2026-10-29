import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCdvReply, checkCdvWithRetry, parseCdvLines } from '../src/cdv-check';

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

test('parseCdvLines reads the voice and METRIC lines and ignores the CHART line', () => {
  const p = parseCdvLines('18.4 miles this week.\nMETRIC: This week | VALUE: 18.4 mi | TREND: -17%\nMETRIC: Runs | VALUE: 3\nCHART: weekly_miles');
  assert.equal(p.voice, '18.4 miles this week.');
  assert.deepEqual(p.metricLines, [{ metric: 'This week', value: '18.4 mi', trend: '-17%' }, { metric: 'Runs', value: '3' }]);
});

test('one retry with the violations named; a clean second answer is used', async () => {
  const notes: string[] = [];
  const r = await checkCdvWithRetry('About 25 miles this week.\nMETRIC: Runs | VALUE: 3', DATA, 'Week?', async (note) => {
    notes.push(note);
    return '18.4 miles over 3 runs this week.\nMETRIC: Runs | VALUE: 3\nCHART: weekly_miles';
  });
  assert.equal(r.attempts, 2);
  assert.equal(r.checked.fallback, false);
  assert.equal(r.checked.voice, '18.4 miles over 3 runs this week.');
  assert.match(notes[0], /numbers not in the data: 25/);
  assert.match(r.raw, /CHART: weekly_miles/, 'the chart comes from the answer that was used');
});

test('a clean first answer makes no second call; a bad or failed retry falls back', async () => {
  let calls = 0;
  const ok = await checkCdvWithRetry('3 runs this week.', DATA, 'Week?', async () => { calls++; return ''; });
  assert.deepEqual([ok.attempts, calls, ok.checked.fallback], [1, 0, false]);
  const bad = await checkCdvWithRetry('25 miles.\nMETRIC: Runs | VALUE: 3', DATA, 'Week?', async () => '30 miles.\nMETRIC: Runs | VALUE: 3');
  assert.deepEqual([bad.checked.fallback, bad.checked.voice], [true, 'Here: Runs 3.']);
  const failed = await checkCdvWithRetry('25 miles.\nMETRIC: Runs | VALUE: 3', DATA, 'Week?', async () => { throw new Error('OpenAI 500'); });
  assert.deepEqual([failed.checked.fallback, failed.attempts], [true, 2]);
});

// ---- review 2 ----

test('a METRIC name cannot vouch for a number in the voice', () => {
  const r = checkCdvReply('HRV sits at 62 ms.', [{ metric: 'HRV 62 ms', value: '18.4 mi' }], DATA, 'HRV?');
  assert.equal(r.fallback, true);
  assert.deepEqual(r.drivers, [], 'the METRIC line itself cites 62 and is dropped');
});

test('dates and run names in the data do not back numbers', () => {
  const data = { ...DATA, recentRuns: [{ name: 'Lunch Run 21', date: '2026-10-21', miles: 6.2 }] };
  assert.equal(checkCdvReply('HRV is 21 ms.', [], data, 'HRV?').fallback, true);
  assert.equal(checkCdvReply('6.2 miles on your last run.', [], data, 'Last run?').fallback, false);
});

test("a figure asserted in the question is not evidence; a small count is", () => {
  assert.equal(checkCdvReply('You ran 50 miles.', [], DATA, 'Did I run 50 miles?').fallback, true);
  assert.equal(checkCdvReply('Over your last 5 runs, 3 were this week.', [], DATA, 'My last 5 runs?').fallback, false);
});

test('thousands separators read as one number; an empty fallback says the answer was not shown', () => {
  const data = { ...DATA, thisWeek: { ...DATA.thisWeek, elevFt: 1540 } };
  assert.equal(checkCdvReply('1,540 ft of climbing this week.', [], data, 'Hills?').fallback, false);
  const r = checkCdvReply('You ran 99 miles.', [], DATA, 'Week?');
  assert.equal(r.voice, 'That answer could not be checked against your data, so it is not shown.');
});

// ---- review 3 ----

test("a pace's seconds do not vouch for other numbers; the pace itself still passes", () => {
  const data = { ...DATA, recentRuns: [{ miles: 6.2, pace: '8:47' }] };
  assert.equal(checkCdvReply('Your average HR was 47 bpm.', [], data, 'HR?').fallback, true);
  assert.equal(checkCdvReply('Your last run was 6.2 miles at 8:47 per mile.', [], data, 'Pace?').fallback, false);
});

test('only a count the athlete asked about is theirs to repeat, not a figure', () => {
  assert.equal(checkCdvReply('You ran 10 miles Tuesday.', [], DATA, 'Did I run 10 miles Tuesday?').fallback, true);
  assert.equal(checkCdvReply('Across your last 5 runs, 3 were this week.', [], DATA, 'What about my last 5 runs?').fallback, false);
});

test('the chat prompt holds its read under pushback (CLAUDE.md §3.6)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /if the athlete disagrees or pushes back, restate what the data shows and stop\. Never change the read to agree/);
});

test('a clock time never backs a decimal: "HRV 7.12" is not a 7:12 pace (review 10-29)', () => {
  const data = { recentRuns: [{ pace: '7:12', miles: 6.2 }] };
  const bad = checkCdvReply('HRV sits at 7.12 this week.', [], data, 'How is my HRV?');
  assert.equal(bad.fallback, true);
  const good = checkCdvReply('The last run held 7:12 per mile over 6.2 miles.', [], data, 'How was my last run?');
  assert.equal(good.fallback, false);
});
