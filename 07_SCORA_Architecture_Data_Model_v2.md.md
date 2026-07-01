SCORA — Architecture & Data Model
Version: v2 (2026-04-26) Supersedes: v1 Companion to: CLAUDE.md v1.4, 02_SCORA_PRD_v1.4.md Audience: Coding agent + SCORA contributors


0. What changed from v1
v2 adds the three-tier ladder + coach marketplace scope:

New tier state machine — Free / Plan / Coach with transitions gated by Stripe events.
Plan generation subsystem — template library, plan engine, adaptation rules, scheduled_workouts as first-class write-enabled entity.
Coach marketplace subsystem — coach_profiles, coach_athlete_assignments, marketplace_transactions via Stripe Connect.
Coach-side platform surfaces — multi-athlete dashboard endpoints, workout builder API, alert system.
Apple WorkoutKit push — new client-side capability for delivering structured workouts to Apple Watch.
Messages — coach-athlete in-app messaging with APNS delivery.


1. System architecture (updated)
┌──────────────────────────────────────────────────────────────────────────┐

│  iOS app (SwiftUI)                                                       │

│  ┌──────────┬──────────┬─────────────┬────────────┬─────────────────┐   │

│  │Dashboard │CDV+WebView│Plan calendar│WorkoutKit  │Coach directory  │   │

│  │          │           │            │push        │+ messaging      │   │

│  └────┬─────┴─────┬─────┴─────┬──────┴─────┬──────┴─────┬───────────┘   │

└───────┼───────────┼───────────┼────────────┼────────────┼───────────────┘

        │           │           │            │            │

        ▼           ▼           ▼            ▼            ▼

┌──────────────────────────────────────────────────────────────────────────┐

│  API (Node.js + Fastify on Railway)                                      │

│  ┌────────┬───────────┬──────────┬─────────┬─────────┬────────────┐     │

│  │ Auth   │Connections│Dashboard │Plan API │Coach API│Marketplace │     │

│  │        │+ Webhooks │+CDV      │         │         │(Stripe Cxn)│     │

│  └────┬───┴─────┬─────┴────┬─────┴────┬────┴────┬────┴─────┬──────┘     │

└───────┼─────────┼──────────┼──────────┼─────────┼──────────┼────────────┘

        │         │          │          │         │          │

        ▼         ▼          ▼          ▼         ▼          ▼

  ┌─────────┐ ┌─────────┐ ┌──────┐ ┌────────┐ ┌───────┐ ┌──────────────┐

  │Postgres │ │Redis    │ │OpenAI│ │Twilio  │ │Strava │ │Stripe Connect│

  │(Supabase│ │(cache+  │ │      │ │(WA BA) │ │+ Oura │ │(marketplace) │

  │)        │ │queue)   │ │      │ │        │ │APIs   │ │              │

  └─────────┘ └────┬────┘ └──────┘ └────────┘ └───────┘ └──────────────┘

                   │

                   ▼

          ┌──────────────────────────────────────┐

          │  Workers (BullMQ, Railway):          │

          │  • posture computation               │

          │  • daily delivery (APNS + WhatsApp)  │

          │  • plan generation                   │

          │  • plan adaptation                   │

          │  • data ingestion (Strava/Oura)      │

          │  • coach alerts                      │

          │  • Stripe Connect payout processing  │

          └──────────────────────────────────────┘


2. Tech stack (updated)


3. Repository layout (updated)
scora/

├── apps/

│   ├── ios/

│   │   ├── SCORA.xcodeproj

│   │   └── SCORA/

│   │       ├── App/

│   │       ├── Features/

│   │       │   ├── Dashboard/

│   │       │   ├── CDV/

│   │       │   ├── Onboarding/

│   │       │   ├── Connections/

│   │       │   ├── Plan/                    # NEW: plan calendar + workout detail

│   │       │   ├── Coach/                   # NEW: coach directory + messaging

│   │       │   ├── Settings/

│   │       │   └── Paywall/                 # NEW: tier upgrade flows

│   │       ├── HealthKit/

│   │       ├── WorkoutKit/                  # NEW: push structured workouts

