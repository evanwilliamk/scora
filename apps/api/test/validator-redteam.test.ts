// Red-team corpus for the voice validators (CLAUDE.md §1, §3, §4). Past the
// literal §4.1 list (banned-phrases-4-1.test.ts): realistic LLM paraphrases and
// typography that must be caught, and legal sentences near each rule that must
// pass. A false catch silently swaps a read for the fallback, so a must-pass
// table sits beside each must-catch table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVoice, type Driver } from '../src/validator';
import { checkCdvReply } from '../src/cdv-check';
import { loadPatterns } from '../../../packages/voice/src/loader';
import { fillTemplate, templateSlots } from '../../../packages/voice/src/render';

// Free tier: nothing on a plan. Every number used below is backed, so a catch
// here is always a phrase catch.
const FREE: Driver[] = [
  { metric: 'Sleep (last night)', value: '7:12' },
  { metric: 'HRV', value: '52ms', trend: '+8% wk' },
  { metric: 'Load', value: '412 min', trend: '+12% wk' },
  { metric: 'Last run', value: '45 min' },
];
const PLAN: Driver[] = [...FREE, { metric: 'Plan today', value: 'tempo, 45 min' }];

// Collects every miss so one run shows the whole table.
function mustCatch(lines: string[], drivers: Driver[]) {
  const missed = lines.filter((s) => validateVoice(s, drivers).bannedHits.length === 0);
  assert.equal(missed.length, 0, `passed the validator:\n${missed.join('\n')}`);
}
function mustPass(lines: string[], drivers: Driver[]) {
  const caught = lines
    .map((s) => ({ s, r: validateVoice(s, drivers) }))
    .filter(({ r }) => !r.ok)
    .map(({ s, r }) => `${s} (${[...r.bannedHits, ...r.unbackedNumbers].join(', ')})`);
  assert.equal(caught.length, 0, `false catch:\n${caught.join('\n')}`);
}
const catchBoth = (lines: string[]) => { mustCatch(lines, FREE); mustCatch(lines, PLAN); };
const passBoth = (lines: string[]) => { mustPass(lines, FREE); mustPass(lines, PLAN); };

