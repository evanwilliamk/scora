SCORA — Product Requirements Document
Version: 1.4 Date: 2026-04-26 Author: Evan Kosowski Status: v1 spec, locked for build Supersedes: v1.3 (2026-04-26 earlier)


0. Cornerstone
The proprietary work is the voice — the library of interpretations, the tone, the way you catch patterns across a week and render them as a sentence. That's taste and data combined. The data gets copied in a week. The voice takes months to clone.

SCORA is a three-tier lifecycle product with a coach platform underneath. The voice is the moat. The Plan tier and Coach marketplace are how the moat monetizes.
0.1 What changed in v1.4
Three-tier ladder replaces single-tier $8/mo. Free / $14 Plan / $200-300 Coach (marketplace with 15% take).
Free tier is the acquisition surface. Interpretation layer + Oura connection included. Meaningful taste; not a stripped experience.
Plan tier is the primary monetization engine. Template-based adaptive plans with named adaptations. WhatsApp doorbell. Inline chart-expansion. Race predictions. Calorie engine. Apple WorkoutKit push.
Coach tier is a marketplace, not a subscription. Athlete pays coach directly through SCORA (Stripe Connect). SCORA takes 15% of the transaction. Coach uses the platform free (revenue via marketplace cut, not per-seat fees).
Voice-vs-Plan distinction is now load-bearing (CLAUDE.md §1). Voice never prescribes. Plans prescribe (deterministic templates, named adaptations, coach-authored content).
Morning message design rule — numeric-first (Evan, 2026-04-26). Every voice claim shows the raw driver value + plain-English translation + interpretation. No smoothed composite scores.
"Actualize the voice" rule — every driver in a voice emission is tappable to a chart. Trust comes from verifiable data.
0.2 How to read this PRD
Anchor numbers for v1 success:

12 of 14 mornings opened during Phase 0 dogfood.
100+ free users active in Phase 1 open ≥10 of 14 mornings.
15% Free→Plan conversion by end of Phase 2.
10 athlete-coach matches by end of Phase 3 (marketplace launch).
70% blind-read voice panel before scale marketing push.


1. Executive summary
SCORA reads an endurance athlete's data (Strava, Apple HealthKit, Oura), interprets it in a curated voice, and delivers a morning read that pairs numeric drivers with plain-English observations. The athlete's plan sits alongside the read — either a plan they built elsewhere and connected (Strava-scheduled, Runna, manual), an adaptive plan SCORA generated in the Plan tier, or a plan their real coach set in the Coach tier.

Delivery: native iOS app (primary surface) + WhatsApp doorbell (Plan and Coach tiers) + Apple WorkoutKit push (workouts on the wrist, Plan and Coach tiers).

Monetization:

Free — acquisition layer, no revenue directly, seeds the funnel.
Plan $14/mo — primary athlete revenue engine.
Coach $200-300/mo (marketplace) — SCORA takes 15%, coach takes 85%. Highest-ARPU per athlete-coach pair.
Coach-side platform — free for coaches; revenue via marketplace cut.

Launch timeline:

Phase 0 (Days 1–14): Dogfood interpretation layer (Free tier features only). Evan on Evan via TestFlight + WhatsApp Sandbox.
Phase 1 (Days 15–35): 10-user closed alpha of Free tier. Includes 1–2 coached athletes for coach-forwarding signal.
Phase 2 (Days 36–65): Launch Plan tier at $14/mo. Template plan library. Apple WorkoutKit push. Stripe subscriptions.
Phase 3 (Days 66–85): Launch Coach marketplace with 5 curated coaches. Stripe Connect. Coach-side dashboard v1.
Phase 4+ (Day 86+): Stabilize, iterate voice, scale marketing, expand template library.


2. Problem statement
Serious endurance athletes collect data from multiple sources — watch, Strava, Oura, sleep tracker. They already have interpretation from Oura ("readiness 78"), Whoop ("recovery green"), Strava's Athlete Intelligence (activity summaries), Garmin's Training Status ("productive"). Those interpretations share three failures:

