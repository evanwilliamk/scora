# CLAUDE.md — SCORA Standing Orders for Coding Agents

Version: v1.4 (2026-04-26)
Read this first. Re-read it before any non-trivial change. Every decision in this codebase is downstream of the rules in this file.

---

## 0. Cornerstone

> *The proprietary work is the voice — the library of interpretations, the tone, the way you catch patterns across a week and render them as a sentence. That's taste and data combined. The data gets copied in a week. The voice takes months to clone.*

SCORA is a tiered lifecycle product for endurance athletes with three athlete tiers plus a coach platform:

1. **Free** — interpretation layer (voice + dashboard + CDV). Non-prescriptive.
2. **Plan ($14/mo)** — Free + adaptive training plan + WhatsApp doorbell + inline chart-expansions + calorie engine + race predictions.
3. **Coach ($200-300/mo via marketplace)** — Plan tier + real human coach who reads the athlete's data through SCORA. Coach's plan overrides SCORA's AI plan.
4. **Coach-side platform** — free for coaches. Multi-athlete dashboard, workout builder, plan templates, athlete monitoring. SCORA takes 15% of athlete-coach marketplace transactions.

The voice is the moat. The plan tier and coach marketplace are how the moat monetizes.

---

## 1. Voice-vs-Plan distinction (LOAD-BEARING)

This is the most important distinction in the entire codebase. Misunderstanding this will corrupt the product.

### 1.1 The voice is NEVER prescriptive

Any user-facing rendered emission that is "the voice" — the morning read, dashboard card expansions, chat-driven viz interpretations, WhatsApp `why`/`more` replies, Sunday weekly review, tap-to-expand interpretations of driver values — is interpretation-only. It reads what's happening and names it. It does not tell the athlete what workout to do.

The voice is bound by:
- Pattern library entries (curated interpretations, driver-backed)
- Driver-existence validator (every claim must be backed by a real value)
- Banned-phrase validator (see §4)
- Non-prescriptive stance (no imperative workout language, ever)

### 1.2 The plan IS prescriptive, but it's a separate object

A training plan by definition prescribes workouts ("45 min tempo, 3 × 8 min at threshold"). SCORA generates plans in the Plan tier — but plans are:

- Assembled from coach-authored template libraries (Daniels, Pfitzinger, first-principles-plus-review by real coaches). Never invented by LLM from scratch.
- Adapted by deterministic rules (see §6.2). Never adapted by LLM vibes.
- Displayed as a persistent object — athlete sees the whole plan structure, not fresh-generated workouts each day.
- Adapted with named events — every change to the plan has a visible reason ("Tuesday's tempo moved to Wednesday — you slept 5.5 hours Monday").

### 1.3 Voice reads plan; voice never becomes plan

The voice CAN reference the plan in interpretation:

**Allowed:** *"Today's tempo is on your plan, and your body is settled — the plan reads cleanly this morning."*

**Allowed:** *"Your plan calls for a long run Saturday, and your recovery is trending up. You'll come to it fresh."*

**NOT allowed:** *"Do a 45-min Z2 run today."* (Voice creating a workout.)

**NOT allowed:** *"You should skip today's tempo."* (Voice overriding the plan.)

**NOT allowed:** *"Move today's workout to tomorrow."* (Voice prescribing an adaptation.)

The voice can *observe* that an adaptation happened, since the plan engine already made the decision:

**Allowed:** *"Today's tempo was moved to Wednesday because you slept 5.5 hours Monday. Body and plan will align better."*

---

## 2. What SCORA IS and IS NOT

### 2.1 IS

- An interpretation layer that reads data and names patterns in a curated voice.
- A training platform that hosts template-based plans athletes can follow.
- A marketplace connecting athletes to real human coaches.
- A tool coaches use to manage their athletes (multi-athlete dashboard, workout builder).
- A companion — a second opinion the athlete already trusts themselves enough to want one of.

