# Review guide: `claude/integration-2026-10-28`

A one-hour map of the bundle. Mechanics (migration order, flags, smoke tests) live in `docs/merge-checklist.md`; this file does not repeat them. Facts below were checked against the code on 2026-11-03, not taken from commit messages; the 2026-11-04 note below was added after that and the area table was not recounted.

## Size

- 829 commits (`git log --oneline origin/main..HEAD`), 2026-10-17 to 2026-11-04.
- 248 files, +37,524 / -1,111 (`git diff --stat origin/main...HEAD`), counted before the last 2026-11-04 merges.
- About a third is tests: API tests +4,951 in 35 files, iOS tests +2,584 in 4 files (plus tests counted inside the areas below).

| Area (files matched by name, tests included) | Files | Lines |
|---|---|---|
| Plan engine, plan routes, predictions, calories | 46 | +6,567 |
| iOS app (excluding test targets) | 17 | +4,695 / -188 |
| Push scheduler, preferences, delivery | 14 | +2,105 / -47 |
| Voice, validators, card expand, telemetry | 24 | +1,698 / -37 |
| Knowledge library (ingest, retrieval) | 6 | +1,368 |
| Docs, PLAN.md, DECISIONS.md | 8 | +1,361 |
| Routes in `apps/api/src/index.ts` and pages | 5 | +1,266 / -219 |
| CDV charts, driver links, chat quota | 8 | +1,184 / -9 |
| Strava / Oura ingest | 14 | +989 / -78 |
| Migrations | 13 | +874 |
| Posture + driver record | 6 | +516 / -18 |
| Gate scripts | 6 | +457 |
| WhatsApp core | 2 | +420 |

Added 2026-11-04, worth reading first: `apps/api/src/validator.ts` (largest behavior change of the night, risk HIGH), the `stravaFetch` cooldown in `apps/api/src/strava.ts`, `startDateForRace` in `packages/plan-engine/src/assembler.ts`, migration `20261104000000`.

## Flags, verified in code

Eight flags, each read as `=== 'on'`, each off by default: `ICAL_IMPORT` (`index.ts`), `KNOWLEDGE_RETRIEVAL` (`knowledge-retrieval.ts`), `PLAN_GENERATION` (`plan-generate.ts`), `PLAN_ADAPTATIONS` (`plan-adapt.ts`), `ADAPTATION_REASON_LLM` (`adaptation-reason.ts`), `INLINE_CHARTS` (`driver-links.ts`), `RACE_PREDICTIONS` (`race-prediction.ts`), `CALORIE_ENGINE` (`calories.ts`). No flag defaults on. There is no `WHATSAPP` flag and no WhatsApp route yet.

Not behind any flag (new and live on merge): `POST /api/plan/manual` (pasted plan, transcribed by gpt-4o-mini, saved), `PUT /api/preferences`, `POST /api/plan/workouts/:id/status`, `POST /api/plan/workouts/:id/watch-sent`, `POST /api/unregister-device`, `POST /api/events/push-open`, `GET /api/plan`, `POST /api/card-expand`. Like every route on `main`, each takes `athleteId` from the body (Sign in with Apple not built), so the bundle widens the unauthenticated write surface.

## Areas

All API paths are under `apps/api/src/` unless written in full.

**Voice and validators**
- Stricter validator: typography folded, paraphrased advice and plan overrides banned, driver numbers keep unit and direction, posture names checked against the rules. Fallback read on any OpenAI failure. CDV replies get the driver check.
- Read first: `validator.ts`, `voice.ts`, `cdv-check.ts`.
- Risk HIGH: on for everyone at merge; a false catch silently swaps reads for the fallback (watch the `voice` fallback rate).
- Flag: none.

**Posture and driver record**
- Driver record computed per athlete and fed to the posture engine; evidence cites only the clauses that fired; no badge when there is no evidence.
- Read first: `drivers.ts`, `packages/posture/src/engine.ts`.
- Risk MEDIUM: decides every posture the voice may name; deterministic and unit tested.
- Flag: none.

**Plan engine (package)**
- Template loader with schema and plan-ban checks, assembler (template + race date to calendar), deterministic adaptation rules, step-based session descriptions.
- Read first: `packages/plan-engine/src/adaptation-rules.ts`, `template-loader.ts`, `assembler.ts`.
- Risk MEDIUM: rules encode CLAUDE.md §6.2; `packages/plan-templates` holds only a README, so nothing generates until templates exist.
- Flag: `PLAN_GENERATION`, `PLAN_ADAPTATIONS`.