Smoothed composite scores. Oura's readiness is a black box. Athletes want to see the numbers behind the score.
Single-source silos. Whoop doesn't know your Oura sleep. Oura doesn't know your Strava load. No product reads across sources with equal fidelity.
No plan awareness. Oura, Whoop, Garmin all read the body; none of them know what workout the athlete has scheduled today. Interpretation without plan context is half a read.

Existing tools that DO include plan context (Runna, TrainerRoad, TrainingPeaks + coach) are prescriptive first, interpretive second. They tell you what to do; they don't explain why the body is where it is.

The gap SCORA fills: read every source, know the plan, name the pattern in plain English with the raw numbers visible. Non-prescriptive interpretation layered on top of a plan (external, SCORA-generated, or coach-authored).


3. Goals and non-goals
3.1 v1 goals (free tier, Phase 0-1)
Read Strava + Apple HealthKit + Oura into a unified daily record.
Compute deterministic daily posture.
Render a numeric-first morning message: values + translation + interpretation.
Deliver via APNS push (free tier) with app dashboard for depth.
Support external plan reading (Strava-scheduled activities, Runna, manual entry) so plan-aware read works for anyone with a plan.
Chat-driven custom visualization (3 queries/day free).
Curated dashboard with cards (Sleep, Load, Intensity, Recovery, Long Effort, Plan Today, Connections).
Weekly read on Sunday (delayed 24h on free tier).
3.2 Phase 2 goals (Plan tier launch)
Stripe subscription infrastructure ($14/mo, $130/yr).
Adaptive training plan generator (template-based).
Named plan adaptations engine (deterministic rules).
Apple WorkoutKit push (workouts on Apple Watch).
WhatsApp doorbell delivery (Twilio Business API).
Inline chart-expansion on voice claims.
Race predictions and calorie engine.
Onboarding path for Plan tier setup (goal race + date + volume).
3.3 Phase 3 goals (Coach marketplace launch)
Coach onboarding + Stripe Connect account creation.
Athlete-coach matching flow (browse coaches, book coach).
Coach-side dashboard v1 (multi-athlete grid, per-athlete detail, workout builder).
Marketplace payments via Stripe Connect (15% platform fee).
Coach's plan overrides SCORA's AI plan when active.
Direct in-app messaging between coach and athlete.
3.4 Permanent non-goals (out of scope forever)
Voice prescribing workouts.
LLM-invented workout structures.
Coach cannibalization / anti-coach positioning.
Medical / injury diagnosis.
Social feed.
Route discovery.
Activity recording.
Hardware.
3.5 Deferred (not v1, may return)
Android client (Phase 5+).
Web companion app (Phase 4+ as coach dashboard).
Garmin Connect direct plan integration (Phase 3+).
TrainingPeaks direct plan integration (Phase 3+, coach-driven).


4. Positioning
Category (internal): interpretation layer + training platform + coach marketplace.

Category (external): Your training companion.

Free tier one-liner: Your training, read every morning. Free.

Plan tier one-liner: Your plan, read every morning. Adjusted when your body says so. $14/mo.

Coach tier one-liner: Everything above, plus a real coach who watches your data with you. From $200/mo.

Anti-positioning: Not an AI coach (voice is not a coach). Not a workout dispenser (plans are structured, adapted with reasons). Not a Strava replacement.

Price anchor for Plan tier: "$14/mo for the reads and the plan. What a coach charges $250/mo to do, minus the human. Or upgrade to a real coach when you're ready."

Price anchor for Coach tier: "$250/mo for a real coach. Same rate as coaches charge outside SCORA. You get the platform + your coach for the same price you'd pay them alone — because SCORA takes 15% of your coach's fee, not from you."


5. Features by tier
5.A — Free tier features
5.A.1 Onboarding
Sign in with Apple (creates account, zero-dollar Stripe customer for future upgrade path).
Connect Strava (OAuth) — required.
Connect Apple HealthKit (native permissions) — required.
Connect Oura (OAuth) — optional but strongly encouraged.
Time zone + preferred morning notification time (default 6 AM local).
Optional: paste/upload existing training plan for plan-aware read.

Target: <3 minutes from app open to "your first read tomorrow morning."
5.A.2 Daily read (APNS push)
Delivery: APNS push at user's local 6 AM (or configured time).

Content:

Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412

