# After merging `claude/integration-2026-10-28`

What the code on this branch needs in production. Nothing here was run against Supabase or Railway.

Reviewing the bundle first? Start with `docs/review-guide.md` (areas, risk, files to read first).

## 0. Order

1. Apply the migrations (section 1) before merging. They only add tables, columns, functions and RLS, so the code on `main` today keeps working on the new schema.
2. Merge and let Railway deploy with every flag off (section 2).
3. Run the smoke tests (section 5).
4. Turn flags on one at a time, each only after the migrations and data it lists.

Applying after the merge breaks things even with every flag off: the Plan Today card reads `scheduled_workouts.workout_structure_json` (migration 4), Watch send records write `workout_kit_pushed_at` (migration 4), and the scheduler and onboarding read `athlete_preferences` (migration 3).

On without a flag once merged and deployed (with a new app build where it is iOS):

- The push scheduler ticks every minute, retries a failed read every 15 minutes, sends to 4 athletes at a time, and logs `push_delivery` and `push_sent` lines.
- Each tick asks `scora_due_deliveries` (migration 12) for the athletes due now; until it is applied the log says `scora_due_deliveries not found` once and the tick reads every athlete.
- Push times follow each athlete's own time zone and delivery time from `athlete_preferences`; `PUSH_TZ` is no longer read.
- Pushes carry a `scora` payload; a tap opens Today's Read (or This Week) and is reported to `POST /api/events/push-open`.
- Plan Today card when the athlete has any plan; Share on This Week and under chat charts; past sessions, Watch send records.
- Daily reads log a `read_plan` line on plan days; voice lines carry `final_ok`.
- Error replies carry only `error`, no `detail` (causes are in the Railway log; the app never read `detail`).
- Chat, weekly and read ask Strava by date (8 weeks, 15 days, 35 days, paged) instead of the 50 most recent activities: still one Strava call per request unless an athlete logged over 200 activities in the window.
- Chat weekday patterns and "today" follow the athlete's local date.
- The voice validator is stricter (typography folded, paraphrased advice, unit and direction of driver numbers): watch the `voice` log lines' fallback rate for a few days after deploy.
- Oura "last night" counts only a night dated today; before the ring syncs, the Sleep card shows its no-data line.
- Treadmill and Zwift runs count toward load and volume (not race predictions).
- `POST /api/plan/manual` (plan paste, added 2026-10-17) has no flag: it calls gpt-4o-mini once per paste and saves the parsed plan. Watch OpenAI spend after deploy.
- New route `POST /api/unregister-device` (sign-out); a new app build sends it, and resends the time zone after travel.
- From 2026-10-31: a read that names a posture the rules did not decide is a validator catch (one retry, then the fallback), and numbers inside driver names ("Load (7d)") no longer back a value: watch the `voice` fallback rate again after deploy.
- Strava activity pages give up after 15 s and the Oura pull after 20 s, so one hung call no longer holds the morning push.
- Dashboard cards carry `connect` (oura, strava or null); the new app build offers Connect Oura only when Oura is not linked.
- The app skips onboarding for a returning athlete (reads `onboarded` from `GET /api/preferences`) and resends an unsaved delivery time.

From 2026-11-02 (no new migration, flag or env var):

- An OpenAI failure on any voice surface sends the checked driver fallback and logs one `voice_emission` line (`fallback`, `final_ok`). The `fallbackOnLlmError` option is gone; it was code only, nothing to change on Railway.
- Chat during an OpenAI outage answers 200, not 500: "No answer could be reached just now, so nothing is shown for this question.", `unavailable: true`, no drivers, and the query refunded (`remaining` counts the refund only when it was saved). Chat's OpenAI call now times out like the other surfaces.
- A failed Strava pull on read, weekly, chat, race prediction and calories still answers 401, but `error` is "Strava needs to be connected again." (Strava said 401 or 403 after the token refresh) or "Strava is not answering right now." (timeout, network, 5xx, bad body).
- Every voice surface (daily, weekly, card, cdv, adaptation_reason, why, more) logs `final_ok`. Gate 1.1.4 reads INCOMPLETE while any line lacks it, so a log that spans the deploy makes the gate script exit 3 (section 5).
- Plan setup (new app build) asks weekly volume in miles and posts `current_weekly_km` converted to km at two decimals; the API contract (km, 0 to 500) is unchanged, so older builds keep working.
- DEBUG builds only, never in release: new launch arguments `-demo-signin`, `-demo-onboarding`, `-demo-onboarding-step <oura|health|plan|delivery|done>` and `-demo-delivery-fails` (UI tests use them).

