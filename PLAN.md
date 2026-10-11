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
- [!] Decide whether OpenClaw keeps pushing on its own, and whether its workspace files stay in the repo (see DECISIONS.md)

## Phase 0 / Phase 1 remaining

- [!] APNs env vars on Railway (needs Apple Developer enrollment + .p8 key)
- [!] Sign in with Apple (auth: needs Evan)
- [ ] Review and land `origin/feat/voice-pattern-library` (pattern engine + 7 ported v0.3 entries)
- [ ] Posture engine as its own module with unit tests (today it lives inline in `index.ts`)
- [ ] Port remaining pattern library entries to reach 20+
- [ ] Card tap-to-expand with a card-expansion prompt (Free tier, card level only)
- [ ] CDV charts: Vega-Lite WebView in ChatView
- [ ] Remove emoji from ChatView error bubbles (CLAUDE.md §3.7)
- [ ] Oura success page + deep link landing (design-todos)
- [ ] Onboarding flow (09_SCORA_Onboarding_Flow_v2.md)
- [ ] Manual plan entry + plan parsing (plan-aware reads)
- [ ] Strava scheduled activities ingestion
- [!] PostHog + Sentry (free tiers, but needs accounts and keys)

## Later phases (not started, see the 90-day plan)

- Phase 2: Stripe subscriptions, plan engine + templates, WorkoutKit, WhatsApp doorbell, inline chart-expansion
- Phase 3: Stripe Connect marketplace, coach dashboard, messaging
- Rev 5 elements (Daily Call, feel-before-reveal, calibration record): not yet adopted, see `docs/scora-master-context-rev5.md`