│   │       ├── API/

│   │       └── Shared/

│   ├── api/

│   │   ├── src/

│   │   │   ├── routes/

│   │   │   │   ├── auth/

│   │   │   │   ├── connections/

│   │   │   │   ├── dashboard/

│   │   │   │   ├── cdv/

│   │   │   │   ├── plan/                    # NEW

│   │   │   │   ├── coach/                   # NEW

│   │   │   │   ├── marketplace/             # NEW

│   │   │   │   ├── messages/                # NEW

│   │   │   │   └── coach-side/              # NEW

│   │   │   ├── webhooks/

│   │   │   │   ├── stripe/                  # + Stripe Connect events

│   │   │   │   ├── strava/

│   │   │   │   ├── oura/

│   │   │   │   └── twilio/

│   │   │   ├── cron/

│   │   │   ├── services/

│   │   │   ├── db/

│   │   │   └── lib/

│   │   └── tests/

│   └── workers/

│       ├── src/

│       │   ├── posture/

│       │   ├── delivery/

│       │   ├── ingest/

│       │   ├── plan-gen/                    # NEW

│       │   ├── plan-adapt/                  # NEW

│       │   └── coach-alerts/                # NEW

│       └── package.json

├── packages/

│   ├── voice/

│   │   ├── patterns/

│   │   ├── banned-phrases.json

│   │   └── tone.md

│   ├── validator/

│   ├── posture/

│   ├── plan-templates/                      # NEW: coach-authored template library

│   │   ├── running/

│   │   │   ├── 5k/

│   │   │   ├── 10k/

│   │   │   ├── half-marathon/

│   │   │   ├── marathon/

│   │   │   └── ultra/

│   │   ├── cycling/

│   │   ├── triathlon/

│   │   └── package.json

│   ├── plan-engine/                         # NEW: template assembly + adaptation

│   │   ├── src/

│   │   │   ├── assembler.ts

│   │   │   ├── adaptation-rules.ts

│   │   │   └── validators.ts

│   │   ├── tests/

│   │   └── package.json

│   ├── llm-prompts/

│   │   ├── daily-read.md

│   │   ├── weekly-read.md

│   │   ├── why-expansion.md

│   │   ├── more-expansion.md

│   │   ├── card-expansion.md

│   │   ├── cdv-spec.md

│   │   ├── workout-description.md          # NEW: plain-English workout text

│   │   ├── adaptation-reason.md            # NEW: adaptation explanation

│   │   └── plan-summary.md                 # NEW: block summary at plan creation

│   └── shared-types/

├── infra/

│   ├── migrations/

│   ├── seed/

│   └── docker-compose.yml

├── CLAUDE.md

├── README.md

└── package.json


4. Database schema — new tables in v2
Continuing from v1 schema. v1 tables (users, subscriptions, oauth_tokens, whatsapp_contacts, strava_activities, oura_sleep, healthkit_samples, daily_posture, pattern_emissions, viz_queries, message_events) remain. Additions:
4.1 subscription_tiers
create table subscription_tiers (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null unique references users(id) on delete cascade,

  tier text not null default 'free' check (tier in ('free','plan','coach')),

  stripe_subscription_id text,                -- for 'plan' tier

  coach_assignment_id uuid,                   -- for 'coach' tier

  effective_since timestamptz not null default now(),

  updated_at timestamptz not null default now()

);