const TABLES: { name: string; caught: string[]; legal: string[] }[] = [
  {
    name: 'first-person advice',
    caught: [
      "I'd keep today easy.",
      'I would keep today easy.',
      'With sleep this short I would keep today easy.',
      "I'd go easy today.",
      "I'd probably skip the tempo.",
      'I would back off.',
      'If I were you, I would rest.',
      "I'd take the day off.",
      'I recommend an easy day.',
      "I'd suggest a shorter run.",
      'I would encourage you to rest.',
      'My advice is to rest.',
      'My recommendation: an easy day.',
      'We should back off.',
      "Let's keep it easy.",
      "Let's dial it back today.",
      "Let's back off.",
    ],
    legal: [
      "I'd call this a settled morning.",
      'I would read this as a settled body.',
      "I'd keep this read: sleep held and HRV is climbing.",
      "I'd consider this a settled week.",
      "Let's move on to sleep: 7:12.",
      "Let's look at the week: load is up 12%.",
      'Most coaches would call this a rest day.',
      'The read does not recommend anything.',
    ],
  },
  {
    name: 'advice as an assessment of the day',
    caught: [
      'Today is a good day to back off.',
      "Today's a good day to rest.",
      'Your best bet is rest.',
      'Your best bet is an easy day.',
      'Your best option today is rest.',
      'The smart move is to rest.',
      'The right call today is an easy run.',
      'Rest is the right call today.',
      'Easy is the way to go.',
      'A shorter run makes sense today.',
      'An easy day makes sense.',
      'Today should be easy.',
      'The run should stay easy.',
      'Today should be a rest day.',
      'Today needs to be easy.',
      'Tomorrow ought to be easy.',
      'Today calls for rest.',
      'Today calls for an easy effort.',
      'A rest day would do you good.',
      'An easy run would be ideal.',
      '45 minutes would be plenty.',
      'A shorter run would be better.',
      "A rest day wouldn't hurt.",
      'Rest would serve you well today.',
      'It would be wise to back off.',
      'It might be wise to rest.',
      'Better to rest today.',
      'Probably best to rest.',
    ],
    legal: [
      'The plan calls for tempo today.',
      'Your plan calls for a long run Saturday, and your recovery is trending up.',
      'Saturday was a good day to run long, and the record shows it.',
      'That was a great week to be sleeping well.',
      'HRV is the best to date.',
      "Saturday's run was the best of the week.",
      "The plan's aim for this block is base.",
      'A call worth thinking about consciously.',
      'The rest day did what rest days do.',
      'The plan made the right call on Tuesday.',
      'HRV makes sense given the load.',
      'The rest of the week would be fine on this sleep.',
      'It took a long time to recover: HRV is only now up 8%.',
      'The move on Tuesday made room in the week.',
      'Sleep should show up in HRV by Friday.',
      'The run should be in Strava by now.',
      'Sleep this short would be enough to explain the dip.',
    ],
  },
  {
    name: 'second-person advice',
    caught: [
      'You really should rest.',
      'You probably should back off.',
      "You shouldn't run today.",
      "You mustn't push today.",
      'You probably need to rest.',
      "You'll need to back off.",
      "You'd want to keep it short.",
      'You will want to keep it short.',
      "You'd better rest.",
      'You would benefit from an easy day.',
      "You'd benefit from a rest day.",
      'You may benefit from a shorter run.',
      "You're better off resting today.",
      "You'd be better off skipping it.",
      "You'd do well to rest.",
      "You'd be wise to back off.",
      'You can skip the tempo.',
      'You can afford to back off.',
      'You can take it easy today.',
      "You don't need to run today.",
      "You don't have to push today.",
      'You could try a shorter run.',
    ],
    legal: [
      'You ran easy on Tuesday, and the load shows it.',
      'You kept it easy on Tuesday.',
      'You took a rest day on Monday.',
      'You have a rest day scheduled Sunday.',
      "You'll come to it fresh.",
      "You're two nights of thin sleep in.",
      'You can see it in the chart: HRV is up 8%.',
      'You can move between weeks in the chart.',
      'You want to know where load sits: 412 min.',
      "You don't need the chart to see it: HRV is up 8%.",
      'You did run a tempo on Tuesday.',
    ],
  },
  {
    name: 'softened and impersonal suggestions',
    caught: [
      'Consider skipping.',
      "Consider skipping today's tempo.",
      'Consider shortening the run.',
      'Consider postponing the tempo.',
      'Consider dropping the intervals.',
      'You might consider rest.',
      'Worth backing off today.',
      'It is worth keeping today easy.',
      'Might be worth cutting the run short.',
      'Why not take it easy.',
      'How about a shorter run?',
      'Perhaps an easy jog.',
      'Maybe keep it short today.',
      'Maybe go easy.',
      'Perhaps take the day off.',
      'Feel free to skip it.',
      "It's okay to skip today.",
      "It's fine to rest today.",
      'There is no need to push today.',
      "There's no shame in skipping.",
    ],
    legal: [
      'Sarah sent you a note yesterday, worth a look before today.',
      'Worth noting: HRV is up 8%.',
      'HRV is worth watching this week.',
      'Worth keeping an eye on the sleep trend.',
      'Most coaches would consider a rest day here.',
      'Considering the load, HRV is holding up.',
      'The tempo is worth thinking about.',
      "It's fine: load is where it should be.",
      'Maybe the most telling number is HRV.',
      'Perhaps the clearest sign is sleep.',
    ],
  },
  {
    name: 'imperatives the first pass missed',
    caught: [
      'Try a shorter run.',
      'Aim for 45 minutes.',
      'Shoot for 45 minutes.',
      'Target 45 minutes.',
      'Cap it at 45 minutes.',
      'Limit today to 45 minutes.',
      'Keep the run easy.',
      'Keep this one short.',
      'Keep tomorrow light.',
      'Keep your run short.',
      'Run for 45 minutes.',
      'Ride for 45 minutes.',
      'Ride 30 minutes.',
      'Swim 20 minutes.',
      'Add 10 minutes.',
      'Walk today.',
      'Hold back today.',
      'Pull back today.',
      'Dial it back.',
      'Sit this one out.',
      'Shorten the run.',
      'Cut the run short.',
      'Cut today short.',
      'Swap the tempo for an easy run.',
      'Drop the intervals.',
      'Give yourself a rest day.',
      'Give yourself the day off.',
      'Listen to your body and rest.',
      'Listen to your body.',
      'Prioritize recovery today.',
      'Prioritise sleep tonight.',
      'Focus on recovery today.',
      'Stick to zone 2.',
      'Stick to easy running today.',
      'Get some rest.',
      'Get more sleep.',
      'Get to bed early tonight.',
      'Get out for an easy run.',
      'Add some strides.',
      'Throw in some strides.',
      'Be sure to rest.',
      'Remember to keep the effort low.',
      'Do not push today.',
      'Do not run today.',
      "Don't do the tempo.",
      "Don't train today.",
      'Push through it.',
      'Sleep was short so go easy today.',
      'Sleep was short so take it easy.',
      'Sleep is short - keep the effort low.',
      "It's time to rest.",
      'Time to back off.',
      'Bottom line: go easy today.',
      'The takeaway: keep it easy.',
      'My read: take the day off.',
      'Please rest today.',
    ],
    legal: [
      'Take a look at the HRV chart: it is up 8%.',
      'Start with sleep: 7:12, the second night it held.',
      'Run tempo was steady on Tuesday.',
      'Run volume is where it was last week.',
      'Plan today: run tempo.',
      'The plan says rest today, and the body is cashing the check.',
      'Rest today is on your plan.',
      'Keep in mind that load is up 12%.',
      'The run you did Tuesday carried most of the load.',
      "Tuesday's run went long.",
      'Your last long run a week ago still shows in the load.',
      'Your 45 min run a day after the tempo held up.',
      'Sleep held, and so did HRV.',
      'Hold on to that: HRV is up 8%.',
      'Sleep came first, and the rest followed.',
      'A long way to go: the race is on the plan.',
      'Add up the week and load is 412 min.',
      "Let's run through the week: load is up 12%.",
      'I would stay with this read: load is up 12%.',
      'The rest of the week is on the plan.',
      'Focus shows up in the sleep, not the load.',
      'Getting more sleep moved HRV: up 8%.',
      'You got more sleep, and HRV is up 8%.',
      'Drop in load: 412 min on the week, up 12% before it.',
      'A long time to wait: 45 min felt longer.',
      'Bottom line: HRV is up 8%.',
      'The takeaway: sleep is holding.',
      'My read: the body is settled.',
    ],
  },
  {
    name: 'coach self-reference',
    caught: [
      'Your AI running coach sees a settled body.',
      'As your A.I. coach, the read is steady.',
      "I'm your A.I. coach.",
      'As an A.I., the read is steady.',
      'Your virtual coach sees a settled body.',
      'Your digital coach sees a settled body.',
      "I'm your trainer.",
      'I am your personal trainer.',
      'As your trainer, the read is steady.',
      'Think of me as your coach.',
      'Consider me your coach.',
      "I'll coach you through this block.",
      'I coach you through the block.',
      "I'm here to coach you.",
      'SCORA coaches you through the block.',
      'Coach here.',
      'My coaching read is steady.',
    ],
    legal: [
      'Your coach set the tempo for today.',
      'As your coach planned it, the tempo is today.',
      'Sarah has been coaching you since March.',
      "Sarah's note is on the plan.",
      'Most coaches would call this a rest day.',
      'A coach would call this a settled week.',
      "Your coach's plan calls for tempo today.",
      "Your trainer's note is on the plan.",
    ],
  },
  {
    name: 'flipping on pushback',
    caught: [
      "You're right.",
      'You are right, I undersold it.',
      "You're right about the load.",
      "You're right that the load was fine.",
      'Good point.',
      "That's a fair point.",
      'You make a good point.',
      'You have a point.',
      'Fair enough.',
      'Point taken.',
      'Great catch.',
      'Nice catch.',
      'I stand corrected.',
      'My mistake.',
      'My apologies.',
      'I apologize.',
      'Sorry, I missed that.',
      'I was wrong.',
      'I got that wrong.',
      'I undersold the load.',
      'I overstated the load.',
      'I misread the week.',
      'Let me revise that.',
      'Let me reconsider.',
      'On second thought, the load is fine.',
      'I take that back.',
      'Now that you mention it, the load is fine.',
      "You've convinced me.",
      'You know your body best.',
      'You know your body better than the data.',
      'What do you think?',
      'Does that make sense?',
      'How does that sound?',
      'Sound good?',
      'Does that feel right?',
      'Does that track?',
    ],
    legal: [
      "You're right where the plan expects: 412 min.",
      "You're right at the top of your range.",
      'You are right on the line with load.',
      'This is a good point in the block to read sleep.',
      'A fair point of comparison is last week.',
      'The record says the same thing it said this morning.',
      'The read does not move: load is up 12%.',
      'The data does not show that.',
      'The plan was right about Tuesday.',
      'Sorry state of sleep: 7:12.',
      'The catch is the load: up 12%.',
      'The mistake would be reading one night as a trend.',
      'Your body shows it: HRV is up 8%.',
    ],
  },
  {
    name: 'clinical claims',
    caught: [
      'This could be a sign of overtraining.',
      'These are signs of overtraining syndrome.',
      'You may be getting sick.',
      'You might be coming down with something.',
      'HRV this low can mean your body is fighting something.',
      'Your body may be fighting off an infection.',
      'HRV suggests an illness.',
      'This pattern indicates an injury.',
      "You're overtrained.",
      'You are likely anemic.',
      'This looks like sleep apnea.',
      'You have insomnia.',
      'That is a stress fracture pattern.',
      'A symptom of too much load.',
    ],
    legal: [
      'HRV is up 8%, and the body is settled.',
      'The body is stubborn this week.',
      'Nothing in the record explains the dip.',
      'The body is fighting through nothing: load is steady.',
      'Sleep has been short for two nights.',
      'Illness is marked on your plan this week.',
      'The sign is in the sleep: 7:12 held.',
      'Signs of a settled body: sleep held and HRV is climbing.',
    ],
  },
  {
    name: 'fitness-bro language',
    caught: [
      'You got this.',
      'You have got this.',
      "Let's get after it.",
      'Get after it.',
      "Let's do this.",
      "Let's gooo.",
      'LFG.',
      'Crushing the week.',
      'You crushed the tempo.',
      "You're killing it.",
      'Kill it today.',
      "You're on fire.",
      "You're a beast.",
      'Great work.',
      'Nice job.',
      'Way to go.',
      'Awesome week.',
      'No excuses.',
      'No pain, no gain.',
      'Go get it.',
      'You dominated the block.',
    ],
    legal: [
      'A week of quality work.',
      'Easy runs dominated the week.',
      'No pain flagged in your notes, and load is steady.',
      'The taper did a good job on load.',
      'Good sleep, and a good week of work.',
      'The taper is doing what it is supposed to.',
      'Load fell away, and sleep came back.',
    ],
  },
];