## 1. Apply the migrations (Supabase SQL editor, in this order)

All in `apps/api/supabase/migrations/`, tested on PGlite (`apps/api/test/migrations.test.ts`), none applied anywhere. Filename order is the apply order. The five files already on `main` (2026-07) are not listed.

1. `20261017000000_knowledge_library.sql`: `knowledge_sources`, `knowledge_chunks`, `read_citations` and `match_knowledge_chunks()`. It runs `create extension if not exists vector`; if the editor refuses, enable `vector` under Database > Extensions and re-run.
2. `20261017010000_manual_plans.sql`: `training_plans`, `scheduled_workouts` and `replace_manual_plan()` for a pasted plan.
3. `20261017020000_athlete_preferences.sql`: `athlete_preferences` (time zone, delivery time, onboarded, last push dates).
4. `20261018000000_plan_engine.sql`: `plan_templates`, `plan_adaptations`, SCORA plan columns on `training_plans`, workout structure and Watch send columns on `scheduled_workouts`.
5. `20261018010000_apply_plan_adaptation.sql`: `apply_plan_adaptation()`, logs a named change and edits the workout in one transaction.
6. `20261018020000_create_scora_plan.sql`: `create_scora_plan()`, stores a generated plan and all its workouts in one transaction.
7. `20261022000000_ical_plans.sql`: `ical` as a plan source, one active external plan per athlete, `replace_external_plan()` and `refresh_ical_plan()`, redefines `replace_manual_plan()`.
8. `20261028000000_rls_all_tables.sql` (Q28): RLS on the init tables, no policies; the API uses the service role, so nothing breaks.
9. `20261030000000_ical_refresh_pairing.sql`: calendar refresh keeps each done/missed mark and the Watch send on its own session; redefines `refresh_ical_plan()` only.
10. `20261030010000_create_scora_plan_lock.sql`: plan setup takes the same per-athlete lock as a calendar paste or refresh; redefines `create_scora_plan()` only.
11. `20261101000000_create_scora_plan_idempotent.sql`: the same plan setup sent twice keeps the plan it made, with its marks and changes; redefines `create_scora_plan()` only.
12. `20261101010000_due_deliveries.sql`: `scora_due_deliveries()` and `scora_delivery_zone()`, so an idle push scheduler tick is one request instead of reading every athlete's preferences. Optional for correctness (without it the scheduler reads every athlete, as before, and checks again every 15 minutes), needed for scale; can be applied before or after the merge.

13. `20261103000000_ical_refresh_keeps_past.sql`: a calendar refresh keeps the plan's sessions from before yesterday (the importer leaves them out) with their done/missed marks and Watch sends; adds a three-argument `refresh_ical_plan()` beside the two-argument one. Needed before `ICAL_IMPORT=on`: the API calls the three-argument version.

No migrations were added on 2026-11-02; the list above is complete. Later ones, if any, follow in filename order.

9 redefines a function 7 creates (13 adds a second version that calls it); 10 and 11 redefine the one 6 creates. If you re-run any earlier migration, re-run every later one after it, in order.

## 2. Env and flags (Railway)

Flags are on only with the exact value `on`. Each defaults off, and with Plan-tier gating by subscription not built yet (Stripe item), a flag turns its feature on for every athlete.

