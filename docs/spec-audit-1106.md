# Spec audit: doc 02 (PRD v1.4) and doc 09 (onboarding) vs the code (2026-11-06)

Branch `claude/spec-audit-1106`, from `claude/integration-2026-10-28` at `a4ba1a8`. Every status below comes from reading the code, not PLAN.md. CLAUDE.md wins where docs disagree. Free-tier and Plan-tier code work only; the Coach tier and coach platform are out of scope.

Not repeated: validator and prompt drift (`docs/voice-spec-audit.md`), doc 10 gates (`docs/acceptance-coverage.md`), route-level Free limits (`docs/free-tier-boundaries.md`), string wording (`docs/copy-audit.md`). Where a row touches one, it points there and stays one line.

Status key: **built and tested**, **built untested** (no automated test reaches it), **differs** (exists, but not as the spec says), **missing**. iOS paths are under `apps/ios/Scora/`, API paths under `apps/api/src/`, test paths under `apps/api/test/` unless written in full.

## Summary

| Status | Rows |
|---|---|
| Built and tested | 28 |
| Built untested | 3 |
| Differs | 27 |
| Missing | 16 |

Real gaps, most important first:

1. **A Free athlete with notifications off is promised a read that never comes.** APNS is the only Free doorbell, the prompt fires at app launch before sign-in, denial is never checked anywhere, and the done screen still says "Your first read lands...". SwiftUI, listed below.
2. **No history is stored.** No 90-day backfill, no Strava or Oura webhooks, no nightly pull (doc 09 §1.5, CLAUDE.md §8.4). Every read, chat and weekly calls Strava live and the `activities` table is never written. This also blocks Plan-tier unlimited history. Question 3.
3. **"Scaled to your current volume" is not true.** PlanView.swift:564 says it and CLAUDE.md §6.1 requires it, but the athlete's volume only picks the template (`weekly_volume_start_km` is stored, never read). Logged 2026-10-18 as reversible, yet the on-screen claim is false today. Question 2.

## Free tier: onboarding (doc 09 §1, CLAUDE.md §5.1)