Body is settled — sleep held for the second night and HRV is climbing. Load is where it should be.

Tap-through opens the app to Today's Read at the top of the dashboard.
5.A.3 Dashboard
Sections:

Today's Read (posture badge + rendered voice + numeric drivers displayed prominently)
Cards: Sleep, Training Load, Recent Intensity, Recovery Signal, Long Effort Recency, Plan Today (if plan connected), Connections
Week So Far (mini visual + one-line voice)
Sunday Read (Sundays only, 24-hour delayed on free tier)

Card interaction: tap to expand. Card-level expansion opens a modal with the SCORA-voice interpretation of the card. Inline (word-level) chart-expansion is Plan-tier gated.
5.A.4 Chat-driven custom viz (CDV)
Bottom input bar: "Ask anything about your training…"

Free tier: 3 queries per day. Additional queries return: "You've used your 3 free viz queries today — upgrade to Plan for unlimited exploration."
5.A.5 Weekly read (Sunday)
Free tier: delivered Monday morning (24h delayed). Plan tier: delivered Sunday morning.

Forwardable card image generated server-side. iOS native share sheet available in the app.
5.A.6 Plan-aware reads (all tiers)
If athlete has connected a plan source (Strava scheduled activities, Runna, manual entry), the voice reads the plan + body together:

"Today's tempo is on your plan, and your body is settled — the plan reads cleanly this morning."

Plan sources supported at Free tier:

Strava scheduled activities (automatic if user has upstream plan syncing to Strava).
Manual entry — paste a plan text, LLM parses into structured scheduled_workouts rows.

Plan sources added at Plan tier:

SCORA-generated adaptive plan (see §5.B).

Plan sources added at Coach tier:

Coach-authored plan (see §5.C).


5.B — Plan tier features ($14/mo)
Everything in Free tier PLUS:
5.B.1 Adaptive training plan
Template-based generation. Athlete inputs:

Goal race (5K, 10K, half, marathon, 50K, 100K, gravel, century, tri)
Race date
Current weekly volume
Experience level (first race / regular racer / competitive)

SCORA selects the appropriate template from the coach-authored library, scales it to current volume, populates the calendar.

Plan as persistent object. Athlete sees the whole plan structure — this week, next week, block phases, race at the end. Not a fresh generation each morning.

Named adaptations. When body state contradicts what the template calls for, deterministic adaptation rules trigger:

posture = rest + hard workout scheduled today → move to next available window. Named reason.
posture = back-off + intervals today → downgrade to steady-state, same duration. Named reason.
posture = primed + easy today → no adaptation.
Race-week: freeze adaptations.
Weekly volume never adapts >±10%.
Long runs never adapt in distance.
Missed workouts require user acknowledgment; no auto-reschedule.

Every adaptation shows: what changed, when, why. Athlete can see full adaptation history.
5.B.2 WhatsApp doorbell
Delivery: WhatsApp via Twilio at user's local 6 AM.

Content:

Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412

Body is settled — sleep held for the second night and HRV is climbing. Load is where it should be.

Today: 45 min tempo · 3 × 8 min at threshold, 3 min recovery

Full read: {deep_link}

Reply handler: why / more / pause N / resume / stop / help. See CLAUDE.md §4.

If APNS is also enabled: WhatsApp is primary, APNS suppressed.
5.B.3 Apple WorkoutKit push
Today's plan workout appears on the athlete's Apple Watch as a structured workout via WorkoutKit. Intervals, cues, durations. Athlete taps "Start" on the watch and the workout runs with prompts.

Enabled by default for Plan/Coach tiers. Athlete can toggle off in Settings.
5.B.4 Inline chart-expansion on voice claims
Every driver referenced in a voice emission is a tappable link. Tap "HRV" in the read → opens a mini-chart of HRV over the last month with the current value and deviation highlighted. Tap "load" → chart of daily load. Etc.

This is what "actualizes the voice." Free tier gets card-level expansion; Plan tier adds word-level linking.
5.B.5 Unlimited CDV queries
Soft limit ~30/day for cost management. Above that, throttled with a message: "That's a lot of asking today — try again in a bit."
5.B.6 Race predictions
For any race event on the plan, SCORA generates a predicted time based on:

Current fitness (peak load + best long efforts)
Plan progression
Recent race performance (from Strava)
Body state trend

Predictions update weekly. Displayed as a range (e.g. "3:42 – 3:52 based on current fitness"). Never a single overconfident number.
5.B.7 Calorie engine
Better estimate than watch defaults using:

Body weight
Workout duration
HR data
Elevation
Sport-specific coefficients

Positioned as "better than generic watch estimates," not medical.
5.B.8 Unlimited data history
Free tier caps at 90 days. Plan tier: all data available, all cards can show longer trend windows.


5.C — Coach tier features (marketplace)
Athlete pays coach $200-300/mo through SCORA (Stripe Connect). SCORA takes 15%; coach takes 85%.

Everything in Plan tier PLUS:
5.C.1 Coach assignment
Athlete browses coach directory in-app:

Coach profile (bio, credentials, sport specializations, athlete testimonials, price)
Coach pricing (each coach sets their own $200-300 range)
"Book coach" flow → confirmation → Stripe Connect payment authorized

Once assigned:

Athlete's Plan tier "generate my plan" option is HIDDEN. The plan they see is their coach's plan.
Coach appears in the app as "Your coach: {name}."
Direct in-app messaging surface unlocks.
5.C.2 Coach-authored plan
Coach uses the coach-side dashboard (§5.D) to build the plan. The plan flows to the athlete via the same scheduled_workouts table. To the athlete, the experience is the same: dashboard shows Plan Today, WhatsApp doorbell includes today's workout, Apple WorkoutKit push works identically.

The difference: adaptations flow through the coach, not through the deterministic engine. The coach reviews adaptation-worthy signals (poor sleep streaks, HRV crashes, missed workouts) and manually adjusts the plan.
5.C.3 Coach-athlete messaging
Two surfaces:

App messages — persistent chat thread in the app.
Weekly coach note — coach writes a short weekly summary that appears in the athlete's Sunday read.

Coach messaging is inside the app. No WhatsApp integration for coach-athlete chat (v1). Notifications via APNS push.
5.C.4 Ending a coach relationship
Athlete or coach can end anytime. On end:

Subscription cancels at end of current billing period.
Coach's plan remains visible for 30 days, then archives.
Athlete drops back to Plan tier (or Free if they were on the coach-included tier).


5.D — Coach-side platform (free for coaches, monetized via marketplace cut)
5.D.1 Coach onboarding
Apply as coach → SCORA reviews (v3+ curated marketplace of 5-20 coaches; scales up carefully).
Stripe Connect Express account setup.
Profile creation (bio, credentials, specializations, testimonials, price).
Marketplace listing.
5.D.2 Multi-athlete dashboard
Grid view of all coach's athletes. Per-athlete summary: current posture, plan adherence (last 7 days), next race, key signals (missed workouts, poor sleep streaks, HRV trends).

Sort/filter by: athlete, next race date, risk flags, last check-in.
5.D.3 Workout builder
Drag-and-drop structured workout editor. Interval-based. Coach can build one-off workouts or save as templates.

Supported workout structures:

Warmup + intervals + cooldown
Long steady effort
Fartlek (varied intensity in one workout)
Multisport (swim/bike/run brick)

Structured workout stored as JSON matching Apple WorkoutKit schema for direct watch push.
5.D.4 Plan builder
Weekly calendar. Coach drags workouts onto specific days. Recurring templates (e.g. "Tuesday tempo" recurring for 12 weeks) supported.

Plans can be authored per-athlete or as templates coaches use across their book.
5.D.5 Analytics per athlete
Fitness/fatigue (CTL/ATL/TSB) — the TrainingPeaks-equivalent view.
Weekly load distribution.
Long-run history.
Race performance history.
Voice emissions log (what has SCORA been telling this athlete).
5.D.6 Athlete monitoring alerts
Configurable per coach:

Missed workout N times.
Sleep < user_p25 for 3+ consecutive nights.
HRV -10% for 5+ consecutive days.
RHR +5% for 5+ consecutive days.
Athlete has not opened the app in N days.

Alerts push to coach via APNS + optional email digest.


