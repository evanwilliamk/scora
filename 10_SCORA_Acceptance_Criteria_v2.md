SCORA — Acceptance Criteria
Version: v2 (2026-04-26) Supersedes: v1 Companion to: 01_SCORA_90-Day_Execution_Plan_v1.4.md, 02_SCORA_PRD_v1.4.md


0. What changed in v2
Phase 1 gates rebuilt for Free tier alpha (not paid alpha).
Phase 2 gates rebuilt for Plan tier launch — trial-to-paid conversion, plan adherence, plan adaptation frequency, WhatsApp doorbell delivery.
Phase 3 gates NEW for Coach marketplace — coach onboarding, athlete-coach matches, first transactions, coach dashboard usage.
New cross-phase quality bars for plan-generation content and coach experience.


1. Phase 0 — Dogfood (Days 1–14)
Goal: Evan on Evan. Free tier features only.
1.1 Hard gates (all must pass)
1.2 Soft gates
Reply handler usage (why / pause).
CDV query usage in-app.
Validator catch rate trend (should be flat or decreasing).
Per-emission LLM cost stabilizes <$0.05.
1.3 Exit criterion
All 7 hard gates pass 14 consecutive days. Evan signs off in dogfood-log.md.


2. Phase 1 — Free tier alpha, 10 users (Days 15–35)
Goal: 10 real athletes on Free tier. Voice generalizes. CDV shipped. Plan-awareness works. Coach-forwarding signal observed.
2.1 Hard gates
2.2 Soft gates
why reply rate ≥40% of users.
Second-week engagement drop <20% vs first week (retention signal).
Free tier feels valuable — informal user quotes at Days 21 and 35.
2.3 Exit criterion
All 10 hard gates pass over 21-day window. Evan documents ≥3 specific user moments confirming the read lands.


3. Phase 2 — Plan tier launch (Days 36–65)
Goal: Ship $14/mo Plan tier. Convert 15% of Free users. Prove plan-tier retention. WhatsApp doorbell working.
3.1 Hard gates
3.2 Soft gates
Voice-quality signal continues.
CDV usage growing per-user.
LLM cost per Plan-tier user <$0.05/month.
Users tap inline chart-expansions ≥5x/week average (feature adoption).
WorkoutKit push acceptance ≥70% among Plan tier users with Apple Watch.
3.3 Exit criterion
All 14 hard gates pass over 30-day window. Phase 3 planning begins with confidence in Plan tier product-market fit.


