# DECISIONS.md

Decision log for agent work on SCORA. Product decisions from April 2026 live in `01_SCORA_90-Day_Execution_Plan_v1_4.md` §8. Newest first.

### 2026-10-18: Plan template format and load checks
- Status: DECIDED (reversible, review when you can)
- Branch: claude/plan-templates-loader
- Context: doc 07 v2 §4.2.1 gives the structure_json shape but no per-week progression, no review state and no rules for which checks run at load.
- Choice:
  1. YAML follows doc 07's shape plus `status` (draft/reviewed), `reviewed_by`, `reviewed_on`, and optional `week_load_percent` (one per week, default 100). Drafts never load in production (doc 07 v2 §8.3).
  2. Every weekly_pattern slot must be filled in every phase; a phase cycles its list in order week to week (deterministic).
  3. Workout duration is computed from the structure; an authored `total_duration_est_min` must agree within 5 min (doc 07's own example says 55 for a 50 min structure, so the estimate is not trusted).
  4. The 10% weekly increase ban is checked against the highest earlier week, so a cutback week can return to its earlier peak.
  5. Step types are warmup, steady, interval, cooldown (doc 07 had no continuous step; added `steady`).
- Why: a bad template must fail at boot with a named rule, not while an athlete's plan is built.
- To reverse: `packages/plan-engine/src/template-loader.ts`, one check per block, each with a test.

### 2026-10-18: Plan adaptation rules, details the spec left open
- Status: DECIDED (reversible, review when you can)
- Branch: claude/plan-engine-adaptation
- Context: doc 07 v2 §6.2/§9 and CLAUDE.md §6.2 define the rules but not the move window, the volume unit or which plans adapt.
- Choice:
  1. A move stays inside the plan week (Mon to Sun) and lands on the first later day that is rest or a single easy/recovery session, with no hard day either side. The displaced easy session is dropped. If no day qualifies, no adaptation (logged `skip_no_window`).
  2. Weekly volume is measured in planned minutes (templates are duration-based). The ±10% guard only blocks a change that moves the week's minutes; a downgrade (same duration) is never blocked.
  3. back-off + threshold downgrades like intervals (doc 07 v2 lists both; CLAUDE.md lists intervals only).
  4. The engine only adapts `scora_ai` plans. Coach plans change only by the coach; external and pasted plans are never rewritten.
  5. Race freeze covers T-7 through race day, measured from the workout's date, and also stops a move landing inside it.
- Why: keeps weekly volume and hard-day spacing as the template set them, which is what the plan-level bans in CLAUDE.md §4.3 protect.
- To reverse: each is one function or constant in `packages/plan-engine/src/adaptation-rules.ts` or `constants.ts`, with a test naming it.

### 2026-10-11: Voice pattern library review notes
- Status: NEEDS EVAN (none block merging)
- Branch: claude/voice-pattern-library
- Context: reviewed feat/voice-pattern-library merged onto current main; 71 tests pass, Railway install path checked locally.
- Choice (or options):
  1. Templates say "HRV down {{hrv_pct_change}}%" and "{{hrv_pct_change}}% below baseline", so the caller must pass a magnitude, not a signed value, or reads say "down -7%". Proposed: slot values are always unsigned; direction lives in the template wording.
  2. numeric_slots do not match templates: `sleep_hours_minutes` is declared but templates use `sleep_hours` + `sleep_minutes_padded`, and plan-says-hard-body-says-primed declares it with no sleep slot at all. Copied from doc 06 as written. Fix in doc 06 or the YAML.
  3. Templates contain em dashes (copied verbatim from doc 06). Left as is since it is voice copy.
  4. Root package.json becomes an npm workspace (apps/*, packages/*). `cd apps/api && npm install` still works, but the first Railway deploy after merge is worth watching.
- Why: voice copy and production deploys are Evan's call.
- To reverse: n/a.
### 2026-10-11: Posture rules ported from doc 07 v1
- Status: DECIDED (review when you can)
- Branch: claude/posture-engine
- Context: no posture engine existed (the LLM picked posture), and doc 07 v2 dropped the rules.
- Choice: ported doc 07 v1 §8.3 thresholds as written into packages/posture. Missing drivers make a clause false, so no data reads steady.
- Open questions: (1) taper fires only while load_7d is still above 0.8x weekly chronic, which reads backwards for a taper; (2) PRD v1 says taper window is 14 days, doc 07 says 7.
- Why: the v1 doc is the only written spec.
- To reverse: edit packages/posture/src/constants.ts and bump POSTURE_ENGINE_VERSION.
### 2026-10-13: Knowledge library: SCORA reasons over fixed sources (RAG)
- Status: DECIDED (by Evan); spec details open for review
- Branch: claude/knowledge-library-spec
- Context: Pattern library v0.3 is 12 hand-written entries; Evan wants interpretations that adapt, grounded in trusted books and coaches captured in FieldCopy, not the internet.
- Choice: Retrieval over a fixed source library (NotebookLM-style), stored in pgvector on Supabase, embedded with OpenAI `text-embedding-3-small`. Pattern library stays as fallback and voice examples. Spec: `11_SCORA_Knowledge_Library_Spec_v0_1.md`.
- Cost: embeddings approved by Evan 2026-10-13 (cents to a few dollars for the whole library). Anything larger is a new decision.
- Why: Canned responses cannot adapt; open-web answers are not trustworthy. A closed library gives adaptation plus credibility.
- To reverse: feature flag off in the read pipeline; reads fall back to the pattern library.

### 2026-10-13: SCORA becomes a coaching app in a later phase
- Status: DECIDED as direction (by Evan); not Phase 1, details NEEDS EVAN when that phase starts
- Branch: claude/knowledge-library-spec
- Context: v1.4 says the voice is never prescriptive and SCORA is not an AI coach. Evan: it has to be a coaching app to monetize.
- Choice: Document the direction now. Phase 1 rules are unchanged. The bans on a prescriptive voice (CLAUDE.md §1, §2.2, §11) are no longer permanent; they hold until Evan starts the coaching phase.
- Open when that phase starts: relation to Plan tier templates and the human coach marketplace, pricing, safety and liability position.
- Why: Evan's call on the business model.
- To reverse: restore "Permanently" in CLAUDE.md §11 and remove the notes in §0 and §2.2.
### 2026-10-13: CDV chart WebView loads Vega from a pinned CDN
- Status: DECIDED
- Branch: claude/cdv-chart-webview
- Context: ChatView needs Vega-Lite to render CDV charts; the night worker does not download files, so the libraries are not bundled.
- Choice: the chart page loads vega 5.30.0, vega-lite 5.21.0 and vega-embed 6.26.0 from cdn.jsdelivr.net. Specs with any `url` or `href` key are rejected, so charts only use inline data. API contract: optional `chart` field (a Vega-Lite object) on the /api/cdv response.
- Why: smallest change that works today. Alternative: bundle the three JS files in the app so charts render offline and nothing loads from a third party.
- To reverse: swap the three script tags in `CDVChart.html(for:)` for bundled files.
### 2026-10-12: Port of remaining voice patterns waits for Node on the Studio
- Status: NEEDS EVAN
- Branch: none yet
- Context: the night worker on Mac-Studio has no Node or npm, so it cannot run the @scora/voice tests; it took the ChatView emoji item instead.
- Options: install Node on the Studio (Homebrew `node@20`), or leave voice work to the MacBook.
- Why: nothing ships untested. Also, doc 06 holds only 12 v0.3 entries (7 ported); the 40 v0.1 and 5 v0.2 entries needed to reach 20+ are not in the repo.
- To reverse: n/a.

### 2026-10-11: Agents push branches, Evan merges to main
- Status: DECIDED (by Evan)
- Branch: claude/push-policy
- Context: OpenClaw's AGENTS.md lets it commit and push on its own; Claude Code was not pushing at all.
- Choice: every agent pushes its own branch to origin when ready for review. Only Evan pushes to or merges into main, on GitHub. No force-pushes.
- Why: Evan reviews everything before it lands; two agents pushing to main would collide.
- To reverse: edit CLAUDE.md §9.1.

### 2026-10-11: OpenClaw workspace files in the repo
- Status: NEEDS EVAN (Evan is handling OpenClaw)
- Branch: none
- Context: AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md sit in the repo root and are on GitHub.
- Options: keep them, or make `~/scora` the OpenClaw workspace with the repo at `~/scora/app`.
- Why: USER.md holds personal context; OpenClaw's AGENTS.md also still says to push on its own.
- To reverse: n/a until decided.

### 2026-10-11: Shared agent workflow lives in the repo
- Status: DECIDED
- Branch: claude/agent-workflow-docs
- Context: Claude Code and OpenClaw both work on this repo and kept separate memory.
- Choice: CLAUDE.md §9.1 holds the workflow rules; PLAN.md, DECISIONS.md, MEMORY.md and memory/ are the shared state both agents read and write. Private per-tool memory is not a source of truth.
- Why: git is the only thing both agents and both machines share.
- To reverse: delete §9.1, PLAN.md and DECISIONS.md.
