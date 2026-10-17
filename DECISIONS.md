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
  - Load = run moving minutes (same unit as the Load card). Rides etc. excluded. acwr = load_7d / (load_28d / 4), null until the oldest fetched run is 21+ days old, so new accounts do not read back-off.
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