for (const t of TABLES) {
  test(`must catch, with or without a plan: ${t.name}`, () => catchBoth(t.caught));
  test(`must pass, with or without a plan: ${t.name}`, () => passBoth(t.legal));
}

test('must catch: typography, casing and markup never hide a ban', () => {
  catchBoth([
    'YOU SHOULD REST.',
    'yOu ShOuLd ReSt.',
    'GO EASY TODAY.',
    "I'M YOUR COACH.",
    'I’D KEEP TODAY EASY.',
    'You\u200B should rest.',
    'You sh\u00ADould rest.',
    'pre\u00ADscribe',
    'c\u200Boach here.',
    'You sh\u0301ould rest.',
    '𝐘𝐨𝐮 𝐬𝐡𝐨𝐮𝐥𝐝 𝐫𝐞𝐬𝐭.',
    'Ｙｏｕ ｓｈｏｕｌｄ ｒｅｓｔ.',
    'Yоu shоuld rest.', // Cyrillic o
    'Your AI\u2011coach sees a settled body.',
    'Your AI\u2013coach sees a settled body.',
    'Beast\u2013mode week.',
    '**Go easy today.**',
    '*Go easy today.*',
    '_Go easy today._',
    '"Go easy today."',
    '“Go easy today.”',
    'Sleep was short. "Go easy today."',
    'You **should** rest.',
    '**You should** rest.',
    '- Go easy today.',
    '• Go easy today.',
    '1. Go easy today.',
    'Sleep was short\nGo easy today',
    'HRV is up 8%\n\nTake the day off',
    '(Go easy today.)',
    '\u2014Go easy today.',
    'Sleep was short…go easy today.',
  ]);
});

