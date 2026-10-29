import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryGateReport, voiceGateReport } from '../src/gate-report';
import { pushDeliveryLine, voiceEmissionLine } from '../src/telemetry';

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

test('a pino line wrapped again by a log export still parses (review 4)', () => {
  const inner = JSON.stringify({ level: 30, msg: voiceEmissionLine({ surface: 'weekly', attempts: 1, fallback: false, bannedHits: [], unbackedCount: 0 }) });
  const outer = JSON.stringify({ timestamp: 't', message: inner });
  assert.equal(voiceGateReport(outer).bySurface.weekly?.emissions, 1);
});

const daily = (athleteId: string, localDate: string, lateMin: number, delivered = true) =>
  pushDeliveryLine({ kind: 'daily', athleteId, localDate, lateMin, delivered });

test('delivery gate: 13 of 14 mornings on time passes, a retried failure counts once', () => {
  const lines: string[] = [];
  for (let d = 1; d <= 14; d++) {
    const date = `2026-11-${String(d).padStart(2, '0')}`;
    lines.push(daily('evan', date, d === 9 ? 12 : 1));
  }
  // Day 3 failed first, then a later tick delivered it on time.
  lines.splice(2, 0, daily('evan', '2026-11-03', 0, false));
  lines.push(pushDeliveryLine({ kind: 'weekly', athleteId: 'evan', localDate: '2026-11-02', lateMin: 90, delivered: true }));
  const r = deliveryGateReport(lines.map((l) => JSON.stringify({ msg: l })).join('\n'));
  assert.deepEqual(r.byAthlete.evan, { mornings: 14, onTime: 13, late: 1, failed: 0, missing: 0 });
  assert.equal(r.pass, true);
  assert.match(r.lines.join('\n'), /PASS/);
});

test('delivery gate: missing and failed mornings count against the bar', () => {
  const lines = [
    daily('a', '2026-11-01', 0),
    daily('a', '2026-11-02', 0, false),
    // Nov 3 has no line at all.
    daily('a', '2026-11-04', 0),
  ];
  const r = deliveryGateReport(lines.join('\n'));
  assert.deepEqual(r.byAthlete.a, { mornings: 4, onTime: 2, late: 0, failed: 1, missing: 1 });
  assert.equal(r.pass, false);
});

test('delivery gate: no lines is no data, not a pass', () => {
  const r = deliveryGateReport('telemetry {"event":"voice_emission","surface":"daily"}');
  assert.equal(r.pass, null);
  assert.match(r.lines[0], /NO DATA/);
});

test('delivery gate: the last 14 mornings count; fewer is not enough to pass', () => {
  const lines: string[] = [];
  // Days 1 and 2 late, then 14 on-time mornings: the late ones fall outside the window.
  for (let d = 1; d <= 16; d++) lines.push(daily('a', `2026-11-${String(d).padStart(2, '0')}`, d <= 2 ? 30 : 0));
  let r = deliveryGateReport(lines.join('\n'));
  assert.deepEqual(r.byAthlete.a, { mornings: 14, onTime: 14, late: 0, failed: 0, missing: 0 });
  assert.equal(r.pass, true);
  // Three good mornings and one late one: on track, not yet a pass.
  r = deliveryGateReport([daily('b', '2026-11-01', 0), daily('b', '2026-11-02', 9), daily('b', '2026-11-03', 0), daily('b', '2026-11-04', 0)].join('\n'));
  assert.equal(r.pass, null);
  assert.match(r.lines.join('\n'), /NOT ENOUGH MORNINGS/);
});
