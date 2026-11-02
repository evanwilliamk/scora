// Acceptance criteria (doc 10) that had no test pinning them. See
// docs/acceptance-coverage.md for the full map. Tests named "FAILING finding"
// are marked todo: they state the criterion, the code does not meet it yet,
// and the suite stays green until it does. Supabase is the local fake REST
// server and every other outside call is refused by the fetch guard.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateAdaptation } from '../../../packages/plan-engine/src/index';
import type { AdaptationDecision, Intensity, PlannedWorkout } from '../../../packages/plan-engine/src/index';
import { reasonIssues } from '../src/adaptation-reason';
import { displacedReasonText, reasonText } from '../src/plan-adapt';
import { voiceGateReport } from '../src/gate-report';
import { voiceEmissionLine } from '../src/telemetry';
import { fakeRest, type FakeRest } from './helpers/fake-rest';
import { blankEnv } from './helpers/test-env';
import { installFetchGuard, type FetchGuard } from './helpers/fetch-guard';

blankEnv();

let rest: FakeRest;
let guard: FetchGuard;
let strava: typeof import('../src/strava');
let oura: typeof import('../src/oura');

before(async () => {
  rest = await fakeRest();
  guard = installFetchGuard(rest.url);
  process.env.SUPABASE_URL = rest.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  strava = await import('../src/strava');
  oura = await import('../src/oura');
});
after(async () => {
  guard.restore();
  await rest.close();
});
beforeEach(() => rest.reset());

// ---------------------------------------------------------------------------
// 2.1.4 / 6.1: banned-phrase hit rate under 0.5%, strictly.

const emission = (banned: boolean, fallback = false) =>
  voiceEmissionLine({ surface: 'daily', attempts: fallback ? 2 : 1, fallback, bannedHits: banned ? ['you should'] : [], unbackedCount: 0, finalOk: true });

const log = (total: number, banned: number, fallbacks = 0) =>
  Array.from({ length: total }, (_, i) => emission(i < banned, i >= total - fallbacks)).join('\n');

test('2.1.4: 1 banned emission in 201 is under 0.5% and passes; 1 in 200 is exactly 0.5% and fails', () => {
  const under = voiceGateReport(log(201, 1));
  assert.ok(under.bannedRate < 0.005);
  assert.match(under.lines.join('\n'), /Banned-phrase hit rate 0\.5% .*: PASS/);
  const at = voiceGateReport(log(200, 1));
  assert.equal(at.bannedRate, 0.005);
  assert.match(at.lines.join('\n'), /Banned-phrase hit rate 0\.5% .*: FAIL/);
});

test('2.1.4: zero banned emissions over 14 reads passes (1.1.3)', () => {
  assert.match(voiceGateReport(log(14, 0)).lines.join('\n'), /Banned-phrase hit rate 0\.0% .*: PASS/);
});

// ---------------------------------------------------------------------------
// 2.1.5: validator fallback rate under 10% of emissions.

test('2.1.5: the gate report counts fallbacks per surface and overall', () => {
  const r = voiceGateReport(log(20, 0, 3));
  assert.equal(r.total.emissions, 20);
  assert.equal(r.total.fallbacks, 3);
  assert.equal(r.bySurface.daily.fallbacks, 3);
  assert.match(r.lines.join('\n'), /^all\s+20\s+15\.0%\s+15\.0%/m);
});

test('2.1.5 / §7: the gate report states a pass or fail against the 10% fallback bar, strictly', () => {
  const over = voiceGateReport(log(20, 0, 3));
  assert.equal(over.fallbackRate, 0.15);
  assert.match(over.lines.join('\n'), /Validator fallback rate 15\.0% \(bar: under 10%\): FAIL/);
  const at = voiceGateReport(log(20, 0, 2));
  assert.equal(at.fallbackRate, 0.1);
  assert.match(at.lines.join('\n'), /Validator fallback rate 10\.0% \(bar: under 10%\): FAIL/);
  const under = voiceGateReport(log(21, 0, 2));
  assert.ok(under.fallbackRate < 0.1);
  assert.match(under.lines.join('\n'), /Validator fallback rate 9\.5% \(bar: under 10%\): PASS/);
  assert.match(voiceGateReport('').lines.join('\n'), /Validator fallback rate n\/a \(bar: under 10%\): NO DATA/);
});

// ---------------------------------------------------------------------------
// 6.2: every adaptation the engine can make carries a plain-English reason,
// and the fixed sentence passes the same checks an LLM-worded one must.

type Decided = Exclude<AdaptationDecision, { type: 'none' }>;
const w = (id: string, date: string, i: Intensity, m: number | null): PlannedWorkout => ({
  id, scheduled_date: date, planned_intensity: i, planned_duration_min: m,
});

function decided(posture: 'rest' | 'back-off', i: Intensity, window: boolean, minutes: number | null = 50): Decided | null {
  const target = w('tue', '2026-10-20', i, minutes);
  // With a window: Thursday is clear. Without one: every other day is hard.
  const week = window
    ? [target, w('wed', '2026-10-21', 'easy', 40), w('thu', '2026-10-22', 'rest', null), w('fri', '2026-10-23', 'easy', 30)]
    : [target, ...['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'].map((d, k) => w(`h${k}`, d, 'hard', 40))];
  const d = evaluateAdaptation({ posture, workout: target, today: '2026-10-19', plan: { source: 'scora_ai', goal_race_date: null, week } });
  return d.type === 'none' ? null : d;
}