create index subscription_tiers_tier_idx on subscription_tiers (tier);
4.2 plan_templates
create table plan_templates (

  id uuid primary key default gen_random_uuid(),

  slug text unique not null,                  -- e.g. 'run-half-marathon-12wk-intermediate'

  sport text not null check (sport in ('run','ride','swim','tri')),

  goal_type text not null,                    -- e.g. '5k','10k','half_marathon','marathon','50k','100k','century','olympic_tri'

  duration_weeks smallint not null,

  experience_level text not null check (experience_level in ('first_timer','regular','competitive')),

  weekly_volume_range_km numrange not null,   -- e.g. '[20,40)'

  author text not null,                       -- coach who authored, e.g. 'Sarah Jones' or 'SCORA Team'

  version text not null,                      -- e.g. '1.0.0'

  structure_json jsonb not null,              -- full periodization structure (see 4.2.1)

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()

);
4.2.1 plan_templates.structure_json shape
{

  "phases": [

    {

      "name": "Base",

      "weeks": [1, 2, 3, 4],

      "focus": "aerobic development",

      "weekly_load_target_percent_of_max": 60

    },

    {

      "name": "Threshold",

      "weeks": [5, 6, 7, 8, 9],

      "focus": "lactate threshold + tempo work"

    },

    {

      "name": "Sharpening",

      "weeks": [10, 11],

      "focus": "race-specific intensity"

    },

    {

      "name": "Taper",

      "weeks": [12],

      "focus": "recover into fresh"

    }

  ],

  "weekly_pattern": {

    "monday": "rest_or_recovery",

    "tuesday": "quality_workout_a",

    "wednesday": "easy_recovery",

    "thursday": "quality_workout_b",

    "friday": "rest",

    "saturday": "long_effort",

    "sunday": "easy_or_medium_long"

  },

  "workout_types_by_phase": {

    "Base": {

      "quality_workout_a": ["easy_intervals","strides"],

      "quality_workout_b": ["fartlek","hill_reps"],

      "long_effort": ["easy_long"]

    },

    "Threshold": {

      "quality_workout_a": ["tempo_intervals","threshold_intervals"],

      "quality_workout_b": ["hill_reps","tempo_continuous"],

      "long_effort": ["progressive_long","medium_long"]

    }

  },

  "workout_definitions": {

    "tempo_intervals": {

      "structure": [

        {"type":"warmup","duration_min":10,"intensity":"easy"},

        {"type":"interval","reps":3,"work_duration_min":8,"work_intensity":"threshold","rest_duration_min":3,"rest_intensity":"easy"},

        {"type":"cooldown","duration_min":10,"intensity":"easy"}

      ],

      "total_duration_est_min": 55

    }

  }

}

Templates are hand-authored YAML files in packages/plan-templates/, loaded and versioned on deploy.
4.3 training_plans
create table training_plans (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references users(id) on delete cascade,

  source text not null check (source in ('scora_ai','coach','external')),

  template_id uuid references plan_templates(id),  -- null for coach-authored or external

  coach_id uuid,                                     -- for coach-authored

  external_source text,                              -- 'strava','runna','manual'

  goal_race_type text,

  goal_race_date date,

  start_date date not null,

  end_date date not null,

  weekly_volume_start_km numeric(6,2),

  current_status text not null default 'active'

    check (current_status in ('active','paused','completed','abandoned')),

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()

);

create index training_plans_user_status_idx on training_plans (user_id, current_status);
4.4 scheduled_workouts (write-enabled in v2)
create table scheduled_workouts (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references users(id) on delete cascade,

  training_plan_id uuid references training_plans(id) on delete set null,

  scheduled_date date not null,

  planned_type text not null,                 -- 'run','ride','swim','strength','brick'

  planned_intensity text,                     -- 'easy','moderate','hard','threshold','intervals','long','recovery','rest'

  planned_duration_min smallint,

  planned_distance_km numeric(6,2),

  planned_description text,                   -- LLM-rendered plain English

  workout_structure_json jsonb,               -- structured intervals for WorkoutKit push

  source text not null check (source in ('scora_ai','coach','external_strava','external_runna','manual')),

  raw_source_json jsonb,

  workout_kit_pushed_at timestamptz,

  athlete_completed boolean,

  athlete_completed_activity_id uuid references strava_activities(id),

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()

);

