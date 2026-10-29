# After merging `claude/integration-2026-10-28`

What the code on this branch needs in production. Nothing here was run against Supabase or Railway.

On without a flag once merged and deployed (with a new app build where it is iOS):
- The push scheduler ticks every minute, retries a failed read every 15 minutes, sends to 4 athletes at a time, and logs `push_delivery` and `push_sent` lines.
- Pushes carry a `scora` payload; a tap opens Today's Read (or This Week) and is reported to `POST /api/events/push-open`.
- Plan Today card when the athlete has any plan; Share on This Week and under chat charts; past sessions, Watch send records.
- Daily reads log a `read_plan` line on plan days; voice lines carry `final_ok`.
- Error replies carry only `error`, no `detail` (causes are in the Railway log; the app never read `detail`).
- Chat, weekly and read ask Strava by date (8 weeks, 15 days, 35 days, paged) instead of the 50 most recent activities: more Strava calls for very active athletes, well inside rate limits for the alpha.
- Chat weekday patterns and "today" follow the athlete's local date.

## 1. Apply the migrations (Supabase SQL editor, in this order)

All tested on PGlite (`apps/api/test/migrations.test.ts`), none applied anywhere.

1. `20261017000000_knowledge_library.sql` (pgvector tables; enable the `vector` extension first)
2. `20261017010000_manual_plans.sql`
3. `20261017020000_athlete_preferences.sql`
4. `20261018000000_plan_engine.sql`
5. `20261018010000_apply_plan_adaptation.sql`
6. `20261018020000_create_scora_plan.sql`
7. `20261022000000_ical_plans.sql`
8. `20261028000000_rls_all_tables.sql` (Q28; RLS on, no policies; the API uses the service role, so nothing breaks)

The scheduler, Your Plan and onboarding read `athlete_preferences`, `training_plans` and `scheduled_workouts`, so 2 and 3 matter even with every flag off.

## 2. Flags (Railway env, all default off)

| Flag | Turns on | Also needs |
|---|---|---|
| `ICAL_IMPORT=on` | calendar link import on Your Plan | migration 7 |
| `KNOWLEDGE_RETRIEVAL=on` | knowledge library in the read | migration 1, an ingest run, the starter sources (spec §6) |
| `PLAN_GENERATION=on` | plan setup screen, `/api/plan/options`, `/api/plan/block` | migrations 4 to 6, reviewed templates in `packages/plan-templates` (none yet) |
| `PLAN_ADAPTATIONS=on` | named plan changes with the read, change history | a SCORA plan (above) |
| `ADAPTATION_REASON_LLM=on` | gpt-4o-mini words the change reason | `PLAN_ADAPTATIONS` |
| `INLINE_CHARTS=on` | tappable drivers in the read | nothing else |
| `RACE_PREDICTIONS=on` | race range on Your Plan | an active SCORA plan or a `race` query |
| `CALORIE_ENGINE=on` | burn estimates | body weight (Q21) |

Plan-tier gating by subscription does not exist yet (Stripe item), so a flag turns its feature on for every athlete.

## 3. Push

APNs env (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY`, `APNS_ENV`) starts the scheduler. It now ticks every minute and logs the delivery lines the gate report reads (`docs/gate-reports.md`).

## 4. Open questions that touch this branch

Q28 (RLS), Q20 (rotate the Strava secret), Q18 (sign Oura state), Q16 (token in the deep link), Q26 (token encryption), Q27 (account deletion), Q21 (body weight).
