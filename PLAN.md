# PLAN.md

Working checklist for coding agents (Claude Code and OpenClaw). Source: `01_SCORA_90-Day_Execution_Plan_v1_4.md`, `memory/design-todos.md`, and the current code. Work top to bottom. One branch per item (see CLAUDE.md §9.1). Check items off only when they are merged by Evan.

Legend: `[ ]` open, `[x]` done, `[~]` branch ready for review, `[!]` blocked or waiting on Evan.

## Done (Phase 0 and early Phase 1)

- [x] Monorepo, Fastify API on Railway, Supabase Postgres
- [x] Strava OAuth + ingestion
- [x] Oura OAuth + Sleep/Recovery cards
- [x] Apple HealthKit (Sleep + Recovery without Oura)
- [x] Dashboard + Today's Read from Strava data
- [x] CDV chat, gated at 3 queries/day (fail-open on quota errors)
- [x] Sunday weekly read (generation + view)
- [x] Driver-existence + banned-phrase validators, unit tests
- [x] APNs scaffolding + scheduled daily/weekly delivery (idle until env is set)
- [x] Daily keepalive ping (Railway + Supabase)

## Agent workflow

- [x] Shared workflow rules, PLAN.md, DECISIONS.md
- [~] Point `/scora-context` at repo files instead of a machine-specific memory path (`claude/scora-context-paths`)
- [~] Push policy: agents push branches, Evan merges (`claude/push-policy`)
- [!] OpenClaw: align its AGENTS.md with CLAUDE.md §9.1, decide where its workspace files live (Evan)

## Phase 0 / Phase 1 remaining

- [!] APNs env vars on Railway (needs Apple Developer enrollment + .p8 key)
- [!] Sign in with Apple (auth: needs Evan)
- [x] Review and land `origin/feat/voice-pattern-library` (pattern engine + 7 ported v0.3 entries) (merged 2026-10-15 from `claude/voice-pattern-library`)
- [x] Posture engine as its own module with unit tests (merged 2026-10-15 from `claude/posture-engine`; not wired into the API yet)
- [ ] Compute the per-user driver record (doc 07 v1 §8.2) and wire posture + voice into the daily read
- [ ] Port the 5 remaining v0.3 pattern entries (12 total). Stopgap only: the knowledge library replaces the "20+ entries" goal (Evan, 2026-10-13)
- [x] Knowledge library spec `11_SCORA_Knowledge_Library_Spec_v0_1.md` (merged 2026-10-15 from `claude/knowledge-library-spec`)
- [ ] Knowledge library: pgvector migration + `knowledge_sources`, `knowledge_chunks`, `read_citations` tables (spec §3; local or mocks only)
- [ ] Knowledge library: ingest script for FieldCopy JSON exports, embedding call mocked in tests (spec §2.3)
- [ ] Knowledge library: retrieval step in the read pipeline behind a flag, pattern library as fallback (spec §2.4 to §2.6)
- [!] Knowledge library: starter source list (5 to 10 books or coaches) and the open questions in spec §6 (Evan)
- [ ] Card tap-to-expand with a card-expansion prompt (Free tier, card level only)
- [~] CDV charts: Vega-Lite WebView in ChatView. iOS side merged 2026-10-15 (`claude/cdv-chart-webview`); API still needs to return `chart` (gpt-4o-mini CDV spec)
- [x] Remove emoji from ChatView error bubbles (CLAUDE.md §3.7) (merged 2026-10-15 from `claude/chatview-no-emoji`)
- [ ] Oura success page + deep link landing (design-todos)
- [ ] Onboarding flow (09_SCORA_Onboarding_Flow_v2.md)
- [ ] Manual plan entry + plan parsing (plan-aware reads)
- [ ] Strava scheduled activities ingestion
- [!] PostHog + Sentry (free tiers, but needs accounts and keys)

## Later phases (not started, see the 90-day plan)

- Phase 2: Stripe subscriptions, plan engine + templates, WorkoutKit, WhatsApp doorbell, inline chart-expansion

## Phase 2: plan engine (started 2026-10-18; pure code, no deploy or money)

- [~] Adaptation rules engine, `packages/plan-engine` (doc 07 v2 §6.2, §9) (`claude/plan-engine-adaptation`). Done when every rule and guard has a unit test and the package typechecks
- [ ] Template schema + YAML loader + validator (doc 07 v2 §4.2.1, CLAUDE.md §4.3 plan bans). Done when a malformed or rule-breaking template fails to load with a named error, tested on test fixtures only
- [ ] Assembler: template + start date + race date + current weekly volume to scheduled workouts (doc 07 v2 §6.1 steps 3 to 5). Done when a fixture template assembles to a dated calendar whose numbers all trace to the template
- [!] MVP template content: 7 templates (half 12wk x3, marathon 16wk x3, 10K 10wk), authored by Evan, reviewed by a paid coach (90-day plan §3.2). Agents never write training content
- [ ] DB migration for `plan_templates`, `training_plans`, `plan_adaptations` and the write-enabled `scheduled_workouts` columns (local PGlite tests only; Evan applies it)
- [ ] Nightly compute-adaptations job + `GET /plan/adaptations` (doc 07 v2 §6.2), behind a flag; Plan tier gating waits for the Stripe item
- Phase 3: Stripe Connect marketplace, coach dashboard, messaging
- Coaching phase (Evan, 2026-10-13): SCORA becomes a coaching app, prescriptive guidance grounded in the knowledge library. Timing and scope set by Evan; see spec §7
- Rev 5 elements (Daily Call, feel-before-reveal, calibration record): not yet adopted, see `docs/scora-master-context-rev5.md`