test('must pass: markup and line breaks do not make a legal read look like an order', () => {
  passBoth([
    '**HRV** is up 8%, and *sleep* held.',
    'Your [HRV] is up 8% over the last week.',
    'The plan says "rest" on Sunday.',
    'Sleep 7:12 · HRV 52ms (+8% wk) · Load 412\n\nBody is settled. Sleep held and HRV is climbing.',
    'Sleep held.\nHRV is up 8%.',
    '- Sleep held.\n- HRV is up 8%.',
    'Résumé of the week: load is up 12%.',
  ]);
});

test('must catch with a plan on the calendar: talking the athlete out of it', () => {
  mustCatch([
    'The tempo can wait.',
    "Today's tempo can wait until Thursday.",
    'Hold off on the tempo.',
    'Thursday works better for the tempo.',
    'The tempo fits better on Thursday.',
    'The tempo would land better on Thursday.',
    'Thursday suits the tempo better.',
    "Today isn't the day for the tempo.",
    'Today is not the day for tempo.',
    'Today may not be the day for the tempo.',
    "Today's tempo looks like too much.",
    'The tempo is too much today.',
    'Set the plan aside today.',
    'Ignore the plan today.',
    'Forget the plan.',
    "Don't follow the plan today.",
    "The plan is wrong today.",
    'Trade the tempo for an easy run.',
    "Replace today's tempo with an easy run.",
    'Bump the tempo to Thursday.',
    'Drop the tempo.',
    'An easy run instead of the tempo.',
    'Tempo today is optional.',
    // The engine made no change today, so none of this happened.
    "Today's tempo was moved to Wednesday.",
    'The tempo has been moved to Wednesday.',
    "Today's tempo moved to Wednesday.",
  ], PLAN);
});

