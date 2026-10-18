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

All `[~]` branches from 2026-10-17 and 2026-10-18 are merged together, with doc conflicts resolved, in `claude/integration-2026-10-18` (tests and typecheck pass there; it supersedes `claude/integration-2026-10-17`). Review the branches, then merge that one PR instead of each.

- [!] APNs env vars on Railway (needs Apple Developer enrollment + .p8 key)
- [!] Sign in with Apple (auth: needs Evan)
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
- [!] Strava scheduled activities ingestion: not possible, Strava API v3 has no planned-workout endpoint (checked 2026-10-17). Proposed replacement: iCal feed import (Q17 in Evan's questions)
- [!] PostHog + Sentry (free tiers, but needs accounts and keys)

## Phase 2: plan engine and Plan tier pieces (started 2026-10-18; pure code, all behind flags that default off, no deploy or money)

- [~] Adaptation rules engine, `packages/plan-engine` (doc 07 v2 §6.2, §9) (`claude/plan-engine-adaptation`)
- [~] Template schema + YAML loader + validator (`claude/plan-templates-loader`, on `claude/plan-engine-adaptation`)
- [~] Assembler: template + race date to a dated calendar (`claude/plan-assembler`, on `claude/plan-templates-loader`)
- [~] DB migration: `plan_templates`, `plan_adaptations`, plan and WorkoutKit columns (`claude/plan-schema`, on `claude/manual-plan`; PGlite only, Evan applies it)
- [~] Adaptations applied with the daily read + `GET /api/plan/adaptations`, `PLAN_ADAPTATIONS=on` (`claude/plan-adapt-job`, on `claude/plan-schema` + `claude/plan-assembler` + `claude/driver-record`)
- [~] `POST /api/plan/generate` from reviewed templates, `PLAN_GENERATION=on` (`claude/plan-generate`, on `claude/plan-adapt-job`)
- [~] Adaptation reasons worded by gpt-4o-mini, checked in code, `ADAPTATION_REASON_LLM=on` (`claude/adaptation-reason-llm`, on `claude/plan-adapt-job`)
- [~] iOS: local date on the read; Your Plan sheet shows the last 3 plan changes (`claude/ios-plan-changes`, on `claude/plan-adapt-job`)
- [~] Inline chart-expansion (CLAUDE.md §3.4): drivers in the read open 28-day charts, `INLINE_CHARTS=on` (`claude/inline-charts`, on `claude/plan-adapt-job`; seen on the simulator with the DEBUG `-demo-read` launch argument)
- [~] HealthKit dated nights for the charts, so athletes without Oura get sleep, HRV and resting HR charts (`claude/healthkit-nights`, on `claude/inline-charts`)
- [~] Race predictions v1 (PRD §5.B.6): a range from recent efforts, `RACE_PREDICTIONS=on` (`claude/race-predictions`, on `claude/plan-adapt-job`); shown on Your Plan by `claude/ios-race-prediction`
- [~] Calorie engine v1 (PRD §5.B.7): burn estimates with method and inputs, `CALORIE_ENGINE=on` (`claude/calorie-engine`, on `claude/plan-adapt-job`; API only)
- [!] Calorie engine needs body weight; Strava only sends it with `profile:read_all` (Q21)
- [!] Rest posture with no move window: hard session currently stays (Q19)
- [!] MVP template content: 7 templates (half 12wk x3, marathon 16wk x3, 10K 10wk), authored by Evan, reviewed by a paid coach (90-day plan §3.2). Agents never write training content
- [ ] Plan tier gating for the flags above, once the Stripe item exists (Evan)

## Later phases (not started, see the 90-day plan)

- Phase 2 (rest): Stripe subscriptions, WorkoutKit, WhatsApp doorbell
- Phase 3: Stripe Connect marketplace, coach dashboard, messaging
- Coaching phase (Evan, 2026-10-13): SCORA becomes a coaching app, prescriptive guidance grounded in the knowledge library. Timing and scope set by Evan; see spec §7
- Rev 5 elements (Daily Call, feel-before-reveal, calibration record): not yet adopted, see `docs/scora-master-context-rev5.md`
