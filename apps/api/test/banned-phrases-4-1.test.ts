import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVoice } from '../src/validator';

// CLAUDE.md §4.1, item by item: every listed voice-level ban is caught, and
// the §4.2 allowances (descriptive "rest day", third-person and marketplace
// "coach") pass. No drivers, and no numbers in any line, so a hit here is a
// banned-phrase hit and never a driver-existence miss.

const hits = (s: string) => validateVoice(s, []).bannedHits;

const BANNED: [string, string][] = [
  // "coach" in first-person self-reference
  ["I'm your coach and the body is settled.", 'coach self-reference'],
  ['I am your coach this morning.', 'coach self-reference'],
  ['As your coach, the read is steady.', 'coach self-reference'],
  ["I'm your running coach.", 'coach self-reference'],
  ["I'm a coach that reads the record.", 'coach self-reference'],
  ['I am an endurance coach.', 'coach self-reference'],
  ['SCORA is your coach today.', 'coach self-reference'],
  ["I'm coaching you through this block.", 'coach self-reference'],
  ['As your coach, I read a settled body.', 'coach self-reference'],
  ['As your running coach I see the load holding.', 'coach self-reference'],
  ['Your AI coach sees a settled body.', 'ai coach'],
  // "you should" / "you need to" / "you must"
  ['You should hold back.', 'you should'],
  ['You need to sleep more.', 'you need to'],
  ['You must ease off.', 'you must'],
  // "do an easy" / "do a hard" / "run a" / "go for a"
  ['Do an easy spin.', 'workout imperative'],
  ['Do a hard session.', 'workout imperative'],
  ['Run a tempo today.', 'workout imperative'],
  ['Go for a long run.', 'workout imperative'],
  // authority surrender
  ['Does that sound right?', 'authority surrender'],
  ['Let me know if that resonates.', 'authority surrender'],
  // sycophantic flip
  ['Good catch.', 'sycophantic flip'],
  ["You're right, I undersold the load.", 'sycophantic flip'],
  // "as an AI" / "I'm just an AI"
  ['As an AI, the read is steady.', 'as an ai'],
  ["I'm just an AI.", 'just an ai'],
  // anti-coach
  ['This is smarter than your coach.', 'anti-coach'],
  ['This is better than your coach.', 'anti-coach'],
  ['It can replace your coach.', 'anti-coach'],
  // clinical claims
  ['Nothing medical shows in the record.', 'clinical claim'],
  ['The record cannot diagnose a cause.', 'clinical claim'],
  ['The record does not prescribe.', 'clinical claim'],
  // "rest day" as an imperative
  ['Take a rest day.', 'rest-day imperative'],
  ['Make today a rest day.', 'rest-day imperative'],
  // fitness-bro language
  ['Crush it.', 'hype'],
  ['Smash today.', 'hype'],
  ["Let's go.", 'hype'],
  ['Beast mode.', 'hype'],
];

for (const [line, label] of BANNED) {
  test(`§4.1 bans: ${JSON.stringify(line)} -> ${label}`, () => {
    assert.ok(hits(line).includes(label), `expected "${label}", got [${hits(line).join(', ')}]`);
  });
}

const ALLOWED = [
  // descriptive "rest day"
  'Most coaches would call this a rest day.',
  'Your plan has a rest day scheduled Sunday.',
  'Yesterday was a rest day, and the body is settled.',
  // third-person and marketplace "coach" (§4.2)
  'Most coaches would read this week as settled.',
  'Your coach: Sarah Jones.',
  'Your coach wrote a note this week.',
  'Your coach has the long run on Saturday.',
  // Coach tier: the athlete's real coach as the subject (second pass, 2026-11-01)
  "Your coach's plan has a long run Saturday.",
  'Sarah has been coaching you through this build, and the body is settled.',
  'As your coach planned it, the long run is Saturday.',
  'As your coach wrote, the tempo sits on Wednesday.',
  // history, not orders
  'Your last long run a week ago held steady.',
  'The body is settled this morning.',
];

for (const line of ALLOWED) {
  test(`§4.2 allows: ${JSON.stringify(line)}`, () => {
    const r = validateVoice(line, []);
    assert.deepEqual(r.bannedHits, []);
    assert.equal(r.ok, true);
  });
}
