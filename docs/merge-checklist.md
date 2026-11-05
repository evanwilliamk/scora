# After merging `claude/integration-2026-10-28`

What the code on this branch needs in production. Nothing here was run against Supabase or Railway.

Reviewing the bundle first? Start with `docs/review-guide.md` (areas, risk, files to read first).

## 0. Order

Rehearsed on PGlite (`apps/api/test/migration-rehearsal.test.ts`, `migration-deploy-order.test.ts`), with `main`'s schema and existing rows as the start. What PGlite cannot prove is at the end of section 1.

1. Run the precheck (section 1). No rows back means go on.
2. On Railway, check `SUPABASE_SERVICE_ROLE_KEY` is the service role (secret) key from Supabase Settings > API, not the anon (publishable) one. Migration 8 turns RLS on, and an anon key then reads nothing from `athletes` or `device_tokens`.
3. Apply the migrations one at a time, in the order of section 1, on the `main` API. It keeps working: it only touches `athletes` and `device_tokens`, no column there changes, and every request it sends got the same answer on the new schema.
4. Run the check after the migrations (section 1). No rows back means go on.
5. Merge so the deploy lands outside 06:00 to 08:00 New York time (section 3 says why), and let Railway deploy with every flag off (section 2).
6. Run the smoke tests (section 5).
7. Turn flags on one at a time, each only after the migrations and data it lists.

Rolling the code back after this needs no schema change, for the same reason as step 3.

If the merge deploys before the migrations (tested, every flag off):

- Nothing is lost and no row changes. `/health`, `/api/keepalive`, `/api/read`, `/api/weekly`, `/api/cdv`, `/api/register-device` and `/api/unregister-device` still answer 200. The read has no plan lines.
- `GET` and `PUT /api/preferences`, `GET /api/plan`, `POST /api/plan/manual`, and the session `status` and `watch-sent` routes answer 500.
- The push scheduler sends nothing and logs `failed to load athletes` every minute, until migration 3 is applied. It never guesses: without `athlete_preferences` there is no once-a-day claim.
- The fix is to apply the migrations then, in the same order. No redeploy is needed. Run `notify pgrst, 'reload schema';` if the routes still answer 500.

With every flag off, the merge needs migrations 2, 3, 4 and 14; leaving out any other one breaks no unflagged route. Apply all 16 anyway.

On without a flag once merged and deployed (with a new app build where it is iOS):

- The push scheduler ticks every minute, retries a failed read every 15 minutes, sends to 4 athletes at a time, and logs `push_delivery` and `push_sent` lines.
- Each tick asks `scora_due_deliveries` (migration 12) for the athletes due now; until it is applied the log says `scora_due_deliveries not found` once and the tick reads every athlete (which still needs migration 3).
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

From 2026-11-04 (one new migration, section 1 item 16; no new flag or env var):

- The voice validator bans many more paraphrases of advice, coach self-reference, pushback flips and clinical claims. A false catch sends the fallback, so watch the `voice` fallback rate after deploy and read `apps/api/test/validator-redteam.test.ts` for what is caught.
- After a Strava 429 the API makes no Strava calls until the next quarter hour, or midnight UTC if the daily count is spent. Reads answer "Strava is not answering right now." meanwhile and the scheduler retries inside its late window. Limits and the athlete counts they allow: `docs/vendor-budget.md`.
- Every model call logs one `llm_call` line per athlete (`apps/api/src/llm-meter.ts`), so per-user cost can be read from the logs. It does not move gate 1.1.4.
- `POST /api/plan/generate` (flag `PLAN_GENERATION`): a race Monday to Wednesday starts the plan a week earlier and the plan's `end_date` is race day; a race more than 12 months out answers 422 `race_too_far`. The new app build's date picker stops at the same day.
- A calendar feed naming Runna is stored as `external_source='runna'`, checked on a synthetic feed only. No real Runna feed has been seen.

