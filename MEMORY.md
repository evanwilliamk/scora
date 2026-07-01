# MEMORY.md — Long-Term Memory

## SCORA Project (v1.4 complete spec locked 2026-06-30)

**What it is:** Tiered lifecycle product for endurance athletes. Reads Strava, Apple Health, Oura. Voice layer (interpretation) + Plan tier (template-based training plans) + Coach tier (human coaches via marketplace).

**What it's NOT:** Voice is never prescriptive, never coach-like. Plan tier prescribes workouts but only from coach-authored templates, deterministically adapted. Never LLM-invented structure.

**The cornerstone (non-negotiable):** Voice is the moat—interpretations, tone, pattern matching. Plan tier monetizes voice (enables athletes to pay for training). Coach tier monetizes ceiling (marketplace cuts 15%).

**Three-tier ladder:**
- **Free:** Voice + dashboard + CDV (3 queries/day). Non-prescriptive. APNS daily push. Oura included. Plan-awareness for external plans (Strava-scheduled, manual paste).
- **Plan ($14/mo):** Free + adaptive template-based plans + WhatsApp doorbell + unlimited CDV + inline chart-expansion + race predictions + calorie engine + Apple WorkoutKit.
- **Coach ($200-300/mo):** Plan + real human coach whose plan replaces SCORA's AI plan. SCORA takes 15%, remits 85% to coach via Stripe Connect.
- **Coach-side platform (free):** Multi-athlete dashboard, workout builder, plan templates, athlete monitoring, marketplace listing.

**Load-bearing distinction (§1 in CLAUDE.md):**
- **Voice is NEVER prescriptive.** It reads and names patterns (postures: primed/steady/moderate/back-off/rest/taper). Does NOT emit workouts.
- **Plan IS prescriptive.** Prescribes workouts from templates (Daniels, Pfitzinger, coach-authored). Adapted by deterministic rules, never LLM vibes. Every adaptation has a visible reason.
- **Voice can reference plan but never override it.** Voice observes plan; plan adapts to posture.

**Design principles (v1.4):**
1. **Numeric-first:** Every claim shows raw number first ("Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk)"), then translation, then meaning.
2. **Actualize and back up:** Every driver is tappable to a chart showing raw data. Trust = verifiable data.
3. **Driver-existence validator:** Every voice claim backed by specific data value. Runs BEFORE render. Anti-hallucination guarantee.
4. **Banned phrases:** Updated §4. "Coach" banned in voice self-reference but allowed in marketplace/tier UX. Fitness-bro language banned. "Rest day" as noun (allowed), imperative (banned).
5. **Plan-level bans:** No LLM-invented workout structures, no weekly volume >±10%, no silent adaptations (all named), no adaptations to race-week workouts (frozen T-7).

**Tech stack (v1.4):**
- iOS (SwiftUI, iOS 17+), Swift Charts + WebView (Vega-Lite)
- Backend: Node.js + Fastify on Railway, Postgres on Supabase, Redis + BullMQ on Railway
- Auth: Sign in with Apple (canonical), Stripe Customer ID post-purchase
- Payments: Stripe Payment Links + Customer Portal (athlete subs), Stripe Connect (coach marketplace, 15% take)
- Integrations: Strava, Oura (both free tier), Apple HealthKit, WhatsApp (Twilio, Plan+ tier), Apple WorkoutKit (Plan+ tier), Runna Phase 2, TrainingPeaks Phase 3
- AI: gpt-4o for voice + workouts, gpt-4o-mini for CDV + adaptation reasons. Validators in app code only.
- Observability: PostHog + Sentry + custom telemetry (validator catches, banned-phrase hits, adaptation frequency, per-user LLM cost)

**Repository:** Monorepo (apps/ios, apps/api, packages/voice, packages/validator, packages/posture, packages/plan-templates, packages/plan-engine, packages/llm-prompts). Voice + templates versioned independently because they're the moat.

**Feature test (5 questions, updated):** Does it surface voice OR reinforce plan? Feed better data? Extend to new surface? Monetize trust? Stay in sidekick role (voice) AND obey deterministic-template rule (plan)? Fail #5 = cut. Pass none of 1–4 = out of scope.

**Permanently out of scope:** Voice prescribing, LLM-invented plan structures, silent adaptations, medical/injury diagnosis, nutrition prescription, social feed, activity recording, hardware, anti-coach marketing.

**Reading order:** CLAUDE.md → PRD (v1.4) → Architecture (v2) → LLM Prompts (v2) → Pattern Library (v0.3) → then as-needed: Onboarding (v2), Acceptance (v2), Execution Plan (v1.4).