create index scheduled_workouts_user_date_idx on scheduled_workouts (user_id, scheduled_date desc);
4.5 plan_adaptations
create table plan_adaptations (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references users(id) on delete cascade,

  training_plan_id uuid not null references training_plans(id) on delete cascade,

  scheduled_workout_id uuid not null references scheduled_workouts(id) on delete cascade,

  adaptation_type text not null check (adaptation_type in (

    'moved','downgraded','skipped','substituted','frozen_race_week'

  )),

  original_date date,

  new_date date,

  original_workout_json jsonb,

  new_workout_json jsonb,

  reason_code text not null,                  -- machine-readable, e.g. 'posture_rest_hard_scheduled'

  reason_text text not null,                  -- LLM-rendered plain English for athlete display

  triggered_by text not null check (triggered_by in ('auto_engine','coach_manual','athlete_manual')),

  triggered_at timestamptz not null default now()

);

create index plan_adaptations_user_time_idx on plan_adaptations (user_id, triggered_at desc);
4.6 coach_profiles
create table coach_profiles (

  id uuid primary key default gen_random_uuid(),

  user_id uuid not null unique references users(id) on delete cascade,

  display_name text not null,

  bio text,

  credentials text,                            -- e.g. 'USATF Level 2, RRCA, 15 years coaching'

  specializations text[],                      -- e.g. ['marathon','ultra','trail']

  price_monthly_usd smallint not null,         -- 200-300 typical

  stripe_connect_account_id text unique,

  photo_url text,

  status text not null default 'pending_review'

    check (status in ('pending_review','active','paused','removed')),

  max_athletes smallint default 20,

  current_athlete_count smallint default 0,

  average_rating numeric(3,2),

  total_reviews smallint default 0,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()

);

create index coach_profiles_status_idx on coach_profiles (status);

create index coach_profiles_specializations_gin_idx on coach_profiles using gin(specializations);
4.7 coach_athlete_assignments
create table coach_athlete_assignments (

  id uuid primary key default gen_random_uuid(),

  athlete_user_id uuid not null references users(id) on delete cascade,

  coach_user_id uuid not null references users(id) on delete cascade,

  stripe_subscription_id text not null,        -- Stripe Connect subscription

  status text not null default 'active'

    check (status in ('active','paused','ended')),

  started_at timestamptz not null default now(),

  ended_at timestamptz,

  end_reason text,                             -- 'athlete_cancel','coach_cancel','payment_failed','completed'

  monthly_price_usd smallint not null,

  updated_at timestamptz not null default now()

);

create index coach_athlete_assignments_coach_active_idx

  on coach_athlete_assignments (coach_user_id) where status = 'active';

create index coach_athlete_assignments_athlete_active_idx

  on coach_athlete_assignments (athlete_user_id) where status = 'active';
4.8 marketplace_transactions
create table marketplace_transactions (

  id uuid primary key default gen_random_uuid(),

  coach_athlete_assignment_id uuid not null references coach_athlete_assignments(id) on delete cascade,

  stripe_payment_intent_id text unique not null,

  gross_amount_usd numeric(8,2) not null,      -- what athlete paid

  platform_fee_usd numeric(8,2) not null,      -- SCORA's 15% cut

  coach_amount_usd numeric(8,2) not null,      -- coach's 85%

  period_start date not null,

  period_end date not null,

  status text not null check (status in ('pending','succeeded','failed','refunded')),

  failure_reason text,

  processed_at timestamptz,

  created_at timestamptz not null default now()

);

create index marketplace_transactions_assignment_idx on marketplace_transactions (coach_athlete_assignment_id, created_at desc);
4.9 messages
create table messages (

  id uuid primary key default gen_random_uuid(),

  coach_athlete_assignment_id uuid not null references coach_athlete_assignments(id) on delete cascade,

  sender_user_id uuid not null references users(id) on delete cascade,

  body text not null,

  kind text not null default 'chat' check (kind in ('chat','weekly_note','system')),

  related_workout_id uuid references scheduled_workouts(id),

  sent_at timestamptz not null default now(),

  read_at timestamptz

);

create index messages_assignment_time_idx on messages (coach_athlete_assignment_id, sent_at desc);

