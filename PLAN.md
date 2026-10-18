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
- [~] Compute the per-user driver record (doc 07 v1 §8.2) and wire posture into the daily read (`claude/driver-record`; definitions in DECISIONS.md 2026-10-17)
- [ ] Wire `@scora/voice` selectPattern into the daily read (needs a scheduled-workout source: every v0.3 entry but the taper ones requires one)
- [ ] Port the 5 remaining v0.3 pattern entries (12 total). Stopgap only: the knowledge library replaces the "20+ entries" goal (Evan, 2026-10-13)
- [x] Knowledge library spec `11_SCORA_Knowledge_Library_Spec_v0_1.md` (merged 2026-10-15 from `claude/knowledge-library-spec`)
- [~] Knowledge library: pgvector migration + `knowledge_sources`, `knowledge_chunks`, `read_citations` tables (spec §3; local or mocks only) (`claude/knowledge-schema`; tested on PGlite, not applied to Supabase: Evan applies it)
- [ ] Knowledge library: ingest script for FieldCopy JSON exports, embedding call mocked in tests (spec §2.3)
- [ ] Knowledge library: retrieval step in the read pipeline behind a flag, pattern library as fallback (spec §2.4 to §2.6)
- [!] Knowledge library: starter source list (5 to 10 books or coaches) and the open questions in spec §6 (Evan)
- [ ] Card tap-to-expand with a card-expansion prompt (Free tier, card level only)
- [~] CDV charts: Vega-Lite WebView in ChatView. iOS side merged 2026-10-15 (`claude/cdv-chart-webview`); API still needs to return `chart` (gpt-4o-mini CDV spec)
- [x] Remove emoji from ChatView error bubbles (CLAUDE.md §3.7) (merged 2026-10-15 from `claude/chatview-no-emoji`)
- [ ] Oura success page + deep link landing (design-todos)
- [ ] Onboarding flow (09_SCORA_Onboarding_Flow_v2.md)
- [~] Manual plan entry + plan parsing (plan-aware reads) (`claude/manual-plan`, stacked on `claude/knowledge-schema`; API + iOS Your Plan sheet)
- [ ] Plan-aware read: pass today's scheduled workout into posture/pattern matching and the read prompt (after `claude/manual-plan`, `claude/driver-record` and `claude/knowledge-retrieval` land)
- [ ] Strava scheduled activities ingestion
- [!] PostHog + Sentry (free tiers, but needs accounts and keys)

## Later phases (not started, see the 90-day plan)

- Phase 2: Stripe subscriptions, plan engine + templates, WorkoutKit, WhatsApp doorbell, inline chart-expansion
  - [~] Plan tier DB migration: `plan_templates`, `plan_adaptations`, template/race columns on `training_plans`, WorkoutKit columns on `scheduled_workouts` (`claude/plan-schema`, stacked on `claude/manual-plan`; PGlite tests only, Evan applies it)

## Phase 2: plan engine (started 2026-10-18; pure code, no deploy or money)

- [~] Adaptation rules engine, `packages/plan-engine` (doc 07 v2 §6.2, §9) (`claude/plan-engine-adaptation`). Done when every rule and guard has a unit test and the package typechecks
- [~] Template schema + YAML loader + validator (`claude/plan-templates-loader`, stacked on `claude/plan-engine-adaptation`) (doc 07 v2 §4.2.1, CLAUDE.md §4.3 plan bans). Done when a malformed or rule-breaking template fails to load with a named error, tested on test fixtures only
- [~] (`claude/plan-assembler`, stacked on `claude/plan-templates-loader`) Assembler: template + start date + race date + current weekly volume to scheduled workouts (doc 07 v2 §6.1 steps 3 to 5). Done when a fixture template assembles to a dated calendar whose numbers all trace to the template
- [!] MVP template content: 7 templates (half 12wk x3, marathon 16wk x3, 10K 10wk), authored by Evan, reviewed by a paid coach (90-day plan §3.2). Agents never write training content
- [ ] DB migration for `plan_templates`, `training_plans`, `plan_adaptations` and the write-enabled `scheduled_workouts` columns (local PGlite tests only; Evan applies it)
- [~] Race predictions v1 (PRD §5.B.6): range from recent efforts, `RACE_PREDICTIONS=on` (`claude/race-predictions`, on `claude/plan-adapt-job`; API only, no iOS display yet)
- [!] Rest posture with no move window: hard session currently stays (Q19 in Evan's questions)
- [~] (`claude/plan-adapt-job`, stacked on `claude/plan-schema` + `claude/plan-assembler` + `claude/driver-record`; runs with the daily read, see DECISIONS) Nightly compute-adaptations job + `GET /plan/adaptations` (doc 07 v2 §6.2), behind a flag; Plan tier gating waits for the Stripe item
- Phase 3: Stripe Connect marketplace, coach dashboard, messaging
- Coaching phase (Evan, 2026-10-13): SCORA becomes a coaching app, prescriptive guidance grounded in the knowledge library. Timing and scope set by Evan; see spec §7
- Rev 5 elements (Daily Call, feel-before-reveal, calibration record): not yet adopted, see `docs/scora-master-context-rev5.md`