| Ref | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 09 §1.1 | Welcome screen, "Get started" | differs | ContentView.swift:7-41 | One screen with "Sign in with Strava"; no separate welcome. |
| 09 §1.3 | Sign in with Apple | missing | ContentView.swift:30; PLAN.md:64 | Parked with Evan (auth). Athlete id comes from Strava. |
| 09 §1.3 | Zero-dollar Stripe customer, `subscription_tiers` = free | missing | no hits in apps/ for `subscription_tiers`; PLAN.md:134-135 | Parked (payments, Q30). |
| 09 §1.4 | Connect Strava, required, returns by universal link | differs | index.ts:104-109; ScoraApp.swift:51-52; strava-link.test.ts | Works and is tested, by the custom `scora://` scheme, not a universal link. |
| 09 §1.4 | Oura optional, headline, body, Skip for now | built and tested | OnboardingView.swift:162-168; index.ts:217-228; apps/ios/ScoraTests/LogicCoverageTests.swift:384-409 | None. |
| 09 §1.4 | HealthKit required, native sheet | built untested | OnboardingView.swift:169-175, 271-284; HealthManager.swift:201 | Step order tested; the sheet itself needs a device. Denial cannot be read for read-only types, so it moves on. |
| 09 §1.4 | Plan paste, inline text area, Save plan, Skip | differs | OnboardingView.swift:138, 176-182; PlanView.swift:915-931 | Opens the whole Your Plan sheet, not a step with a text area. Strava sentence rightly dropped (PLAN.md:86). |
| 09 §1.4 | Paste parsed to rows, `source=external`, `external_source=manual` | built and tested | index.ts:1037; plan-parse.ts; migration 20261017010000:67; manual-plan.test.ts; plan-parse-fuzz.test.ts | None. |
| 09 §1.4 | Time zone auto-detect + confirm + picker | differs | OnboardingView.swift:183-198, 355-388 | Zone is detected and named but cannot be changed; trips re-sync it. Picker tested. |
| 09 §1.1 | Default 6 AM local | built and tested | OnboardingView.swift:60; delivery.ts:19; migration 20261017020000:8; delivery.test.ts | Before onboarding the zone defaults to New York. |
| 09 §1.2 | No WhatsApp screen, no phone number on Free | built and tested | OnboardingView.swift:9-11; free-tier-boundaries.test.ts | PRD §7.1 "enters phone" conflicts; doc 09 and CLAUDE.md §5.1 win. |
| 09 §1.5 | "Your first read lands tomorrow morning." | differs | OnboardingView.swift:69-81; LogicCoverageTests.swift | Says today, tomorrow or shortly by the clock (Q33 A, logged). |
| 09 §1.5 | 90-day backfill queued | missing | no `activities` writes in apps/api/src; strava.ts:267 | Question 3. Reads fetch live, 35 to 56 days. |
| CLAUDE.md §8.4 | Strava and Oura webhooks, nightly pull | missing | routes at index.ts:75-1542 show no webhook | Question 3. |
| 09 §1.1 | Next morning APNS push | built and tested | scheduler.ts:174; send-push.test.ts; scheduler-push.test.ts | Not live until APNs env is set (PLAN.md:46). |
| 5.1 (implied) | Athlete knows when the push cannot arrive | differs | PushManager.swift:73-77, 198; no `authorizationStatus` in apps/ios/Scora | Top gap 1. Prompt before sign-in, denial unseen. |
| 09 §1.1 | Under 3 minutes, app open to done | missing | no start or finish event | Unmeasurable until the item below is built. |
| 09 §5 | `onboard_free_completed` event | missing | no hits in apps/ | Now in PLAN.md. `phase1-gates.sql` counts `onboarded_at`, so 2.1.1 is covered; the funnel is not. |

## Free tier: daily use (PRD §5.A)

| Ref | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| §5.A.2 | Numbers then voice in the push | built and tested | scheduler.ts:82; numeric-line.test.ts; scheduler-push.test.ts | See acceptance 1.1.7. |
| §5.A.2 | Tap opens Today's Read at the top | built and tested | DashboardView.swift:529-547; apps/ios/ScoraTests | Unit tested, never tapped on a simulator (PLAN.md:45). |
| §5.A.3 | Today's Read: posture badge, voice, numbers | built and tested | DashboardView.swift:640, 683; index.ts:581; routes-read.test.ts | None. |
| §5.A.3 | Cards: Sleep, Load, Intensity, Recovery, Long Effort, Connections, in order | built and tested | metrics.ts:88-300; spec-audit-1106.test.ts (new) | Order had no test until now. |
| §5.A.3 | "Long Effort" card name | differs | metrics.ts:240-285 | Named "Longest Run (30d)" (Q31 B, logged). |
| §5.A.3 | Plan Today card when a plan exists | built and tested | plan-read.ts:87; index.ts:753-758; plan-read.test.ts; spec-audit-1106.test.ts (new) | Route position had no test until now. |
| §5.A.3 | Week So Far: mini visual + one-line voice | differs | week-so-far.ts:1-4; WeekSoFarView.swift; week-so-far.test.ts | Line is built in code, not voice. Stricter; logged. |
| §5.A.3 | Sunday Read section, Sundays only | differs | DashboardView.swift:605-608 | A calendar icon opens This Week every day. See free-tier gap 1. |
| §5.A.3 | Card tap expands to interpretation | built and tested | card-expand.ts; index.ts:922; card-expand.test.ts | None. |
| §5.A.4 | Bottom input bar, "Ask anything about your training" | differs | DashboardView.swift:609-612; ChatView.swift:444, 473 | Chat is a sheet behind an icon; placeholder is "Message". |
| §5.A.4 | 3 chats a day | built and tested | index.ts:299-305; free-tier-boundaries.test.ts | See that doc. |
| §5.A.4 | Limit sentence offers the Plan upgrade | differs | index.ts:279; ChatView.swift:75; spec-audit-1106.test.ts (new) | "You've used your 3 chats for today. Resets tomorrow." Question 1. |
| §5.A.5 | Weekly push Monday on Free | built and tested | delivery.ts:89; weekly.test.ts | `POST /api/weekly` has no weekday gate, see free-tier gap 1. |
| §5.A.5 | Forwardable card image, server-side; share sheet | differs | WeeklyView.swift:80, 232 | Rendered on the phone (logged 2026-10-28). |
| §5.A.6 | Plan-aware read from a pasted plan | built and tested | plan-read.ts; index.ts:740-760; plan-read.test.ts; routes-read.test.ts | None. |
| §5.A.6 | Plan source: Strava scheduled activities | differs | PLAN.md:86-87; index.ts:1070; plan-ical.test.ts | Strava has no such API. iCal replaces it, behind `ICAL_IMPORT`, see free-tier gap 3. |
| CLAUDE.md §5.1 | Runna as a plan source | built and tested | migration 20261104000000; plan-ical.test.ts | Calendar path only; direct API is PLAN.md:147. |
| §5.A.1 | Oura on Free | built and tested | oura.ts; oura.test.ts; no tier check anywhere | None. |

