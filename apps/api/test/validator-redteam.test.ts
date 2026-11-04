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
    'You\u200B should rest.',
    'You sh\u00ADould rest.',
    'pre\u00ADscribe',
    'You sh\u0301ould rest.',
    '𝐘𝐨𝐮 𝐬𝐡𝐨𝐮𝐥𝐝 𝐫𝐞𝐬𝐭.',
    'Ｙｏｕ ｓｈｏｕｌｄ ｒｅｓｔ.',
    'Yоu shоuld rest.', // Cyrillic o
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
    '—Go easy today.',
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