| Flag | Turns on | Set only after |
|---|---|---|
| `ICAL_IMPORT=on` | `POST /api/plan/ical` and the calendar link field on Your Plan | migrations 2, 7, 9 and 13 |
| `KNOWLEDGE_RETRIEVAL=on` | knowledge library passages in the read, with `read_citations` rows | migration 1, the starter sources (spec §6), a real ingest run (section 4) |
| `PLAN_GENERATION=on` | plan setup screen, `/api/plan/options`, `/api/plan/block` | migrations 4, 6, 10 and 11, reviewed templates in `packages/plan-templates` (none yet) |
| `PLAN_ADAPTATIONS=on` | named plan changes with the read, `/api/plan/adaptations` and its history | migrations 4 and 5, an active SCORA plan (so `PLAN_GENERATION` first) |
| `ADAPTATION_REASON_LLM=on` | gpt-4o-mini words the change reason (uses `OPENAI_API_KEY`) | `PLAN_ADAPTATIONS` |
| `INLINE_CHARTS=on` | tappable drivers in the read | nothing else |
| `RACE_PREDICTIONS=on` | `/api/plan/prediction`, race range on Your Plan | an active SCORA plan, or a `race` query |
| `CALORIE_ENGINE=on` | `/api/calories` burn estimates | body weight (Q21); no weight, no estimate |

All eight flags are new on this branch.

Also new in the code, test only, never set on Railway: `NODE_ENV=test`, `SCORA_NO_LISTEN=1` (both together stop the server from listening) and `APNS_TEST_HOST` (ignored unless `NODE_ENV=test`).

No new secrets. The existing ones stay as they are, Evan sets, never committed: `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `STRAVA_CLIENT_SECRET`, `OURA_CLIENT_SECRET`, `APNS_KEY` (plus the non-secret `SUPABASE_URL`, `OURA_CLIENT_ID`, `API_URL`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_ENV`). `PUSH_TZ` can be removed.

## 3. Push

APNs env (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY`, `APNS_ENV`) starts the scheduler. It now ticks every minute and logs the delivery lines the gate report reads (`docs/gate-reports.md`).

## 4. Knowledge ingest (Evan runs, before `KNOWLEDGE_RETRIEVAL=on`)

From `apps/api`, after migration 1: `npx tsx scripts/ingest-knowledge.ts <export.json> --dry-run` (no OpenAI call, no write), then the same without `--dry-run`. `--sync` treats the export as the whole library and deletes entries not in it.

## 5. Smoke test after deploy (read-only)

1. `GET /health` returns `status: ok`; `GET /api/keepalive` returns `supabase: true`.
2. Export the Railway log from the first morning after deploy and, from `apps/api`, run `npx tsx scripts/voice-gate-report.ts <log-file>` (expect `push_delivery`, `push_sent` and `voice_emission` lines; exit 1 means a bar failed, exit 3 means not enough telemetry: no lines, or voice lines without `final_ok`, which a log starting before the deploy will have; export from after the deploy) and `npx tsx scripts/log-audit.ts <log-file>` (exit 0, no health values or secrets in the log).
3. Chat during an OpenAI outage (staging or local, with a bad `OPENAI_API_KEY`): `POST /api/cdv` answers 200 with the outage sentence and `unavailable: true`, the day's chat count is unchanged, and the log has one `voice_emission` line with `surface: cdv`, `fallback: true`.
4. Strava revoked (a test athlete, after revoking SCORA under Strava settings > My Apps): `POST /api/read` answers 401 with "Strava needs to be connected again." while the stored access token is unexpired (once it expires the refresh fails and the older "Strava not connected or refresh failed. Please reconnect Strava." comes back instead); the app shows either sentence.
5. In the Supabase SQL editor (each is a plain `select`): `apps/api/scripts/phase1-gates.sql` (edit `phase_start` first), `apps/api/scripts/plan-gates.sql`, and `apps/api/scripts/plan-invariants.sql` once `PLAN_ADAPTATIONS` is on (no rows means every plan bar held).

## 6. Open questions that touch this branch

Q28 (RLS), Q20 (rotate the Strava secret), Q18 (sign Oura state), Q16 (token in the deep link), Q26 (token encryption), Q27 (account deletion), Q21 (body weight).
