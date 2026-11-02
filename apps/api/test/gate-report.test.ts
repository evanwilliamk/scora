import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryGateReport, gateExitCode, morningGateReport, planAwareGateReport, voiceGateReport } from '../src/gate-report';
import { pushDeliveryLine, pushOpenLine, pushSentLine, readPlanLine, voiceEmissionLine } from '../src/telemetry';

test('counts emissions per surface from plain and JSON-wrapped log lines', () => {
  const plain = voiceEmissionLine({ surface: 'daily', attempts: 1, fallback: false, bannedHits: [], unbackedCount: 0, finalOk: true });
  const caught = voiceEmissionLine({ surface: 'daily', attempts: 2, fallback: true, bannedHits: ['you should'], unbackedCount: 1, finalOk: true });
  const cdv = voiceEmissionLine({ surface: 'cdv', attempts: 1, fallback: false, bannedHits: [], unbackedCount: 0, finalOk: true });
  const wrapped = JSON.stringify({ level: 30, time: 1, msg: cdv });
  const log = [plain, 'unrelated line {"x":1}', caught, wrapped, 'telemetry {broken'].join('\n');
  const r = voiceGateReport(log);
  assert.deepEqual(r.bySurface.daily, { emissions: 2, caught: 1, fallbacks: 1, bannedEmissions: 1, failThroughs: 0, unchecked: 0 });
  assert.deepEqual(r.bySurface.cdv, { emissions: 1, caught: 0, fallbacks: 0, bannedEmissions: 0, failThroughs: 0, unchecked: 0 });
  assert.equal(r.total.emissions, 3);
  assert.match(r.lines.join('\n'), /Banned-phrase hit rate 33\.3% .*FAIL/);
});

test('no telemetry lines: no data, not a pass', () => {
  assert.match(voiceGateReport('nothing here').lines.join('\n'), /Banned-phrase hit rate n\/a .*NO DATA/);
});

test('a pino line wrapped again by a log export still parses (review 4)', () => {
  const inner = JSON.stringify({ level: 30, msg: voiceEmissionLine({ surface: 'weekly', attempts: 1, fallback: false, bannedHits: [], unbackedCount: 0, finalOk: true }) });
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

test('fail-throughs: a line without final_ok (an older log) leaves 1.1.4 incomplete, never a pass', () => {
  const line = (finalOk: boolean) => voiceEmissionLine({ surface: 'daily', attempts: 2, fallback: true, bannedHits: [], unbackedCount: 1, finalOk });
  const old = 'telemetry {"event":"voice_emission","surface":"cdv","attempts":1,"fallback":false,"caught":false,"banned":[],"unbacked":0}';
  let r = voiceGateReport([line(true), old].join('\n'));
  assert.deepEqual([r.failThroughs, r.checked, r.unchecked], [0, 1, 1]);
  assert.match(r.lines.at(-1)!, /fail-throughs 0 of 1 .*INCOMPLETE \(1 emissions without final_ok\)/);
  r = voiceGateReport([line(true), line(true)].join('\n'));
  assert.match(r.lines.at(-1)!, /fail-throughs 0 of 2 .*PASS/);
  r = voiceGateReport([line(true), line(false), old].join('\n'));
  assert.match(r.lines.at(-1)!, /fail-throughs 1 of 2 .*FAIL/);
  assert.match(voiceGateReport('').lines.at(-1)!, /NO DATA/);
});

test('1.1.4 and 2.1.5 count every voice surface: cdv, adaptation_reason and card fallbacks included', async () => {
  const { cdvEmission, checkCdvWithRetry } = await import('../src/cdv-check');
  const { reasonEmission } = await import('../src/adaptation-reason');
  const { cardFallbackEmission } = await import('../src/card-expand');
  const data = { recentRuns: [{ miles: 6.2 }] };
  const cdvPass = cdvEmission(await checkCdvWithRetry('The last run was 6.2 miles.', data, 'Last run?', async () => ''));
  const cdvFell = cdvEmission(await checkCdvWithRetry('HRV is 99 ms.', data, 'HRV?', async () => 'HRV is 98 ms.'));
  const reasonPass = reasonEmission({ text: 'x', source: 'llm', issues: [], finalOk: true });
  const reasonThrough = reasonEmission({ text: 'x', source: 'fallback', issues: ['advice'], finalOk: false });
  const cardThrough = cardFallbackEmission('HRV 999ms.', [{ metric: 'HRV', value: '52ms' }], null);
  const why = { surface: 'why' as const, attempts: 1, fallback: false, bannedHits: [], unbackedCount: 0, finalOk: true };
  const log = [cdvPass, cdvFell, reasonPass, reasonThrough, cardThrough, why].map(voiceEmissionLine).join('\n');
  const r = voiceGateReport(log);
  assert.deepEqual([r.checked, r.unchecked, r.failThroughs], [6, 0, 2]);
  assert.deepEqual([r.bySurface.cdv.failThroughs, r.bySurface.cdv.fallbacks], [0, 1]);
  assert.deepEqual([r.bySurface.adaptation_reason.failThroughs, r.bySurface.adaptation_reason.fallbacks], [1, 1]);
  assert.equal(r.bySurface.card.failThroughs, 1);
  // 2.1.5: fallbacks from every surface count against the 10% bar (3 of 6).
  assert.equal(r.total.fallbacks, 3);
  assert.equal(r.fallbackRate, 0.5);
  assert.match(r.lines.join('\n'), /Validator fallback rate 50\.0% .*FAIL/);
  assert.match(r.lines.at(-1)!, /fail-throughs 2 of 6 .*FAIL/);
  assert.match(r.lines.find((l) => l.startsWith('adaptation_reason'))!, /\s1\s+0$/);
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

test('script exit code: fail-throughs INCOMPLETE is not a pass', () => {
  const ok = (finalOk?: boolean) => {
    const line = voiceEmissionLine({ surface: 'daily', attempts: 1, fallback: false, bannedHits: [], unbackedCount: 0, finalOk: finalOk ?? true });
    // An older line logged before every surface set final_ok.
    return finalOk === undefined ? line.replace(/,"final_ok":true/, '') : line;
  };
  const code = (log: string) => gateExitCode(voiceGateReport(log), deliveryGateReport(log), morningGateReport(log), planAwareGateReport(log));
  const passing = Array.from({ length: 20 }, () => ok(true));
  assert.equal(code(passing.join('\n')), 0);
  assert.match(voiceGateReport([...passing, ok()].join('\n')).lines.at(-1)!, /INCOMPLETE/);
  assert.equal(code([...passing, ok()].join('\n')), 3, 'an unchecked emission leaves 1.1.4 unjudged');
  assert.equal(code([...passing, ok(), ok(false)].join('\n')), 1, 'a fail-through fails even with unchecked lines');
  assert.equal(code('nothing here'), 3);
});
