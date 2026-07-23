SCORA — Onboarding Flow
Version: v2 (2026-04-26) Supersedes: v1 Companion to: 02_SCORA_PRD_v1.4.md, 07_SCORA_Architecture_Data_Model_v2.md Audience: Coding agent + designer


0. What changed in v2
Free tier is the new default onboarding path. No Stripe checkout at signup — just Sign in with Apple, connect data, start receiving reads.
Plan tier upgrade is a separate flow. Triggered when user taps upgrade (in-app, Settings, or via nudge). Adds Stripe checkout + plan setup (goal, race date, volume).
Coach tier is a marketplace flow. Athlete browses coach directory, books a coach, Stripe Connect direct charge handles the payment.
Plan setup surface added — after Plan upgrade, athlete configures their plan (goal race, date, volume, experience).
Coach booking surface added — coach directory + coach profile + book flow with in-app messaging opening on assignment.


1. Free tier onboarding (default path — no card required)
1.1 Path summary
scora.app OR App Store discovery

  ↓

App Store install (Free)

  ↓ Open app

Welcome screen

  ↓ "Get started"

Sign in with Apple

  ↓ (creates zero-dollar Stripe customer for future upgrade)

Connect Strava (required)

  ↓

Connect Oura (optional — YES it's free-tier included)

  ↓

Grant Apple HealthKit permissions (required)

  ↓

Optional: paste existing training plan (skippable)

  ↓

Time zone + morning notification time (default 6 AM local)

  ↓

"Your first read lands tomorrow morning."

  ↓ Background app

Backend: 90-day backfill

  ↓

Next morning 6 AM: APNS push

Target: <3 minutes from app open to "first read tomorrow morning" screen.
1.2 Iteration on v1 onboarding
Differences from v1 (paid-first):

No Stripe checkout at signup. Skip web-Stripe step entirely.
Sign in with Apple immediately creates zero-dollar Stripe customer in users + subscription_tiers.tier = 'free'.
APNS is the daily channel for Free tier — no WhatsApp screen at all (WhatsApp is Plan-tier).
Optional plan-paste surface — for athletes who already have a plan from Runna, coach, or Excel. Adds richer reads immediately.
1.3 Sign in with Apple
Same shape as v1. On successful auth:

Create users row.
Create Stripe zero-dollar customer.
Create subscription_tiers row with tier = 'free'.
Return session tokens to app.
1.4 Connections sequence
Guided flow, one connection per screen. Reduced friction from v1 — no WhatsApp screen, no phone number.
Strava (required)
Same as v1. OAuth via Safari, returns via universal link.
Oura (optional — Free tier includes it)
Headline: "Got an Oura ring? Add it."
Body: "Oura's sleep and HRV signal makes every read sharper. Free tier — no extra cost."
Buttons: "Connect Oura" (primary) / "Skip for now" (text link).
Apple HealthKit (required)
Same as v1. Native permissions sheet for the specified data types.
Optional: plan paste
Headline: "Have a training plan?"
Body: "Paste your plan and SCORA reads it alongside your body. Or skip — we'll read your Strava scheduled activities if any."
Text area: "Paste plan here..."
Buttons: "Save plan" / "Skip"

If plan pasted:

Backend LLM-parses plan text into scheduled_workouts rows.
Stores in training_plans with source='external', external_source='manual'.
Time zone + delivery time
Same as v1. TZ auto-detect + confirm + time picker.
1.5 Backfill + confirmation
Same as v1. "Your first read lands tomorrow morning." Backfill queued.


2. Free → Plan tier upgrade flow
2.1 Trigger points
Settings → "Upgrade to Plan"
In-app nudge (e.g. after 7 days of consistent use, after the athlete asks 3 CDV questions in a day, after connecting Strava with a race event upcoming)
Marketing site direct link
2.2 Upgrade path
Trigger tap (from anywhere in app)

  ↓

Plan tier landing screen (in-app)

  - Shows what Plan tier adds: WhatsApp, unlimited CDV, adaptive plan, inline chart-expansion, race predictions, calorie engine, Apple WorkoutKit push, unlimited history

  - 7-day free trial

  - $14/mo or $130/yr

  ↓

Tap "Start 7-day trial"

  ↓

Stripe Payment Link opens in Safari View Controller

  - Card entered, 7-day trial starts

  - Stripe webhook: customer.subscription.created

  ↓

Return to app via universal link

  ↓

Backend: subscription_tiers.tier = 'plan', subscriptions row created

  ↓

Plan setup screen (see §2.3)

  ↓

"Your plan is ready" screen → dashboard
2.3 Plan setup screen (post-upgrade)
Four fields to collect the plan generation inputs:

Goal race type — dropdown (5K / 10K / half marathon / marathon / 50K / 100K/100mi / gravel century / century / Olympic tri / sprint tri).
Race date — date picker. Must be at least 4 weeks in future (else "choose a race further out or skip and just use the interpretation layer").
Current weekly volume — slider (km or mi based on user's Strava distance preference).
Experience level — three options with descriptions:
First timer or first serious block → matches template first_timer
Regular racer → matches template regular
Competitive racer → matches template competitive

Optional 5th field:

Preferred rest day — picker (Monday default). Plan schedules the weekly rest day accordingly.

Submit → backend:

Match plan_templates by (sport, goal_type, duration_weeks_range, experience_level, weekly_volume_range).
If no match: show "template not available yet" + fallback to Free tier features. Refund trial.
If matched: run plan generation pipeline (Architecture §6.1).
Insert training_plans row + all scheduled_workouts rows.
Call plan-summary prompt for the block-level summary.
Show summary screen: "Your 12-week half marathon plan is ready. {summary from LLM}"
Athlete confirms; plan becomes active.
2.4 WhatsApp opt-in (Plan tier only)
After plan setup, offer WhatsApp doorbell:

Headline: "Get your morning read on WhatsApp."
Body: "Numbers + interpretation + today's workout. One short message at 6 AM. Reply 'why' any time for more."
Phone input + country code.
Twilio "reply YES" opt-in flow (same as v1).
Skippable: falls back to APNS (which the athlete had on Free tier anyway).
2.5 Apple WorkoutKit permission
Prompt when relevant (before first Plan tier workout that has a structured template):

Native iOS permission sheet requests WorkoutKit access.
On grant: today's workout appears on the athlete's Apple Watch as a structured workout.
If denied: workout still shows in-app; watch push disabled. Athlete can enable later in Settings.
2.6 Edge cases
User cancels trial: Stripe webhook subscription.deleted → subscription_tiers.tier = 'free'. Plan features gated off; plan calendar preserved read-only for 30 days then archived.
Race in less than 4 weeks: show "let's just do interpretation this cycle — plans need at least 4 weeks to work." Refund trial.
Volume mismatch (user says 5 mi/wk, wants marathon): show "this plan would ramp too fast from your current volume. Consider a half marathon first, or come back with more base."


3. Plan → Coach tier upgrade flow (marketplace)
3.1 Trigger points
Settings → "Find a coach"
In-app nudge (when SCORA detects the "ceiling reached" pattern from voice library)
Marketing site
3.2 Coach discovery
Trigger tap

  ↓

Coach directory screen

  - Grid of coach profile cards

  - Filter: sport, specialization, price range, availability

  - Sort: rating, price, name

  ↓

Tap coach card

  ↓

Coach profile screen

  - Photo, bio, credentials, specializations

  - Sample testimonials (2-3)

  - Price ($200-300/mo)

  - Availability (slots remaining)

  - "Book coach" CTA
3.3 Coach booking flow
Tap "Book Coach"

  ↓

Booking preview screen

  - Coach summary, price, "You'll pay $X/mo, SCORA takes 15% platform fee, coach gets 85%"

  - Optional message to coach ("Tell {Coach} a bit about your goals")

  - Confirm & continue

  ↓

Stripe Connect direct-charge checkout (in-app via Safari View Controller)

  - Card entered

  - Subscription created via Stripe Connect

  ↓

Return to app

  ↓

Backend: coach_athlete_assignments row inserted, subscription_tiers.tier = 'coach', coach_assignment_id set

  ↓

Athlete's SCORA AI plan (if active) → training_plans.current_status = 'abandoned'

  ↓

Assignment landing screen

  - "You're paired with {Coach}."

  - "Your coach has been notified and will build your first week's plan."

  - "Message your coach" CTA (unlocks in-app messaging)

  ↓

Coach receives assignment alert via coach-side dashboard
3.4 First coach-authored plan flow
On assignment, training_plans row for AI plan is closed.
Athlete's calendar shows empty until coach builds the plan.
Coach uses coach-side dashboard + workout builder to author plan (typically first 4 weeks).
On coach save, training_plans row created with source='coach', coach_id=coach's user_id. scheduled_workouts populated.
Athlete sees plan appear (push notification to athlete: "Your plan is ready").
3.5 In-app messaging
Unlocks the moment the coach-athlete assignment is active. Two entry points in app: dashboard "Message your coach" tile + Settings.

Messaging surface:

Chat thread UI (persistent, all messages preserved).
APNS delivery for new messages.
Optional attach: reference a specific scheduled_workout (adds a mini-card in the message).
Coach's messages appear differently styled from athlete's.
3.6 Ending a coach relationship
Athlete Settings → "Manage coach" → "End coaching with {Coach}".
Confirm: "Your subscription ends at the end of this billing period. Coach's plan remains visible for 30 days after."
Backend: coach_athlete_assignments.status = 'ended'. Stripe subscription set to cancel at period end.
On period end: coach's plan archives, athlete drops back to Plan tier (if they still want SCORA's AI plan) or Free.
3.7 Downgrade edge cases
Payment failure during Coach tier: Standard Stripe retry (3 attempts over 14 days). If final fail: assignment.status = 'ended', athlete drops to Plan tier if they still have a Plan subscription active, else Free.
Coach ends relationship: Coach can end from coach-side dashboard. Athlete notified, transitions same as above.
Coach account suspended: Rare, but if a coach is removed from platform, existing assignments continue for 30 days then auto-transition to Free/Plan based on athlete preference at that point.


4. Coach onboarding (Phase 3+, curated)
4.1 Application
Coach fills out application form on scora.app/coach:

Name, email, credentials, years of experience, sport specializations, coaching philosophy sample paragraph, testimonials link, existing athlete count, proposed monthly price.
4.2 Review
SCORA (Evan in Phase 3, later admin) reviews application manually. Approves or requests more info. Approval criteria:

Verified credentials (USATF, RRCA, USAT, or equivalent).
Real athletes coached (verifiable).
Coaching philosophy compatible with SCORA's non-prescriptive-voice + template-based-plan approach.
Willing to use coach-side dashboard (as opposed to insisting on TrainingPeaks).
4.3 Stripe Connect Express onboarding
SCORA sends account link.
Coach completes Stripe Connect onboarding: tax info, bank account, ID verification.
Coach returns to app to set up coach profile (bio, photo, price, specializations).
4.4 First-athlete onboarding for coach
Coach's first assignment triggers a walkthrough of the coach-side dashboard.
Guided workout-builder tutorial (5 minutes).
Coach can save workouts to a personal template library for reuse.


5. Telemetry — new events for v2
Additions to Onboarding Flow v1 event list:

onboard_free_completed (Free tier user finishes onboarding).
upgrade_to_plan_initiated (user taps upgrade CTA).
upgrade_to_plan_stripe_completed (Stripe webhook fires).
plan_setup_completed (goal/date/volume/experience submitted, plan generated).
whatsapp_opt_in_completed (Plan tier user opts into WhatsApp).
workoutkit_permission_granted / workoutkit_permission_denied.
coach_directory_opened.
coach_profile_viewed (with coach_id).
coach_booked (with coach_id, price).
coach_assignment_activated (webhook: Stripe Connect charge succeeded).
coach_plan_first_message (coach sends first message to newly-assigned athlete).
coach_ended_by_athlete / coach_ended_by_coach.

Funnel targets:

Free onboard completion: ≥85%.
Free → Plan trial start: ≥15% within 30 days of onboard.
Plan trial → paid conversion: ≥70% (7-day trial).
Plan → Coach conversion: ≥5% within 6 months (long-tail).


6. Open onboarding questions (defer)
Trial duration A/B test (3 / 7 / 14 days).
Onboarding nudge for Oura connection when user doesn't have one (should there be a friendly "get Oura for sharper reads" screen that respects the free-tier promise)? Probably yes, but soft.
Plan tier trial duration (7 days matches most SaaS; consider 14 for higher conversion).
Coach tier trial (currently 0-day; coach discretion via Stripe subscription trial).
Plan setup on Free tier — should Free tier users get a "plan preview" if they enter goal/date, showing them what the plan would look like without unlocking full features? (Growth lever, potential design).


7. Change log
v1 (2026-04-26 earlier): Native iOS + Stripe + Strava/Oura/HealthKit + WhatsApp opt-in. Paid-first.
v2 (2026-04-26 later): Free tier as default (no Stripe at signup). Plan tier upgrade flow with 4-input plan setup. Coach marketplace booking flow with Stripe Connect direct charges. Removed phone number requirement at signup (WhatsApp is Plan-tier only). Added coach onboarding flow (Phase 3+ curated).