## 1. Apply the migrations (Supabase SQL editor, in this order)

All in `apps/api/supabase/migrations/`, tested on PGlite (`apps/api/test/migrations.test.ts`, `migration-rehearsal.test.ts`), none applied anywhere. Filename order is the apply order. The five files already on `main` (2026-07) are not listed; the precheck confirms they are on production.

**Precheck, before the first migration.** A plain `select`. No rows back means go on; each row names what is wrong.

```sql
-- precheck
select problem from (
  select 'Postgres 15 or newer is needed (migration 15), found ' || current_setting('server_version') as problem
  where current_setting('server_version_num')::int < 150000
  union all
  select 'pgvector is not available on this project (migration 1)'
  where not exists (select 1 from pg_available_extensions where name = 'vector')
  union all
  select 'pgvector 0.5 or newer is needed for the hnsw index (migration 1), found ' || default_version
  from pg_available_extensions
  where name = 'vector' and string_to_array(default_version, '.')::int[] < array[0, 5]
  union all
  select 'missing, so a migration on main was not applied: ' || w.t || '.' || w.c
  from (values ('users', 'email'), ('athletes', 'strava_id'), ('athletes', 'strava_access_token'),
    ('athletes', 'oura_access_token'), ('athletes', 'cdv_count'), ('athletes', 'cdv_count_date'),
    ('activities', 'athlete_id'), ('workouts', 'athlete_id'), ('health_data', 'athlete_id'),
    ('device_tokens', 'token')) as w(t, c)
  where not exists (select 1 from information_schema.columns k
    where k.table_schema = 'public' and k.table_name = w.t and k.column_name = w.c)
) p;
```

Paste one whole file per run. A file that fails changes nothing, so fix the cause and paste it again. Files 4, 7 and 16 hold `drop constraint` or `drop index`, each recreated in the same file, so the editor may warn about destructive operations; no table, column or row is dropped.

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
12. `20261101010000_due_deliveries.sql`: `scora_due_deliveries()` and `scora_delivery_zone()`, so an idle push scheduler tick is one request instead of reading every athlete's preferences. Optional for correctness (without it the scheduler reads every athlete, as before, and checks again every 15 minutes), needed for scale; can be applied before or after the merge, but after migration 3, or it fails on the missing table.

13. `20261103000000_ical_refresh_keeps_past.sql`: a calendar refresh keeps the plan's sessions from before yesterday (the importer leaves them out) with their done/missed marks and Watch sends; adds a three-argument `refresh_ical_plan()` beside the two-argument one. Needed before `ICAL_IMPORT=on`: the API calls the three-argument version.
14. `20261103010000_plan_marks_locked.sql`: `mark_scheduled_workout()` and `mark_workout_watch_sent()`, so a done/missed mark or Watch send runs under the per-athlete plan lock and never lands on a plan a refresh or paste just replaced. Needed at merge: `POST /api/plan/workouts/:id/status` and `/watch-sent` call them (they are unflagged).
15. `20261103020000_knowledge_source_unique.sql` (data-writes review): a unique index on `knowledge_sources (title, author) nulls not distinct`, so two ingest runs of a source with no author keep one row. Index only. Apply with or after migration 1, before the first ingest run; not needed before merge (the library is idle until `KNOWLEDGE_RETRIEVAL=on` and an ingest). If an ingest already ran, the duplicate check in the file's header must return no rows first.
16. `20261104000000_runna_calendar_source.sql`: a calendar feed naming Runna is stored as a `runna` plan. Redefines `replace_external_plan` and both `refresh_ical_plan` versions and widens the one-active-plan index. Until it is applied, importing a feed that names Runna fails with a 500 (other feeds are unaffected).

The list above is complete as of 2026-11-04. Later ones, if any, follow in filename order.

**Check after the migrations.** Run `notify pgrst, 'reload schema';` first, so the API sees the new tables and functions, then this plain `select`. No rows back means every table, function version, index and RLS flag is the final one. A row names what to re-run.

