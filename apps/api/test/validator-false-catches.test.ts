// Second pass over the 2026-11-04 bans. Each line here is a plain reading of
// the record that a ban caught, which swaps a good read for the fallback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVoice } from '../src/validator';

const planDriver = [{ metric: 'Plan today', value: 'tempo' }];
const clean = (text: string, drivers: { metric: string; value: string }[] = []) =>
  assert.deepEqual(validateVoice(text, drivers).bannedHits, [], text);
const caught = (text: string, drivers: { metric: string; value: string }[] = []) =>
  assert.notDeepEqual(validateVoice(text, drivers).bannedHits, [], text);

test('time to recover is a fact about the body, not an order', () => {
  clean('Your body had time to recover after the block.');
  clean('HRV takes time to recover after a hard week.');
  clean('Three easy days gave the body time to recover.');
  clean('Sleep needs time to rest the system.');
  clean('There was plenty of time to recover between sessions.');
  caught('Time to rest.');
  caught("It's time to back off.");
  caught('Time to recover now.');
});

test('the plan calling for an easy day is the plan, not the voice', () => {
  clean('Your plan for today calls for an easy run, and the body is settled.');
  clean('The plan today calls for rest, and the numbers agree.');
  clean('Your plan for tomorrow calls for a recovery run.');
  caught('Today calls for rest.');
  caught('Tomorrow calls for an easy run.');
});

test('right about means roughly, not agreement', () => {
  clean("You're right about where you were last week.");
  clean("You're right about at your four-week average.");
  caught("You're right about the tempo.");
  caught("You're right about that.");
});

test('the plan engine having made the right call stays allowed', () => {
  clean('The plan made the right call this morning.');
  clean('The engine made the right call today.');
  caught('The right call today is rest.');
});

test('getting something is not an illness', () => {
  clean("You're getting something back from the rest.");
  caught("You're getting sick.");
  caught('You may be fighting something.');
  caught('You may be coming down with something.');
});

test('worth noting is not an offer of a different session', () => {
  clean("That's worth taking note of.");
  clean("It's worth keeping the trend in view.");
  clean("It's worth holding onto that context.");
  caught('Worth taking a day.');
  caught('Worth keeping the run short.');
  caught('Worth holding back.');
});

test('explaining a number with an easy or short thing is not advice', () => {
  clean('A short night would help explain the HRV dip.');
  clean('The easy week would help explain why HRV rose.');
  clean('It was a short night, and that makes sense.');
  clean('HRV is down after a short night, which makes sense.');
  clean('The easy week makes sense of the HRV rise.');
  clean('Perhaps a short night explains the dip.');
  caught('An easy day would help.');
  caught('A shorter run makes sense.');
  caught('Rest makes sense today.');
  caught('Perhaps a short run.');
});

test('reading guidance and looking back are not training advice', () => {
  clean('No need to read much into one night.');
  clean('Better to read this as a blip than a trend.');
  clean('You have to go back six weeks to find a load like this.');
  clean('You have to look back a month for this HRV.');
  caught('No need to run today.');
  caught('Better to rest.');
  caught('You have to run easy.');
});

test('so do the numbers, and a target beside its number, are not commands', () => {
  clean('When sleep climbs, so do the numbers.');
  clean('Load 412, target 420.', [{ metric: 'Load', value: '412, target 420' }]);
  caught('Body is settled, so do the tempo.');
  caught('Target 420 today.', [{ metric: 'Load', value: '420' }]);
});

test('with a plan today: a drop is a noun, and a skipped session can be history', () => {
  clean('Sleep dropped, and the drop the week before was smaller.', planDriver);
  clean('The dip is the same size as the drop the last time you raced.', planDriver);
  clean('The bump the last two nights is small.', planDriver);
  clean("You've skipped two sessions this week.", planDriver);
  clean('You have skipped two sessions this week.', planDriver);
  clean('Instead of a dip, HRV held.', planDriver);
  caught('Drop the tempo.', planDriver);
  caught('Instead of the tempo, an easy run.', planDriver);
  caught('The tempo should be skipped.', planDriver);
});
