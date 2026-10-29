# Tier gating: design for Q30 (draft, nothing built)

Status: waiting on Q30. This note maps every Plan-tier surface in the API to what a Free athlete gets, so the build is one short branch once Evan answers. No code, no migration on this branch.

## Where the tier lives

Doc 07 v2 §4.1 specifies a `subscription_tiers` table keyed by `users.id`. The live API keys every table by the athlete's Strava id (`athletes.strava_id`, see the comment in `20261017010000_manual_plans.sql`), and `users` rows are not linked until Sign in with Apple lands.

Recommendation: build `subscription_tiers` as doc 07 shapes it, but keyed by `athlete_id text` (the Strava id) like the other live tables, with `user_id` nullable for the Sign in with Apple migration. Q30 option A said an `athletes.tier` column; the table is the same amount of work, matches doc 07, and keeps Stripe and coach-assignment fields out of `athletes`. RLS on, no policies (service role only), like `20261028000000_rls_all_tables.sql`.

One read path: `tierOf(athleteId) -> 'free' | 'plan' | 'coach'`, default `free` when no row exists. Coach tier counts as Plan for every Plan feature, except plan generation (CLAUDE.md §5.3).

## Route by route

| Surface | Today | Free gets | Plan gets | Coach gets |
|---|---|---|---|---|
| `POST /api/plan/generate`, `GET /api/plan/options`, `GET /api/plan/block` | `PLAN_GENERATION` flag | 404 (setup entry hidden in the app) | as now | 404 / empty (coach plan replaces it; already true for `options` and `block` when a coach plan is active) |
| Adaptations in the read, `GET /api/plan/adaptations`, `/history`, `/dismiss` | `PLAN_ADAPTATIONS` flag | no adaptation runs; 404 | as now | none (coach plan; already true) |
| `ADAPTATION_REASON_LLM` | flag | n/a | as now | n/a |
| Inline chart links in the read (`read.links`, `read.series`) | `INLINE_CHARTS` flag | omitted (card-level expansion only, CLAUDE.md §3.4) | as now | as now |
| `read.today` Today line | shown when the session has steps (only SCORA plans) | omitted | as now | shown for the coach's sessions once they carry steps |
| `GET /api/plan/prediction` | `RACE_PREDICTIONS` flag | 404 | as now | as now |
| `GET /api/calories` | `CALORIE_ENGINE` flag | 404 | as now | as now |
| `POST /api/plan/workouts/:id/watch-sent` (WorkoutKit) | open | 404 (app hides Send to Watch) | as now | as now |
| `POST /api/cdv` daily limit | 3 (`FREE_CDV_DAILY_LIMIT`) | 3 | ~30 soft limit (CLAUDE.md §5.2) | ~30 |
| Sunday weekly review push | Monday, same time (24h late) | Monday | Sunday morning | Sunday morning |
| Data history | read pulls 35 days | 90-day cap (not yet enforced anywhere: nothing stores history) | unlimited | unlimited |
| WhatsApp doorbell | not built (Q29) | APNs only | WhatsApp | WhatsApp |

Free-tier surfaces stay open to everyone: the read, cards, card expand, week so far, manual paste and iCal import (plan source for the plan-aware read), preferences, device registration, push-open events.

## Shape of the change

- Keep each feature flag as the global switch; add the tier check after it (`if (!flag) 404; if (!(await hasTier(athleteId, 'plan'))) 404`). Flags off still hide everything from everyone.
- One helper in `apps/api/src/tier.ts` with a 60-second in-process cache, so the read does not add a query per field.
- Tests: route tests already run against a local fake of Supabase REST (`test/helpers/fake-rest.ts`); one table-driven test per row above, Free vs Plan.
- App side: the dashboard and plan screens already hide what the API omits or 404s; the paywall surfaces come with the Stripe item.

## Open points for Evan

1. Table keyed by Strava id now, migrated to `user_id` with Sign in with Apple (recommended), or wait for Sign in with Apple and key by `user_id` from the start.
2. Plan-tier CDV limit: 30 per day hard, or 30 soft with a log line only.
3. How Evan sets himself to `plan` before Stripe: a SQL line in `docs/merge-checklist.md` (recommended), or an admin route (needs auth, so no).
