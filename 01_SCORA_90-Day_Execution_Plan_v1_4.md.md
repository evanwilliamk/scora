SCORA — 90-Day Execution Plan
Version: v1.4 Date: 2026-04-26 Supersedes: v1.3 Companion to: 02_SCORA_PRD_v1.4.md, 07_SCORA_Architecture_Data_Model_v2.md, 10_SCORA_Acceptance_Criteria_v2.md


0. Cornerstone (unchanged)
The proprietary work is the voice — the library of interpretations, the tone, the way you catch patterns across a week and render them as a sentence. That's taste and data combined. The data gets copied in a week. The voice takes months to clone.


0.1 What changed in v1.4
Three-tier ladder replaces single-tier $8/mo. Free / Plan $14 / Coach ($200-300 marketplace with 15% SCORA take).
Phase 1 is Free tier alpha (not paid alpha). 10 users on Free tier for 21 days.
Phase 2 launches Plan tier. Stripe subscriptions + template plan library + Apple WorkoutKit push + WhatsApp doorbell.
Phase 3 launches Coach marketplace. 5 curated coaches + Stripe Connect + coach-side dashboard v1.
Solo bootstrapper economics intact. Free tiers to Phase 1; paid infra starts Phase 2 revenue.
Non-negotiable v1 additions from tonight's conversation: plan-aware reads (v1), inline chart-expansion on voice claims (Plan tier), template-based adaptive plans with named adaptations (Plan tier), coach marketplace with athlete-pays / coach-free / SCORA-takes-15% economics (Phase 3).


0.2 Anchor numbers for 90 days
12 of 14 mornings opened in Phase 0 (Evan on Evan).
7 of 10 users open ≥10 of 14 days in Phase 1 (Free tier alpha).
100 free users → 15 Plan tier conversions by end of Phase 2 (15% conversion rate).
5 coaches onboarded + 10 athlete-coach matches by end of Phase 3.
70% blind-read voice panel before scale marketing.


1. Phase 0 — Dogfood (Days 1–14)
Goal: Evan-on-Evan. Free tier features only. TestFlight + Twilio Sandbox.
1.1 Scope
Same as v1.3 Phase 0:

