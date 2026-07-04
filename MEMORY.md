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

**Repository:** Monorepo (apps/ios, apps/api, packages structure). Voice + templates versioned independently because they're the moat.

**Feature test (5 questions, updated):** Does it surface voice OR reinforce plan? Feed better data? Extend to new surface? Monetize trust? Stay in sidekick role (voice) AND obey deterministic-template rule (plan)? Fail #5 = cut. Pass none of 1–4 = out of scope.

**Permanently out of scope:** Voice prescribing, LLM-invented plan structures, silent adaptations, medical/injury diagnosis, nutrition prescription, social feed, activity recording, hardware, anti-coach marketing.

**Reading order:** CLAUDE.md → PRD (v1.4) → Architecture (v2) → LLM Prompts (v2) → Pattern Library (v0.3) → then as-needed: Onboarding (v2), Acceptance (v2), Execution Plan (v1.4).

---

## Phase 0 Day 1 COMPLETE ✅✅✅

**Status:** Backend + iOS shipped. End-to-end auth WORKING.

**Backend (Live API):** https://zonal-prosperity-production-3965.up.railway.app
- `/health` → returns JSON ✅
- `/` → Landing page (S logo, black bg, 4-feature list) ✅
- `/privacy`, `/terms` → Legal pages (black minimal) ✅
- `/api/auth/strava` → OAuth authorize ✅
- `/api/auth/strava/callback` → Token exchange + success page ✅

**iOS App (SwiftUI):**
- ✅ Landing screen (black, S logo, features, auth button)
- ✅ Strava auth button (opens Safari)
- ✅ Deep link handler (processes scora://auth/success?athlete_id=...&name=...)
- ✅ Success screen (shows athlete name)
- ✅ **END-TO-END WORKING** (tested on simulator: sign-in → Strava approval → deep link → success screen shows "Welcome, Evan!")

**What shipped:**
1. Backend: Strava OAuth (redirect → authorize → token exchange → deep link)
2. iOS: SwiftUI app with Strava auth + deep link handling
3. **End-to-end integration: WORKING** (tested and verified)
4. Design: Black minimal (landing + success pages consistent)

**Oura Status:** ✅ WORKING (end-to-end, tested on device 2026-07-03)
- Registered app at https://cloud.ouraring.com/oauth/applications
- Client ID: cfaea8b9-7e65-4452-acb7-a9105796bd9e
- **Root cause of the old 400 `invalid_request`:** it was NOT an app-approval /
  "development app restriction" problem. It was request format — the token
  exchange must be `application/x-www-form-urlencoded` (Oura rejects JSON, which
  the Strava code uses). Dev-mode Oura apps work fine for the owner's own account.
- Implemented in `apps/api/src/oura.ts`: form-encoded token exchange against
  api.ouraring.com/oauth/token, athlete id threaded through the OAuth `state`
  param to link tokens to the Strava-keyed athlete row, refresh mirrors Strava.
  Scopes: `personal daily`. Redirect URI registered:
  .../api/auth/oura/callback. Migration adds oura_access_token/refresh_token/
  expires_at to `athletes`.
- Powers the Sleep + Recovery Signal dashboard cards (sleep duration, Oura
  score, HRV + week trend, resting HR). Verified live: Sleep 6:25/Oura 75,
  HRV 35ms.

**Stats:**
- Commits: 14 total (clean final state)
- Time: ~5 hours (backend setup + iOS build + auth testing)
- Tokens: ~200k (lots of iteration, Xcode troubleshooting)

---

## Phase 1 Launch Checklist (Days 15-35)

**READY (shipped today):**
- ✅ Backend API (Strava OAuth, landing pages, legal docs)
- ✅ iOS app (SwiftUI, deep link handler, auth working)
- ✅ End-to-end auth tested (sign-in → deep link → success screen)

**TODO before Phase 1 starts:**
- [x] Oura OAuth working (fix was form-encoded token exchange, not approval)
- [x] Build Dashboard view (iOS) — Today's Read + 6 cards, tap-to-expand
- [x] Implement CDV endpoint (backend) — chat-driven analysis
- [ ] Recruit 10 alpha users (friends, fitness buddies with Strava + iPhone)
- [ ] Add weekly read feature (backend) - scheduled Sunday morning push
- [ ] Set up PostHog + Sentry (telemetry)

**Phase 1 scope (locked from PRD v1.4):**
1. Dashboard screen (athlete info, recent activities)
2. CDV endpoint (chat-driven analysis)
3. Weekly read (scheduled, Sunday morning)
4. Reply handler (why/more/pause/resume/stop/help)
5. Manual plan entry + Strava activity sync
6. Telemetry (PostHog + Sentry)
7. TestFlight submission prep

**Exit gates (Phase 1):**
- 7/10 users open ≥10 of 14 mornings
- <0.5% banned-phrase hits
- Voice quality ≥5/10 "sounds like a person"
- ≥1 coach-forwarding signal

---

## Next Actions (Evan)

**Immediate (this week):**
1. Check email for Oura approval → if yes, test Oura OAuth
2. Start recruiting 10 alpha users (send Strava invite links)
3. Test iOS app on your iPhone (build for device, not just simulator)
4. Start Phase 1 planning

**Questions before Phase 1:**
- Team: Just you coding, or iOS/backend help?
- Pattern library: Have 20 posture entries ready to port, or build from scratch?
- Plan templates: Evan-authored drafts ready, or use Daniels/Pfitzinger samples?
- Coach recruiting: Pre-scoped 5+ coaches, or parallel project?

**Locked in stone:**
- Phase 1 = 21 days (Days 15-35)
- Free tier only (no paid gating)
- 10 alpha users minimum
- Voice never prescriptive (only interpretive)
- Plans always template-based (never LLM-invented)

---

## Repositories & Deployment

**GitHub:** https://github.com/evanwilliamk/scora (monorepo)
- `apps/api/` → Fastify backend (TypeScript)
- `apps/ios/` → SwiftUI iOS app
- `packages/` → Reserved for voice engine, validator, etc.

**Deploy:** Railway (auto-deploy on GitHub push)
- API: https://zonal-prosperity-production-3965.up.railway.app
- Environment variables:
  - `STRAVA_CLIENT_SECRET` ✅ (loaded, working)
  - `OURA_CLIENT_ID` ✅ (loaded, working)
  - `OURA_CLIENT_SECRET` ✅ (loaded, working)

**iOS:** Built locally, ready for TestFlight when you're ready

---

## Session Log

**Wed 2026-07-01 (Day 1):**
- 11:55 AM: Started Phase 0, set up monorepo + API
- 12:30 PM: Strava OAuth working, landed on landing page HTML deployment issues
- 1:30 PM: Backend live, Oura blocked on token exchange (development app)
- 2:45 PM: Started iOS setup (Xcode install)
- 3:32 PM: **iOS end-to-end auth WORKING** (Strava sign-in → deep link → success screen)

**Key wins:**
- ✅ Strava OAuth 100% working (backend + iOS)
- ✅ Deep link handling proven
- ✅ Black minimal design consistent across web + iOS
- ✅ Ready for Phase 1 dogfooding

**Blockers resolved:**
- HTML on Railway (solved with inline hardcoded strings)
- Xcode version mismatch (installed 15.x for Sonoma 14.5)
- SafariView sheet issues (switched to UIApplication.shared.open())
- Swift onChange Optional binding (switched to onReceive)

**Next session:** Phase 1 prep (Dashboard view, CDV endpoint, weekly reads)