```sql
-- verify
with fn(name, nargs, hash) as (values
    ('apply_plan_adaptation', 1, 'ed6db179debcb35d342ef6100f115485'),
    ('create_scora_plan', 1, 'd8b2f0bc6cb4cf3589f1a0767387a4b7'),
    ('mark_scheduled_workout', 4, 'b8ffa16112ce379d6a85f23a05197b75'),
    ('mark_workout_watch_sent', 2, '5141d72c7c048906ddeb7f3e4ea4209c'),
    ('match_knowledge_chunks', 3, '809960cd4e5bdcd85f37370590212d62'),
    ('refresh_ical_plan', 2, '762cd77cd841e06e0870fd3ce3a82ab4'),
    ('refresh_ical_plan', 3, '148db66919948435db86f74b83659854'),
    ('replace_external_plan', 4, 'ff90f7786f2d9bafd89ddaa9675ba8a3'),
    ('replace_manual_plan', 3, 'c6ac92aa17aeb5c064f93338fcbd4f89'),
    ('scora_delivery_zone', 1, '55448851d11f9b6efc589ea2ee1d34a8'),
    ('scora_due_deliveries', 4, '513e7ac1e1af47c808675616cb0baf1a')),
tbl(t) as (values ('users'), ('athletes'), ('activities'), ('workouts'), ('health_data'), ('device_tokens'),
    ('knowledge_sources'), ('knowledge_chunks'), ('read_citations'), ('training_plans'), ('scheduled_workouts'),
    ('athlete_preferences'), ('plan_templates'), ('plan_adaptations')),
col(t, c) as (values ('training_plans', 'template_id'), ('training_plans', 'goal_race_date'),
    ('training_plans', 'weekly_volume_start_km'), ('scheduled_workouts', 'workout_structure_json'),
    ('scheduled_workouts', 'workout_kit_pushed_at')),
idx(i, has) as (values ('knowledge_chunks_embedding_idx', 'hnsw'), ('knowledge_chunks_source_idx', ''),
    ('knowledge_chunks_tags_idx', ''), ('knowledge_sources_title_author_one', 'NULLS NOT DISTINCT'),
    ('plan_adaptations_athlete_time_idx', ''), ('read_citations_athlete_idx', ''), ('read_citations_chunk_idx', ''),
    ('scheduled_workouts_athlete_date_idx', ''), ('training_plans_athlete_status_idx', ''),
    ('training_plans_one_active_external_idx', 'runna'), ('training_plans_one_active_scora_idx', '')),
chk(k, has) as (values ('training_plans_external_source_check', 'ical'), ('training_plans_template_source_check', 'template_id'),
    ('scheduled_workouts_source_check', 'external_ical'), ('scheduled_workouts_planned_intensity_check', 'steady_state'))
select 'function missing or an old version, re-run from the newest file that defines it: ' || f.name || ' (' || f.nargs || ' args)' as problem
from fn f
where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = f.name and p.pronargs = f.nargs
    and md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) = f.hash)
union all
select 'table missing: ' || t from tbl where to_regclass('public.' || t) is null
union all
select 'row level security is off: ' || c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
union all
select 'policy not expected, the API uses the service role: ' || tablename || '.' || policyname
from pg_policies where schemaname = 'public'
union all
select 'column missing: ' || t || '.' || c from col
where not exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = t and k.column_name = c)
union all
select 'index missing or an old version: ' || i from idx
where not exists (select 1 from pg_indexes x where x.schemaname = 'public' and x.indexname = i and x.indexdef like '%' || has || '%')
union all
select 'constraint missing or an old version: ' || k from chk
where not exists (select 1 from pg_constraint c where c.conname = k and pg_get_constraintdef(c.oid) like '%' || has || '%')
union all
select 'old index still here, re-run migration 7, then 16: training_plans_one_active_manual_idx'
where to_regclass('public.training_plans_one_active_manual_idx') is not null
union all
select 'extension not installed: vector'
where not exists (select 1 from pg_extension where extname = 'vector');
```

