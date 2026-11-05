# Voice spec audit (2026-11-05)

Branch `claude/voice-spec-1105`, from `claude/integration-2026-10-28`. Compared CLAUDE.md §1, §3, §4, doc 08 and doc 06 with the prompts, pipelines and fallbacks. No real LLM was run.

Repeatable test: `apps/api/test/voice-awkward-values.test.ts` (14 data scenarios x 8 plans, all 12 patterns). Fix proofs: `apps/api/test/voice-spec-drift.test.ts`, `packages/voice/test/render.test.ts`.

## Fixed: code had drifted

| Finding | Fix |
|---|---|
| Validator checked numbers only, so "HRV is climbing" passed with no HRV in the record (§3.2) | New `unbackedClaims`: HRV, sleep, resting HR or Oura named with no driver fails. A sentence saying the data is absent passes. |
| "HRV is climbing" passed with HRV at -8%: direction was checked only beside a cited % | Present-tense direction words right after HRV, Load or volume must agree with the signed trend |
| An echoed `{{slot}}`, `undefined` or `NaN` passed the validator (the prompt holds the raw template) | Banned as `unfilled template` |
| Doc 06 §4.2, §4.3 bans missing: "consider whether", "in my experience", "you should think about", "do this workout", "today's workout should be", "move this to" | Added |
| "13.1k" passed against "13.1 mi" (the pattern writes `{{long_distance_km}}k`, plans read in miles) | `k` counts as km |
| Weekly prompt offered "you may name a posture" with no posture given, and no check | Prompt says name none; `postureClaimHits(v, null)` added |
| Why, more and chat had no posture check, unlike the read and the card | Added |
| Sentences: daily 2-3 (doc 2-4), weekly 4-6 (doc 3-5) | Prompts match the doc |
| Daily and weekly temperature 0.5 and 200, 320 tokens (doc 0.6, 250; 0.7, 400). Reason 0.3, 120 (doc 0.4, 100) | Match the doc |
| Reason lines need not cite a driver (doc 08 §10.4) | Model line must cite one when a number exists. Fixed sentence exempt (question 3). |
| `numeric_slots` never reached the prompt (doc 06 §7) | Named in the pattern block |
| Oura zeros became real drivers: "HRV 0ms", "Sleep 0:00", and HRV -100% could fire a rest posture | `usableRecovery`: 0 is no reading, the floor HealthKit already has |
| "Longest run 0 mi", "Weekly volume 0 mi" for runs with no distance | Dropped. A week with no runs keeps its real 0. New card line: "No run distance recorded in the last 30 days." |
| Plan "run, 0 min, 0 mi"; a blank intensity crashed the Plan Today card | Zero amounts left out; blank falls back to the type |
| Fallback double period on a plan change value (".. ") | One period |
| "Today: Today:" when the read's line goes to `composeDoorbell` (no route calls it yet) | One label |
| `fillTemplate`: NaN, Infinity and blank printed; "-0%"; "1 hard days", "1 days out"; "steady_state" | Gaps stay visible and reported; singular for 1; words for intensity |
| "same 1 minutes" in the reason sentence and prompt | Singular |

## Clean, no change

- Numeric-first: every daily read with drivers, fallback included, returns numbers then voice, in fixed order. With no drivers there is no line and a fixed sentence. Weekly, card, why and more have no numbers line; the doc asks for one only on the morning message.
- Pct never prints "-0%" ("+0% wk" is the floor). "1 run" is singular wherever it is counted.
- Tone: fixed strings have no exclamation points, emoji, em dashes or fitness-bro words (pinned in the test). Exception under question 4.

## Not fixed: doc is older (report only)

- `packages/llm-prompts` and `system.md` do not exist; prompts are inline. Not moved: another agent is working in prompt assembly.
- JSON output and `drivers_referenced`: prompts return prose and code builds the numeric line, which is stricter.
- Card `has_inline` brackets: spans are found in code (`driver-links.ts`, 2026-10-18).
- CDV 350 tokens at 0.5 (doc 1500 at 0.2): the server builds the chart spec now (2026-10-17).
- Workout description has no LLM prompt (2026-10-28). Plan summary has no prompt either.
- Five templates differ from doc 06 by punctuation only (em dash removed). The adherence rule's extra guard is logged (2026-10-17).

## Not fixed: real gaps (features or data, not drift)

- 12 of doc 06's 73 patterns exist (Q10 stopgap). The read gets the top pattern, not the top 1 to 3. The weekly read gets none, and coach patterns cannot fire (no tier passed).
- Daily prompt lacks tier, weekday, time zone, days to race, days since onboarding. Weekly lacks posture sequence, plan phase, adaptations, next phase, coach note, card headline.
- `days_to_race` and `long_distance_km` have no driver value, so the taper patterns cannot cite days out.
- `fillTemplate` is not used in production: the model gets the raw shape.
- Why and more have no route yet (Q29).
- Today line is gated on session steps, not tier (2026-10-28, Q30): a Free athlete on a SCORA plan would see it, a coach session without steps would not. Rest days have no line (doc: "REST"). Its wording is the deterministic description, not the doc's "45 min tempo · 3 × 8 min".
- Outside this pass's files: `oura.ts` averages 0 into the HRV week average; plan-engine says "VO2max effort".

## Questions for Evan

1. **Enforce sentence counts?** Doc 08 §3.3 step 4 retries, then falls back; nothing counts today. A: both bounds. B: upper bound only. C: prompt only (now). Recommend B: a one-sentence read is still voice, and a miss swaps voice for a number list.
2. **Curated lines on legal values** (pinned in the test, wording untouched). "Sleep 6:10 after 0 hard days." "HRV is still 5% above baseline. The body is stubborn" and "still 0% below". "0 days out". "HRV down 0%". "The plan says rest today" on a recovery session. `{{long_distance_km}}k` for athletes in miles. Recommend tightening the rules, not the words: hard days >= 2 for that line, HRV below 0 for the taper line.
3. **Fixed adaptation sentence**: names a posture, no number (§6.4 shows one), and says "Today's posture" forever in history. A: append the top driver and the date. B: leave it until the LLM flag is on. Recommend A.
4. **"Acute:chronic load"** in the fallback and driver list is jargon (§3.7). A: "Load vs usual". B: leave. Recommend A.
5. **Fallback**: doc 08 §3.3 step 7 renders the top pattern; code lists drivers. Recommend keeping the list until slot values are built and question 2 is settled.
6. **Retries**: doc says 2, code does 1. A second is a paid call. Recommend keeping 1.
