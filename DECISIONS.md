# DECISIONS.md

Decision log for agent work on SCORA. Product decisions from April 2026 live in `01_SCORA_90-Day_Execution_Plan_v1_4.md` §8. Newest first.


### 2026-10-17: Pattern review notes (voice copy is yours)
- Status: NEEDS EVAN (copy); one rule fix DECIDED
- Branch: claude/port-v03-patterns
- Decided: plan-adherence-strong-week now also requires workouts_planned_this_week > 0 (doc 06's rule fired on "0 of 0"). Differs from doc 06; update the doc or revert.
- For you: (1) coach-note-preserve-verbatim's template "A week of quality work." is a claim no driver backs and fires at any posture with completeness 0; something neutral like "{{coach_name}}'s note this week:" avoids it. (2) coach-recent-message-acknowledge says "yesterday" but fires on the last 24 hours, and keeps doc 06's em dash.
- To reverse: drop the first line of that driver_rule.
### 2026-10-17: Last 5 v0.3 pattern entries ported as written
- Status: DECIDED (review when you can)
- Branch: claude/port-v03-patterns
- Context: Q10 answer B: port the remaining doc 06 v0.3 entries as a stopgap.
- Choice: copied §6.8 to §6.12 verbatim, same as the first 7. coach-recent-message-acknowledge keeps doc 06's em dash in its template (voice copy, same call as 2026-10-11 note 3). None can fire in production yet: they need adaptation, missed-workout, adherence and coach drivers that nothing computes.
- Why: doc 06 is the source of truth for voice copy.
- To reverse: delete the 5 YAML files in packages/voice/patterns.
### 2026-10-17: Card expansion reads from a 10 minute snapshot of the last read
- Status: DECIDED (review when you can)
- Branch: claude/card-expand
- Context: a tap needs the same numbers the card showed. Recomputing means a Strava (and Oura) call per tap, and Strava's app-wide rate limit is tight.
- Choice: /api/read keeps an in-memory snapshot per athlete (cards, drivers, posture) for 10 minutes; /api/card-expand interprets from it. No snapshot (expired or a server restart): 409, and the app keeps the card's translation. Plain-text reply through generateValidatedVoice (same validators and fallback as the read), not doc 08's JSON shape, since Free tier has no chart-link target. Related drivers per card are a fixed map in apps/api/src/card-expand.ts.
- Alternative: persist reads in Postgres (also what read_citations wants eventually), or recompute per tap.
- Why: one LLM call per tap, nothing new to store.
- To reverse: replace SnapshotCache with a reads table, or recompute in the route.
### 2026-10-17: Driver record definitions for the posture engine
- Status: DECIDED (review when you can)
- Branch: claude/driver-record
- Context: doc 07 v1 §8.2 (driver computation) is not in the repo, so the night worker defined each driver.
- Choice:
  - Load = run moving minutes (same unit as the Load card). Rides etc. excluded. acwr = load_7d / (load_28d / 4), null until the oldest run in the 35-day fetch is 27+ days old, so new accounts do not read back-off (and no partial-window guess hides a comeback ramp).
  - Hard day = any run that is a Strava race/workout, or whose avg HR is at or above the athlete's own 80th percentile over 28 days (needs 5+ HR runs). Streak counts back from today, or from yesterday if nothing is recorded today.
  - Long effort = run of 90+ min moving time.
  - Sleep: last night's Oura score; delta vs mean of prior 7 nights (points); p25/p75 over prior 28 nights (needs 7+). Low night = below p25.
  - HRV delta in percent vs prior-7 avg; resting HR delta in bpm vs prior-7 avg.
  - race_in_next_7d stays null until a plan or race source exists, so taper cannot fire yet.
  - Oura fetch now pulls 29 days of daily_sleep (was 8) for the baselines.
- Why: these match what the dashboard cards already show, so the voice and the posture read the same numbers.
- To reverse: edit the constants at the top of apps/api/src/drivers.ts.
### 2026-10-17: Root package-lock.json synced with packages/posture
- Status: DECIDED
- Branch: claude/driver-record
- Context: main's root lockfile lacked @scora/posture, so `npm ci` failed in apps/api.
- Choice: ran `npm install` at the root and committed the 16-line lockfile change.
- Why: the routine's test command (`npm ci && npm test`) must work.
- To reverse: revert commit b289e96.
### 2026-10-17: CDV charts: LLM picks the kind, server builds the spec
- Status: DECIDED (review when you can)
- Branch: claude/cdv-chart-api
- Context: CLAUDE.md §8.5 says gpt-4o-mini writes the CDV spec. A free-form LLM spec could plot invented numbers, which breaks §3.2 and §3.4.
- Choice: the model adds one line, `CHART: <kind>`, choosing from weekly_miles, recent_pace, recent_hr, weekday_runs or none. The API builds the Vega-Lite spec and its inline data from Strava activities. No extra LLM call.
- Alternative: let the model write the full spec with data, then validate every value against the data block.
- Why: same guarantee as the driver-existence validator, at zero extra cost. New kinds are a few lines each in apps/api/src/cdv-chart.ts.
- To reverse: remove the CHART line from the CDV prompt and the `chart` field from the response.
### 2026-10-17: Oura link outcome copy and Strava deep-link token
- Status: NEEDS EVAN (copy is cheap to change; the token point is yours)
- Branch: claude/oura-success
- Context: the Oura round trip had no in-app landing and the callback pages were injectable.
- Choice: banner copy "Oura connected. Sleep and recovery now read from your ring." and, on failure, "Oura was not connected. You can try again from the Sleep card." (cancelled) or "Oura did not connect. Nothing changed; try again from the Sleep card." Strava page now says "Welcome, <name>." (no exclamation point).
- Not changed, flagging: the Strava callback puts the Strava access token in the scora:// deep link URL. Any app that registers the scora scheme, or a browser history entry, can see it. The app no longer needs it (the API refreshes tokens itself). Removing it touches sign-in, so it is yours to call.
- To reverse: copy lives in OuraLinkResult (DashboardView.swift) and apps/api/src/pages.ts callers.
### 2026-10-17: Knowledge retrieval in the daily read
- Status: DECIDED (review when you can)
- Branch: claude/knowledge-retrieval
- Context: spec §2.4 to §2.6. Flag, query shape and prompt wording were unspecified.
- Choice: env flag `KNOWLEDGE_RETRIEVAL=on` (default off, so no OpenAI embedding cost until you turn it on). Query is a plain-language description built only from drivers that exist, plus topic tags (sleep, load, recovery, hrv, intensity, taper); if the tagged search is empty it retries untagged. Top 4 chunks, cosine similarity at least 0.3. Prompt tells the model to paraphrase, take no numbers from the library, and never prescribe. Fallback order: library, pattern library (selectPattern), nothing. Citations are written to read_citations after the read, best effort. The API response gains `knowledge: { mode, chunks, pattern }` but no source names (spec §6.1 is still open).
- Alternative: retrieval on by default; showing sources in the response.
- Why: keeps today's behavior until you have a starter library to test against (spec §8 step 5).
- To reverse: unset the env var, or remove the knowledgeForRead call in /api/read.
### 2026-10-18: Plan adaptations run with the daily read, not a separate nightly cron
- Status: DECIDED (reversible, review when you can)
- Branch: claude/plan-adapt-job (on plan-schema + plan-assembler + driver-record)
- Context: doc 07 v2 §6.2 describes a nightly job, but posture needs HealthKit data, which only the app sends with the read request.
- Choice: when `/api/read` has decided today's posture and `PLAN_ADAPTATIONS=on`, tomorrow's workouts on the athlete's active SCORA plan go through `evaluateAdaptation`; changes are written by `apply_plan_adaptation` in one transaction. One automatic adaptation per workout (reruns and later reads that day change nothing). A displaced easy session becomes a rest day and is logged as `skipped` with its own reason. A downgrade replaces the structure with one continuous step at the same duration.
- Reason text is a fixed sentence built from the decision (for example "Thursday's tempo is now an endurance run at the same 40 minutes. Today's posture reads back-off."), checked against the banned-phrase list in tests. The gpt-4o-mini adaptation-reason prompt (CLAUDE.md §6.4) can replace it later; copy is yours.
- Alternative: a nightly cron that computes posture server-side (Strava + Oura only, so HealthKit-only athletes would never adapt).
- To reverse: move the `adaptTomorrow` call from the read route into a cron in `scheduler.ts`.

### 2026-10-18: Plan tier schema shape
- Status: DECIDED (reversible until applied to Supabase; Evan applies it)
- Branch: claude/plan-schema (on claude/manual-plan)
- Context: doc 07 v2 §4.2 to §4.5 key everything by users.id and make plan_templates.slug unique; the live API keys by athlete_id and athletes stay pinned to a template version.
- Choice: athlete_id keys, as in the manual plan tables. `plan_templates` unique on (slug, version), with `status`/`reviewed_by`/`reviewed_on` (a reviewed row must name both). `training_plans` gains the template and race columns; a `scora_ai` plan must name a template and others must not; one active SCORA plan per athlete. `scheduled_workouts` gains WorkoutKit columns and allows `endurance` and `steady_state` (downgrade targets). `plan_adaptations` requires a non-blank reason_text (never silent), dates on a move, and adds `engine_version` and `dismissed_at`.
- Why: matches the plan-engine package and the existing manual plan tables; constraints make a silent or unnamed adaptation impossible at the database level.
- To reverse: edit `apps/api/supabase/migrations/20261018000000_plan_engine.sql` before it is applied.

### 2026-10-17: Manual plan parsing and storage
- Status: DECIDED (review when you can)
- Branch: claude/manual-plan
- Context: doc 09 says the backend LLM-parses a pasted plan into scheduled_workouts; doc 07 keys plans by users.id.
- Choice: gpt-4o-mini (JSON mode, temperature 0) only transcribes. Code keeps a row only if its date resolves (yesterday to 26 weeks out), type and intensity are in closed lists, and every duration and distance appears in the pasted text (hours to minutes and miles to km allowed). Rejected rows come back as reasons. Tables keyed by athlete_id (strava_id) like the live API, Plan-tier columns left out. Added `tempo` to the intensity list (doc 07 omits it; the pattern library uses it). A new paste marks the old plan `replaced` and keeps its rows. iOS: "Your Plan" sheet from a header button; copy follows doc 09 ("Have a training plan?", "Paste plan here...", "Save plan"), minus the Strava-scheduled sentence since that source does not exist yet.
- Cost: one gpt-4o-mini call per paste (fractions of a cent).
- To reverse: drop the two tables; remove the routes and PlanView.
### 2026-10-17: Onboarding slice and per-athlete delivery time
- Status: DECIDED (review when you can)
- Branch: claude/onboarding
- Context: doc 09 §1 onboarding starts with Sign in with Apple and a Stripe customer, both yours. The scheduler pushed everyone at 06:00 in one server zone (PUSH_TZ).
- Choice: build the steps after Strava sign-in: Oura (optional), Apple Health, plan paste (optional, reuses PlanView), morning time with the device's time zone, confirmation. Only a fresh sign-in triggers it. New athlete_preferences table; scheduler ticks every 15 minutes and sends each athlete's read once per local day at their time (default 06:00 America/New_York, same as before), skipping it if more than 2 hours late. PUSH_TZ is no longer read. Copy follows doc 09, minus its em dash ("Free tier, no extra cost."); the Apple Health and delivery screen copy is mine.
- Alternative: keep one global push time until Plan tier.
- Why: doc 09 makes delivery time part of Free onboarding; one fixed zone sends 6 AM New York reads at 3 AM in California.
- To reverse: restore the two fixed crons in scheduler.ts; drop athlete_preferences; set needsOnboarding false.
### 2026-10-17: Knowledge library schema shape
- Status: DECIDED (review when you can)
- Branch: claude/knowledge-schema
- Context: spec §3 sketches the tables; reads are not stored anywhere yet, so read_citations has no read row to point at.
- Choice: read_citations keys a read by athlete_id (strava_id, like device_tokens) + read_kind + read_generated_at, with rank and similarity. knowledge_chunks adds chunk_index, embedding_model and unique (fieldcopy_entry_id, chunk_index) so re-ingest is idempotent. Retrieval is a SQL function `match_knowledge_chunks(query_embedding, match_count, filter_tags)` over active sources, cosine similarity, HNSW index. RLS on with no policies (API uses the service role key).
- Alternative: a `reads` table first, with read_citations.read_id as a foreign key. Better once reads are persisted; easy to add then.
- Why: smallest shape that lets ingest and retrieval run end to end.
- To reverse: drop the three tables and the function; nothing else depends on them yet.
### 2026-10-17: PGlite for migration tests
- Status: DECIDED
- Branch: claude/knowledge-schema
- Context: the Studio has no Postgres or Docker, and agents must not touch real Supabase.
- Choice: devDependencies @electric-sql/pglite 0.5.8 and @electric-sql/pglite-pgvector 0.0.9 (free, Apache-2.0; pinned to August releases, not this week's). apps/api/test/migrations.test.ts applies every migration in order.
- Alternative: Supabase CLI local stack (needs Docker).
- Why: real Postgres plus pgvector in-process, no services.
- To reverse: delete the test and the two devDependencies.
### 2026-10-17: Knowledge ingest chunking and embedding text
- Status: DECIDED (review when you can)
- Branch: claude/knowledge-ingest
- Context: spec §2.3 says split long passages and embed each chunk, without sizes.
- Choice: chunks up to 1500 characters (about 350 tokens), split at paragraph, then sentence, then word, with 200 characters of overlap. Embedded text is the chunk plus "Take: <Evan's take>" when there is one, so Evan's reading of a passage helps it get found. Tags are lowercased. A bad entry fails the whole export rather than ingesting part of a book. Ingest is a script (`apps/api/scripts/ingest-knowledge.ts`), not an endpoint, so no new auth surface.
- Alternative: embed passage only; token-based chunking with a tokenizer dependency.
- Why: FieldCopy passages are mostly short; this keeps one idea per chunk with no new dependency.
- To reverse: CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS and embedText in apps/api/src/knowledge-ingest.ts.
### 2026-10-18: Plan assembler: no athlete scaling beyond template choice
- Status: DECIDED (reversible, review when you can)
- Branch: claude/plan-assembler
- Context: doc 07 v2 §6.1 step 4 says "apply current_weekly_km to scale durations" but gives no formula; any formula is a coaching call.
- Choice: the athlete's weekly km only picks the template (its `weekly_volume_range_km`); workouts use the template's minutes as written, with the template's own `week_load_percent`. Load percent scales continuous steps only, never interval reps or durations. Race must fall in the final week; nothing is scheduled on or after race day. Matching ties go to the highest version.
- Alternative: linear scaling within the template's range (for example 0.9x at the bottom, 1.1x at the top), clamped. Easy to add in `assemblePlan`; needs a coach's view on whether interval work should scale.
- Why: keeps every number traceable to a reviewed template (CLAUDE.md §6.3).
- To reverse: add a scale factor to `scaleStructure` calls in `packages/plan-engine/src/assembler.ts`.

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

### 2026-10-17: Driver record definitions for the posture engine
- Status: DECIDED (review when you can)
- Branch: claude/driver-record
- Context: doc 07 v1 §8.2 (driver computation) is not in the repo, so the night worker defined each driver.
- Choice:
  - Load = run moving minutes (same unit as the Load card). Rides etc. excluded. acwr = load_7d / (load_28d / 4), null until the oldest run in the 35-day fetch is 27+ days old, so new accounts do not read back-off (and no partial-window guess hides a comeback ramp).
  - Hard day = any run that is a Strava race/workout, or whose avg HR is at or above the athlete's own 80th percentile over 28 days (needs 5+ HR runs). Streak counts back from today, or from yesterday if nothing is recorded today.
  - Long effort = run of 90+ min moving time.
  - Sleep: last night's Oura score; delta vs mean of prior 7 nights (points); p25/p75 over prior 28 nights (needs 7+). Low night = below p25.
  - HRV delta in percent vs prior-7 avg; resting HR delta in bpm vs prior-7 avg.
  - race_in_next_7d stays null until a plan or race source exists, so taper cannot fire yet.
  - Oura fetch now pulls 29 days of daily_sleep (was 8) for the baselines.
- Why: these match what the dashboard cards already show, so the voice and the posture read the same numbers.
- To reverse: edit the constants at the top of apps/api/src/drivers.ts.
### 2026-10-17: Root package-lock.json synced with packages/posture
- Status: DECIDED
- Branch: claude/driver-record
- Context: main's root lockfile lacked @scora/posture, so `npm ci` failed in apps/api.
- Choice: ran `npm install` at the root and committed the 16-line lockfile change.
- Why: the routine's test command (`npm ci && npm test`) must work.
- To reverse: revert commit b289e96.
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
