# Acceptance criteria coverage (doc 10 v2)

Audit date: 2026-11-02, branch `claude/acceptance-coverage`. Source: `10_SCORA_Acceptance_Criteria_v2.md`.

Status key:
- **TESTED**: a test pins the code behavior the criterion depends on (file named).
- **GAP filled**: had no test; a test was added on this branch.
- **FAILING**: a new test shows the code does not meet the criterion. The test is `todo` (named "FAILING finding ...") so the suite stays green.
- **NOT CODE**: needs a device, Evan, a deploy, real users, or a feature not built yet.

Most hard gates are measured on live data. For those, TESTED means the code that produces or measures the signal is tested, not that the gate has passed.

Test paths: `api/` is `apps/api/test/`, `engine/` is `packages/plan-engine/test/`, `voice/` is `packages/voice/test/`, `ios/` is `apps/ios/ScoraTests/`.

## Summary

| Status | Count |
|---|---|
| TESTED | 33 (1.1.3 and 6.2 c, d, e also got new tests; 2.1.5 and 6.2 b fixed 2026-11-02) |
| GAP filled | 2 (2.1.4, 6.5 e) |
| FAILING | 1 row (6.5 a): 1 finding |
| NOT CODE | 62 |

98 rows in all.

## FAILING findings

| Id | Finding | Test |
|---|---|---|
| 6.5 | OAuth tokens are stored in plain text: `storeStravaTokens` (strava.ts) and `storeOuraTokens` (oura.ts) write the raw access and refresh tokens to `athletes`. No app-level encryption. | api/acceptance-gaps.test.ts |

Fixed 2026-11-02 (branch claude/acceptance-fixes): 2.1.5 (the gate report now prints PASS/FAIL against the 10% fallback bar) and 6.2 (the no-window reason now ends "no other day this week had room for it", which passes the reason checks).

Fixed 2026-11-02 (branch claude/gate-fail-through): every voice surface (daily, weekly, card, cdv, adaptation_reason, why, more) now logs `final_ok` for the text it sent, so 1.1.4 counts all of them. Two fail-throughs closed on the way: a CDV METRIC decimal backed only by a clock time reached the fallback, and the card error path sent the card translation (counts that are not drivers).

## Phase 0 (dogfood) hard gates

