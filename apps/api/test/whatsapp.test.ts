import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDoorbell, fixedReply, parseReply, twilioSignature, verifyTwilioSignature, PAUSE_MAX_DAYS } from '../src/whatsapp';

test('the morning message: numbers, read, today, link (CLAUDE.md §3.3)', () => {
  const m = composeDoorbell({
    numbers: 'Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412',
    voice: 'Body is settled.\n  Load is where it should be.',
    today: '45 min tempo · 3 × 8 min at threshold',
    link: 'https://scora.app/r/abc',
    drivers: [],
  });
  assert.equal(m, 'Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412\n\nBody is settled. Load is where it should be.\n\nToday: 45 min tempo · 3 × 8 min at threshold\n\nFull read: https://scora.app/r/abc');
  const noPlan = composeDoorbell({ numbers: 'Sleep 7:12', voice: 'Settled.', today: null, link: 'L', drivers: [] });
  assert.equal(noPlan, 'Sleep 7:12\n\nSettled.\n\nFull read: L');
});

test('replies are a bounded set; anything else gets help', () => {
  assert.deepEqual(parseReply(' Why? '), { cmd: 'why' });
  assert.deepEqual(parseReply('MORE'), { cmd: 'more' });
  assert.deepEqual(parseReply('pause'), { cmd: 'pause', days: 3 });
  assert.deepEqual(parseReply('pause 5'), { cmd: 'pause', days: 5 });
  assert.deepEqual(parseReply('Pause 7 days'), { cmd: 'pause', days: 7 });
  assert.deepEqual(parseReply('pause 0'), { cmd: 'pause', days: 1 });
  assert.deepEqual(parseReply('pause 400'), { cmd: 'pause', days: PAUSE_MAX_DAYS });
  assert.deepEqual(parseReply('resume'), { cmd: 'resume' });
  for (const s of ['STOP', 'stop.', 'Unsubscribe', 'cancel', 'quit', 'end', 'opt out']) assert.deepEqual(parseReply(s), { cmd: 'stop' }, s);
  assert.deepEqual(parseReply('help'), { cmd: 'help' });
  for (const s of ['should I run today?', 'pause for a bit', '', 'end of week was good', 'cancel that']) assert.deepEqual(parseReply(s), { cmd: 'unknown' }, s);
  // Review 5: opting out must never fall through to help.
  for (const s of ['STOP please', 'please stop', 'Stop \u{1F6D1}', 'stop :)', 'STOP ALL', 'opt-out', 'revoke', '\uFF33\uFF34\uFF2F\uFF30', 'stop\u200B', 'stop sending at 6']) {
    assert.deepEqual(parseReply(s), { cmd: 'stop' }, JSON.stringify(s));
  }
});

test('fixed replies name the commands and carry no emoji or exclamation points', () => {
  assert.equal(fixedReply({ cmd: 'pause', days: 1 }), 'Paused for 1 day. Reply resume to start again sooner.');
  assert.match(fixedReply({ cmd: 'stop' })!, /no more WhatsApp messages/);
  assert.equal(fixedReply({ cmd: 'unknown' }), fixedReply({ cmd: 'help' }));
  assert.equal(fixedReply({ cmd: 'why' }), null, 'why comes from the read, not a fixed line');
  for (const c of [{ cmd: 'pause', days: 3 }, { cmd: 'resume' }, { cmd: 'stop' }, { cmd: 'help' }] as const) {
    assert.doesNotMatch(fixedReply(c)!, /!|\p{Extended_Pictographic}/u);
  }
});

test("Twilio signature matches Twilio's documented example and rejects tampering", () => {
  const url = 'https://example.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675310', Digits: '1234', From: '+14158675310', To: '+18005551212' };
  // From twilio.com/docs/usage/security.
  assert.equal(twilioSignature('12345', url, params), 'L/OH5YylLD5NRKLltdqwSvS0BnU=');
  assert.equal(verifyTwilioSignature('12345', url, params, 'L/OH5YylLD5NRKLltdqwSvS0BnU='), true);
  assert.equal(verifyTwilioSignature('12345', url, { ...params, Digits: '9999' }, 'L/OH5YylLD5NRKLltdqwSvS0BnU='), false);
  assert.equal(verifyTwilioSignature('12345', url, params, undefined), false);
  assert.equal(verifyTwilioSignature('', url, params, 'L/OH5YylLD5NRKLltdqwSvS0BnU='), false);
  assert.equal(verifyTwilioSignature('12345', url, params, 'short'), false);
});