**Plan routes, paste, calendar**
- Pasted plan (LLM transcribes, code checks rows against the text), iCal import, done/missed marks, adaptations applied during `/api/read`, history and dismiss, predictions, calories.
- Read first: `plan-adapt.ts`, `plan-store.ts`, `plan-parse.ts`.
- Risk HIGH: writes plan rows and adaptations; paste is unflagged and calls OpenAI.
- Flag: paste none; iCal `ICAL_IMPORT`; rest as above plus `ADAPTATION_REASON_LLM`, `RACE_PREDICTIONS`, `CALORIE_ENGINE`.

**Scheduler and push**
- Ticks every minute, per-athlete zone and time, claim/release per day so a read is sent once, retry every 15 min, `scora_due_deliveries` in SQL, tap routing and push-open events.
- Read first: `scheduler.ts`, `preferences.ts` (`claim`, `release`), `delivery.ts`.
- Risk HIGH: a claim bug means duplicate or missing morning pushes; it calls `/api/read` over localhost, so every read cost repeats per athlete.
- Flag: none; starts only when the APNs env is set (still blocked).

**Strava and Oura ingest**
- Strava asked by date window and paged; single-flight token refresh; timeouts (15 s, 20 s); Oura "last night" strictly today; treadmill and Zwift count as runs.
- Read first: `strava.ts`, `oura.ts`, `metrics.ts`.
- Risk MEDIUM: token refresh writes to `athletes`; changes which activities every card counts.
- Flag: none.

**CDV and charts**
- LLM picks a chart kind, server builds the Vega-Lite spec from real data; inline driver charts; quota at the athlete's midnight with refund on outage.
- Read first: `cdv-chart.ts`, `driver-links.ts`, `usage.ts`.
- Risk LOW to MEDIUM: read only except the quota counter.
- Flag: inline charts `INLINE_CHARTS`; chat charts none.

**Knowledge library**
- pgvector tables, FieldCopy ingest script, retrieval in the read with the pattern library as fallback.
- Read first: `knowledge-retrieval.ts`, `knowledge-ingest.ts` (`--sync` deletes chunks).
- Risk MEDIUM: shapes voice substance; idle until sources and an ingest run exist.
- Flag: `KNOWLEDGE_RETRIEVAL`.

**WhatsApp core**
- Composer, reply parser (why/more/pause/stop/help, unstop, polite opt-outs), Twilio signature check. No route, no sending, no storage.
- Read first: `whatsapp.ts`.
- Risk LOW: unreachable from any route.
- Flag: none needed yet.

**iOS dashboard**
- Numeric line and posture badge, Plan Today card, Week So Far, inline charts, offline last-read cache, share cards, sleep counted once across iPhone and Watch.
- Read first: `apps/ios/Scora/DashboardView.swift`, `HealthManager.swift`, `DriverChart.swift`.
- Risk MEDIUM: HealthKit sleep and HRV math changed; cached read written to disk with file protection.
- Flag: server side only.

**iOS plan**
- Your Plan sheet (paste, calendar link, block view, past sessions, plan changes, setup in miles), Send to Watch and the Watch reconcile pass.
- Read first: `apps/ios/Scora/PlanView.swift` (+1,350), `WatchReconcile.swift`, `WorkoutExport.swift`.
- Risk MEDIUM: reconcile removes scheduled Watch workouts when a session moves; not tried on a paired Watch.
- Flag: setup screen hidden unless `/api/plan/options` returns goals.

**iOS onboarding and push**
- Post-Strava steps, delivery time picker, first-read timing copy (Q33 A), returning athletes skip onboarding, push token unregister on sign-out.
- Read first: `apps/ios/Scora/OnboardingView.swift`, `PushManager.swift`, `TokenManager.swift`.
- Risk LOW to MEDIUM: copy is yours; DEBUG launch arguments are inside `#if DEBUG`.
- Flag: none.

**Migrations**
- 13 new files, exactly the 13 in the checklist (13 added 2026-11-03 by the data-writes review). Only add tables, columns, functions and RLS; old plans are marked `replaced`, never deleted.
- Read first: `20261018020000_create_scora_plan.sql` with its redefinitions `20261030010000` and `20261101000000`; `20261022000000_ical_plans.sql`; `20261028000000_rls_all_tables.sql`.
- Risk HIGH: they touch production schema and are not applied anywhere yet; the plan functions are redefined twice.
- Flag: none (applied by hand).