## Plan tier: upgrade and setup (doc 09 §2, PRD §5.B.1)

| Ref | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 09 §2.1-2.2 | Upgrade triggers, landing screen, 7-day trial, Stripe, webhook | missing | no "upgrade" in iOS or API; SettingsView.swift | Parked (payments, Q30). |
| 09 §2.6 | Trial cancel drops to Free, calendar read-only 30 days; refunds | missing | no tier column | Parked (payments). |
| 09 §2.3 | Goal, date, volume, experience with descriptions | built and tested | PlanView.swift:540-556; plan-generate.ts:59-83; plan-generate.test.ts; apps/ios/ScoraTests/ScoraTests.swift:582 | None. |
| 09 §2.3 | Goal list, 11 races | built and tested | plan-generate.ts:207-211; spec-audit-1106.test.ts (new) | The screen offers only goals with templates. |
| 09 §2.3 | Volume slider in the athlete's Strava unit | differs | PlanView.swift:462-473, 554 | Stepper, miles for everyone (Q32 B, Q39 B). |
| 09 §2.3 | Race at least 4 weeks out | differs | PlanView.swift:442; plan-generate.ts:124-133; plan-generate.test.ts:229-232 | App enforces it; API only checks template length, so a 4-week template takes a race 24 days out. Question 5. |
| 09 §2.3 | Optional preferred rest day | missing | no field in plan-generate.ts:27-33 | Logged 2026-10-28 (templates fix the week). |
| 09 §2.3 | Template match by sport, goal, duration, level, volume | built and tested | packages/plan-engine/src/assembler.ts:33-56; packages/plan-engine/test/assembler.test.ts | None. |
| 09 §2.3 | No match: "template not available", keep Free | built and tested | plan-generate.ts:121; plan-generate.test.ts | None. |
| 09 §2.3 | Plan-summary prompt, summary screen | missing | no prompt in apps/api/src | Logged 2026-10-28; `/api/plan/block` shows the phases instead. |
| 09 §2.3 | Athlete confirms, then the plan is active | differs | plan-generate.ts:140; `create_scora_plan` | Active on creation. Confirmation only when replacing a plan (PlanView.swift:575). |
| 09 §2.6 | Race too soon sentence | differs | plan-generate.ts:98, 132 | Names the earliest date; no "just do interpretation". Reasonable. |
| 09 §2.6 | Volume mismatch sentence | differs | plan-generate.ts:115-118 | Names the bound; no "consider a half marathon first". Reasonable. |
| §5.B.1 | Template library has content | missing | packages/plan-templates holds only README.md | Evan and a paid coach (PLAN.md:133). Nothing can generate yet. |
| §5.B.1, CLAUDE.md §6.1 | Scale template to current volume | differs | packages/plan-engine/src/assembler.ts:138-147; plan-generate.ts:147; PlanView.swift:564 | Top gap 3. Question 2. |
| §5.B.1 | Plan as a persistent object | differs | index.ts:1114, 1191; PlanView.swift:678; routes-store.test.ts | Block shows phases and race, but sessions stop at the next 14. No full calendar. |
| §5.B.1, CLAUDE.md §6.2 | Deterministic adaptation rules | built and tested | packages/plan-engine/src/adaptation-rules.ts:33-45; packages/plan-engine/test/ | See acceptance 6.2. |
| §5.B.1 | What changed, when, why; full history | built and tested | index.ts:1326, 1345; routes-store.test.ts | The list on PlanView.swift:1017 has no demo data, not seen on a simulator. |
| §5.B.1 | Missed sessions need acknowledgment | built and tested | index.ts:1146; PlanView.swift:1033; routes-store.test.ts | None. |
| §9 | Adaptation runs nightly | differs | plan-adapt.ts; DECISIONS.md 2026-10-18 | Runs with the read, since HealthKit reaches only the read (logged). |
| 09 §5 | `plan_setup_completed`, `upgrade_to_plan_*` | missing | no hits in apps/ | First one now in PLAN.md; upgrade events wait on Stripe. |