test('must pass with a plan on the calendar: naming the tension is the voice', () => {
  mustPass([
    "Today's tempo is on your plan, and your body is settled. The plan reads cleanly this morning.",
    'Your plan calls for a long run Saturday, and your recovery is trending up. You will come to it fresh.',
    "You're two nights of thin sleep in, and HRV is trending up. The plan calls for tempo intervals today, a call worth thinking about.",
    'Today is the day for the tempo on your plan.',
    "HRV climbed instead of falling, up 8% on the week.",
    'Sleep held at 7:12 instead of dropping.',
    'Sleep shortened for a second night.',
    'Sleep has shortened all week.',
    'You skipped nothing this week.',
    "You skipped yesterday's tempo, and today's tempo is on the plan.",
    "Yesterday's tempo was skipped, and today's tempo is on the plan.",
    'The plan fits the week: sleep held and load is up 12%.',
    "Today's tempo sits on a rested system.",
    'The plan shifted yesterday to give the body a day.',
    'The tempo moved the load: up 12%.',
    'Load dropped the week before.',
  ], PLAN);
});

const CHANGED: Driver[] = [
  { metric: 'Sleep (last night)', value: '5.5 h' },
  { metric: 'Plan today', value: 'easy run, 40 min' },
  { metric: 'Plan change', value: "Today's tempo moved to Wednesday because of short sleep." },
];