iOS app skeleton (Sign in with Apple + dashboard + Today's Read + Connections + basic CDV).
Backend API: auth, Strava OAuth, Oura OAuth (yes — free tier includes Oura), HealthKit POST, posture engine, pattern library v0.3 with 20+ ported entries, daily-read prompt + render pipeline, validators.
Background worker: nightly posture computation, 6 AM APNS delivery (WhatsApp is Sandbox for Evan only).
Postgres on Supabase free tier + Redis on Railway free credit.

Not in Phase 0: Stripe checkout, plan generation, WhatsApp Business API (Sandbox is fine), coach marketplace, WorkoutKit push, App Store submission.
1.2 Build schedule (14 days, solo full-time)
1.3 Dogfood execution (Days 14 → 28)
Every morning: receive APNS at 6 AM (WhatsApp Sandbox for text preview). Open. Open app. Notice the read.
Log a sentence per day in dogfood-log.md.
Tag ≥1 read/week as "wow."
Track Phase 0 gates (Acceptance Criteria v2 §1).
1.4 Phase 0 exit
All hard gates pass 14 consecutive days. Evan signs off in dogfood-log.md.


2. Phase 1 — Free tier alpha, 10 users (Days 15–35)
Goal: 10 real athletes on Free tier. Voice generalizes. CDV shipped. Coach-forwarding signal observed.
2.1 Recruiting
10 athletes from Evan's network (runners + cyclists, 28-45, Strava users, ideally Oura users).
1-2 must have a real coach (for coach-forwarding signal).
All onboard manually; no self-serve yet.
Free tier — no charge. Simple one-page informed consent.
2.2 New scope vs Phase 0
Twilio Business API approved (target Phase 1 Day 5). Switch from Sandbox.
CDV layer shipped (input bar + cdv-spec prompt + Vega-Lite WebView + query pipeline).
Card tap-to-expand (card-level expansion — inline chart-expansion is Plan tier, comes Phase 2).
Sunday weekly read — weekly-read prompt + forwardable card image generation (delayed 24h for Free tier is set here).
Onboarding flow polished for Phase 2 self-serve readiness.
Reply handler v1 (why / more / pause / resume / stop / help).
Manual plan entry — athletes can paste a plan text; LLM parses into scheduled_workouts. This enables plan-aware reads for anyone with a plan, even at Free tier.
Strava scheduled activities ingestion — automatic plan-awareness for users whose plans sync to Strava.
PostHog + Sentry wired up.
Pattern library expansion (5+ new v0.3 entries based on Phase 0 emission gaps).
2.3 Build schedule (Days 15-35)
2.4 Phase 1 exit
All hard gates in Acceptance Criteria v2 §2.1 pass over 21-day window. Evan documents ≥3 specific user moments.


3. Phase 2 — Plan tier launch, 100 users → 15 paid conversions (Days 36–65)
Goal: Ship the $14/mo Plan tier. Convert 15% of Free users. Prove plan-tier retention.
3.1 New scope vs Phase 1
Stripe subscriptions live — Payment Links, Customer Portal, webhook handling for subscription_tiers state.
Plan generation shipped — template library (2-3 initial templates: half marathon 12-week 3 tiers + marathon 16-week 3 tiers as MVP), plan-engine assembler, adaptation-rules deterministic engine.
Apple WorkoutKit push — structured workouts on Apple Watch.
WhatsApp doorbell for Plan tier — outbound daily at 6 AM with numeric drivers + interpretation + workout summary.
Inline chart-expansion on voice claims (Plan tier only, upgrades card tap-to-expand behavior).
Marketing site at scora.app — landing, pricing (Free vs Plan), CTA to Stripe checkout.
App Store listing approved + live (target Day 50).
Self-serve onboarding flow.
Voice iteration — pattern library expansion based on Phase 1 emission gaps.
Race predictions + calorie engine for Plan tier.
3.2 Plan template library — MVP scope
To ship Plan tier at Phase 2, we need at minimum these templates:

Half marathon 12-week (novice, intermediate, experienced) — 3 templates
Marathon 16-week (novice, intermediate, experienced) — 3 templates
10K 10-week (intermediate) — 1 template

Total: 7 templates as Plan tier launch MVP. Expand to full 20-template library during Phase 3-4.

Sourcing: Evan authors initial templates using Daniels/Pfitzinger/first-principles frameworks; pays 1 respected coach for review and sign-off before launch. Budget: ~$500-1500 for review (revenue from Phase 2 can cover; or Evan absorbs).
3.3 Acquisition channels
Same as v1.3 Phase 2: warm intros, Strava clubs, one creator partnership, Reddit, Substack mentions. No paid acquisition in Phase 2.

Free tier expansion is priority — grow to 100+ free users so 15% Plan conversion = 15+ paying users.
3.4 Build schedule (Days 36-65)
3.5 Phase 2 exit
All hard gates in Acceptance Criteria v2 §3.1 pass over 30-day window. 100+ free users, 15+ Plan tier subs, LLM/infra economics on track.


4. Phase 3 — Coach marketplace launch (Days 66–85)
Goal: 5 curated coaches onboarded, 10 athlete-coach matches, first marketplace transactions.
4.1 New scope vs Phase 2
Stripe Connect setup — platform account + Express connected accounts for coaches.
Coach onboarding flow — application, Express account creation, profile setup, marketplace listing.
Coach directory in-app — browse, filter, view coach profiles.
Coach booking flow — Stripe Connect direct charge with 15% application fee.
Coach-side dashboard v1 — multi-athlete grid, per-athlete detail, minimal workout builder (edit + save workouts on the calendar), plan review + adjust.
In-app messaging — coach-athlete chat, APNS delivery.
Weekly coach note — surfaces in athlete's Sunday read.
Coach alerts — configurable, APNS delivery to coach.
Coach's plan overrides AI plan — when assignment is active, AI plan is hidden; coach's plan is shown.
4.2 Coach recruiting
Curated. Not open-marketplace. 5 coaches for Phase 3:

2 running coaches (marathon + ultra specialists)
2 cycling coaches (road + gravel)
1 triathlon coach

Warm intros from Evan's network. Each coach signs a Phase 3 alpha agreement: they get free platform access + preferential marketplace listing during Phase 3-4 in exchange for early adoption.
4.3 Build schedule (Days 66-85)
4.4 Phase 3 exit
Acceptance Criteria v2 §4.1: 5 coaches active, 10 athlete-coach matches, first marketplace transactions successful, coach dashboard functional, no critical incidents.


5. Phase 4+ — Stabilization + iteration (Day 86+)
Daily SLOs enforced.
Voice quality panel (formal 20-person blind-read) runs Days 86-95. Gate for scale marketing.
Template library expansion (add remaining 13 templates: 5K, ultra, cycling variants, tri variants).
Coach marketplace scales (recruit 10-20 more coaches).
Paid acquisition test ($50/day) if voice panel passes 70%.
Iterations on plan adaptation rules based on real-world data.


6. Non-goals in the 90-day window
Android client (Phase 5+, gated on iOS PMF signal).
Web companion (Phase 4+ possibly for coaches).
Garmin Connect direct integration (Phase 4+).
TrainingPeaks direct integration (Phase 4+).
Public open-marketplace (curated only during Phase 3-4).
LLM-generated plan structures (permanently out of scope — always template-based).


7. Risk register (updated for v1.4)


8. Decision log
Additions this session:

2026-04-26 later: Three-tier ladder locked (Free / Plan $14 / Coach marketplace).
2026-04-26 later: Plan tier features locked (WhatsApp doorbell, unlimited CDV, inline chart-expansion, adaptive template plans with named adaptations, WorkoutKit push, race predictions, calorie engine).
2026-04-26 later: Coach marketplace mechanics locked (Stripe Connect Express, 15% platform fee, athlete-pays direct, coach free platform access via marketplace cut).
2026-04-26 later: Coach cannibalization resolved via marketplace framing (coaches get lead flow + free tools; SCORA extracts value from athlete-coach transactions).
2026-04-26 later: Voice-vs-Plan distinction load-bearing. Voice never prescribes; plan does. Two separate objects.
2026-04-26 later: Numeric-first morning message design principle (Evan). Raw drivers + interpretation + workout.
2026-04-26 later: "Actualize the voice" principle (Evan). Every driver referenced tappable to a chart.
2026-04-26 later: Oura in Free tier (wedge ICP argument).
2026-04-26 later: Free tier boundaries set at launch, no gating later.


9. Infrastructure costs (updated)

Infra:revenue ratio at Phase 3: ~3% — healthy for consumer SaaS + marketplace.


10. Tools + accounts (updated)
Same as v1.3 plus:



11. Change log
v1.0 (2026-04-22): Initial 90-day plan.
v1.1 (2026-04-22): Cornerstone + non-prescriptive framing.
v1.2 (2026-04-23): WhatsApp-first + Evan-on-Evan MVP.
v1.3 (2026-04-26 earlier): Native iOS + WhatsApp messenger. CDV as v1 feature.
v1.4 (2026-04-26 later): Three-tier ladder (Free / Plan / Coach marketplace). Plan tier feature spec (template plans + WorkoutKit + inline chart-expansion). Coach marketplace with Stripe Connect. Numeric-first morning message design.

Days | Work
1-2 | Repo setup, Supabase + Railway + Twilio Sandbox + Apple developer + Stripe (later) + domain scora.app. Apply for Twilio WhatsApp Business API — longest lead time.
3-4 | Backend API skeleton, DB migrations (users, subscriptions, oauth_tokens, whatsapp_contacts, strava_activities, oura_sleep, healthkit_samples, daily_posture, pattern_emissions, message_events, subscription_tiers). Sign in with Apple.
5-6 | Strava OAuth + ingestion + backfill. Oura OAuth + ingestion + backfill. HealthKit POST endpoint.
7 | Posture engine (packages/posture) + unit tests.
8 | Pattern Library port: audit v0.1 against v0.3 banned-phrase list, port 20 highest-priority entries to v0.3 YAML in packages/voice/patterns/.
9 | Validator package (packages/validator) + unit tests.
10 | LLM render pipeline (daily-read prompt v2, retry/fallback, cost telemetry).
11 | Twilio Sandbox integration + 6 AM APNS + reply handler (why / pause / stop). Twilio Sandbox works with just Evan's phone.
12 | iOS app: Sign in with Apple, Connections screen, Today's Read screen with numeric-first display, dashboard cards. HealthKit native read.
13 | End-to-end test. Seed Evan's record with real OAuth tokens. First test message.
14 | First real morning read delivered. Dogfood begins.
Days | Work
15 | Apply App Store TestFlight expansion (10 users). Confirm Twilio BA.
15-18 | CDV layer (input bar, cdv-spec prompt, Vega-Lite WebView, query pipeline).
19-21 | Card tap-to-expand + card-expansion prompt.
22-24 | Sunday weekly read + forwardable card image (server-side PNG via @vercel/og or Puppeteer).
25-27 | Reply handler expansion (more, help, edge cases). Twilio production sender.
28-30 | Manual plan entry surface + LLM plan parsing prompt. Strava scheduled activities ingestion.
31 | Phase 1 alpha kickoff. 10 users onboarded manually.
32-35 | Observe. Adjust pattern library. Address user-reported issues.
Days | Work
36-40 | Stripe integration — Payment Links, Customer Portal, webhooks, subscription_tiers state machine.
41-45 | Plan engine — template loader, assembler, adaptation rules engine + full unit test coverage. Plan template YAML files for 7 MVP templates.
46-48 | Plan generation LLM prompts (workout-description, plan-summary). Plan-aware daily-read + weekly-read updates.
49-52 | Apple WorkoutKit integration — client-side scheduling, structured workout mapping, server-side workout_kit_pushed tracking.
53-55 | WhatsApp doorbell for Plan tier — Twilio template approval for daily_read_plan_v1, delivery cron.
56-58 | Inline chart-expansion — dashboard update, card-expansion prompt update, chart data endpoints.
59-60 | Marketing site at scora.app — landing, pricing, FAQ. App Store submission.
61 | Self-serve onboarding live. Public signups accepted.
62-65 | Active acquisition. Refine conversion funnel. First upgrade nudges tested.
Days | Work
66-70 | Stripe Connect setup — platform config, Express account onboarding flow, direct charges with application_fee_amount = 15%.
71-73 | Coach profile schema + onboarding UI (in-app for coaches, initial version is coach-side settings). Coach directory grid + coach detail page for athletes.
74-77 | Coach-side dashboard — multi-athlete grid, per-athlete detail, plan calendar view, coach-authored plan builder (edit workouts, drag calendar, save as coach template).
78-80 | In-app messaging — chat thread UI, APNS delivery, weekly coach note surface in Sunday read.
81-82 | Coach alerts — deterministic evaluation cron, alert types (missed workouts, sleep streak, HRV crash, RHR elevation, app inactive), APNS delivery to coach.
83-84 | Recruit 5 coaches; onboard them via Stripe Connect Express.
85 | Marketplace goes live. First athlete-coach match.
Risk | Severity | Phase | Mitigation
Twilio BA approval slow | High | 0-2 | Apply Day 1. Sandbox for Phase 0. APNS as primary daily channel for Free tier (WhatsApp is Plan-only anyway).
Voice fails to generalize past Evan | Critical | 1 | Pattern library expansion. Fallback: pause user growth, iterate voice.
Plan quality poor (users abandon plans) | Critical | 2 | Coach-review sign-off before ship. Real coaches review Phase 2 sample plans. Adaptation rules bounded.
Coach recruiting fails | Medium | 3 | Curated warm-intro list of 15 candidates for 5 slots. Free platform access + preferential listing incentive.
Coach cannibalization concerns from recruits | Medium | 3 | Explicit framing: pre-coach segment is the AI Plan audience. Coach's plan wins when active. Coach retains 85% of transactions.
Apple rejects Stripe web checkout for Plan | Medium | 2 | Fall back to StoreKit IAP, absorb 30%. Price shift $14 → $16/mo.
Free tier freeloader ratio too high | Medium | 2 | Free tier bounded at launch. Not to be gated later. Track conversion rate; iterate free-vs-paid feature split if conversion <10%.
Stripe Connect payout complexity | Medium | 3 | Standard payouts. Express accounts. Nightly reconciliation cron.
WorkoutKit integration slippage | Medium | 2 | Fall back to app-only display of today's workout. WorkoutKit push is Plan tier value-add, not must-have.
Founder burnout | High | All | Realistic pacing. Voice work needs distance. No more than 5 build days in a row.
LLM cost spike | Medium | 2-3 | Caching. Cheaper models for spec generation. Per-user daily caps.
Strava API tightening | Medium | All | Partner application Day 1. Read-only scopes. Never position as Strava replacement.
Phase | Users | Infra target | Notes
Phase 0 (1 user) | 1 | $0 | All free tiers
Phase 1 (10 free users) | 10 | <$25/mo | Free tiers hold; Twilio BA ≈ $10 setup fees; OpenAI ≈ $5
Phase 2 (100 free + 15 paid) | 115 | <$70/mo on ~$210/mo gross | Supabase Pro ($25), Twilio ≈ $15, OpenAI ≈ $15, Railway $10, others free
Phase 3 (~200 free + 30 paid + 10 coach pairs) | 240 | <$100/mo on ~$3,000/mo gross | Same infra scaled, +Stripe Connect fees, +coach alert compute
Tool | Purpose | Phase
Stripe Connect | Marketplace payments | Phase 3
Apple WorkoutKit (dev entitlement) | Push structured workouts | Phase 2
Runna partnership discussion | Plan integration (aspirational) | Phase 3+
Coach recruiting network | Marketplace supply | Phase 3