create index messages_unread_idx on messages (coach_athlete_assignment_id) where read_at is null;
4.10 coach_alerts
create table coach_alerts (

  id uuid primary key default gen_random_uuid(),

  coach_user_id uuid not null references users(id) on delete cascade,

  athlete_user_id uuid not null references users(id) on delete cascade,

  coach_athlete_assignment_id uuid not null references coach_athlete_assignments(id) on delete cascade,

  alert_type text not null check (alert_type in (

    'missed_workouts_n','low_sleep_streak','hrv_crash','rhr_elevation','app_inactive'

  )),

  severity text not null check (severity in ('info','warning','critical')),

  body text not null,

  related_data_json jsonb,

  acknowledged_at timestamptz,

  created_at timestamptz not null default now()

);

create index coach_alerts_coach_unack_idx on coach_alerts (coach_user_id) where acknowledged_at is null;


5. API contracts — new families for v2
5.1 Plan endpoints
GET    /plan                             -> return active training_plan + upcoming scheduled_workouts

POST   /plan/generate                    -> generate SCORA AI plan (Plan tier only)

  body: { goal_race_type, goal_race_date, current_weekly_km, experience_level }

PATCH  /plan/{plan_id}                   -> update plan (goal shift, pause, etc.)

DELETE /plan/{plan_id}                   -> abandon plan

GET    /plan/adaptations                 -> history of adaptations for user's active plan

POST   /plan/adaptations/{id}/dismiss    -> athlete acknowledges adaptation

GET    /plan/templates                   -> browsable library (used by coach-side too)
5.2 Coach discovery + assignment
GET    /coach/directory                  -> list of active coaches with filters

  query: ?specializations=marathon,ultra&sort=rating

GET    /coach/{coach_id}                 -> full coach profile

POST   /coach/{coach_id}/book            -> initiate booking flow

  body: { athlete_intro_message }

  returns: { stripe_connect_checkout_url }

POST   /coach/end                        -> athlete ends coaching relationship
5.3 Marketplace / Stripe Connect
POST   /marketplace/webhooks/stripe-connect     -> Stripe Connect events

GET    /marketplace/coach/earnings              -> coach's earning summary

GET    /marketplace/coach/payouts               -> payout history

GET    /marketplace/athlete/receipts            -> athlete's payment history
5.4 Messages
GET    /messages/{assignment_id}                -> paginated thread

POST   /messages/{assignment_id}                -> send message

  body: { body, related_workout_id? }

POST   /messages/{message_id}/mark-read
5.5 Coach-side platform endpoints
GET    /coach-side/dashboard                    -> multi-athlete grid + summaries

GET    /coach-side/athletes/{athlete_id}        -> athlete detail

GET    /coach-side/athletes/{athlete_id}/plan   -> read athlete's plan

POST   /coach-side/athletes/{athlete_id}/plan   -> write plan (coach-authored)

POST   /coach-side/athletes/{athlete_id}/adapt  -> manual coach-driven adaptation

PATCH  /coach-side/athletes/{athlete_id}/workouts/{workout_id}

GET    /coach-side/alerts                       -> unacked alerts across all athletes

POST   /coach-side/alerts/{alert_id}/acknowledge

GET    /coach-side/analytics/{athlete_id}       -> fitness/fatigue charts, etc.

POST   /coach-side/workout-builder              -> save custom workout as template

GET    /coach-side/plan-templates               -> coach's saved templates


6. Key pipelines — new for v2
6.1 Plan generation pipeline (SCORA AI plan)
POST /plan/generate (athlete input)

  1. Verify user is on Plan tier (subscription_tiers.tier = 'plan')

  2. Match plan_template by (sport, goal_type, duration_weeks, weekly_volume_range, experience_level)

     - If no match: reject with "template not available yet" or LLM-negotiate a fallback

  3. Load template.structure_json

  4. Apply user's current_weekly_km to scale workout durations/distances

  5. Populate scheduled_workouts for each week/day of the plan

     - For each: choose workout_definition from workout_types_by_phase

     - Interpolate to user's scale

     - Call workout-description prompt to render plain-English text

     - Store workout_structure_json for WorkoutKit push

  6. Insert training_plan row

  7. Insert scheduled_workouts rows (all weeks upfront)

  8. Return plan summary via plan-summary prompt