test('a repeated parameter signs each of its values', () => {
  const a = twilioSignature('t', 'https://x.test/hook', { MediaUrl: ['b', 'a'], Body: 'hi' });
  const b = twilioSignature('t', 'https://x.test/hook', { Body: 'hi', MediaUrl: ['a', 'b'] });
  assert.equal(a, b);
  assert.notEqual(a, twilioSignature('t', 'https://x.test/hook', { Body: 'hi', MediaUrl: 'a' }));
});

test("why and more prompts carry the read, the posture and only the read's drivers (doc 08 §5, §6)", async () => {
  const { whyPrompt, morePrompt } = await import('../src/whatsapp');
  const drivers = [{ metric: 'HRV', value: '38ms', trend: '-9% wk' }, { metric: 'Sleep', value: '6:42' }];
  const why = whyPrompt('You are two nights of thin sleep in.', 'back-off', drivers);
  assert.equal(why.maxTokens, 100);
  assert.match(why.systemPrompt, /1 or 2 sentences/);
  assert.match(why.systemPrompt, /Never tell the athlete what to do/);
  assert.match(why.userPrompt, /- HRV: 38ms \(-9% wk\)\n- Sleep: 6:42/);
  assert.match(why.userPrompt, /TODAY'S POSTURE: back-off: signs of strain/);
  const more = morePrompt('x', 'steady', []);
  assert.equal(more.maxTokens, 200);
  assert.match(more.systemPrompt, /3 or 4 sentences/);
  assert.match(more.systemPrompt, /say nothing about what comes next/);
  assert.match(more.userPrompt, /- none/);
});

test('a why reply runs through the validators and falls back when it invents a number', async () => {
  const { whyPrompt } = await import('../src/whatsapp');
  const { generateValidatedVoice } = await import('../src/voice');
  const drivers = [{ metric: 'HRV', value: '38ms', trend: '-9% wk' }];
  const p = whyPrompt('read', 'back-off', drivers);
  const drafts = ['HRV at 31ms is the lowest in a month.', 'HRV at 29ms.'];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: drafts.shift() } }] }))) as typeof fetch;
  try {
    const r = await generateValidatedVoice({ ...p, drivers, surface: 'why' });
    assert.equal(r.usedFallback, true);
    assert.match(r.voice, /HRV 38ms \(-9% wk\)/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('review 6: a long read is shortened at a sentence so the message fits Twilio WhatsApp body limit', async () => {
  const { WHATSAPP_MAX_CHARS } = await import('../src/whatsapp');
  const sentence = 'Sleep held for the second night and the week reads settled so far. ';
  const m = composeDoorbell({ numbers: 'Sleep 7:12', voice: sentence.repeat(60), today: '45 min tempo', link: 'https://scora.app/r/abc', drivers: [] });
  assert.ok(m.length <= WHATSAPP_MAX_CHARS, `length ${m.length}`);
  assert.match(m, /^Sleep 7:12\n\nSleep held/);
  assert.match(m, /settled so far\.\n\nToday: 45 min tempo\n\nFull read: https:\/\/scora\.app\/r\/abc$/, 'cut at a sentence end; today and link kept');
});

test('review 6: a decimal is not taken for a sentence end when the read is cut', async () => {
  const { WHATSAPP_MAX_CHARS } = await import('../src/whatsapp');
  const voice = 'Settled. ' + 'x'.repeat(WHATSAPP_MAX_CHARS - 40) + ' HRV 7.2 is up. More text follows here.';
  const m = composeDoorbell({ numbers: 'N', voice, link: 'L', drivers: [{ metric: 'HRV', value: '7.2' }] });
  assert.ok(m.length <= WHATSAPP_MAX_CHARS);
  assert.doesNotMatch(m, /7\.\n/);
});

test('review 6: the doorbell refuses a read the voice validators reject, and emoji or ! anywhere', () => {
  const drivers = [{ metric: 'Sleep', value: '7:12' }, { metric: 'HRV', value: '52ms', trend: '+8% wk' }];
  const base = { numbers: 'Sleep 7:12 · HRV 52ms (+8% wk)', today: '45 min tempo', link: 'L', drivers };
  assert.doesNotThrow(() => composeDoorbell({ ...base, voice: 'Sleep held at 7:12 and HRV is climbing.' }));
  assert.throws(() => composeDoorbell({ ...base, voice: 'You should run easy today.' }), /you should/);
  assert.throws(() => composeDoorbell({ ...base, voice: 'HRV is 61ms.' }), /61/);
  assert.throws(() => composeDoorbell({ ...base, voice: 'Settled.', today: '45 min tempo \u{1F525}' }), /emoji/);
  assert.throws(() => composeDoorbell({ ...base, voice: 'Settled.', numbers: 'Sleep 7:12!' }), /exclamation/);
  assert.throws(() => composeDoorbell({ ...base, voice: '   ' }), /empty/);
});