---

## 90-Day Execution Plan (v1.4) Summary

### Phase 0 (Days 1–14): Dogfood (Evan on Evan)
- **Scope:** Free tier features only. iOS app + API + workers + pattern library (20 entries ported).
- **Exit gates:** 12 of 14 mornings opened, 0 banned-phrase hits, 0 validator fail-throughs, ≥1 "wow" moment.

### Phase 1 (Days 15–35): Free tier alpha, 10 users
- **Scope:** CDV shipped, card tap-to-expand, Sunday weekly read, reply handler (why/more/pause/resume/stop/help), manual plan entry + Strava scheduled activities ingestion, Twilio BA approved, PostHog + Sentry.
- **Exit gates:** 7/10 users open ≥10 of 14 days, <0.5% banned-phrase hits, voice-quality signal ≥5/10 "sounds like a person", ≥1 coach-forwarding signal.

### Phase 2 (Days 36–65): Plan tier launch, 100 users → 15 paid
- **Scope:** Stripe subscriptions, 7 MVP templates (half marathon 3x, marathon 3x, 10K 1x), plan generation, Apple WorkoutKit push, WhatsApp doorbell, inline chart-expansion, race predictions, calorie engine, scora.app marketing site, App Store submission.
- **Exit gates:** 100 free users, 15 Plan conversions (15%), 70% trial→paid, ≥85% WhatsApp delivery, ≥90% WorkoutKit push success, ≥70% plan adherence, <10% monthly churn.

### Phase 3 (Days 66–85): Coach marketplace launch
- **Scope:** Stripe Connect setup, 5 curated coaches, coach onboarding, coach directory in-app, coach booking flow, coach-side dashboard v1, in-app messaging, weekly coach notes, coach alerts, coach's plan overrides AI plan.
- **Exit gates:** 5 coaches active, 10 athlete-coach matches, ≥1 marketplace transaction, coach dashboard usage ≥80%, coach-authored plans for ≥8/10 athletes.

### Phase 4+ (Day 86+): Stabilization
- **Scope:** Daily SLOs, voice-quality panel (70%+ "sounds like a person"), template library expansion (20 total), paid acquisition test if voice panel passes.

---

## Key Decisions & Constraints (locked)

1. **Voice-vs-Plan is load-bearing.** Blur this = product broken.
2. **All validators in app code, never LLM.** Hallucination guarantee.
3. **Plans are always template-based.** Never LLM-invented.
4. **Every adaptation named.** No silent changes.
5. **Numeric-first design.** Raw drivers first, then interpretation.
6. **Actualize the voice.** Every driver tappable to a chart.
7. **Free tier at launch.** No gating later (avoids alienating users).
8. **Coach marketplace, not acquisition fee.** SCORA takes 15% of athlete-coach transaction; coach gets 85% + free platform.
9. **Oura in Free tier.** Wedge ICP includes Oura users; free tier includes it.
10. **No paid acquisition in Phase 2.** Organic growth only (warm intros, Strava clubs, creator partnerships, Reddit, Substack).

---

## Next: Clarifying Questions for Evan

(To be asked after full spec review)

1. Team: Just you (Phase 0-1), or do you have eng + design help?
2. Build strategy: Backend-first (API ready by Day 14) or pair-build iOS in parallel?
3. Pattern library: 20 entries ported in Phase 0, or full 40-entry v0.1 port?
4. Plan templates: Evan-authored drafts ready, or start from scratch (Daniels/Pfitzinger)?
5. Coach recruiting: 5+ coaches pre-scoped, or Phase 2 parallel project?
6. Locking Phase 1 scope — confirm 10 users, 21 days, no paid features, focus on voice generalization?

---

**Status:** Phase 0 Day 1 IN PROGRESS
- ✅ Monorepo scaffold complete
- ✅ API server live (Fastify)
- ✅ Supabase database migrations pushed (5 tables)
- ✅ Strava OAuth working (redirect → token exchange → success page)
- ❌ HTML landing pages crashing on Railway (deployment issue)
- ⏸️ Oura OAuth blocked on HTML pages for legal docs

**Current blocker:** Railway crashes when serving HTML. Deployed JSON-only version, still 502.

**Live API:** https://zonal-prosperity-production-3965.up.railway.app
- `/health` → returns JSON (works locally, crashes on Railway)
- `/api/auth/strava` → OAuth flow (WORKING)
- `/api/auth/strava/callback` → Success (WORKING)