4. Phase 3 — Coach marketplace launch (Days 66–85)
Goal: 5 curated coaches, 10 athlete-coach matches, first marketplace transactions successful, coach dashboard functional.
4.1 Hard gates
4.2 Soft gates
Voice-quality panel formal run (20-person blind read) achieves ≥70% "sounds like a human."
Sunday weekly read includes coach note for Coach tier users.
Coach-side workout builder usage (workouts saved as templates).
Coach retention (they don't leave the platform during Phase 3).
4.3 Exit criterion
All 11 hard gates pass. Phase 4 planning begins with coach marketplace validated.


5. Phase 4+ — Stabilization (Day 86+)
Ongoing operations. Daily SLOs enforced.
5.1 Ongoing SLOs
Daily delivery rate ≥99.5% (both APNS Free tier and WhatsApp Plan+).
Reply handler p95 latency ≤10s.
CDV p95 latency ≤8s.
Plan generation p95 latency ≤10s.
API uptime ≥99.9%.
Validator catch rate reviewed weekly.
Banned-phrase hit rate <0.5% continuously.
Voice panel quarterly (≥70% sustained).
Monthly churn Plan tier <8%.
Coach retention (year-over-year) ≥80%.
Marketplace payout SLA maintained (Stripe Connect standard 2-day).
5.2 Gates for further phases
Coach marketplace expansion (>5 coaches, open marketplace) gated on:

30 completed coach-athlete relationships (2+ months average tenure).
No compliance/tax issues arisen.
Athlete satisfaction ≥4.5/5 (survey).

Android client gated on:

500 iOS Plan tier users sustained ≥30 days.
iOS Plan tier 30-day retention ≥60%.
Coach marketplace at 20+ active coaches with 100+ active pairs.


6. Cross-phase quality bars
6.1 Voice (always)
Banned-phrase hit rate <0.5%.
Driver-existence validator never bypassed.
No emission sent without passing validators OR template fallback.
Numeric-first format on every morning message.
6.2 Plan content (always)
Plans never LLM-invented from scratch — always template-based.
Adaptations always show a plain-English reason.
Weekly volume adaptations never exceed ±10%.
Long run distances never adapted.
Race week freezes adaptations.
6.3 Coach experience (Phase 3+)
Coach can never see other coaches' athletes.
Coach cannot see athlete data prior to assignment start.
Coach's plan changes are visible to athlete within 60s.
In-app messages deliver reliably (≥99%).
6.4 Marketplace integrity (Phase 3+)
15% platform fee correctly assessed on every transaction.
Stripe Connect payouts run on schedule (2-day standard).
Refunds handled through Stripe Connect refund flow (never direct DB modification).
Failed payments trigger standard 3-retry sequence.
6.5 Security (always)
OAuth tokens encrypted at rest.
No PHI in logs.
RLS enforced.
HealthKit raw data never sent to LLM.
Stripe Connect credentials never in repo.
6.6 Privacy (always)
Account deletion completes within 7 days.
WhatsApp STOP processed immediately.
Coach relationships end cleanly on Stripe subscription cancellation.
User can export data via Settings (Plan/Coach tiers, Phase 3+).


7. Phase-gate review process
Same as v1 with additions:

At the end of each phase:

Generate gate report — script dumps table of all hard gates with measured vs threshold.
Evan reviews + signs off — phase-N-signoff-v2.md in /SCORA/.
Lessons captured — what surprised, what missed, what worked.
Strategy memo updated if foundational learning.
(New for Phase 2+): Voice-quality panel run at Phase 2 end, quarterly thereafter.
(New for Phase 3+): Coach-side experience survey (5-question survey to each coach at Phase 3 end).


8. Change log
v1 (2026-04-26 earlier): Initial for v1.3 (single-tier paid).
v2 (2026-04-26 later): Phase 1 rebuilt for Free tier alpha. Phase 2 rebuilt for Plan tier launch (100 users, 15% trial conversion, plan adherence, WhatsApp delivery, WorkoutKit push). Phase 3 NEW for Coach marketplace launch. Added quality bars for plan content, coach experience, marketplace integrity.

# | Gate | Threshold | Measurement
1.1.1 | Daily APNS delivery success | ≥13 of 14 mornings on time | message_events.delivered_at within ±5 min of scheduled
1.1.2 | Founder open rate | ≥12 of 14 mornings opened | app_open event with deep-link source within 4h of delivery
1.1.3 | Zero banned-phrase hits | 0 over 14 reads | pattern_emissions.banned_phrase_hits = 0 for all 14
1.1.4 | Zero validator fail-throughs | 0 | DB check
1.1.5 | At least one "wow" moment | ≥1 tagged in dogfood-log.md | Manual
1.1.6 | Zero PHI in logs | Verified | Audit last 14 days of logs
1.1.7 | Numeric-first message format compliance | 100% of 14 messages | Manual review of message shape (drivers line + interpretation + null workout line for Free tier)
# | Gate | Threshold | Measurement
2.1.1 | 10 free users onboarded | 10 users with subscription_tiers.tier = 'free' and completed onboarding within Phase 1 Days 1-7 | users + onboard_complete event count
2.1.2 | Open rate | ≥7 of 10 users open ≥10 of 14 daily messages | Per-user app_open from deep-link + APNS receipts
2.1.3 | Voice-quality panel signal (informal) | ≥5 of 10 users, asked "does this sound like a person," answer yes | Manual user check-in
2.1.4 | Banned-phrase hit rate | <0.5% of emissions across all 10 users × 21 days | Aggregate DB check
2.1.5 | Validator fallback rate | <10% of emissions | Same
2.1.6 | Coach-forwarding signal | ≥1 of 10 users spontaneously forwards Sunday card to a coach or training partner | Manual user check-in question at week 2
2.1.7 | Twilio Business API approved + stable | Approved by Phase 1 Day 5; <2% send failure over 21 days | Twilio dashboard
2.1.8 | Plan-aware reads working | For each user with a connected plan (Strava or manual), plan reference appears in ≥60% of daily reads that day has a workout | DB check: pattern_emissions.matched_pattern_ids contains plan-vs-body entry when scheduled_workouts row exists for that date
2.1.9 | CDV usage adoption | ≥50% of users make ≥1 CDV query during Phase 1 | viz_queries count per user
2.1.10 | Zero critical voice incidents | Zero "this was wrong" or "creepy" user complaints | Manual review of message replies + ad-hoc check-ins
# | Gate | Threshold | Measurement
3.1.1 | 100 free users acquired | 100 users with subscription_tiers.tier = 'free' and active during Phase 2 window | DB count
3.1.2 | 15% Free → Plan trial conversion | ≥15 of 100 free users start a Plan trial during Phase 2 | upgrade_to_plan_stripe_completed events
3.1.3 | 70% trial → paid conversion | ≥70% of trials become paid subscriptions | subscription.status='active' after trial_end
3.1.4 | Plan tier open rate | ≥85% over pilot window (WhatsApp delivery + read) | message_events for Plan tier users
3.1.5 | Plan tier monthly churn | <10% | subscription.deleted rate for Plan tier
3.1.6 | 30-day Plan tier retention | ≥65% | Cohort analysis
3.1.7 | Stripe subscriptions working | <1% failed payment rate; <2% dispute rate | Stripe dashboard
3.1.8 | Twilio WhatsApp delivery success | ≥99% delivery within 5-min window | message_events for channel='whatsapp'
3.1.9 | Apple WorkoutKit push success | ≥90% of scheduled workouts successfully pushed to watch (of users who granted permission) | scheduled_workouts.workout_kit_pushed_at non-null rate
3.1.10 | Plan adherence signal | Plan tier users complete ≥70% of scheduled workouts across the pilot | Compare strava_activities to scheduled_workouts
3.1.11 | Plan adaptation frequency reasonable | Adaptations per user per week ≤2 (else plans are too aggressive) | plan_adaptations count / active plan users
3.1.12 | No plan-quality complaints | Zero "the plan is bad" or "this plan doesn't make sense" user reports | Manual review + user check-ins
3.1.13 | App Store listing approved | Approved by Day 50 | Apple confirmation
3.1.14 | Numeric-first message format live | 100% of Plan tier morning messages follow the drivers + interpretation + workout template | Sample audit of 50 messages
# | Gate | Threshold | Measurement
4.1.1 | 5 coaches onboarded | 5 coach_profiles.status = 'active' by Day 85 | DB count
4.1.2 | 5 coaches Stripe Connect complete | 5 with coach_profiles.stripe_connect_account_id populated + verified | Stripe Connect dashboard
4.1.3 | 10 athlete-coach matches | 10 coach_athlete_assignments.status = 'active' by Day 85 | DB count
4.1.4 | ≥1 marketplace transaction succeeds | First marketplace_transactions.status = 'succeeded' | Stripe Connect dashboard + DB
4.1.5 | Coach dashboard usage | ≥80% of active coaches log in ≥3x/week | PostHog events
4.1.6 | Coach-authored plans populated | ≥8 of 10 assigned athletes have coach-authored training_plans within 7 days of assignment | DB check
4.1.7 | In-app messages exchanged | ≥100 total messages across all assignments during Phase 3 | messages count
4.1.8 | Coach alerts firing correctly | ≥1 alert per coach per week (baseline signal that monitoring works) | coach_alerts count per coach
4.1.9 | 15% platform fee correctly assessed | 100% of marketplace_transactions.platform_fee_usd = gross × 0.15 | DB check
4.1.10 | No coach or athlete complaints about marketplace mechanics | Zero critical UX or billing complaints | Manual review + check-ins
4.1.11 | Coach's plan overrides AI plan correctly | When assignment is active, athlete's app shows coach's plan (not SCORA AI plan). Verified for all 10 matches | Manual + automated check on training_plans.source