6.2 Plan adaptation pipeline (nightly cron)
compute-adaptations job (runs nightly, per user with active plan):

  1. Fetch today's daily_posture

  2. Fetch tomorrow's scheduled_workout (adaptations apply to next day, not retroactive)

  3. Apply deterministic adaptation rules (packages/plan-engine/adaptation-rules.ts):

     - if posture=rest && tomorrow.intensity in ['hard','intervals','threshold','tempo','long']:

         → move workout to next available window, insert rest tomorrow

     - if posture=back-off && tomorrow in ['intervals','threshold']:

         → downgrade to steady-state at same duration

     - if posture=back-off && tomorrow=tempo:

         → downgrade to endurance at same duration

     - if posture=primed && tomorrow in ['easy','recovery']:

         → NO adaptation

     - if race_in_next_7d: FREEZE all adaptations

     - if adaptation would push weekly volume >10% from template: SKIP adaptation

     - if adaptation would change long run distance: SKIP adaptation

  4. If adaptation triggered:

     - Insert plan_adaptations row

     - Update scheduled_workouts (both original and new dates)

     - Call adaptation-reason prompt for plain-English reason_text

     - Emit APNS notification if athlete has notifications on

  5. If no adaptation: log 'evaluated_no_change'
6.3 WorkoutKit push pipeline (per-workout)
Client-side (iOS):

  1. On app foreground OR on scheduled_workouts.updated_at change:

     - Fetch today's + tomorrow's scheduled_workouts for user

     - For each with workout_structure_json:

       - Convert to WorkoutKit structured workout (HKWorkoutSchedule)

       - Schedule via WorkoutKit API

     - POST /internal/workout-pushed to mark workout_kit_pushed_at

  2. On watch: workout appears in Workouts app, user starts, intervals cue
6.4 Coach assignment pipeline
POST /coach/{coach_id}/book (athlete):

  1. Verify coach.status = 'active' && coach.current_athlete_count < coach.max_athletes

  2. Create Stripe Connect direct charge:

     - amount: coach.price_monthly_usd * 100 (cents)

     - application_fee_amount: 15% of gross

     - destination: coach.stripe_connect_account_id

     - subscription (monthly recurring)

  3. Return checkout URL

  

On Stripe webhook 'checkout.session.completed':

  1. Insert coach_athlete_assignments row

  2. Update subscription_tiers.tier = 'coach', coach_assignment_id = new_id

  3. If athlete had subscription_tiers.tier = 'plan': cancel old subscription (no proration, prorate handled by Stripe)

  4. Increment coach_profiles.current_athlete_count

  5. Deactivate athlete's SCORA AI plan (training_plans.current_status = 'abandoned')

  6. Coach receives new athlete alert

  7. Athlete's app: coach appears in "Your coach" surface, messaging unlocks, plan surface waits for coach's first plan
6.5 Coach alert pipeline
compute-coach-alerts job (runs 3x/day per athlete with active coach):

  1. Fetch athlete's daily_posture + last 7 days scheduled_workouts + last 3 days pattern_emissions

  2. Evaluate alert conditions per assignment configuration:

     - Missed workouts ≥ N (default 2 in last 7d)

     - Sleep < user_p25 for 3+ consecutive nights

     - HRV_7d_avg_delta ≤ -10 for 5+ consecutive days

     - RHR_7d_avg_delta ≥ +5 for 5+ consecutive days

     - app_open events = 0 for N days (default 3)

  3. For each triggered condition without existing unack alert of same type:

     - Insert coach_alerts row

     - APNS push to coach


7. Stripe Connect implementation notes
7.1 Account structure
Platform account — SCORA (owned by Evan)
Connected accounts — each coach is an Express Connect account
Charge model — Direct charges with application_fee_amount of 15%
Payout schedule — Standard 2-business-day for coaches (Stripe default)
7.2 Onboarding flow (coach)
1. Coach applies via /coach/apply (form submission)

2. SCORA reviews (manual, v3+ curated)

3. If approved: SCORA creates Stripe Connect Express account link

4. Coach completes Stripe onboarding (tax info, bank account, ID verification)

