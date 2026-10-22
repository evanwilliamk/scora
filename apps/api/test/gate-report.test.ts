import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceGateReport } from '../src/gate-report';
import { voiceEmissionLine } from '../src/telemetry';

test('counts emissions per surface from plain and JSON-wrapped log lines', () => {
  const plain = voiceEmissionLine({ surface: 'daily', attempts: 1, fallback: false, bannedHits: [], unbackedCount: 0 });
  const caught = voiceEmissionLine({ surface: 'daily', attempts: 2, fallback: true, bannedHits: ['you should'], unbackedCount: 1 });
  const cdv = voiceEmissionLine({ surface: 'cdv', attempts: 1, fallback: false, bannedHits: [], unbackedCount: 0 });
  const wrapped = JSON.stringify({ level: 30, time: 1, msg: cdv });
  const log = [plain, 'unrelated line {"x":1}', caught, wrapped, 'telemetry {broken'].join('\n');
  const r = voiceGateReport(log);
  assert.deepEqual(r.bySurface.daily, { emissions: 2, caught: 1, fallbacks: 1, bannedEmissions: 1 });
  assert.deepEqual(r.bySurface.cdv, { emissions: 1, caught: 0, fallbacks: 0, bannedEmissions: 0 });
  assert.equal(r.total.emissions, 3);
  assert.match(r.lines.at(-1)!, /Banned-phrase hit rate 33\.3% .*FAIL/);
});

test('no telemetry lines: no data, not a pass', () => {
  assert.match(voiceGateReport('nothing here').lines.at(-1)!, /NO DATA/);
});