## Plan tier: features (PRD §5.B, doc 09 §2.4-2.5)

| Ref | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| §5.B.2 | Morning message composer | built and tested | whatsapp.ts:42; whatsapp.test.ts | Nothing calls it (no hits in index.ts). |
| §5.B.2 | Reply parser: why, more, pause N, resume, stop, help | built and tested | whatsapp.ts:81-126; whatsapp.test.ts | Superset of CLAUDE.md §7. |
| §5.B.2, 09 §2.4 | Twilio send, inbound route, opt-in, phone number | missing | PLAN.md:149-150 | Parked (Q29). |
| §5.B.2 | WhatsApp primary, APNS suppressed | missing | scheduler.ts has no channel | Needs the row above. |
| §5.B.2 | "Full read" deep link opens the read | built untested | ScoraApp.swift:51-75 handles only auth and oura; composer takes any link | The link does not exist yet. Build with Q29. |
| §5.B.3 | Structured workout conversion | built and tested | WorkoutExport.swift; apps/ios/ScoraTests/ScoraTests.swift:478, 665 | Fake Watch only (PLAN.md:130). |
| §5.B.3 | Today's workout on the Watch by default, Settings toggle | differs | PlanView.swift:1087; no `Toggle` in apps/ios/Scora | Manual Send to Watch per session, no toggle. Question 6. |
| 09 §2.5 | WorkoutKit permission, `workoutkit_permission_*` events | built untested | WorkoutExport.swift:176 | Prompt fires at first send. Events absent; needs a paired Watch. |
| §5.B.4 | Word-level links to charts | built and tested | driver-links.ts:115; index.ts:886; DriverChart.swift:24-29; driver-links.test.ts | Flag `INLINE_CHARTS`; tier gate is Q30. |
| §5.B.5 | ~30 chats a day, throttle sentence | missing | index.ts:279; `FREE_CDV_DAILY_LIMIT` for everyone | Needs Q30. PRD sentence absent. |
| §5.B.6 | Prediction shown as a range | built and tested | race-prediction.ts:92-97; PlanView.swift:262-290; race-prediction.test.ts | None. |
| §5.B.6 | Uses fitness, plan progression, races, body trend; updates weekly | differs | race-prediction.ts:49-97; index.ts:1240 | Recent runs and races only. Computed on each view. Question 4. |
| §5.B.6 | Any race on the plan | differs | race-prediction.ts:15-20; spec-audit-1106.test.ts (new) | 5K to marathon only; 50K and up, gravel and tri get "No estimate yet." Question 4. |
| §5.B.7 | Calories from weight, duration, HR, elevation, sport | differs | calories.ts:1-8; index.ts:1271; calories.test.ts | HR left out (needs age and sex); weight blocked (Q21); no screen in the app. |
| §5.B.8 | Unlimited history on Plan | missing | see free-tier doc | Needs stored history (Question 3) and Q30. |
| CLAUDE.md §3.3 | "Today:" line on the morning message | differs | plan-read.ts:104; routes-read.test.ts | Gated on session steps, not tier; wording in the voice audit. Q30. |
| §7.6 | Sunday message opens with numbers | differs | scheduler.ts:82 | Weekly sends the voice only. §3.3 names only the morning message. |

