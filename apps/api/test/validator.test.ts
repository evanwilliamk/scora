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

// Parity with CLAUDE.md §4.1: one phrasing per ban, plus the descriptive
// sentences the bans must not catch (history, third-person "coach").
test('every §4.1 ban is caught, and history is not mistaken for an order', () => {
  const banned = [
    'Go for an easy run today.', 'Run an easy 30 this morning.', 'Run a tempo today.', 'Today, run an easy 30.',
    'Do an easy spin.', 'Take a rest day.', 'Make today a rest day.', 'Have a rest day tomorrow.',
    'SCORA is smarter than your coach.', 'This is better than a coach.', 'SCORA can replace your coach.',
    "I'm your coach.", 'As your AI coach, I see it.', 'You should sleep more.', 'You need to slow down.', 'You must rest.',
    "Let's go.", 'Crush it today.', 'Smash today.', 'Beast mode.', 'Does that sound right?', 'Let me know if that resonates.',
    'Good catch.', "You're right, I undersold it.", 'As an AI, I cannot know.', "I'm just an AI.", 'This is not medical advice.',
    // Review: clause-opening commands.
    'Run tempo today.', 'Run 30 easy minutes.', 'Go run easy today.', 'Go out for a run.', 'Go easy today.', 'Do a tempo.',
    'Take the day off.', 'Try a 30 minute run.', 'Hit the track today.', 'Sleep was short, so keep it easy.',
    // Review 3.
    'Body is settled \u2014 go easy today.', '(go easy today)', 'Stay easy today.', 'Skip the tempo.', 'Rest today.',
    'Ride easy today.', 'Start with an easy run.', 'Just go easy today.', 'Today, have a rest day.',
    // Review 5: catch-up and cut-back advice.
    'So next week you could make up the gap.', 'You fell behind the plan.', 'Make up the missing minutes next week.', 'Cut back on Thursday.',
  ];
  for (const v of banned) assert.ok(validateVoice(v, []).bannedHits.length > 0, `missed: ${v}`);
  const allowed = [
    'Your last long run a week ago was 18 km.', 'The long run a week ago set the tone.',
    'Easy run a day after the race is in the plan.', 'Most coaches would call this a rest day.',
    'Your coach, Sarah, wrote a note this week.',
    // Review: plan-referencing and questions are descriptive.
    'The plan has you run a tempo Thursday.', 'You have a rest day scheduled Sunday.',
    'Run totals are up for the week.', "Today's plan: easy run at 45 min.", 'Going into the weekend, load is steady.',
    // Review 3: nouns and idioms at the start of a clause.
    'Take last week: 3 runs.', 'Keep in mind the long run is Saturday.', 'Go back to Tuesday and sleep was 7:12.',
    'Hit rate on your intervals held.', 'Plan today: run tempo.', 'Rest days sit on Monday and Friday.',
  ];
  for (const v of allowed) assert.deepEqual(validateVoice(v, [{ metric: 'Long run', value: '18 km' }]).bannedHits, [], v);
});

// ---- digits in driver names (review) ----

test('driver-existence: a digit inside a driver NAME backs nothing', () => {
  const named: Driver[] = [
    { metric: 'Load (7d)', value: '412 min' },
    { metric: 'Race within 7 days', value: 'yes' },
    { metric: 'HRV (28d)', value: '52ms' },
  ];
  const r = validateVoice('Sleep came in at 7 hours of sleep and HRV is 52ms.', named);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.deepEqual(r.unbackedNumbers, ['7']);
  assert.deepEqual(validateVoice('HRV has held for 28 nights.', named).unbackedNumbers, ['28']);
  assert.deepEqual(validateVoice('Seven hours of sleep.', [{ metric: 'Load (7d)', value: '412 min' }]).unbackedNumbers, ['Seven hours']);
});

test('driver-existence: the window a driver name states may be quoted as a window', () => {
  const named: Driver[] = [
    { metric: 'Load (7d)', value: '412 min' },
    { metric: 'HRV vs 7-day', value: '-12%' },
    { metric: 'Plan, last 7 full days', value: '135 of 190 planned run min' },
  ];
  for (const v of ['Load over 7 days is 412 min.', 'Load (7d) sits at 412 min.', 'HRV is 12% under the 7-day average.', 'Across the last 7 full days, 135 of 190 planned run min.']) {
    assert.deepEqual(validateVoice(v, named).unbackedNumbers, [], v);
  }
  // A window no driver names is not backed: "28 days" with only a 7d window.
  assert.deepEqual(validateVoice('Load over 28 days is 412 min.', named).unbackedNumbers, ['28']);
  // The fallback quotes driver names verbatim and must still validate.
  const fb = buildFallbackVoice([...named, { metric: 'Race within 7 days', value: 'yes' }]);
  assert.equal(validateVoice(fb, [...named, { metric: 'Race within 7 days', value: 'yes' }]).ok, true, fb);
});