| Id | Criterion | Status | Test |
|---|---|---|---|
| 1.1.1 | APNS delivery on time 13 of 14 mornings | TESTED | api/gate-report, delivery, scheduler-*, send-push |
| 1.1.2 | Founder opens 12 of 14 within 4h | TESTED | api/gate-report (morning gate) |
| 1.1.3 | Zero banned-phrase hits over 14 reads | TESTED | api/validator, banned-phrases-4-1, routes-read; GAP filled: acceptance-gaps (0 of 14 passes) |
| 1.1.4 | Zero validator fail-throughs | TESTED | api/voice, cdv-check, adaptation-reason, card-expand (final_ok on every surface's line, pass, fallback and fail-through), gate-report (per-surface count; a line without final_ok reads INCOMPLETE, not PASS, and the script exits 3) |
| 1.1.5 | At least one "wow" moment | NOT CODE | Evan, dogfood-log.md |
| 1.1.6 | Zero PHI in logs | TESTED | api/log-audit, telemetry |
| 1.1.7 | Numeric-first format, null workout line on Free | TESTED | api/numeric-line, scheduler-push, routes-read (no Today line for pasted plans), gate-report |

## Phase 0 soft gates

| Id | Criterion | Status | Test |
|---|---|---|---|
| 1.2 a | Reply handler usage (why / pause) | NOT CODE | WhatsApp webhook not wired |
| 1.2 b | CDV query usage in-app | TESTED | api/phase1-gates, usage |
| 1.2 c | Validator catch rate trend | TESTED | api/gate-report (caught column) |
| 1.2 d | Per-emission LLM cost under $0.05 | NOT CODE | no cost telemetry yet |

## Phase 1 (Free alpha) hard gates

| Id | Criterion | Status | Test |
|---|---|---|---|
| 2.1.1 | 10 free users onboarded | TESTED | api/phase1-gates |
| 2.1.2 | Open rate 7 of 10 users | NOT CODE | real users; no per-user 10-of-14 report yet |
| 2.1.3 | Voice panel signal (informal) | NOT CODE | Evan, users |
| 2.1.4 | Banned-phrase rate under 0.5% | GAP filled | api/acceptance-gaps (0.5% boundary is a fail) |
| 2.1.5 | Validator fallback rate under 10% | TESTED | api/acceptance-gaps (fallbacks counted; PASS/FAIL against the strict 10% bar, 10.0% fails) |
| 2.1.6 | Coach-forwarding signal | NOT CODE | user check-in |
| 2.1.7 | Twilio approved and stable | NOT CODE | Twilio dashboard |
| 2.1.8 | Plan-aware reads in 60% of workout days | TESTED | api/gate-report (plan-aware gate), plan-read, voice/matcher |
| 2.1.9 | CDV adoption 50% of users | TESTED | api/phase1-gates |
| 2.1.10 | Zero critical voice incidents | NOT CODE | manual review |

## Phase 1 soft gates

| Id | Criterion | Status | Test |
|---|---|---|---|
| 2.2 a | why reply rate 40% | NOT CODE | WhatsApp not wired |
| 2.2 b | Second-week engagement drop under 20% | NOT CODE | real users |
| 2.2 c | Free tier feels valuable | NOT CODE | user quotes |

## Phase 2 (Plan tier) hard gates

| Id | Criterion | Status | Test |
|---|---|---|---|
| 3.1.1 | 100 free users | NOT CODE | real users |
| 3.1.2 | 15% Free to Plan trial | NOT CODE | Stripe not built |
| 3.1.3 | 70% trial to paid | NOT CODE | Stripe not built |
| 3.1.4 | Plan tier open rate 85% | NOT CODE | WhatsApp not wired |
| 3.1.5 | Plan tier churn under 10% | NOT CODE | Stripe not built |
| 3.1.6 | 30-day retention 65% | NOT CODE | real users |
| 3.1.7 | Stripe failure and dispute rates | NOT CODE | Stripe not built |
| 3.1.8 | WhatsApp delivery 99% in 5 min | NOT CODE | Twilio send path not wired |
| 3.1.9 | WorkoutKit push 90% | TESTED | api/plan-gates, manual-plan (watch-sent), ios/ScoraTests (workout export) |
| 3.1.10 | Plan adherence 70% | TESTED | api/plan-gates |
| 3.1.11 | At most 2 adaptations per user per week | TESTED | api/plan-gates |
| 3.1.12 | No plan-quality complaints | NOT CODE | manual review |
| 3.1.13 | App Store approved by Day 50 | NOT CODE | Apple |
| 3.1.14 | Plan tier morning message: drivers + read + workout | TESTED | api/whatsapp (composeDoorbell), scheduler-push (Today line last), routes-read |

## Phase 2 soft gates

| Id | Criterion | Status | Test |
|---|---|---|---|
| 3.2 a | Voice-quality signal continues | NOT CODE | panel |
| 3.2 b | CDV usage growing per user | NOT CODE | real users |
| 3.2 c | LLM cost per Plan user under $0.05/month | NOT CODE | no cost telemetry |
| 3.2 d | Inline chart taps 5x a week | NOT CODE | analytics on device |
| 3.2 e | WorkoutKit acceptance 70% | NOT CODE | Apple Watch users |

## Phase 3 (Coach marketplace) hard gates

| Id | Criterion | Status | Test |
|---|---|---|---|
| 4.1.1 | 5 coaches onboarded | NOT CODE | coach profiles not built |
| 4.1.2 | 5 coaches Stripe Connect complete | NOT CODE | Stripe Connect not built |
| 4.1.3 | 10 athlete-coach matches | NOT CODE | assignments not built |
| 4.1.4 | First marketplace transaction | NOT CODE | not built |
| 4.1.5 | Coach dashboard usage | NOT CODE | not built |
| 4.1.6 | Coach-authored plans within 7 days | NOT CODE | not built |
| 4.1.7 | 100 in-app messages | NOT CODE | messaging not built |
| 4.1.8 | Coach alerts firing | NOT CODE | not built |
| 4.1.9 | 15% platform fee | NOT CODE | not built |
| 4.1.10 | No marketplace complaints | NOT CODE | manual |
| 4.1.11 | Coach plan overrides the AI plan | TESTED | api/plan-adapt, plan-generate, routes-store, routes-adapt, plan-ical, engine/adaptation-rules (API side; coach assignment itself not built) |

## Phase 3 soft gates

| Id | Criterion | Status | Test |
|---|---|---|---|
| 4.2 a | Voice panel 70% "sounds like a human" | NOT CODE | panel |
| 4.2 b | Sunday weekly read has a coach note (Coach tier) | TESTED | voice/matcher (coach note, Coach tier only) |
| 4.2 c | Workout builder usage | NOT CODE | not built |
| 4.2 d | Coach retention | NOT CODE | not built |

## Phase 4+ SLOs and later gates

| Id | Criterion | Status | Test |
|---|---|---|---|
| 5.1 a | Daily delivery rate 99.5% | NOT CODE | production; delivery report logic is TESTED under 1.1.1 |
| 5.1 b | Reply handler p95 10s | NOT CODE | production |
| 5.1 c | CDV p95 8s | NOT CODE | production |
| 5.1 d | Plan generation p95 10s | NOT CODE | production |
| 5.1 e | API uptime 99.9% | NOT CODE | production |
| 5.1 f | Validator catch rate reviewed weekly | NOT CODE | Evan |
| 5.1 g | Banned-phrase rate under 0.5% continuously | TESTED | see 2.1.4 |
| 5.1 h | Voice panel quarterly | NOT CODE | panel |
| 5.1 i | Plan churn under 8% | NOT CODE | Stripe |
| 5.1 j | Coach retention 80% | NOT CODE | not built |
| 5.1 k | Payout SLA | NOT CODE | Stripe Connect |
| 5.2 | Marketplace expansion and Android gates | NOT CODE | business gates |

## 6.1 Voice (always)

| Id | Criterion | Status | Test |
|---|---|---|---|
| 6.1 a | Banned-phrase rate under 0.5% | TESTED | api/validator, validator-hardening, banned-phrases-4-1, acceptance-gaps |
| 6.1 b | Driver-existence validator never bypassed | TESTED | api/validator, voice, routes-read, routes-weekly, routes-misc (chat), card-expand, cdv-check, whatsapp, adaptation-reason, week-so-far, knowledge-retrieval |
| 6.1 c | Nothing sent without validators or fallback | TESTED | api/voice (fallback is itself valid), validator (self-consistency), routes-read, routes-weekly, whatsapp (doorbell refuses an invalid read) |
| 6.1 d | Numeric-first on every morning message | TESTED | api/numeric-line, scheduler-push, whatsapp |

## 6.2 Plan content (always)

| Id | Criterion | Status | Test |
|---|---|---|---|
| 6.2 a | Plans never LLM-invented | TESTED | engine/assembler, template-loader, api/plan-generate (no template, no plan), manual-plan (invented numbers dropped) |
| 6.2 b | Adaptations always show a plain-English reason | TESTED | api/acceptance-gaps (every reason code's fixed sentence passes the reason checks), adaptation-reason, plan-adapt |
| 6.2 c | Weekly volume never past 10% | TESTED; GAP filled | engine/adaptation-rules; engine/acceptance-6-2 (400 generated weeks, every posture) |
| 6.2 d | Long run distances never adapted | TESTED; GAP filled | engine/adaptation-rules; engine/acceptance-6-2 |
| 6.2 e | Race week freezes adaptations | TESTED; GAP filled | engine/adaptation-rules; engine/acceptance-6-2 (also: nothing moves into race week, coach and external plans never adapt) |

## 6.3 Coach experience and 6.4 Marketplace integrity (Phase 3+)

| Id | Criterion | Status | Test |
|---|---|---|---|
| 6.3 a | Coach never sees other coaches' athletes | NOT CODE | coach surface not built |
| 6.3 b | No athlete data before assignment start | NOT CODE | not built |
| 6.3 c | Coach plan changes visible within 60s | NOT CODE | not built |
| 6.3 d | In-app messages 99% | NOT CODE | not built |
| 6.4 a | 15% fee on every transaction | NOT CODE | not built |
| 6.4 b | Payouts on schedule | NOT CODE | not built |
| 6.4 c | Refunds through Stripe only | NOT CODE | not built |
| 6.4 d | 3-retry failed payments | NOT CODE | not built |

## 6.5 Security (always)

| Id | Criterion | Status | Test |
|---|---|---|---|
| 6.5 a | OAuth tokens encrypted at rest | FAILING | api/acceptance-gaps |
| 6.5 b | No PHI in logs | TESTED | api/log-audit, telemetry, delivery (no read text in push lines) |
| 6.5 c | RLS enforced | TESTED | api/migrations (every table has RLS) |
| 6.5 d | HealthKit raw data never sent to LLM | TESTED | api/routes-read |
| 6.5 e | Stripe Connect credentials never in repo | GAP filled | api/acceptance-gaps (scans every tracked file) |

## 6.6 Privacy (always)

| Id | Criterion | Status | Test |
|---|---|---|---|
| 6.6 a | Account deletion within 7 days | NOT CODE | no deletion job; table inventory is TESTED in api/migrations |
| 6.6 b | WhatsApp STOP processed immediately | TESTED | api/whatsapp (opt-out words parse to stop); webhook and stored opt-out not wired yet |
| 6.6 c | Coach relationships end on cancellation | NOT CODE | not built |
| 6.6 d | Data export in Settings | NOT CODE | not built |

## 7 Phase-gate review

| Id | Criterion | Status | Test |
|---|---|---|---|
| 7 a | Gate report script: measured vs threshold | TESTED | api/gate-report, phase1-gates, plan-gates, plan-invariants (2.1.5 verdict added) |
| 7 b | Evan sign-off, lessons, strategy memo, panels, coach survey | NOT CODE | Evan |
