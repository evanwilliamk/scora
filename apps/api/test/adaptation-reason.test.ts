// Adaptation reason wording: prompt, code-side checks, fallback. The LLM is a
// stub; nothing here calls OpenAI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAdaptation } from '../../../packages/plan-engine/src/index';
import type { AdaptationDecision, PlannedWorkout } from '../../../packages/plan-engine/src/index';
import { reasonIssues, reasonPrompt, writeReason, openAiReasonLlm } from '../src/adaptation-reason';
import { reasonText } from '../src/plan-adapt';
import type { Driver } from '../src/metrics';

type Decided = Exclude<AdaptationDecision, { type: 'none' }>;
const w = (id: string, date: string, i: PlannedWorkout['planned_intensity'], m: number | null): PlannedWorkout => ({
  id, scheduled_date: date, planned_intensity: i, planned_duration_min: m,
});
const week = [w('tue', '2026-10-20', 'intervals', 60), w('wed', '2026-10-21', 'easy', 40), w('thu', '2026-10-22', 'rest', null)];
const decide = (posture: 'rest' | 'back-off'): Decided => {
  const d = evaluateAdaptation({
    posture, workout: week[0], today: '2026-10-19',
    plan: { source: 'scora_ai', goal_race_date: null, week, template_week_minutes: 100 },
  });
  assert.notEqual(d.type, 'none');
  return d as Decided;
};
const moved = decide('rest'); // Tuesday to Thursday
const downgraded = decide('back-off');
const evidence: Driver[] = [
  { metric: 'Sleep last night', value: '5:40' },
  { metric: 'HRV vs 7-day', value: '-12%' },
];

test('the prompt states the decided change, the posture and only the listed drivers', () => {
  const { system, user } = reasonPrompt(moved, evidence);
  assert.match(user, /MOVED: Tuesday's intervals session to Thursday, unchanged\./);
  assert.match(user, /TODAY'S POSTURE: rest/);
  assert.match(user, /- Sleep last night: 5:40/);
  assert.match(system, /never suggest, advise or ask/);
  assert.match(reasonPrompt(downgraded, []).user, /DOWNGRADED: Tuesday's intervals session to steady state, same 60 minutes\.\n.*\nDRIVERS:\n- none/);
});

test('a clean line passes: right days, driver numbers only, stated not advised', () => {
  assert.deepEqual(reasonIssues("Tuesday's intervals moved to Thursday. Sleep was 5:40 last night and HRV is 12% under your week.", moved, evidence), []);
  assert.deepEqual(reasonIssues("Tuesday's intervals are now steady at the same 60 minutes. HRV sits 12% under your week.", downgraded, evidence), []);
});

test('lines that break a rule are caught, each with a named issue', () => {
  const cases: [string, Decided, RegExp][] = [
    ["Tuesday's intervals moved to Thursday because sleep was 4:10.", moved, /unbacked number 4/],
    ["Tuesday's intervals moved to Friday.", moved, /missing Thursday/],
    ["Tuesday's intervals moved to Thursday, ahead of Saturday's long run.", moved, /names Saturday/],
    ['Intervals moved to Thursday.', moved, /missing Tuesday/],
    ["Tuesday's intervals moved to Thursday. You should rest today.", moved, /banned: you should/],
    ["Tuesday's intervals moved to Thursday. Consider an early night.", moved, /advice/],
    ["Tuesday's intervals moved to Thursday. Does that work?", moved, /asks a question/],
    ["Tuesday's intervals moved to Thursday. Sleep was short. HRV is down. Rest helps.", moved, /more than two sentences/],
    ["Tuesday's intervals moved to Thursday, as your coach would want.", moved, /coach/],
    ["Tuesday's intervals moved to Thursday!", moved, /exclamation/],
    ['', moved, /empty/],
    // review fixes
    ["Tuesday's long run moved to Thursday.", moved, /names long/],
    ["Tuesday's intervals are now steady at the same 60 minutes. HRV is 12% above your week.", downgraded, /says up for HRV/],
    ["Tuesday's intervals moved to Thursday. Keep it easy, sleep was 5:40.", moved, /advice/],
    ["Tuesday's intervals moved to Thursday and friday stays as is.", moved, /names Friday/],
    ["Tuesday's intervals moved to Thursday, clear of Sat.", moved, /names Saturday/],
    ["Tuesday's intervals moved to Thursday. Posture reads back-off after five hours of sleep.", moved, /wrong posture back-off|number in words/],
  ];
  for (const [text, d, issue] of cases) {
    const issues = reasonIssues(text, d, evidence);
    assert.ok(issues.some((i) => issue.test(i)), `${text} -> ${issues.join(', ')}`);
  }
});

test('writeReason: a good line is used, a bad or failed one falls back to the fixed sentence', async () => {
  const fixed = reasonText(moved);
  const good = await writeReason(moved, evidence, async () => `"Tuesday's intervals moved to Thursday. Sleep was 5:40 last night."`, fixed);
  assert.deepEqual([good.source, good.text], ['llm', "Tuesday's intervals moved to Thursday. Sleep was 5:40 last night."]);

  const bad = await writeReason(moved, evidence, async () => 'You should take it easy!', fixed);
  assert.equal(bad.source, 'fallback');
  assert.equal(bad.text, fixed);
  assert.ok(bad.issues.length > 0);

  const failed = await writeReason(moved, evidence, async () => { throw new Error('429'); }, fixed);
  assert.deepEqual([failed.source, failed.text], ['fallback', fixed]);
  assert.match(failed.issues[0], /llm failed: 429/);
});

test('the fixed sentences pass the same checks they stand in for', () => {
  assert.deepEqual(reasonIssues(reasonText(moved), moved, []), []);
  assert.deepEqual(reasonIssues(reasonText(downgraded), downgraded, []), []);
});

test('the OpenAI wrapper sends gpt-4o-mini a short completion and reads the first choice', async () => {
  let sent: any;
  const llm = openAiReasonLlm('test-key', (async (_url: string, init: any) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } as any;
  }) as any);
  assert.equal(await llm('s', 'u'), 'ok');
  assert.equal(sent.model, 'gpt-4o-mini');
  assert.ok(sent.max_tokens <= 120);
  const failing = openAiReasonLlm('k', (async () => ({ ok: false, status: 500, text: async () => 'down' })) as any);
  await assert.rejects(failing('s', 'u'), /OpenAI 500/);
});

test('reason checks see through curly apostrophes and odd spaces (review 10-29)', () => {
  const t = 'You’ll  want to rest on Wednesday.';
  assert.notDeepEqual(reasonIssues(t, moved, evidence), []);
});