6. Data model changes from v1.3
New tables added in v1.4 (full schemas in Architecture doc):

training_plans — an assigned plan for a user (either SCORA-generated or coach-authored).
plan_templates — the coach-authored library.
scheduled_workouts — write-enabled (v1.3 was read-only from external sources).
plan_adaptations — every adaptation event with reason.
coach_profiles — coach directory.
coach_athlete_assignments — the assignment relationship.
marketplace_transactions — Stripe Connect payment records.
messages — coach-athlete in-app messaging.
subscription_tiers — Free / Plan / Coach state per user.


7. User journeys
7.1 Free tier onboarding
Aaron installs the app after seeing a TikTok. Signs in with Apple. Connects Strava (OAuth). Connects Apple HealthKit (permissions). Skips Oura. Enters phone but skips WhatsApp opt-in (only for Plan tier). Confirms 6 AM. Screen: "Your first read lands tomorrow morning." Total time: ~90 seconds.
7.2 First morning read (Free tier)
6 AM. APNS push lands. Content preview:

Sleep 7:14 · HRV 42ms · Load 285. Body's finding its rhythm.

Aaron taps. App opens to dashboard. Reads today's read at the top. Taps Sleep card. Modal expands with SCORA-voice interpretation: "Sleep at 7 hours 14 minutes — right in your normal window. Nothing to flag." Scrolls dashboard. Closes app.
7.3 Free → Plan upgrade
After running two half marathons over four months, Aaron opens SCORA and sees a subtle upgrade nudge in Settings: "Get a plan for your next race." Taps → landing screen: "Adaptive training plans built from proven periodization templates. Named adaptations when your body needs a change. $14/mo. Try 7 days free." Taps "Start trial." Stripe web checkout in Safari View Controller. Card entered. Returns to app. Plan setup flow: selects "marathon," enters race date, enters current volume (25 mi/wk), experience level (regular racer). SCORA generates a 16-week marathon build plan. Aaron sees the calendar. Tomorrow's workout is on his Apple Watch.
7.4 Plan tier morning read
6 AM. WhatsApp:

Sleep 6:42 · Oura 71 · HRV 38ms (-9% wk) · Load 512

You're two nights of thin sleep in, and HRV is trending down. The plan calls for tempo intervals today — a call worth thinking about.

Today: 45 min tempo · 4 × 6 min at threshold, 2 min recovery

Full read: {link}

Aaron replies "why". WhatsApp response 8 seconds later:

HRV dropping this fast usually shows up before subjective fatigue. Sleep at 6:42 is below your 30-day average by 45 minutes. Tempo would land on a body already working overtime.

Aaron opens the app. Sees inline chart-expansions on "HRV" and "Sleep." Taps the workout card — sees it's already been auto-moved to Wednesday with the reason: "Moved because HRV -9% and sleep short 2 nights running."
7.5 Plan → Coach upgrade
After his marathon, Aaron wants to move up to ultras. Opens the coach directory in-app. Filters for "ultra runners." Reads three coach profiles. Books Sarah Jones at $275/mo. Stripe Connect payment authorized. Sarah appears in his app as "Your coach: Sarah Jones." His AI plan disables. Sarah sees him in her multi-athlete dashboard. She builds his first four weeks of plan by end of day. Aaron receives an in-app message: "Hey Aaron — took a look at your recent data. Excited to work together. Your week is on your calendar."
7.6 Coach signals into Sunday read
Sunday morning. Aaron's WhatsApp:

Week 3 of 12 · Load 623 · Sleep avg 7:04 · HRV steady

A clean training week — three quality efforts, sleep held, HRV steady. Body is absorbing the block.

Sarah's note: "Nice work this week. Next week we start the first long block. Focus on nutrition on Saturday's long."

View the week: {link}


8. API surface (v1.4)
Detailed in Architecture doc. Family additions vs v1.3:

/plan/* — plan CRUD (Plan/Coach tiers), template listing, adaptation history.
/coach/* — coach directory, coach profile, book coach.
/marketplace/* — Stripe Connect flows, payment status.
/messages/* — coach-athlete messaging.
/coach-side/* — coach-side dashboard endpoints (multi-athlete view, workout builder, plan builder, alerts).


9. Non-functional requirements (updated)
Daily delivery window (Plan tier WhatsApp): 6 AM ± 5 minutes user local time. <1% delivery failure.
Plan generation time: <10 seconds for a 12-week plan.
Plan adaptation compute: nightly cron; per-user compute <1s.
CDV query latency p95: <8 seconds end-to-end.
Reply handler latency p95: <10 seconds.
Coach dashboard load p95: <2 seconds.
Stripe Connect payout SLA: standard (2 business days).
Infrastructure cost target at 1,000 total users (600 Free + 400 Plan + 20 Coach pairs): <$0.20 per user per month.
LLM cost target: <$0.03/paying user/month for morning read; <$0.05/user/month for CDV; <$0.02 per plan generation.


10. Metrics + phase gates
Detailed in 10_SCORA_Acceptance_Criteria_v2.md. Summary:

Phase 0 (Days 1-14): Evan dogfood — 12/14 opens, zero banned-phrase hits, ≥1 "wow" moment.
Phase 1 (Days 15-35): 10-user free alpha — 7/10 open ≥10 of 14 days, coach-forwarding signal, banned-phrase <0.5%.
Phase 2 (Days 36-65): Plan tier launch — 100 free users, 15% Free→Plan conversion, plan adherence tracking begins.
Phase 3 (Days 66-85): Coach marketplace — 5 coaches onboarded, 10 athlete-coach matches, first marketplace transaction, coach dashboard v1 shipped.
Phase 4+ (Day 86+): Scale + iterate.


11. Risks (updated for v1.4)


12. Assumptions
Endurance athletes will pay $14/mo for an adaptive plan + read (Runna's $14/mo pricing validates).
Endurance athletes will pay $200-300/mo for a coach through a platform (existing coach market validates).
Coaches will accept 15% platform fee for lead flow + tooling (adjacent marketplaces at 15-30% validate).
Free tier converts to Plan at ≥15%.
Plan tier retention ≥60% at 30 days.
80%+ of the wedge ICP is on iPhone.
Apple Business Chat won't be a viable messenger channel (rejected in favor of WhatsApp).


13. Change log
v1.0 (2026-04-22): Initial PRD, native iOS + readiness score.
v1.1 (2026-04-22): Added cornerstone, Oura priority, Interpretation Engine framing.
v1.2 (2026-04-23): Reframed around WhatsApp-first delivery + dogfood MVP.
v1.3 (2026-04-26 earlier): Reverted to native iOS + WhatsApp messenger. Added chat-driven custom viz. Cut "coach" from external copy.
v1.4 (2026-04-26 later): Three-tier ladder (Free / Plan $14 / Coach marketplace). Plan tier feature spec. Coach marketplace spec. Numeric-first morning message design rule. "Actualize the voice" inline chart-expansion. Voice-vs-Plan distinction load-bearing.

Risk | Severity | Phase | Mitigation
Twilio WhatsApp approval slow | High | Phase 2 | Apply Day 1. Sandbox for Phase 0. APNS as primary daily channel for Free tier (WhatsApp is Plan-only anyway).
Voice fails to generalize past Evan | Critical | 1 | Pattern library expansion. Fallback: pause user growth until voice iterates.
Plan quality poor (users abandon plans) | Critical | 2 | Coach-authored templates from proven periodization. Real coaches review generated plans in Phase 2.
Coaches don't sign up for marketplace | High | 3 | Curated recruit of 5 coaches from Evan's network to seed. Warm intros only.
Marketplace 15% cut resented by coaches | Medium | 3 | Frame as acquisition fee (much cheaper than paid ads). Coaches keep 85%.
Apple rejects Stripe web checkout for Plan | Medium | 2 | Fall back to Apple IAP, absorb 30%. Raise Plan tier to $16/mo to preserve unit economics.
Coach cannibalization concerns | Medium | 3 | Explicit positioning: AI Plan is pre-coach segment. Coach's plan overrides AI plan when active.
Free tier freeloader ratio too high | Medium | 2 | Free tier is generous but obviously less than Plan. Gates were set at launch, not later.
Stripe Connect payout complexity | Medium | 3 | Use Stripe Express accounts. Standard payout schedule.