test('must pass: observing an adaptation the plan engine made (§1.3)', () => {
  mustPass([
    "Today's tempo was moved to Wednesday because you slept 5.5 hours Monday. Body and plan will align better.",
    "Today's tempo moved to Wednesday.",
    'The plan moved the tempo to Wednesday.',
    'The tempo has been moved to Wednesday.',
  ], CHANGED);
  // The stored reason's first sentence, quoted (plan-adapt.ts reasonText).
  mustPass([
    "Tuesday's intervals moved to Thursday.",
    "Tuesday's intervals moved to Thursday, and the plan reads cleanly this morning.",
  ], [{ metric: 'Plan today', value: 'rest' }, { metric: 'Plan change', value: "Tuesday's intervals moved to Thursday." }]);
});

test('must catch: an observed adaptation does not license a different day or advice', () => {
  mustCatch([
    "Today's tempo was moved to Friday.",
    'Move the tempo to Wednesday.',
    'You should move the tempo to Wednesday.',
    'Skip the tempo.',
    "Today's tempo could move to Wednesday.",
  ], CHANGED);
});

test('must pass: every shipped pattern, rendered with plausible slot values', () => {
  const values: Record<string, string | number> = {
    coach_name: 'Sarah',
    'scheduled_workout.planned_intensity': 'tempo',
    yesterday_workout_planned_intensity: 'tempo',
  };
  const entries = loadPatterns();
  assert.ok(entries.length >= 12);
  for (const e of entries) {
    const slots: Record<string, string | number> = {};
    for (const k of templateSlots(e.template)) slots[k] = values[k] ?? 7;
    const text = fillTemplate(e.template, slots).text;
    const nums = (text.match(/\d+/g) ?? []).join(' ');
    const drivers: Driver[] = [{ metric: 'Slots', value: nums }, { metric: 'Plan today', value: 'tempo' }];
    const r = validateVoice(text, drivers);
    assert.deepEqual(r.bannedHits, [], `${e.id}: ${text}`);
  }
});

test('the chat surface inherits the catches, and the fallback stays clean', () => {
  const data = { hrv: 52, minutes: 45 };
  for (const line of ['I would keep today easy.', '**Go easy today.**', 'Your best bet is rest.', "You're right about the load."]) {
    const r = checkCdvReply(line, [{ metric: 'HRV', value: '52' }], data, 'how am I doing?');
    assert.equal(r.fallback, true, line);
    assert.equal(r.finalOk, true, line);
  }
  const ok = checkCdvReply('HRV sits at 52, and the last run was 45 min.', [{ metric: 'HRV', value: '52' }], data, 'how am I doing?');
  assert.equal(ok.fallback, false);
});

test('a METRIC line cannot smuggle advice past the chat check', () => {
  const r = checkCdvReply('HRV sits at 52.', [{ metric: 'Your best bet is rest', value: '52' }, { metric: 'HRV', value: '52' }], { hrv: 52 }, 'how am I doing?');
  assert.deepEqual(r.drivers, [{ metric: 'HRV', value: '52' }]);
});
