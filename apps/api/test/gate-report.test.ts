import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryGateReport, morningGateReport, planAwareGateReport, voiceGateReport } from '../src/gate-report';
import { pushDeliveryLine, pushOpenLine, pushSentLine, readPlanLine, voiceEmissionLine } from '../src/telemetry';

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
  assert.match(r.lines.join('\n'), /Banned-phrase hit rate 33\.3% .*FAIL/);
});

test('no telemetry lines: no data, not a pass', () => {
  assert.match(voiceGateReport('nothing here').lines.join('\n'), /Banned-phrase hit rate n\/a .*NO DATA/);
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

test('morning gates: opens within 4h and numbers first, per athlete', () => {
  const lines: string[] = [];
  for (let d = 1; d <= 14; d++) {
    const date = `2026-11-${String(d).padStart(2, '0')}`;
    lines.push(pushSentLine({ kind: 'daily', athleteId: 'evan', localDate: date, numericFirst: d !== 5, devices: 1, accepted: 1 }));
    if (d <= 11) lines.push(pushOpenLine({ kind: 'daily', athleteId: 'evan', localDate: date, afterMin: 30 }));
  }
  lines.push(pushOpenLine({ kind: 'daily', athleteId: 'evan', localDate: '2026-11-12', afterMin: 241 })); // too late
  lines.push(pushOpenLine({ kind: 'weekly', athleteId: 'evan', localDate: '2026-11-13', afterMin: 5 })); // weekly does not count
  let r = morningGateReport(lines.join('\n'));
  assert.deepEqual(r.byAthlete.evan, { sent: 14, opened: 11, numericFirst: 13 });
  assert.equal(r.openPass, false);
  assert.equal(r.numericPass, false);
  lines.push(pushOpenLine({ kind: 'daily', athleteId: 'evan', localDate: '2026-11-14', afterMin: 240 }));
  r = morningGateReport(lines.join('\n'));
  assert.equal(r.byAthlete.evan.opened, 12);
  assert.equal(r.openPass, true);
  assert.equal(morningGateReport('').openPass, null);
});

test('fail-throughs count only emissions that carry final_ok', () => {
  const line = (finalOk?: boolean) => voiceEmissionLine({ surface: 'daily', attempts: 2, fallback: true, bannedHits: [], unbackedCount: 1, finalOk });
  let r = voiceGateReport([line(true), line(undefined)].join('\n'));
  assert.deepEqual([r.failThroughs, r.checked], [0, 1]);
  assert.match(r.lines.at(-1)!, /fail-throughs 0 of 1 .*PASS/);
  r = voiceGateReport([line(true), line(false)].join('\n'));
  assert.match(r.lines.at(-1)!, /fail-throughs 1 of 2 .*FAIL/);
  assert.match(voiceGateReport('').lines.at(-1)!, /NO DATA/);
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

test('morning gates: a push no phone accepted is not an unopened morning; under 14 cannot pass', () => {
  const lines: string[] = [];
  for (let d = 1; d <= 5; d++) {
    const date = `2026-11-${String(d).padStart(2, '0')}`;
    lines.push(pushSentLine({ kind: 'daily', athleteId: 'a', localDate: date, numericFirst: true, devices: 1, accepted: d === 3 ? 0 : 1 }));
    if (d !== 3) lines.push(pushOpenLine({ kind: 'daily', athleteId: 'a', localDate: date, afterMin: 10 }));
  }
  const r = morningGateReport(lines.join('\n'));
  assert.deepEqual(r.byAthlete.a, { sent: 4, opened: 4, numericFirst: 4 });
  assert.equal(r.openPass, null);
  assert.equal(r.numericPass, true);
  assert.match(r.lines.join('\n'), /Opened within 4h .*NOT ENOUGH MORNINGS/);
});

test('plan-aware gate: a day counts as named if any read that day named the plan', () => {
  const lines = [
    readPlanLine({ athleteId: 'a', localDate: '2026-11-01', named: true }),
    readPlanLine({ athleteId: 'a', localDate: '2026-11-02', named: false }),
    readPlanLine({ athleteId: 'a', localDate: '2026-11-02', named: true }), // a refresh named it
    readPlanLine({ athleteId: 'a', localDate: '2026-11-03', named: false }),
    readPlanLine({ athleteId: 'b', localDate: '2026-11-01', named: false }),
    readPlanLine({ athleteId: 'b', localDate: '2026-11-02', named: true }),
  ];
  const r = planAwareGateReport(lines.join('\n'));
  assert.deepEqual(r.byAthlete, { a: { days: 3, named: 2 }, b: { days: 2, named: 1 } });
  assert.equal(r.pass, false, 'b names the plan on 50% of days');
  assert.equal(planAwareGateReport(lines.slice(0, 4).join('\n')).pass, true);
  assert.equal(planAwareGateReport('').pass, null);
});
