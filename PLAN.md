# PLAN.md

Working checklist for coding agents (Claude Code and OpenClaw). Source: `01_SCORA_90-Day_Execution_Plan_v1_4.md`, `memory/design-todos.md`, and the current code. Work top to bottom. One branch per item (see CLAUDE.md §9.1). Check items off only when they are merged by Evan.

Legend: `[ ]` open, `[x]` done, `[~]` branch ready for review, `[!]` blocked or waiting on Evan.

After merging `claude/integration-2026-10-28`: migrations, flags and smoke tests are in `docs/merge-checklist.md`.

## Done (Phase 0 and early Phase 1)

- [x] Monorepo, Fastify API on Railway, Supabase Postgres
- [x] Strava OAuth + ingestion
- [x] Oura OAuth + Sleep/Recovery cards
- [x] Apple HealthKit (Sleep + Recovery without Oura)
- [x] Dashboard + Today's Read from Strava data
- [x] CDV chat, gated at 3 queries/day (fail-open on quota errors)
- [x] Sunday weekly read (generation + view)
- [~] Sunday review names how the week tracked against the plan (`claude/weekly-plan-aware`, on `claude/integration-2026-10-22`)
- [x] Driver-existence + banned-phrase validators, unit tests
- [~] UI smoke tests on the DEBUG demo data: dashboard numbers and Week So Far; Your Plan past sessions and Send to Watch (`claude/ui-smoke-tests`, on `claude/integration-2026-10-22`; run with `-only-testing:ScoraUITests`)
- [~] Route tests: the real Fastify routes driven with inject (flag gates, input checks); `SCORA_NO_LISTEN=1` keeps tests off the port and the scheduler (`claude/route-tests`, on `claude/integration-2026-10-22`)
- [~] Tests: Strava and Oura token refresh (5-minute window, rotation, errors); a refreshed token that fails to save is now logged (`claude/tests-token-refresh`, on `claude/integration-2026-10-22`)
- [~] Tests: the Supabase stores production runs (preferences claim/release, plan adaptations) pinned with a recording fake (`claude/tests-supabase-stores`, on `claude/integration-2026-10-22`)
- [~] Banned-phrase parity with CLAUDE.md §4.1: 8 missing bans added, "long run a week ago" no longer flagged (`claude/banned-phrase-parity`, on `claude/integration-2026-10-22`)
- [~] Driver-existence check on CDV chat replies (doc 10 §6.1), numbers must be in the data sent to the model (`claude/cdv-driver-check`, on `claude/integration-2026-10-22`)
- [x] APNs scaffolding + scheduled daily/weekly delivery (idle until env is set)
- [x] Daily keepalive ping (Railway + Supabase)

## Agent workflow

- [x] Shared workflow rules, PLAN.md, DECISIONS.md
- [~] Point `/scora-context` at repo files instead of a machine-specific memory path (`claude/scora-context-paths`)
- [~] Push policy: agents push branches, Evan merges (`claude/push-policy`)
- [!] OpenClaw: align its AGENTS.md with CLAUDE.md §9.1, decide where its workspace files live (Evan)

## Phase 0 / Phase 1 remaining

All `[~]` branches from 2026-10-17 to 2026-10-28 are merged together, with doc conflicts resolved, in `claude/integration-2026-10-28` (tests and typecheck pass there; it supersedes `claude/integration-2026-10-22` and the older ones). Review the branches, then merge that one PR instead of each. How to run the gate reports: `docs/gate-reports.md`.

