import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditLog, auditReport } from '../src/log-audit';
import { pushDeliveryLine, pushSentLine, voiceEmissionLine } from '../src/telemetry';

test('flags health values and secrets by line and category', () => {
  const log = [
    'server listening on 3000',
    'voice draft: Sleep 7:12 · HRV 52ms (+8% wk)',
    '{"average_heartrate": 151.2, "calories": 640}',
    'resting HR 48 this morning',
    'strava refresh ok access_token=abcdef0123456789abcdef',
    'Authorization: Bearer eyJhbGciOiJFUzI1NiJ9.abcdefghijk',
    'weight: 71.5 kg',
    'oura readiness 84',
  ].join('\n');
  const f = auditLog(log);
  assert.deepEqual(f, [
    { line: 2, category: 'hrv' },
    { line: 2, category: 'sleep' },
    { line: 3, category: 'heart rate' },
    { line: 3, category: 'calories' },
    { line: 4, category: 'heart rate' },
    { line: 5, category: 'secret' },
    { line: 6, category: 'secret' },
    { line: 7, category: 'body weight' },
    { line: 8, category: 'readiness' },
  ]);
  const r = auditReport(log);
  assert.match(r.lines.at(-1)!, /FAIL/);
  assert.ok(!r.lines.join('\n').match(/52ms|151|abcdef/), 'the report never repeats the values');
});

test('our own telemetry and scheduler lines are clean', () => {
  const log = [
    voiceEmissionLine({ surface: 'daily', attempts: 2, fallback: true, bannedHits: ['you should'], unbackedCount: 1, finalOk: true }),
    pushDeliveryLine({ kind: 'daily', athleteId: '0b7c1d2e-1111-2222-3333-444455556666', localDate: '2026-10-28', lateMin: 1, delivered: true }),
    pushSentLine({ kind: 'daily', athleteId: '0b7c1d2e-1111-2222-3333-444455556666', localDate: '2026-10-28', numericFirst: true, devices: 2, accepted: 2 }),
    'scheduler: sent 3 daily, 0 weekly',
    'voice validator caught draft 1: banned: none; unbacked numbers: 2',
    'CDV validator catch after 2 attempts (banned: none; unbacked numbers: 1), using fallback',
    'incoming request {"method":"POST","url":"/api/read","responseTime":812.4}',
  ].join('\n');
  assert.deepEqual(auditLog(log), []);
  assert.match(auditReport(log).lines.at(-1)!, /PASS/);
});
