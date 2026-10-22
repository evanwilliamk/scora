import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDoorbell, fixedReply, parseReply, twilioSignature, verifyTwilioSignature, PAUSE_MAX_DAYS } from '../src/whatsapp';

test('the morning message: numbers, read, today, link (CLAUDE.md §3.3)', () => {
  const m = composeDoorbell({
    numbers: 'Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412',
    voice: 'Body is settled.\n  Load is where it should be.',
    today: '45 min tempo · 3 × 8 min at threshold',
    link: 'https://scora.app/r/abc',
  });
  assert.equal(m, 'Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412\n\nBody is settled. Load is where it should be.\n\nToday: 45 min tempo · 3 × 8 min at threshold\n\nFull read: https://scora.app/r/abc');
  const noPlan = composeDoorbell({ numbers: 'Sleep 7:12', voice: 'Settled.', today: null, link: 'L' });
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
  for (const s of ['should I run today?', 'stop sending at 6', 'pause for a bit', '']) assert.deepEqual(parseReply(s), { cmd: 'unknown' }, s);
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
