SCORA — Documentation Package
Version: v1.4 (2026-04-26) Supersedes: v1.3 package (same day, earlier)

For the coding agent (and anyone new to the project): read this file first. It tells you what every other doc is, what order to read them in, and what the current state of strategy is.


0. The 30-second version
SCORA is a three-tier lifecycle product for endurance athletes with a coach marketplace underneath:

Free — interpretation layer (voice + dashboard + CDV + plan-aware reads). Non-prescriptive. Acquisition surface.
Plan ($14/mo) — Free + adaptive template-based plans + WhatsApp doorbell + inline chart-expansion + WorkoutKit push + race predictions + calorie engine.
Coach ($200-300/mo to coach via marketplace) — Plan tier + real human coach + coach's plan overrides AI plan + in-app messaging. Athlete pays coach directly through SCORA. SCORA takes 15%.
Coach-side platform — free for coaches. Multi-athlete dashboard, workout builder, plan templates, athlete monitoring, marketplace listing.

The product is built around the voice — a curated library of pattern interpretations rendered through a constrained LLM pipeline that cannot hallucinate (architectural guarantee).

Solo founder. $0 contractor budget. Free-tier infra until revenue.


1. Reading order for the coding agent
Read these in order before writing any code.
1.1 Required reading (all five before any non-trivial work)
1.2 Reference (consult as needed)


2. File catalog
/SCORA/

├── README.md                                        ← you are here

├── CLAUDE.md                                        ← agent standing orders (v1.4)

│

├── 01_SCORA_90-Day_Execution_Plan_v1.4.md           ← CURRENT (three-tier phasing)

├── 01_SCORA_90-Day_Execution_Plan_v1.3.md           ← v1.3 (native iOS + WhatsApp, no plan tier)

├── 01_SCORA_90-Day_Execution_Plan.md                ← v1.2 (STALE)

├── 01_SCORA_90-Day_Execution_Plan.docx              ← v1.2 export (STALE)

│

├── 02_SCORA_PRD_v1.4.md                             ← CURRENT (three-tier product spec)

├── 02_SCORA_PRD_v1.3.md                             ← v1.3 (single-tier)

├── 02_SCORA_PRD_v1.md                               ← v1.2 (STALE)

├── 02_SCORA_PRD_v1.docx                             ← v1.2 export (STALE)

│

├── 03_SCORA_Feature_Roadmap_12mo.md                 ← PARTIAL STALE

├── 03_SCORA_Feature_Roadmap_12mo.docx               ← export

│

├── 04_SCORA_ICP_Interview_Script.md                 ← CURRENT

├── 04_SCORA_ICP_Interview_Script.docx               ← export

│

├── 05_SCORA_Home_Screen_Mockup.html                 ← visual reference

│

├── 06_SCORA_Pattern_Library_v0.3.md                 ← CURRENT (plan-vs-body subfamily)

├── 06_SCORA_Pattern_Library_v0.2.md                 ← v0.2 (schema-defining)

├── 06_SCORA_Pattern_Library_v0.1.md                 ← v0.1 (40 historical entries — need porting)

├── 06_SCORA_Pattern_Library_v0.1.docx               ← export

│

├── 07_SCORA_Architecture_Data_Model_v2.md           ← CURRENT (tier state, plan engine, coach marketplace)

├── 07_SCORA_Architecture_Data_Model_v1.md           ← v1 (superseded)

│

├── 08_SCORA_LLM_Prompt_Spec_v2.md                   ← CURRENT (plan-aware + numeric-first + plan gen prompts)

├── 08_SCORA_LLM_Prompt_Spec_v1.md                   ← v1 (superseded)

│

├── 09_SCORA_Onboarding_Flow_v2.md                   ← CURRENT (Free tier default + upgrade paths + coach booking)

├── 09_SCORA_Onboarding_Flow_v1.md                   ← v1 (superseded)

│

└── 10_SCORA_Acceptance_Criteria_v2.md               ← CURRENT (Free alpha + Plan launch + Coach marketplace gates)

└── 10_SCORA_Acceptance_Criteria_v1.md               ← v1 (superseded)
2.1 What "CURRENT" vs "STALE" means
CURRENT — reflects the v1.4 strategy (three tiers + plan feature + coach marketplace + numeric-first design + voice-vs-plan distinction). Implement against these.
STALE — pre-v1.4 versions, kept for historical record. Do not implement against them.
PARTIAL STALE — some content still useful; framing is older. Treat skeptically.


3. Current state of strategy (April 26, 2026 late)
Locked decisions the docs reflect:

Category: interpretation layer + training platform + coach marketplace.
Voice-vs-Plan distinction is load-bearing. Voice never prescribes; plans prescribe (as separate objects with deterministic template-based generation + named adaptations).
Three-tier ladder: Free (interpretation) → $14 Plan (adaptive template plan) → $200-300 Coach (marketplace with 15% platform cut).
v1 product surface: native iOS app + WhatsApp messenger (Plan+) + Apple WorkoutKit push (Plan+).
Two moats: voice (pattern library + validators + numeric-first + "actualize the voice" trust bridge) and template-based plans with named adaptations.
Marketplace mechanics: Stripe Connect Express accounts, direct charges, 15% application fee, 85% to coach. Coaches free on platform because SCORA extracts value from athlete-coach transactions.
Coach cannibalization resolved: AI Plan tier is pre-coach segment; Coach's plan overrides AI plan when active; coaches see SCORA as lead flow + tooling.
Non-prescriptive stance applies to voice ONLY. Plans DO prescribe (that's their job).
Solo founder, $0 contractor budget, free-tier infra until revenue.
ICP wedge: 28-45 endurance athletes (runners 15+ mi/wk, cyclists 3+ sessions/wk) on iPhone + Apple Watch + Strava, ideally Oura users.
Content sourcing for plan templates: coach-authored + coach-reviewed. Evan authors initial 7 templates using standard periodization; pays qualified coach for sign-off before Phase 2 launch.


4. Open decisions (deferred, not unilaterally decided)
App Store paywall mechanism: Stripe web checkout (current plan) vs Apple StoreKit fallback.
CDV chart rendering: WebView + Vega-Lite (default) vs Swift Charts subset. Decided during build.
Trial durations: Plan tier 7-day default (A/B test in Phase 3+). Coach tier trial coach-configurable.
Coach payout schedule: standard 2-day (default) vs on-demand.
Plan template library expansion cadence.
Voice A/B testing infrastructure (voice_version field ready; plumbing Phase 3).
Coach-contributed voice pattern entries (deferred).


5. The five-question feature test (updated for v1.4)
Any proposed feature, prompt, or UI change is evaluated against:

Does it surface the voice OR reinforce the plan?
Does it feed the voice/plan better data?
Does it extend the voice/plan into a new surface?
Does it monetize trust the voice/plan has earned?
Does it stay inside the sidekick role for the VOICE and obey the deterministic-template rule for the PLAN?

Pass #5 even if 1-4 fail. Fail #5 even if 1-4 all pass.


6. Where the cornerstone lives
The proprietary work is the voice — the library of interpretations, the tone, the way you catch patterns across a week and render them as a sentence. That's taste and data combined. The data gets copied in a week. The voice takes months to clone.

Appears in:

CLAUDE.md §0
02_SCORA_PRD_v1.4.md §0
06_SCORA_Pattern_Library_v0.3.md §1
01_SCORA_90-Day_Execution_Plan_v1.4.md §0

Most important sentence in the company.


7. What's permanently out of scope
Voice prescribing workouts (voice-level ban — enforced by validator).
LLM-invented workout structures in plan generation.
Silent plan adaptations — every adaptation must be named.
Medical / injury diagnosis.
Nutrition prescription (calorie engine estimates burn; it doesn't prescribe intake).
Social feed.
Route discovery.
Activity recording (Strava records; SCORA reads).
Hardware (no SCORA band, ring, or watch).
Anti-coach marketing copy.
Coach cannibalization — AI Plan tier is pre-coach segment, coach's plan overrides AI when active.
Free-tier freeloader features that will require gating later — all free-tier boundaries set at launch.


8. For an LLM coding agent: how to behave
Read CLAUDE.md first. Re-read it before any change touching voice, prompts, plan content, or coach experience.
When in doubt about scope, ask.
Never invent a feature. If it's not in the PRD, propose it explicitly.
All voice work requires validator coverage.
All plan template work requires coach review before ship.
All schema changes go in infra/migrations/ as timestamped forward-only SQL.
All product copy reviewed against banned-phrase list before merge.
Voice-vs-Plan distinction is load-bearing. Never blur it.
Coach marketplace mechanics (Stripe Connect, 15% fee, refunds, disputes) must be handled through Stripe — never direct DB manipulation.


9. Change log for this package
2026-04-26 (v1.3 package, earlier): Initial CLAUDE.md, PRD v1.3, Architecture v1, LLM Prompt Spec v1, Onboarding Flow v1, Pattern Library v0.2, Acceptance Criteria v1, 90-Day Plan v1.3.
2026-04-26 (v1.4 package, later, this update): All docs bumped to v1.4/v2/v0.3. Three-tier ladder. Plan tier feature spec. Coach marketplace via Stripe Connect. Voice-vs-Plan distinction. Numeric-first morning message. Plan-vs-body pattern subfamily.


10. Contact
Evan Kosowski — founder, voice lead, product, engineering, everything else.

# | File | What it gives you
1 | CLAUDE.md | Standing orders. Voice rules. Voice-vs-Plan distinction. Banned phrases. Tech stack. Non-negotiables. Read first. Re-read regularly.
2 | 02_SCORA_PRD_v1.4.md | Product spec. Three-tier features. User journeys. Data model overview.
3 | 07_SCORA_Architecture_Data_Model_v2.md | Concrete schemas, API contracts, pipelines, Stripe Connect + WorkoutKit + plan generation + coach marketplace details.
4 | 08_SCORA_LLM_Prompt_Spec_v2.md | Production prompts (daily-read plan-aware, weekly-read, workout-description, adaptation-reason, plan-summary, CDV spec). Validator pipelines.
5 | 06_SCORA_Pattern_Library_v0.3.md | The voice. Pattern schema. Banned-phrase list. Plan-vs-body subfamily.
File | Consult when
09_SCORA_Onboarding_Flow_v2.md | Free tier onboarding, Plan tier upgrade flow, Coach tier booking flow, coach onboarding.
10_SCORA_Acceptance_Criteria_v2.md | Verifying phase gates. Writing observability. Free tier Phase 1 → Plan tier Phase 2 → Coach marketplace Phase 3.
01_SCORA_90-Day_Execution_Plan_v1.4.md | Understanding what to build when. Phased scope.
03_SCORA_Feature_Roadmap_12mo.md | Long-range roadmap context. (Stale framing in places; treat as historical until update.)
04_SCORA_ICP_Interview_Script.md | Running customer discovery.
05_SCORA_Home_Screen_Mockup.html | Visual reference for dashboard direction (open in browser).