5. Coach profile activated on marketplace
7.3 Subscription mechanics
Each coach-athlete assignment is a Stripe Connect Subscription:

Product: dynamic price per coach (coach.price_monthly_usd)
Trial: optional 7 days (coach-configurable)
Cancel: at end of billing period
Failed payment: 3 retry attempts over 14 days, then subscription status='past_due', then 'canceled'
7.4 Platform fee accounting
Every successful invoice generates a marketplace_transactions row. Nightly reconciliation cron cross-references Stripe payouts with our records for accounting integrity.


8. Plan template library — content strategy
8.1 Sourcing
Recommended: partner with 2-3 respected endurance coaches to author the initial template library. Compensation: royalty per user month spent on their template + credited on marketplace as recommended coaches.

Fallback: SCORA team authors initial library based on published periodization frameworks (Daniels, Pfitzinger, Friel, Uphill Athlete). Frameworks are public; specific plan structures should be reviewed by a qualified coach before shipping.
8.2 Initial library scope (v2 launch)
Minimum viable library for Plan tier launch:

Running

5K: 8-week, 3 volume tiers (novice/intermediate/experienced)
10K: 10-week, 3 tiers
Half marathon: 12-week, 3 tiers
Marathon: 16-week, 3 tiers
50K ultra: 16-week, intermediate + experienced
100K/100mi ultra: 24-week, experienced only

Cycling

Century ride: 12-week, intermediate
Gravel race: 12-week, intermediate

Triathlon

Sprint tri: 8-week
Olympic tri: 12-week

Total: ~20 templates in v1 Plan library.
8.3 Template review + versioning
Every template versioned (1.0.0, 1.1.0, etc.).
Every template reviewed by a qualified coach before ship.
Athletes on a given template are pinned to their version (never auto-upgraded mid-plan).


9. Adaptation rules (definitive spec)
Implemented in packages/plan-engine/adaptation-rules.ts as deterministic TypeScript functions. Each rule has a unit test with synthetic posture + workout inputs and expected output.

// Simplified illustration - see actual code for complete spec

type Adaptation =

  | { type: 'move'; from: Date; to: Date; reason: string }

  | { type: 'downgrade'; from_intensity: Intensity; to_intensity: Intensity; reason: string }

  | { type: 'freeze'; reason: string }

  | null;

function evaluateAdaptation(

  posture: DailyPosture,

  tomorrow: ScheduledWorkout,

  plan: TrainingPlan

): Adaptation {

  // Rule 0: Race week freeze

  if (daysUntilRace(plan) <= 7) return null;

  

  // Rule 1: Rest posture + hard workout

  if (posture.posture === 'rest' && isHardWorkout(tomorrow)) {

    const nextWindow = findNextEasyWindow(plan, tomorrow.scheduled_date);

    return {

      type: 'move',

      from: tomorrow.scheduled_date,

      to: nextWindow,

      reason: 'posture_rest_hard_scheduled'

    };

  }

  

  // Rule 2: Back-off posture + intervals

  if (posture.posture === 'back-off' && tomorrow.planned_intensity === 'intervals') {

    return {

      type: 'downgrade',

      from_intensity: 'intervals',

      to_intensity: 'steady_state',

      reason: 'posture_backoff_intervals_scheduled'

    };

  }

  

  // ... more rules ...

  

  return null;

}

Rules are exhaustively tested. Adaptation frequency is a telemetry signal — too high means the plan is misaligned with the user's actual capacity.


10. Client-side WorkoutKit integration
10.1 SwiftUI + HealthKit + WorkoutKit
// Pseudo-code sketch

import WorkoutKit

func pushScheduledWorkout(_ workout: ScheduledWorkout) async throws {

    let intervals = workout.structure.intervals.map { interval in

        WorkoutStep(

            goal: intervalGoal(interval),

            step: interval.isWarmup ? .warmup : (interval.isCooldown ? .cooldown : .work)

        )

    }

    

    let customWorkout = CustomWorkout(

        activity: activityType(workout.planned_type),

        location: .outdoor,

        displayName: workout.planned_description,

        warmup: /* first warmup step */,

        blocks: /* intervals grouped as blocks */,

        cooldown: /* last cooldown step */

    )

    

    try await WorkoutScheduler.shared.schedule(

        customWorkout,

        at: workout.scheduled_date

    )

    

    // Mark server-side

    await api.markWorkoutPushed(workout.id)

}
10.2 Fallback for non-Apple-Watch users
If user has no Apple Watch, WorkoutKit push is a no-op (WorkoutKit schedule succeeds silently on iPhone-only). The athlete sees today's workout in-app but no wrist prompts.