**Gate scripts**
- `voice-gate-report.ts`, `log-audit.ts`, and three read-only SQL reports.
- Read first: `apps/api/scripts/voice-gate-report.ts`, `apps/api/src/gate-report.ts`.
- Risk LOW: read only, run by hand.
- Flag: none.

## Read these first (highest risk)

1. `apps/api/src/validator.ts` and `apps/api/src/voice.ts`: every voice surface passes through them with no flag; this is the moat, and a regression either lets a prescription through or floods the fallback.
2. `apps/api/src/scheduler.ts` with `apps/api/src/preferences.ts` (`claim`, `release`, lines 150 to 173): the conditional update that keeps a morning push to one per athlete per day.
3. `apps/api/supabase/migrations/20261018020000_create_scora_plan.sql`, `20261030010000_create_scora_plan_lock.sql`, `20261101000000_create_scora_plan_idempotent.sql`: the plan write path in SQL, redefined twice; read the last one as the truth.
4. `apps/api/supabase/migrations/20261022000000_ical_plans.sql` and `20261030000000_ical_refresh_pairing.sql`: replace and refresh of an athlete's plan, which must keep done/missed marks and Watch sends.
5. `apps/api/src/plan-adapt.ts` (writes through `apply_plan_adaptation`) and `packages/plan-engine/src/adaptation-rules.ts`: the only code that changes a plan, run inside `/api/read`.
6. `apps/api/src/index.ts` lines 1012 to 1146: unflagged plan writes (`/api/plan/manual`, status, watch-sent) that trust a body `athleteId`.
7. `apps/api/src/strava.ts` and `apps/api/src/oura.ts`: token refresh and rotation writes.
8. `apps/ios/Scora/WatchReconcile.swift`: removes Watch workouts the athlete may have on their wrist.

## Decisions made on your behalf

DECISIONS.md has 111 entries (two headings appear twice: 2026-10-17 driver record, 2026-10-17 root package-lock); 9 were on `main`, so about 100 are new. Status: 104 DECIDED, 7 NEEDS EVAN. Five were decided after you were silent 3 days on a bucket 2 question (Q17, Q19, Q31, Q32, Q33).

Worth a second look:

1. 2026-10-28: Session descriptions without an LLM (deviates from CLAUDE.md §6.4)
2. 2026-10-22: Rest posture with no move window drops the session to easy (Q19)
3. 2026-11-01: A race early in the week loses the template's final week (NEEDS EVAN)
4. 2026-10-18: Plan adaptations run with the daily read, not a separate nightly cron
5. 2026-10-18: Plan assembler: no athlete scaling beyond template choice
6. 2026-10-18: Race predictions v1: Riegel range from recent efforts
7. 2026-10-29: Voice validator reads folded typography and bans paraphrased advice
8. 2026-10-30: A late read can go out just after midnight under yesterday's date
9. 2026-10-17: Knowledge retrieval in the daily read
10. 2026-10-22: Calendar (iCal) import as a plan source (Q17)

## Not in this bundle, waiting on you

- Sign in with Apple: every route still trusts a body `athleteId`.
- APNs env on Railway (Apple Developer enrollment and .p8 key): the scheduler stays idle until then.
- Apply the RLS migration (Q28).
- OAuth tokens encrypted at rest (Q26).
- Account deletion (Q27), inventory in `docs/account-deletion-inventory.md`.
- Rotate the Strava secret (Q20), sign the Oura state (Q18), token in the deep link (Q16).
- Body weight for the calorie engine (Q21).
- Plan tier gating code half (Q30), draft in `docs/tier-gating-design.md`; Stripe itself.
- WhatsApp live: storage, inbound route, `WHATSAPP` flag (Q29); Twilio account and opt-in copy.
- MVP plan templates (7), authored by you and reviewed by a paid coach.
- Knowledge library starter sources and spec §6 questions.
- PostHog and Sentry accounts.
- Turning on `ADAPTATION_REASON_LLM` (small OpenAI cost per adaptation).
- WorkoutKit try on a paired Apple Watch.
- OpenClaw AGENTS.md alignment.