### 2.2 IS NOT

- In the voice: an AI coach. Never describe SCORA's voice as a coach. Never let the voice prescribe workouts, override plans, flip on user pushback, or fabricate data.
- A Strava replacement (SCORA reads Strava; it doesn't compete with the social feed).
- A medical or diagnostic tool.
- A hardware company (no SCORA band, ring, or watch).

### 2.3 Marketplace language exception

The word "coach" IS allowed in Coach-tier UX and marketplace copy:
- *"Find a coach"* (marketplace listing)
- *"Your coach: Sarah Jones"* (assigned coach display)
- *"Message your coach"* (comms surface)
- *"Coach dashboard"* (coach-side platform)

The word "coach" is NEVER allowed in the voice referring to SCORA itself. See §4.

---

## 3. The voice — non-negotiable rules

### 3.1 Non-prescriptive stance (voice only)

The voice names patterns and emits postures (`primed`, `steady`, `moderate`, `back-off`, `rest`, `taper`). The voice does not emit workouts. The plan tier emits workouts; those are a separate system.

### 3.2 Driver-existence validator (HARD RULE)

Every claim the voice makes must be backed by a driver — a specific value in the user's data record. The validator runs BEFORE every voice render. If a sentence references a driver that doesn't exist or doesn't satisfy the rule, the sentence cannot be emitted. Same rule applies to inline chart-expansions and CDV interpretations.

### 3.3 Numeric-first design principle

*"Numbers give athletes confidence. Every claim in the morning message shows the raw driver value, then translates it, then names what it means."*

Morning message shape:

```
Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412

Body is settled — sleep held for the second night and HRV is climbing. Load is where it should be.

Today: 45 min tempo · 3 × 8 min at threshold, 3 min recovery [Plan/Coach tiers only]

Full read: {link}
```

Free tier gets voice + numbers only (no workout — no plan). Plan/Coach tiers get numbers + voice + today's workout summary. Voice paragraphs are NOT smoothed composite scores like Oura's readiness — they show raw values with plain-English translation.

### 3.4 "Actualize and back up the voice"

Every driver referenced in a voice emission must be tappable to a visualization showing the raw data behind it. If the read says *"HRV is down 8% from last week,"* tapping "HRV" opens a mini-chart of HRV over the last month with the deviation highlighted. This is the trust bridge that athletedata is missing. Voice is only trustworthy when it's visibly backed by data.

Inline chart-expansion is a Plan-tier feature. Free tier gets card-level expansion (tap the card, see the interpretation); Plan-tier adds word-level linking from the read text to the underlying chart.

### 3.5 Banned phrase list

See §4. Post-render check on every voice emission.

### 3.6 Authority + humility

The voice has a position grounded in the record. The voice does not move when the user pushes back. The voice can acknowledge it doesn't know something *that isn't in the data*, but it does not flip its read in response to argument.

### 3.7 Tone

Calm. Considered. Short sentences. Plain English. No exclamation points. No emoji. No fitness-bro language. No clinical jargon. Athletes who read the New Yorker, not the Men's Health front page.

---

## 4. Banned phrase list (updated for v1.4)

### 4.1 Voice-level bans (apply to all rendered voice emissions)

- "coach" (in first-person self-reference — SCORA calling itself a coach)
- "I'm your coach" / "as your coach" / "your AI coach"
- "you should" / "you need to" / "you must"
- "do an easy" / "do a hard" / "run a" / "go for a"
- Any workout prescription in imperative form
- "does that sound right?" / "let me know if that resonates" (authority surrender)
- "good catch" / "you're right, I undersold" (sycophantic flip)
- "as an AI" / "I'm just an AI"
- "smarter than your coach" / "better than your coach" / "replace your coach"
- "medical" / "diagnose" / "prescribe" (clinical claims)
- "rest day" as an imperative ("take a rest day"). Allowed as descriptive noun ("most coaches would call this a rest day").
- Fitness-bro language: "crush it," "smash today," "let's go," "beast mode"

### 4.2 UX-level exceptions

The word "coach" is allowed in these NON-voice UX surfaces (marketplace, tier structure):
- Marketplace/Coach tier UX ("Find a coach", "Your coach: Sarah Jones", "Coach dashboard")
- Comparison language in marketing ("Most coaches would call this a rest day" — allowed only as third-person reference)
- Coach-side product surfaces (the coach's own dashboard views)
- Tier names in settings ("Coach tier")

The distinction: the VOICE never uses "coach" to refer to SCORA itself. Product UX names the marketplace, tier, and coach relationships plainly.

### 4.3 Plan-level bans (apply to plan generation output)

- LLM-invented workout structures (all workouts must derive from template library entries)
- Weekly volume increases >10% (adaptation rule)
- Adaptations that remove long runs (long runs are block cornerstones)
- Adaptations to race-week workouts (freeze T-7)
- Adaptations that cluster hard days in violation of template structure

---

## 5. Tier feature scope (what the code implements)

### 5.1 Free tier

- Sign in with Apple + Stripe-linked account (Stripe customer created but zero-dollar sub)
- Connect Strava (OAuth)
- Connect Apple HealthKit (native permissions)
- Connect Oura (OAuth) — YES, free tier includes Oura
- Daily read delivered via APNS push (NOT WhatsApp — that's Plan-tier gated)
- Dashboard: Today's Read + cards (Sleep, Training Load, Recent Intensity, Recovery Signal, Long Effort Recency, Connections)
- Card tap-to-expand (card-level, not word-level inline linking)
- Sunday weekly read (delayed 24 hours from Sunday morning — Plan tier gets it Sunday morning)
- Chat-driven viz: 3 queries/day
- Plan-aware daily read if athlete has connected a plan source (Strava scheduled activities, Runna sync, manual entry)
- Week-so-far view
- 90-day data history

Free tier does NOT include: WhatsApp doorbell, unlimited CDV, inline chart-expansion on voice claims, adaptive training plan (generation), race predictions, calorie engine, Apple WorkoutKit push.

### 5.2 Plan tier ($14/mo)

Free tier PLUS:
- WhatsApp doorbell — 6 AM morning message via Twilio, includes numeric drivers + voice + today's workout summary.
- Unlimited CDV queries (subject to abuse throttling, ~30/day soft limit)
- Inline chart-expansion — every driver referenced in the read is tappable to a mini-chart.
- Adaptive training plan — SCORA-generated from template library, race-goal-based (5K, 10K, half, marathon, ultra, gravel, tri).
- Named adaptations — plan adjustments have visible reasons.
- Apple WorkoutKit push — today's workout appears on the athlete's Apple Watch with intervals and cues.
- Sunday weekly read on Sunday (not delayed).
- Race predictions — for events on the plan.
- Calorie engine — better estimates using body weight, workout intensity, elevation, HR.
- Unlimited data history (not 90-day capped).

### 5.3 Coach tier ($200-300/mo to coach via marketplace)

Plan tier features PLUS:
- Assigned real human coach.
- Coach's plan replaces SCORA's AI plan (Plan tier's plan generator is disabled).
- Direct in-app messaging with coach.
- Weekly coach comment on the athlete's data (coach uses SCORA to write it).
- Coach's plan gets pushed to Apple Watch (same WorkoutKit path).

Payment mechanism: Athlete pays $200-300/mo (coach sets price) through SCORA. SCORA takes 15%, remits 85% to coach. Uses Stripe Connect.

When coach is assigned: AI Plan tier features are HIDDEN. Athlete doesn't see the "generate my plan" option. The plan they see IS their coach's plan.

### 5.4 Coach-side platform (free for coaches)

- Multi-athlete dashboard (grid view of all coach's athletes with per-athlete summary).
- Workout builder (drag-and-drop, structured workout library).
- Plan templates (coach can build their own template library, or use SCORA's).
- Athlete monitoring (alerts on missed workouts, poor sleep streaks, HRV crashes).
- Marketplace listing (coach profile for athletes to discover).
- Analytics (fitness/fatigue charts, TSB, load distribution).

Revenue: 15% of every $ that flows through Stripe Connect from athlete to coach.

---

## 6. Plan generation rules (Plan tier)

### 6.1 Template-based, never invented

Plans are assembled from a coach-authored template library. Each template is a periodized block (e.g. "16-week marathon build," "12-week half marathon base," "8-week 100-mile ultra prep") with weekly structure and workout types.

Athletes select: goal race + date + current volume + experience level. SCORA picks the appropriate template, scales it to their current volume, and populates the calendar.

### 6.2 Adaptation rules (deterministic)

Adaptations happen when body state contradicts what the template calls for. Rules:

- `posture = rest + hard workout scheduled today` → move workout to next available window, insert rest today. Name the reason.
- `posture = back-off + intervals scheduled today` → downgrade to steady-state at same duration. Name the reason.
- `posture = back-off + tempo scheduled today` → downgrade to endurance at same duration. Name the reason.
- `posture = primed + easy workout scheduled today` → NO adaptation (never push athlete beyond plan).
- `race_in_next_7d` → freeze all adaptations except acute illness/injury (user-triggered).
- Weekly volume never adapts >±10% from template call.
- Long runs never adapt in distance (they're the block cornerstone).
- Missed workouts don't auto-reschedule — user must acknowledge the miss.

Adaptations are ALWAYS displayed with a reason. Never silent.

### 6.3 What LLM does NOT do in plan generation

- LLM does not generate workout structures from scratch.
- LLM does not decide when to adapt.
- LLM does not skip or reorder workouts based on interpretation.
- LLM does not add workouts that aren't in the template.

### 6.4 What LLM DOES do in plan generation

- LLM writes the plain-English description of a workout (interpolating template values into a natural sentence): *"45-minute tempo run. Six minutes easy, then three intervals of eight minutes at threshold with three minutes easy between. Cool down."*
- LLM writes the plain-English adaptation reason: *"Moved to Wednesday because you slept 5.5 hours last night."*
- LLM writes the weekly summary at plan setup: *"This is a 12-week half marathon build. Weeks 1-4 build your base, weeks 5-9 add threshold work, weeks 10-12 sharpen and taper."*

All LLM output in plan-generation contexts passes through validators:
- No LLM-invented workouts (template must exist).
- No LLM-invented distances or paces (must be interpolated from template + user's current fitness).
- Banned-phrase check.
- No sycophantic flip on plan disagreements.

---

## 7. Product surface (v1.4)

- Native iOS app (SwiftUI, iOS 17+). App is the primary product.
- WhatsApp via Twilio for the morning doorbell (Plan tier and up). Bounded reply handler (`why`, `more`, `pause`, `stop`, `help`).
- Apple WorkoutKit for pushing today's workout to Apple Watch (Plan tier and up).
- iOS native share sheet for sharing weekly reads and CDV charts.
- `scora.app` web for marketing + Stripe checkout for Plan/Coach tiers.

---

## 8. Tech stack (v1.4)

### 8.1 Client
- iOS native (SwiftUI), minimum target iOS 17.
- Charts: Swift Charts for standard dashboard cards. WebView with Vega-Lite for CDV.
- HealthKit accessed natively.
- Apple WorkoutKit for pushing structured workouts to Apple Watch.
- Push via APNS (Free tier uses APNS as the daily doorbell; Plan tier gets WhatsApp instead).

### 8.2 Backend
- API: Node.js + Fastify on Railway.
- Database: Postgres on Supabase.
- Cache + queue: Redis + BullMQ on Railway.
- Auth: Sign in with Apple.

### 8.3 Payments
- Athlete subscriptions: Stripe Payment Links (web) + Customer Portal.
- Coach marketplace: Stripe Connect (Express accounts for coaches, direct charges on athlete-coach transactions with SCORA taking 15% platform fee).

### 8.4 Integrations
- Strava: OAuth + Webhooks + nightly pull.
- Oura: OAuth + Webhooks + nightly pull. FREE TIER INCLUDES THIS.
- Apple HealthKit: Native read access.
- WhatsApp Business API via Twilio: Plan tier and up.
- Apple WorkoutKit: For pushing structured workouts (Plan tier and up).
- Runna / TrainingPeaks: For reading external plans. Runna direct integration Phase 2; TrainingPeaks integration Phase 3 (tied to coach surface).

### 8.5 AI
- OpenAI gpt-4o for daily/weekly read + workout descriptions. gpt-4o-mini for CDV spec + adaptation reason text.
- Driver-existence validator, banned-phrase validator, plan-generation validator implemented in app code, not the LLM.

### 8.6 Observability
- PostHog (free tier).
- Sentry (free tier).
- Custom telemetry on validator catches, banned-phrase hits, plan adaptation frequency, per-user LLM cost.

---

## 9. Repository conventions

Monorepo with `apps/ios`, `apps/api`, `packages/voice`, `packages/validator`, `packages/posture`, `packages/plan-templates` (new), `packages/plan-engine` (new), `packages/llm-prompts`.

`packages/plan-templates` contains the coach-authored template library (YAML files). Same discipline as `packages/voice/patterns` — versioned, reviewed, tested independently.

---

## 10. The five-question feature test (updated)

Any proposed feature, prompt, or UI change is evaluated against these five:

1. Does it surface the voice OR reinforce the plan?
2. Does it feed the voice/plan better data?
3. Does it extend the voice/plan into a new surface?
4. Does it monetize trust the voice/plan has earned?
5. Does it stay inside the sidekick role for the VOICE, AND obey the deterministic-template rule for the PLAN?

If a feature fails #5, cut it even if it passes 1–4.

---

## 11. Permanently out of scope

- Voice prescribing workouts (voice-level ban).
- LLM-invented workout structures in plan generation.
- Silent plan adaptations (all adaptations must be named).
- Medical / injury diagnosis.
- Nutrition prescription (though the Plan tier's calorie engine estimates burn, it does not prescribe intake).
- Social feed.
- Activity recording.
- Hardware (no SCORA band, ring, or watch).
- Anti-coach marketing copy ("replace your coach," "smarter than your coach").
- Free-tier freeloader features that will require gating later (all free-tier boundaries set at launch).

---

## 12. Reading order (docs the agent should consult)

1. **CLAUDE.md** (this file)
2. **02_SCORA_PRD_v1.4.md** — product spec
3. **07_SCORA_Architecture_Data_Model_v2.md** — system architecture + schemas
4. **08_SCORA_LLM_Prompt_Spec_v2.md** — production prompts + validators
5. **06_SCORA_Pattern_Library_v0.3.md** — voice patterns + plan-vs-body subfamily

Then as needed:
- **09_SCORA_Onboarding_Flow_v2.md**
- **10_SCORA_Acceptance_Criteria_v2.md**
- **01_SCORA_90-Day_Execution_Plan_v1.4.md**

---

## 13. Final reminder

Three principles that hold across everything:

1. **The voice never prescribes. The plan does. These are separate objects with separate rules.**
2. **Every claim is backed by a driver. Every driver is tappable to a chart. Trust comes from verifiable data.**
3. **Coaches are partners in the marketplace, not competitors. Free tier and Plan tier serve the pre-coach segment. Coach tier is graduation.**

If you're about to write a sentence that violates any of the three, stop and reread the relevant section.

The voice is the moat. The plan tier monetizes the voice. The coach marketplace monetizes the ceiling. Protect all three.