Pasted twice (tested, with rows in every table):

- The same file twice in a row: all 16 change nothing, with no error.
- A file re-run after later ones are applied: 10 of the 16 still change nothing. Six give no error and change no row, but silently put an older function back, and the later file's behavior is lost until it is re-applied. The check above names it:
  - 2 (`manual_plans`): the old `replace_manual_plan` and the dropped index are back. A paste over a calendar plan fails, and a paste over a SCORA plan leaves two active plans.
  - 6 (`create_scora_plan`) and 10 (`create_scora_plan_lock`): a double tap on plan setup replaces the plan again and loses its marks; 6 also drops the lock.
  - 7 (`ical_plans`): Runna feeds fail, and a refresh loses Watch sends.
  - 9 (`ical_refresh_pairing`) and 13 (`ical_refresh_keeps_past`): a Runna plan's refresh silently does nothing.
- To repair any of them, re-run every later file after it, in order, then the check. Tested for all 16.
- The files on `main`: `20260701000000_init.sql` stops with `relation "users" already exists` and changes nothing; the other four change nothing.

The API code and the check above expect this exact set; a later migration that changes a function changes its hash here too (a test holds them together).

What PGlite could not prove (Postgres 18 in WebAssembly, one superuser, no Supabase):

- `create extension vector` on the project, and the `vector` schema it lands in. The precheck reads what is available; the check confirms it installed.
- Production's version. Everything was run on Postgres 18, and production may be older. Only migration 15 needs a newer version (15), as far as a reading of the files shows; the precheck covers that one.
- That production's schema and rows match `main`'s migrations. They were applied by hand, so drift is possible. The precheck only looks for the columns the code needs.
- Service role and anon behavior. Tested with stand-in roles set up as Supabase documents them, not the real ones, and not the real key on Railway (step 2 of section 0).
- PostgREST itself: a local stand-in answered the requests. Its schema cache reload is why `notify pgrst` is there. The named-argument choice between the two `refresh_ical_plan` versions, and the read-only transaction it uses for `scora_due_deliveries`, are read or imitated, not run.
- That the SQL editor runs one paste as one transaction. PGlite does, and "a file that fails changes nothing" rests on that. If a failed paste looks half-applied, re-paste the file: every one of the 16 is safe to repeat.
- How long `alter table ... enable row level security` waits on real traffic (it needs a brief exclusive lock on the init tables).

## 2. Env and flags (Railway)

Flags are on only with the exact value `on`. Each defaults off, and with Plan-tier gating by subscription not built yet (Stripe item), a flag turns its feature on for every athlete.

| Flag | Turns on | Set only after |
|---|---|---|
| `ICAL_IMPORT=on` | `POST /api/plan/ical` and the calendar link field on Your Plan | migrations 2, 7, 9, 13 and 16 |
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

Have the deploy land outside 06:00 to 08:00 New York time. After migration 3 no athlete has a preferences row, so every device reads as New York, 06:00, not sent today (tested on existing rows). `main`'s scheduler keeps no record in the database, so a deploy inside that window sends today's read a second time (and on a Monday the weekly). Outside it nothing is due until the next morning and nothing is missed.

Look at `PUSH_TZ` on Railway first. If it is set to anything but `America/New_York`, deploy after both 08:00 New York and 06:00 in that zone, so today's read went out once; athletes then move to 06:00 New York until the new app build sends their time zone.

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

## Added 2026-11-05: Settings sheet (`claude/ios-settings`)

No migration or flag. Smoke test on a phone: gear on the dashboard, change the time and save, then Reconnect Strava with the same account (banner says Strava connected, read reloads) and with another account (banner says nothing changed, same athlete stays). Sign Out now lives in this sheet.