Future: Garmin Connect direct push (Phase 3+), Wahoo push (Phase 4+).


11. Observability additions
11.1 New PostHog events
subscription_upgraded_to_plan (free → plan)
subscription_upgraded_to_coach (plan → coach)
subscription_downgraded (coach → plan, plan → free)
plan_generated (new plan created)
plan_adapted (adaptation event, with type)
workout_kit_pushed
coach_discovered (opened coach directory)
coach_booked
coach_message_sent
coach_alert_triggered (with type)
11.2 Cost telemetry additions
Per-user plan generation cost.
Per-user adaptation compute cost.
Marketplace revenue attribution (which acquisition channel led to which coach conversion).


12. Security additions
12.1 Stripe Connect
Never store Stripe Connect account credentials.
All Connect events verified via webhook signature.
Payout errors alert Sentry immediately.
12.2 Coach access
Coaches can only view athletes they have active assignments with.
RLS policy on all coach-side endpoints: WHERE coach_user_id IN (SELECT coach_user_id FROM coach_athlete_assignments WHERE athlete_user_id = X AND status = 'active').
Coaches cannot see other coaches' athletes.
Coaches cannot see athletes' historical data prior to assignment start (privacy).
12.3 PHI handling
Unchanged from v1. HealthKit data never sent verbatim to LLM. Aggregated metrics only.


13. Open architecture decisions (defer)
Same as v1 plus:

Stripe Connect Express vs Standard accounts for coaches. Current plan: Express. Standard gives coaches more control but more onboarding friction.
Coach payout schedule: standard 2-day vs on-demand. Current plan: standard.
Trial for coach relationships (0, 7, 14 days): coach-configurable, default 7 days.
WorkoutKit fallback for non-Apple-Watch: no-op vs export as .fit for Garmin sync. Deferred to Phase 3+.
Coach-authored voice pattern entries: can coaches contribute voice patterns for their athletes? Deferred.


14. Change log
v1 (2026-04-26 earlier): Initial Architecture doc for v1.3 PRD.
v2 (2026-04-26 later): Added tier state machine, plan generation subsystem, coach marketplace, Stripe Connect, coach-side platform, in-app messaging, coach alerts, WorkoutKit push.

Layer | Choice | Notes
iOS client | SwiftUI, iOS 17+ | Unchanged
Charts (dashboard cards) | Swift Charts | Unchanged
Charts (CDV inline + plan-driver expansion) | WebView + Vega-Lite | Unchanged
Workout push to watch | Apple WorkoutKit (new for v2) | Structured workouts with intervals appear on watch
Backend API | Node.js 22 + Fastify | Unchanged
Database | Postgres 16 (Supabase) | Unchanged
Cache + queue | Redis + BullMQ | Unchanged
Background jobs | BullMQ workers on Railway | Expanded scope: + plan gen, + adaptation, + alerts
LLM | OpenAI (gpt-4o for reads, gpt-4o-mini for CDV + adaptation text) | Unchanged
Athlete payments | Stripe Payment Links + Customer Portal | Free tier creates zero-dollar customer for future upgrade
Marketplace payments | Stripe Connect (Express accounts, direct charges with platform fee) | New for v2
Messaging | Twilio WhatsApp Business API | Plan/Coach tier only; Free uses APNS push
In-app messaging (coach↔athlete) | Direct DB storage + APNS delivery notifications | New for v2
Email | Resend (transactional) | Same
Auth | Sign in with Apple | Same
Analytics | PostHog | Same
Errors | Sentry | Same
Secrets | Railway env + 1Password CLI | Same