## Fixes made (2 commits, no source change)

- Doc pointers: docs 01, 07, 08, 09, 10 and `README_DOC_INDEX.md` named `02_SCORA_PRD_v1.4.md` and others; the files use `v1_4` and `v0_3`. Guard: `apps/api/test/spec-cross-refs.test.ts`. It failed before the fix and passes after.
- Tests on existing behavior: `apps/api/test/spec-audit-1106.test.ts` pins card order, Plan Today position, goal labels, the chat limit reply and prediction's road-only scope.

CLAUDE.md §12 has the same two wrong file names. Not edited: question 7.

## SwiftUI list (for the agent who owns the simulator; none changed here)

1. Notifications off: check `authorizationStatus`, ask after the delivery step rather than at launch (PushManager.swift:198), and say so on the done screen and in Settings when denied. New copy is bucket 2.
2. PlanView.swift:564: drop ", scaled to your current volume" unless question 2 chooses B.
3. Onboarding plan step (OnboardingView.swift:138, 180): open only the paste form, not all of Your Plan.
4. Chat placeholder (ChatView.swift:473): "Message" to the PRD's "Ask anything about your training".
5. Onboarding time zone (OnboardingView.swift:189): allow a change, as doc 09 §1.4 says "confirm". Low.
6. ContentView.swift:15: "Endurance athlete insights" is not PRD §4's line. Copy, bucket 2.
7. Add demo data for All plan changes so it can be checked on a simulator (PLAN.md:121).

## Questions for Evan

Existing Q21, Q29, Q30 and Sign in with Apple cover the parked rows and are not repeated.

| # | Question | Options | Recommendation | Bucket |
|---|---|---|---|---|
| 1 | Chat limit wording | A: keep the current sentence. B: PRD upgrade sentence now. C: B when Stripe ships. | C: there is nothing to upgrade to today | 2 |
| 2 | Scale plans to current volume? CLAUDE.md §6.1 says yes; code picks the template only | A: keep, amend §6.1, remove the screen claim. B: linear 0.9x to 1.1x, after a coach's view on intervals. | A until the paid template review | 3 |
| 3 | Stored history (backfill, webhooks, nightly pull) | A: stay live through the alpha. B: store activities now (migration, personal data, deletion inventory). | A for 10 users, B before Plan launch | 3 |
| 4 | Predictions | A: road 5K to marathon from recent runs, and amend the PRD. B: add ultra and other sports, plan and body inputs. | A: Riegel is unreliable past the marathon | 2 |
| 5 | 4-week floor in the API too? | A: app only. B: API refuses under 28 days, moving the Q35 B earliest date and its tests. | A: MVP templates are 10 weeks or more | 2 |
| 6 | Watch push | A: manual Send to Watch until tried on a paired Watch. B: automatic with a Settings toggle, as PRD §5.B.3. | A, then B | 2 |
| 7 | CLAUDE.md §12 names `02_SCORA_PRD_v1.4.md` and `06_SCORA_Pattern_Library_v0.3.md`; the files use underscores | A: Evan corrects both. B: leave. | A | 3 |