test('6.2: every reason code has a fixed reason sentence that passes the reason checks', () => {
  const cases: Decided[] = [];
  for (const i of ['hard', 'intervals', 'threshold', 'tempo', 'long'] as Intensity[]) {
    for (const window of [true, false]) {
      for (const minutes of [50, null]) {
        const d = decided('rest', i, window, minutes);
        if (d) cases.push(d);
      }
    }
  }
  for (const i of ['intervals', 'threshold', 'tempo'] as Intensity[]) {
    for (const minutes of [50, null]) cases.push(decided('back-off', i, true, minutes)!);
  }
  const codes = new Set(cases.map((d) => d.reason_code));
  assert.deepEqual([...codes].sort(), [
    'posture_backoff_intervals_scheduled', 'posture_backoff_tempo_scheduled', 'posture_backoff_threshold_scheduled',
    'posture_rest_hard_no_window', 'posture_rest_hard_scheduled',
  ]);
  for (const d of cases) {
    const text = reasonText(d);
    assert.ok(text.length > 20, `empty reason for ${d.reason_code}`);
    assert.doesNotMatch(text, /undefined|null|NaN/, `reason has a hole: ${text}`);
    assert.deepEqual(reasonIssues(text, d, []), [], `${d.reason_code}: ${text}`);
  }
});

test('6.2: the fixed no-window reason is a plain observation and passes the reason checks it stands in for', () => {
  const d = decided('rest', 'intervals', false)!;
  assert.equal(d.reason_code, 'posture_rest_hard_no_window');
  const text = reasonText(d);
  assert.equal(text, "Tuesday's intervals is now an easy run at the same 50 minutes. Today's posture reads rest, and no other day this week had room for it.");
  assert.deepEqual(reasonIssues(text, d, []), []);
});

test('6.2: a move that displaces an easy session names that change too', () => {
  const target = w('tue', '2026-10-20', 'intervals', 60);
  const easy = w('wed', '2026-10-21', 'easy', 10);
  const week = [target, easy, w('thu', '2026-10-22', 'easy', 40), w('fri', '2026-10-23', 'easy', 40)];
  const d = evaluateAdaptation({ posture: 'rest', workout: target, today: '2026-10-19', plan: { source: 'scora_ai', goal_race_date: null, week } });
  assert.equal(d.type, 'moved');
  if (d.type !== 'moved') return;
  assert.equal(d.displaced_workout_id, 'wed');
  assert.match(displacedReasonText(d, easy), /^Wednesday's .+ gives way to Tuesday's .+\.$/);
});

// ---------------------------------------------------------------------------
// 6.5: Stripe Connect credentials never in the repo.

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
// Built from parts so this file never matches its own scan.
const STRIPE_SECRET = new RegExp(
  [
    '\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}', // secret and restricted keys
    '\\bwhsec_[A-Za-z0-9]{10,}', // webhook signing secrets
    '\\bca_[A-Za-z0-9]{16,}', // Connect platform client ids
    '\\bacct_[A-Za-z0-9]{14,}', // connected account ids
  ].join('|'),
);

test('6.5: no tracked file holds a Stripe key, webhook secret or Connect id', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(files.length > 50, 'the scan found the repo');
  const hits: string[] = [];
  for (const f of files) {
    const p = join(repoRoot, f);
    let size = 0;
    try { size = statSync(p).size; } catch { continue; } // deleted in the working tree
    if (size > 2_000_000) continue;
    const buf = readFileSync(p);
    if (buf.includes(0)) continue; // binary
    if (STRIPE_SECRET.test(buf.toString('utf8'))) hits.push(f); // the file name only, never the match
  }
  assert.deepEqual(hits, []);
});

test('6.5: the Stripe scan catches what it should and leaves ordinary words alone', () => {
  const sample = (a: string, b: string) => `${a}${b}`;
  assert.ok(STRIPE_SECRET.test(sample('sk_live_', 'abcdefghij1234')));
  assert.ok(STRIPE_SECRET.test(sample('rk_test_', 'abcdefghij1234')));
  assert.ok(STRIPE_SECRET.test(sample('whsec_', 'abcdefghij1234')));
  assert.ok(STRIPE_SECRET.test(sample('acct_', '1AbCdEfGhIjKlMn')));
  assert.ok(!STRIPE_SECRET.test('task_list risk_test_case acct_id ca_cert'));
});

// ---------------------------------------------------------------------------
// 6.5: OAuth tokens encrypted at rest. Today they are written to the
// athletes row as sent by Strava and Oura.

const PLAIN_ACCESS = 'plain-access-token-123';
const PLAIN_REFRESH = 'plain-refresh-token-456';

test('FAILING finding 6.5: Strava OAuth tokens are encrypted before they are stored', {
  todo: 'strava.ts storeStravaTokens writes strava_access_token and strava_refresh_token in plain text',
}, async () => {
  await strava.storeStravaTokens('99', { access_token: PLAIN_ACCESS, refresh_token: PLAIN_REFRESH, expires_at: 1 });
  const body = JSON.stringify(rest.requests[0].body);
  assert.ok(!body.includes(PLAIN_ACCESS) && !body.includes(PLAIN_REFRESH), 'a raw token reached the database');
});

test('FAILING finding 6.5: Oura OAuth tokens are encrypted before they are stored', {
  todo: 'oura.ts storeOuraTokens writes oura_access_token and oura_refresh_token in plain text',
}, async () => {
  rest.answer('athletes', { body: [{ strava_id: '99' }] });
  await oura.storeOuraTokens('99', { access_token: PLAIN_ACCESS, refresh_token: PLAIN_REFRESH, expires_in: 60 });
  const body = JSON.stringify(rest.requests[0].body);
  assert.ok(!body.includes(PLAIN_ACCESS) && !body.includes(PLAIN_REFRESH), 'a raw token reached the database');
});
