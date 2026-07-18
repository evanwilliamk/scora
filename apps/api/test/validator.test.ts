import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVoice, buildFallbackVoice, Driver } from '../src/validator';

const drivers: Driver[] = [
  { metric: 'Load', value: '208 min', trend: '+84% wk' },
  { metric: 'Weekly volume', value: '24.9 mi', trend: '+92% wk' },
  { metric: 'Peak avg HR', value: '165 bpm', trend: '7:15/mi' },
  { metric: 'HRV', value: '52ms', trend: '+8% wk' },
];

test('clean, fully-backed read passes', () => {
  const voice =
    'Load is climbing at 208 minutes, up 84 percent on the week. HRV sits at 52ms, up 8 percent. Volume reached 24.9 miles and the hardest session averaged 165 bpm.';
  const r = validateVoice(voice, drivers);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('driver-existence: unbacked number is caught', () => {
  const r = validateVoice('You covered 300 miles and HRV was 52ms.', drivers);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unbackedNumbers, ['300']);
});

test('driver-existence: decimals, percentages, and times all match their drivers', () => {
  // 24.9 (decimal), 84 (percent), 7:15 -> 7 and 15 (time), all present in drivers
  const r = validateVoice('Volume 24.9 mi, load up 84%, pace 7:15 per mile.', drivers);
  assert.equal(r.unbackedNumbers.length, 0, JSON.stringify(r.unbackedNumbers));
});

test('driver-existence: a number appearing only in a trend counts as backed', () => {
  // 8 appears in HRV trend "+8% wk"
  const r = validateVoice('HRV is up 8 percent.', drivers);
  assert.equal(r.unbackedNumbers.length, 0);
});

const bannedCases: [string, string][] = [
  ['coach self-reference', 'As your coach, I would ease off. Load 208 min.'],
  ['ai coach', 'Your AI coach says HRV 52ms is fine.'],
  ['you should', 'Load 208 min. You should rest.'],
  ['you need to', 'You need to back off. HRV 52ms.'],
  ['you must', 'You must run easy. Volume 24.9 mi.'],
  ['workout imperative', 'Go for a run. HRV 52ms.'],
  ['hype', 'HRV 52ms — great job, keep it up.'],
  ['exclamation', 'HRV is 52ms, strong today.\nLoad 208 min!'],
  ['clinical claim', 'Volume 24.9 mi. I prescribe a rest day.'],
  ['rest-day imperative', 'Load 208 min. Take a rest day.'],
  ['authority surrender', 'HRV 52ms. Does that sound right?'],
  ['as an ai', 'As an AI, I read HRV at 52ms.'],
];

for (const [label, voice] of bannedCases) {
  test(`banned phrase caught: ${label}`, () => {
    const r = validateVoice(voice, drivers);
    assert.equal(r.ok, false, `expected banned catch for: ${voice}`);
    assert.ok(r.bannedHits.length > 0);
  });
}

test('emoji is caught', () => {
  const r = validateVoice('HRV 52ms and holding 💪', drivers);
  assert.equal(r.ok, false);
  assert.ok(r.bannedHits.includes('emoji'));
});

test('the word "coach" in a legitimate third-person sense is not over-flagged', () => {
  // §4.2 allows third-person; only self-reference forms are banned.
  const r = validateVoice('Most coaches would call 24.9 miles a solid week.', drivers);
  assert.equal(r.bannedHits.length, 0, JSON.stringify(r.bannedHits));
});

test('fallback voice is itself valid (self-consistency invariant)', () => {
  const fb = buildFallbackVoice(drivers, 'Today');
  const r = validateVoice(fb, drivers);
  assert.equal(r.ok, true, `fallback failed validation: ${fb} -> ${JSON.stringify(r)}`);
});

test('fallback includes every driver value and no banned phrasing', () => {
  const fb = buildFallbackVoice(drivers);
  for (const d of drivers) assert.ok(fb.includes(d.value), `missing ${d.value}`);
  assert.ok(!/!/.test(fb));
});

test('fallback handles no drivers gracefully', () => {
  const fb = buildFallbackVoice([], 'This week');
  assert.ok(fb.length > 0);
  assert.equal(validateVoice(fb, []).ok, true);
});