- [~] Numeric line first (PRD §5.A.2, CLAUDE.md §3.3) in the read, the push and Today's Read, plus the posture badge (PRD §5.A.3) (`claude/numeric-first-read`, on `claude/integration-2026-10-18`; seen on the simulator)
- [~] Plan Today dashboard card (PRD §5.A.3) when the athlete has a plan: the session's minutes or km with its kind, a rest day, or nothing; tap shows the plain sentence, no LLM (`claude/plan-today-card`, on `claude/integration-2026-10-28`; seen on the simulator with `-demo-read -demo-cards`)
- [~] Morning message "Today:" line (CLAUDE.md §3.3, Plan and Coach tiers): the read, the push and Today's Read add it for a session SCORA built (has steps); pasted plans and rest days get none; the push puts it last, the voice keeps about 60 characters, a stub line is left off; also on the no-activity reply, and downgraded sessions keep it (review fixes 2026-10-29) (`claude/today-workout-line`, on `claude/integration-2026-10-28`; seen on the simulator with `-demo-read -demo-plan-sessions`)
- [~] Week So Far: Mon to Sun run-minute bars + one line built from the same numbers (PRD §5.A.3) (`claude/week-so-far`, on `claude/numeric-first-read`; seen on the simulator)
- [~] Week So Far shows the plan's run minutes as outlines and states them in the line (`claude/week-planned`, on `claude/integration-2026-10-22`; seen on the simulator)
- [~] Push tap-through (PRD §5.A.2): a tapped daily push closes any open sheet and scrolls to Today's Read; the weekly push opens This Week; works when the tap launches the app (`claude/push-tap-routing`, on `claude/integration-2026-10-28`; unit-tested, not tapped on the simulator)
- [!] APNs env vars on Railway (needs Apple Developer enrollment + .p8 key). Done when a scheduled read arrives on Evan's phone at his delivery time
- [~] Tests: APNs provider JWT verified against a throwaway key; scheduled push delivery (body format, dead-token pruning) (`claude/tests-push-prefs`, on `claude/integration-2026-10-22`)
- [~] Tests: `sendPush` against a local HTTP/2 stand-in for APNs (path, headers, `scora` payload, refusal reasons); host override honored only under NODE_ENV=test (`claude/tests-send-push`, on `claude/integration-2026-10-28`)
- [~] Tests: whole routes against a local fake of Supabase REST plus a fetch guard (only the fake's origin passes; Strava/Oura/OpenAI canned; http2 blocked): plan, status, Watch, adaptations, read with validator fallbacks, manual paste, preferences, devices, weekly, chat quota. index.ts lines 58% to 76% (`claude/route-tests-fake-rest`, on `claude/integration-2026-10-28`)
- [~] Error replies carry a plain message, never internal error text (14 routes echoed vendor and DB errors) (`claude/no-error-detail`, on `claude/integration-2026-10-28`)
- [~] Older-code fixes from a 10-29 review (all on `claude/integration-2026-10-28`): Strava asked by date window, paged (`claude/strava-date-windows`); chat weekday patterns and "today" on the athlete's date, weekly long-run weekday in UTC (`claude/cdv-local-today`); weekday patterns count weeks, not runs (`claude/cdv-weekday-weeks`); pace never ":60", treadmill/Zwift runs count (not for race predictions), calendar "days ago", no "n/a wk" (`claude/metrics-fixes`); Oura "last night" only from today or yesterday (`claude/oura-last-night`)
- [~] Fixes from 2026-10-30 reviews (all on `claude/integration-2026-10-28`): plan paste parser (5k pace, 45 MIN, Z2 HR, min/mi pace, h:mm:ss) (`claude/plan-parse-fixes`); knowledge retry floor, batched prune, single-flight Oura/Strava refresh (`claude/knowledge-token-fixes`); calories for slow runs, prediction pool, template pick by weeks to race (`claude/estimates-fixes`); calendar TZID dates, Send to Watch across DST (`claude/ical-watch-fixes`); late read past midnight, claim release retry, push-open with the Strava id, weekly local days, CDV quota refund, Strava denial page (`claude/delivery-fixes`)
- [~] Fixes from 2026-10-31 reviews (all on `claude/integration-2026-10-28`): mislabelled hard template blocks refused, worded downgrade reasons name the new session (`claude/plan-engine-review`); partial first plan week measured against its stored sessions, impossible race dates get a 400 (`claude/plan-first-week`); WhatsApp body under 1,600 characters, validators before compose, polite opt-outs, :443 signature form (`claude/whatsapp-workoutkit-review`); banned METRIC lines, weekday chart by local days, whole-number baselines, expansions only name the read's posture (`claude/expansion-chart-review`); the read may not name an undecided posture, low sleep score label, plan keys in words (`claude/read-pipeline-review`); driver-name digits back nothing (`claude/validator-name-digits`); more cited drivers open a chart, the rest listed as not chartable, guarded by a test (`claude/tappable-drivers`); iOS onboarding double tap, lenient chat and weekly decoding, VoiceOver labels (`claude/ios-onboarding-chat-review`); onboarding skipped for returning athletes, unsaved delivery time retried (`claude/onboarding-resume`)
- [~] More 2026-10-31 fixes (all on `claude/integration-2026-10-28`): posture evidence cites only the clauses that fired (`claude/posture-review`); sleep score charted from dated Oura nights (`claude/sleep-score-chart`); tests for strava.ts, scheduler, usage, device tokens (`claude/coverage-gaps`); dashboard stale loads, failed refresh line, VoiceOver cards (`claude/ios-dashboard-review`, `claude/ios-refresh-cancel`); second-pass review of the night's API and iOS diffs (`claude/review-1031`, `claude/ios-review-1031`, includes a DST-safe delivery time picker); Strava and Oura fetch timeouts (`claude/webhook-review`); cards carry `connect` (`claude/card-connect-flag`); knowledge library citations and relayed advice (`claude/knowledge-review`); weekly planned minutes match Week So Far (`claude/weekly-review-api`); Your Plan shows when changes failed to load (`claude/ios-settings-plan-review`); OpenAI outage sends the validated fallback read (`claude/llm-outage-fallback`); chat weekday chart counts weeks (`claude/cdv-weekday-chart-weeks`)
- [~] 2026-11-01 work (all on `claude/integration-2026-10-28`): Long Effort card driver renamed Longest run (30d), Q31 B (`claude/longest-run-card`); plan generation fixes: half-minute sessions, null weekly km, past or too-close race refusals, idempotent double submit, migration 20261101000000 (`claude/plan-generate-review`, `claude/review-1101`); paste of 0-minute or 0-km sessions no longer 500s, schema guard over every `.from()`/`.rpc()` (`claude/schema-code-check`); coach self-reference rule widened and narrowed for Coach-tier reads, package tests (`claude/package-coverage`, `claude/review-1101`); Watch copies follow plan changes and carry a session plan id, last night's HRV from the sleep window, foreground push banners (`claude/ios-health-watch-review`, `claude/watch-reconcile-hrv-night`, `claude/watch-plan-id`); scheduler pages past Supabase's 1000-row cap, DST simulation (`claude/dst-delivery-sim`); Free tier boundaries pinned, `docs/free-tier-boundaries.md` (`claude/free-tier-boundaries`); merge checklist audited (`claude/merge-checklist-audit`); copy style guard, API and iOS cleanup, ESLint (`claude/copy-style-sweep`, `claude/api-cleanup-1101`, `claude/ios-warnings-1101`, `claude/api-eslint`)
- [~] 2026-11-02 work (all on `claude/integration-2026-10-28`): plan distances in miles everywhere, converted from stored km, one helper for a later unit preference, Q32 B (`claude/plan-distance-unit`; plan setup asks miles and posts km, `claude/ios-plan-setup-miles`); doc 10 coverage map `docs/acceptance-coverage.md` with gap tests (`claude/acceptance-coverage`) and two of its findings fixed (`claude/acceptance-fixes`); gate 1.1.4 counts every voice surface and an OpenAI outage on any surface is a logged validated fallback, chat no longer 500s (`claude/gate-fail-through`, `claude/telemetry-leftovers`, `claude/outage-telemetry`, `claude/review-1102-late`); vendor error bodies never logged; tsc covers api tests and scripts (`claude/typecheck-tests`); iOS fixes: earlier-day reads drop today lines and reload after midnight, cache only for who asked, no developer error text, sign-out guards (`claude/review-1102`, `claude/ios-review-1102`, `claude/ios-review-1102b`); 33 iOS logic tests (`claude/ios-tests-1102`); API second pass (`claude/review-1102-api`)
- [~] iOS offline and slow network (`claude/ios-offline`): last read kept on the phone and shown under its date at launch; a read from an earlier day is never headed Today's Read; 15 s and 30 s request timeouts; plain offline lines on the dashboard, chat, This Week and Your Plan; those screens reload when the connection returns, chat puts the question back in the box
- [~] Schema vs code check: every supabase-js table, column, write payload, onConflict target and rpc checked against the migrated PGlite schema by a test; migrations after init re-run with no schema change; pasted or calendar numbers the columns cannot hold (0 min, 0.00 km, over 9999.99 km) are dropped instead of failing the save. No new migration (`claude/schema-code-check`, on `claude/integration-2026-10-28`)
- [~] Schema guard: every table with an athlete key must be in `docs/account-deletion-inventory.md` (`claude/athlete-tables-guard`)
- [~] Chart links match the read: Load/volume chart on the read's window, whole-token links, 7-night baselines and "last week" for load, "Today" on the long effort card, weekly plan driver renamed (`claude/driver-links-fixes`); Oura last night strictly today's night, weekly screen sends its date, pace chart outdoor only (`claude/oura-freshness-strict`); Oura week window by calendar nights (`claude/oura-week-window`)
- [~] Voice validators harden: typography folded before checks (curly quotes, odd spaces, non-ASCII digits), paraphrased advice and plan overrides, coach/surrender variants, number words, driver numbers keep their unit and direction (`claude/validator-hardening`); chat pace chart in m:ss (`claude/pace-chart-clock`)
- [~] Voice validators red-team: table-driven corpus of paraphrases, typography and legal sentences near each rule; misses and false catches fixed (`claude/validator-redteam-1104`)
- [~] App fixes from a 10-29 review: sleep counted once across iPhone and Watch, HRV week like the API, today's read after an overnight suspend or a push tap, no raw error bodies, sign-out unregisters the push token (new `POST /api/unregister-device`), local plan change dates, push time follows travel (`claude/ios-review-fixes`); chat check never lets a clock time back a decimal (`claude/cdv-time-decimals`)
- [!] Sign in with Apple (auth: needs Evan). Done when every `/api/*` route takes the athlete from a verified Apple identity, not a body `athleteId`
- [~] RLS on every table (doc 10 §6.5): users, athletes, activities, workouts, health_data and device_tokens had it off, so the anon key could read OAuth and device tokens through the REST API. Migration plus a test that fails on any table without RLS (`claude/rls-all-tables`, on `claude/integration-2026-10-28`; PGlite only, Evan applies it, Q28)
- [!] OAuth tokens encrypted at rest (doc 10 §6.5) (Q26). Done when Strava and Oura tokens are unreadable from a plain `select` on `athletes`
- [!] Account deletion (doc 10 §6.6, App Store 5.1.1(v)) (Q27). Done when a Settings action removes the athlete's rows and revokes Strava/Oura within 7 days, tested on PGlite. Inventory of every table and outside store: `docs/account-deletion-inventory.md`
- [x] Review and land `origin/feat/voice-pattern-library` (pattern engine + 7 ported v0.3 entries) (merged 2026-10-15 from `claude/voice-pattern-library`)
- [x] Posture engine as its own module with unit tests (merged 2026-10-15 from `claude/posture-engine`; not wired into the API yet)
- [~] Port the 5 remaining v0.3 pattern entries (12 total) (`claude/port-v03-patterns`). Stopgap only: the knowledge library replaces the "20+ entries" goal (Evan, 2026-10-13)
- [~] Compute the per-user driver record (doc 07 v1 §8.2) and wire posture into the daily read (`claude/driver-record`; definitions in DECISIONS.md 2026-10-17)
- [~] Wire `@scora/voice` selectPattern into the daily read (done as the retrieval fallback on `claude/knowledge-retrieval`; fires with a pasted plan via `claude/plan-aware-read`)
- [x] Knowledge library spec `11_SCORA_Knowledge_Library_Spec_v0_1.md` (merged 2026-10-15 from `claude/knowledge-library-spec`)
- [~] Knowledge library: pgvector migration + `knowledge_sources`, `knowledge_chunks`, `read_citations` tables (spec §3; local or mocks only) (`claude/knowledge-schema`; tested on PGlite, not applied to Supabase: Evan applies it)
- [~] Knowledge library: ingest script for FieldCopy JSON exports, embedding call mocked in tests (spec §2.3) (`claude/knowledge-ingest`, stacked on `claude/knowledge-schema`; real run is Evan's: `npx tsx scripts/ingest-knowledge.ts <file>`, try `--dry-run` first)
- [~] Knowledge library: retrieval step in the read pipeline behind a flag, pattern library as fallback (spec §2.4 to §2.6) (`claude/knowledge-retrieval`, stacked on `claude/knowledge-ingest` + `claude/driver-record`; flag `KNOWLEDGE_RETRIEVAL=on`, default off)
- [!] Knowledge library: starter source list (5 to 10 books or coaches) and the open questions in spec §6 (Evan)
- [~] Card tap-to-expand with a card-expansion prompt (Free tier, card level only) (`claude/card-expand`, stacked on `claude/driver-record`; API + iOS, needs a deploy to try on device)
- [~] CDV charts: Vega-Lite WebView in ChatView. iOS side merged 2026-10-15 (`claude/cdv-chart-webview`); API side on `claude/cdv-chart-api` (LLM picks a chart kind, server builds the spec from real data)
- [x] Remove emoji from ChatView error bubbles (CLAUDE.md §3.7) (merged 2026-10-15 from `claude/chatview-no-emoji`)
- [~] Oura success page + deep link landing (design-todos) (`claude/oura-success`; also fixes reflected XSS in the Oura and Strava callback pages)
- [~] Onboarding flow (09_SCORA_Onboarding_Flow_v2.md): post-Strava steps + per-athlete push time (`claude/onboarding`, stacked on `claude/knowledge-schema` + `claude/manual-plan`). Sign in with Apple and the Stripe customer step still wait on Evan
- [~] Manual plan entry + plan parsing (plan-aware reads) (`claude/manual-plan`, stacked on `claude/knowledge-schema`; API + iOS Your Plan sheet)
- [~] Plan-aware read: pass today's scheduled workout into posture/pattern matching and the read prompt (`claude/plan-aware-read`, stacked on `claude/knowledge-retrieval` + `claude/manual-plan`; merge those first)
- [!] Strava scheduled activities ingestion: not possible, Strava API v3 has no planned-workout endpoint (checked 2026-10-17). Replaced by iCal import below (Q17)
- [~] Calendar (iCal) import as a plan source, `POST /api/plan/ical`, `ICAL_IMPORT=on` (Q17 option B), plus a calendar link field on Your Plan that fetches the feed on the phone (`claude/ical-plan-import`, on `claude/integration-2026-10-18`; migration tested on PGlite, Evan applies it; sheet seen on the simulator with `-demo-read -demo-plan`)
- [~] Calendar import refresh: the phone re-imports a saved link when Your Plan opens (12 h), plus a Refresh button (`claude/ical-refresh`, on `claude/integration-2026-10-22`)
- [~] Validator and banned-phrase telemetry as structured log lines, ready to forward to PostHog (`claude/validator-telemetry`, on `claude/integration-2026-10-22`)
- [~] Morning delivery on-time gate (doc 10 1.1.1): `push_delivery` telemetry per scheduled push, a per-athlete on-time table in `scripts/voice-gate-report.ts`, scheduler ticks every minute (`claude/delivery-telemetry`, on `claude/integration-2026-10-22`)
- [~] Phase 0 gates 1.1.2 and 1.1.7 measurable: pushes carry kind, date and send time; the app reports a tap to `POST /api/events/push-open` (logged, not stored); the gate report scores opens within 4h, numbers-first mornings and validator fail-throughs (1.1.4, `final_ok` on each voice line) (`claude/phase0-gates`, on `claude/delivery-telemetry`)
- [~] Log audit for gate 1.1.6 (no PHI in logs) and §6.5 (no secrets): `npx tsx scripts/log-audit.ts <log>` flags lines with health values or credentials by line and category, never the value (`claude/phase0-gates`)
- [~] Gate 2.1.8 measurable: a `read_plan` line on each daily read with a planned session (not rest) says whether the read named the plan (the word plan, or the session's minutes or km); the gate report scores 60% per athlete (`claude/plan-aware-gate`, on `claude/phase0-gates`)
- [~] Phase 1 gates 2.1.1 (10 onboarded) and 2.1.9 (half used CDV) as a read-only SQL report, `apps/api/scripts/phase1-gates.sql` (`claude/plan-gates`)
- [~] Push-open reports wait on the phone until the API has them (offline, before sign-in), resent on launch and sign-in, dropped after 7 days (`claude/push-open-retry`, on `claude/integration-2026-10-28`)
- [~] Share the Sunday review (PRD §5.A.5, CLAUDE.md §7, doc 10 2.1.6): share button on This Week opens the iOS share sheet with a card image of the read and its stats, rendered on the phone (`claude/weekly-share`, on `claude/integration-2026-10-28`; seen on the simulator with `-demo-read -demo-weekly`)
- [~] Share a chat chart (CLAUDE.md §7): once Vega-Lite draws, the app snapshots the chart and offers the answer plus chart as a card in the share sheet; single-series charts now draw in orange (`claude/cdv-share`, on `claude/weekly-share`; seen on the simulator with `-demo-read -demo-chat`)
- [!] PostHog + Sentry (free tiers, but needs accounts and keys). Done when validator catches, banned-phrase hits and CDV fallbacks are counted in PostHog (doc 10 §6.1 rates)

## Phase 2: plan engine and Plan tier pieces (started 2026-10-18; pure code, all behind flags that default off, no deploy or money)

- [~] Adaptation rules engine, `packages/plan-engine` (doc 07 v2 §6.2, §9) (`claude/plan-engine-adaptation`)
- [~] Template schema + YAML loader + validator (`claude/plan-templates-loader`, on `claude/plan-engine-adaptation`)
- [~] Assembler: template + race date to a dated calendar (`claude/plan-assembler`, on `claude/plan-templates-loader`)
- [~] DB migration: `plan_templates`, `plan_adaptations`, plan and WorkoutKit columns (`claude/plan-schema`, on `claude/manual-plan`; PGlite only, Evan applies it)
- [~] Adaptations applied with the daily read + `GET /api/plan/adaptations`, `PLAN_ADAPTATIONS=on` (`claude/plan-adapt-job`, on `claude/plan-schema` + `claude/plan-assembler` + `claude/driver-record`)
- [~] `POST /api/plan/generate` from reviewed templates, `PLAN_GENERATION=on` (`claude/plan-generate`, on `claude/plan-adapt-job`)
- [~] Plan setup screen (doc 09 §2.3): `GET /api/plan/options` lists the goals the loaded templates cover (off unless `PLAN_GENERATION=on`); Your Plan shows Build a SCORA plan only when there are goals; the form posts to `/api/plan/generate` and shows the server's refusal sentence (`claude/plan-setup-screen`, on `claude/integration-2026-10-28`; seen on the simulator with `-demo-read -demo-plan -demo-plan-setup`; no real template exists yet, so a real build is untried)
- [~] The plan as a block (PRD §5.B.1): `GET /api/plan/block` gives week N of M, the phases with their weeks and focus, and the race; Your Plan shows it above the sessions (`claude/plan-block-view`, on `claude/integration-2026-10-28`; seen on the simulator with `-demo-read -demo-plan -demo-plan-sessions`)
- [~] Session descriptions (CLAUDE.md §6.4) said from the template's steps, no LLM: "45-minute tempo. 10 minutes easy, 25 minutes at tempo, 10 minutes easy." Filled in by `/api/plan` for SCORA sessions; pasted text is kept (`claude/workout-descriptions`, on `claude/integration-2026-10-28`)
- [~] Adaptation reasons worded by gpt-4o-mini, checked in code, `ADAPTATION_REASON_LLM=on` (`claude/adaptation-reason-llm`, on `claude/plan-adapt-job`)
- [~] iOS: local date on the read; Your Plan sheet shows the last 3 plan changes (`claude/ios-plan-changes`, on `claude/plan-adapt-job`)
- [~] Inline chart-expansion (CLAUDE.md §3.4): drivers in the read open 28-day charts, `INLINE_CHARTS=on` (`claude/inline-charts`, on `claude/plan-adapt-job`; seen on the simulator with the DEBUG `-demo-read` launch argument)
- [~] HealthKit dated nights for the charts, so athletes without Oura get sleep, HRV and resting HR charts (`claude/healthkit-nights`, on `claude/inline-charts`)
- [~] Race predictions v1 (PRD §5.B.6): a range from recent efforts, `RACE_PREDICTIONS=on` (`claude/race-predictions`, on `claude/plan-adapt-job`); shown on Your Plan by `claude/ios-race-prediction`
- [~] Calorie engine v1 (PRD §5.B.7): burn estimates with method and inputs, `CALORIE_ENGINE=on` (`claude/calorie-engine`, on `claude/plan-adapt-job`; API only)
- [~] The read observes plan changes touching today (CLAUDE.md §1.3) (`claude/read-sees-plan-changes`, on `claude/integration-2026-10-18`)
- [~] WorkoutKit export: a plan session's structure becomes a CustomWorkout, Watch total equal to the plan (`claude/workoutkit-export`, on `claude/plan-adapt-job`; converter + tests only)
- [~] CDV daily quota resets at the athlete's local midnight, not UTC (`claude/cdv-local-day`, on `claude/plan-adapt-job`)
- [~] WorkoutKit scheduling, code half: Send to Watch on SCORA plan sessions, WorkoutScheduler behind a protocol, tested with a fake (`claude/workoutkit-schedule`, on `claude/integration-2026-10-22`)
- [~] Full plan change history (PRD §5.B.1): `GET /api/plan/adaptations/history` (active plan, dismissed included and marked) and an All plan changes list on Your Plan (`claude/adaptation-history`, on `claude/integration-2026-10-28`; not seen on the simulator, no demo data for changes)
- [~] Dismiss a plan change (doc 07 §5): route + x on Your Plan (`claude/dismiss-adaptation`, on `claude/integration-2026-10-22`)
- [~] Missed workouts: Past sessions on Your Plan with Done / Missed; a miss is recorded, never moved (`claude/missed-workouts`, on `claude/integration-2026-10-22`; seen on the simulator)
- [~] Plan tier gates 3.1.10 (adherence, from the athlete's done/missed marks) and 3.1.11 (adaptations per athlete per week) as a read-only SQL report, `apps/api/scripts/plan-gates.sql`, paste into the Supabase SQL editor (`claude/plan-gates`, on `claude/integration-2026-10-22`; run on PGlite in tests)
- [~] Gate 3.1.9: a successful Send to Watch stamps `workout_kit_pushed_at` via `POST /api/plan/workouts/:id/watch-sent`; `plan-gates.sql` reports the share (`claude/watch-sent-record`, on `claude/integration-2026-10-28`)
- [~] Plan bars audit (doc 10 §6.2): `apps/api/scripts/plan-invariants.sql` lists any engine adaptation that changed a long run, touched race week, moved more than 10% of a week's minutes, or put a moved hard session next to another (`claude/plan-invariants-audit`, on `claude/integration-2026-10-28`)
- [ ] WorkoutKit scheduling on a paired Apple Watch (Evan). Done when a sent session appears in the Watch's Workout app on its day and runs with the plan's steps
- [!] Calorie engine needs body weight; Strava only sends it with `profile:read_all` (Q21). Done when an athlete with a known weight gets estimates with the method shown
- [~] Rest posture with no move window: the session drops to easy at the same duration, named reason; long runs stay (Q19 option B, `claude/rest-no-window-downgrade`, on `claude/integration-2026-10-18`)
- [!] MVP template content: 7 templates (half 12wk x3, marathon 16wk x3, 10K 10wk), authored by Evan, reviewed by a paid coach (90-day plan §3.2). Agents never write training content
- [ ] Plan tier gating for the flags above, once the Stripe item exists (Evan). Done when a Free athlete gets 404 or the Free behavior from every Plan-tier route, and a coach-assigned athlete never sees plan generation
  - [!] Code half, ASK (Q30): an `athletes.tier` column (default `free`, Evan can set `plan` by hand), one `requireTier` check on every Plan-tier route, coach-assigned athletes kept out of generation. Done when route tests show a Free athlete gets the Free behavior from each Plan-tier route. Stripe then only writes the column. Route-by-route design: `docs/tier-gating-design.md` (recommends doc 07's `subscription_tiers` table, keyed by Strava id for now)
  - [~] Free-tier boundaries today vs §5.1, pinned in route tests, 3 gaps listed: `docs/free-tier-boundaries.md` (`claude/free-tier-boundaries`)

## Later phases (refined 2026-11-03 from the 90-day plan §4, doc 07 §4.6 to §5.5, doc 10 §4 and §6.3)

Marking: `[ ]` workable unattended (pure code, or behind a flag that defaults off, tested with fakes or PGlite, no auth, payments, new personal data or legal copy). `[!] ASK (reason)` needs Evan first. Workable items come first in each phase.

### Phase 2 (rest)

- [~] (`claude/runna-calendar`) Runna through the calendar import: a feed whose PRODID or event text names Runna is stored as `external_source='runna'`, and Runna-style titles ("Easy Run", "Tempo", "Long Run") map to kind and intensity by the existing keywords; synthetic fixture only, same validator, still `ICAL_IMPORT=on`. Done when an import test turns the fixture into a runna-tagged plan and an unknown title falls back as today
- [!] ASK (payments, keys, waits on Q30): Stripe subscriptions. Payment Links for Plan, Customer Portal, `POST /api/stripe/webhook` with signature check writing the tier row from `docs/tier-gating-design.md`. Done when a test-mode subscription moves an athlete to `plan` and a cancel moves them back to `free`
- [!] ASK (partner access, possible cost or agreement): Runna direct integration (CLAUDE.md §8.4). Runna has no public plan API; needs a partner agreement. Done when Evan has API access or drops it for the calendar path above
- [~] WhatsApp doorbell core: message composer, reply parser, Twilio signature check; no sending or storage (`claude/whatsapp-core`, on `claude/integration-2026-10-22`)
- [ ] WhatsApp doorbell live: Twilio sandbox account, opt-in copy, inbound route, why-expansion prompt (Evan: account and copy). Done when a reply "why" in the sandbox returns a validated expansion
  - [!] Code half, ASK (Q29): store the athlete's WhatsApp number (E.164) with an opt-in timestamp, `POST /api/whatsapp/inbound` that checks the Twilio signature (built), handles why/more/pause/stop/help (built) and answers in TwiML, flag `WHATSAPP=on`. Done when route tests answer each reply word from a signed fake request; no message is sent until Evan adds the Twilio account

### Phase 3 (Coach tier and coach-side platform)

Voice-vs-plan rule (CLAUDE.md §1): a coach-authored plan is a plan, not voice. The voice may observe the coach's plan and its changes; it never prescribes, never overrides the coach, never calls itself a coach. Coach notes and messages are the coach's words, shown as the coach's, never passed through or blended into the voice. Agents never write training content or coach templates.

Workable unattended (pure code or flag `COACH_PLATFORM=on`, default off; seeded by hand in tests, no coach accounts):

- [ ] Coach plan validator in `packages/plan-engine`: a coach-authored plan payload (dated sessions, kind, minutes or km, optional steps) is checked for shape only: valid dates, units, steps that sum to the session, convertible to WorkoutKit. SCORA's template and 10% rules are not applied to the coach. Done when unit tests accept a valid fixture and reject each malformed case with a reason
- [ ] Coach plan replaces the AI plan, read side (CLAUDE.md §5.3, doc 10 4.1.11): with a `source='coach'` plan active, generate, options and block return the Coach behavior, the adaptation engine never auto-adapts it, and the Today line shows coach sessions that carry steps. Done when PGlite route tests with a hand-seeded coach plan show all four
- [ ] Voice reads the coach plan as a plan (§1.3): the read and Sunday review get coach sessions labeled as the coach's plan; tests show the validator still rejects any prescription, override or SCORA-as-coach line on a coach-plan fixture. Done when voice and validator tests pass on that fixture
- [ ] Assignment window filter: one pure function that clips any athlete data query to the assignment's start and end (doc 10 §6.3: no data before assignment start). Done when unit tests show data before start and after end is never returned
- [ ] Athlete monitoring alert rules, pure: the doc 07 §4.10 types (missed_workouts_n, low_sleep_streak, hrv_crash, rhr_elevation, app_inactive) computed from existing data, thresholds as named constants, factual alert text with the driver value, no advice. No storage, no delivery. Done when unit tests fire and do not fire each type on fixture series
- [ ] Coach analytics math, pure: fitness, fatigue and TSB (CTL/ATL) and weekly load by intensity from stored Strava activities. Done when unit tests match hand-computed values on a fixture
- [ ] Multi-athlete dashboard summary builder, pure: per athlete one row (posture, last sleep, 7-day load, plan adherence from done/missed marks, open alert count) from existing stores through fakes; no route. Done when tests build rows for 3 fake athletes, one with no data
- [ ] Workout builder core, pure: a structured workout model (warm-up, repeats, recovery, cool-down) with validation and conversion to plan session steps and to WorkoutKit through the existing converter. Done when round-trip tests keep totals equal
- [ ] Coach template library format: coach templates use the `packages/plan-templates` YAML schema plus `author` and `coach_id`; loader and schema tests on a synthetic fixture with placeholder content. Done when loader tests pass and SCORA templates still load unchanged
- [ ] Weekly coach note slot in the Sunday read: the review accepts an optional note string from a fake source and shows it as its own block attributed to the coach, outside the voice text and never sent to the LLM. Done when tests show the voice block unchanged with and without a note
- [ ] iOS Coach tier display on DEBUG demo data (`-demo-coach`): "Your coach: <name>" on the dashboard and "Your coach's plan" on Your Plan, plan setup hidden. Done when seen on the simulator; no real coach data

Needs Evan (most items above become routes only after the gate):

- [!] ASK (auth and roles, gate): coach accounts and roles. How a coach signs in (same app with Sign in with Apple, or web), how an assignment is created before Stripe Connect (Evan by hand?), and the rule that a coach sees only their own athletes. Unblocks: the coach tables migration, coach-side routes, alert storage and delivery, messaging, coach note storage, coach plan write, and real data for the iOS Coach tier display
- [!] ASK (new personal data, after the gate): migration for `coach_profiles`, `coach_athlete_assignments`, `coach_alerts` as doc 07 §4.6, §4.7, §4.10, keyed for the Strava-id era, RLS on. Done when PGlite migration tests pass
- [!] ASK (roles, after the gate): coach-side routes (doc 07 §5.5): dashboard, athlete detail, plan read and write with `triggered_by='coach_manual'` named changes, alerts list and acknowledge, analytics, workout builder save, template list. Done when route tests show a coach gets 403 on an athlete not assigned to them
- [!] ASK (stores coach-facing alerts, APNS to coaches): alert storage, nightly job and delivery. Done when a fake athlete with a short-sleep streak creates one alert for the assigned coach only
- [!] ASK (new personal data: message bodies): in-app messaging, `messages` table, doc 07 §5.4 routes, APNS delivery, retention rule. Done when route tests send, page and mark read within one assignment only
- [!] ASK (stores coach-written text): weekly coach note storage and the coach write route. Done when a stored note shows in that athlete's Sunday read
- [!] ASK (consent and privacy copy): athlete consent to share data with an assigned coach, and the copy for it. Done when Evan approves the text
- [!] ASK (personal data, coach agreement): marketplace listing, coach profile, `GET /coach/directory` and profile view, directory UI. Done when 5 seeded profiles list and filter by specialization
- [!] ASK (payments, Stripe Connect): Express onboarding for coaches, booking by direct charge with a 15% application fee, Connect webhooks, assignment ended on cancel or failed payment (doc 10 §6.3). Done when a test-mode booking creates an active assignment and a cancel ends it

### Not scheduled

- Coaching phase (Evan, 2026-10-13): SCORA becomes a coaching app, prescriptive guidance grounded in the knowledge library. Timing and scope set by Evan; see spec §7
- Rev 5 elements (Daily Call, feel-before-reveal, calibration record): not yet adopted, see `docs/scora-master-context-rev5.md`
