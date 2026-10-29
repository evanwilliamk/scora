# DECISIONS.md

Decision log for agent work on SCORA. Product decisions from April 2026 live in `01_SCORA_90-Day_Execution_Plan_v1_4.md` §8. Newest first.

### 2026-10-22: Dismissing a plan change (doc 07 v2 §5)
- Status: DECIDED (reversible)
- Branch: claude/dismiss-adaptation
- Context: doc 07 specifies POST /plan/adaptations/{id}/dismiss and the column existed, but nothing set it.
- Choice: `POST /api/plan/adaptations/:id/dismiss` (off with `PLAN_ADAPTATIONS`), only the athlete's own change and only once; an x on each change in Your Plan. A dismissed change leaves the list and the morning read's plan-change context; the change itself stays in the plan and in the table. Like the other plan routes it trusts `athleteId` until Sign in with Apple.
- To reverse: the route in `index.ts`, `dismiss` in both adapt stores, the button in `PlanView.swift`.

### 2026-10-22: Marking past sessions done or missed (CLAUDE.md §6.2)
- Status: DECIDED (reversible; copy is yours)
- Branch: claude/missed-workouts
- Context: §6.2 and PRD 5.B say missed workouts are acknowledged by the athlete and never auto-rescheduled; nothing let the athlete acknowledge one.
- Choice: `GET /api/plan` also returns `recent`, the last 7 days' sessions with no mark yet (rest days left out). `POST /api/plan/workouts/:id/status` with done or missed sets `athlete_completed`, only for the athlete's own active-plan sessions on or before today. Your Plan shows them under "Past sessions" with Done and Missed. A miss is recorded only: nothing moves (the engine adapts only future sessions). Not flagged: it applies to pasted and imported plans too. The buttons read Completed and Missed ("Done" already closes the sheet). After review: the app's date must be within a day of the server's; a calendar refresh keeps marks on sessions it brings back unchanged; the Supabase update re-checks the plan and date.
- Not done: matching Strava runs to sessions automatically (athlete_completed_activity_id).
- To reverse: the route and the `recent` list in `index.ts`, `markCompleted` in `plan-store.ts`, the section in `PlanView.swift`.

### 2026-10-22: Sunday review names how the week tracked against the plan
- Status: DECIDED (reversible; prompt wording is yours)
- Branch: claude/weekly-plan-aware
- Context: the weekly review ignored the athlete's plan, though pattern plan-adherence-strong-week exists for it.
- Choice: when the plan has run minutes in the 7 complete local days before today (so a Sunday-morning review never counts Sunday's long run as missed), and every run in them has a duration, the review gets one driver, "Plan this week: 135 of 190 planned run min" (stored durations of run sessions vs Strava run minutes). The prompt lets it state this as a fact and forbids judging it or suggesting catching up or cutting back. No plan: nothing changes.
- Known gap: the review's other numbers use a rolling 7 days on server time; the plan line uses the athlete's local days.
- To reverse: the `weeklyPlanDriver` block in the /api/weekly route.

### 2026-10-22: WhatsApp doorbell core (pure pieces only)
- Status: DECIDED (reversible; reply copy is yours)
- Branch: claude/whatsapp-core
- Context: Phase 2 lists the WhatsApp doorbell (PRD §5.B.2). Sending needs a Twilio account (money) and opt-in copy (privacy), which wait on you.
- Choice: `apps/api/src/whatsapp.ts` with the morning message in the §3.3 shape, the bounded reply set (why, more, pause N, resume, stop, help; STOP synonyms such as unsubscribe and cancel; after review, width, emoji, zero-width and punctuation are ignored and a message that starts with stop, unsubscribe, opt out or revoke stops, while cancel, end and quit stop only on their own; anything else gets help), fixed replies for pause/resume/stop/help, and the Twilio webhook signature check tested against Twilio's documented example. "pause" alone is 3 days, at most 30. Nothing sends, stores a phone number or adds a route.
- The why and more prompts (doc 08 §5, §6) are built too (claude/whatsapp-expansions): 1 to 2 and 3 to 4 sentences on the read's own drivers, through generateValidatedVoice, so an invented number falls back. Prompt wording is yours.
- Next when you want it: Twilio sandbox credentials and the opt-in screen copy.
- To reverse: delete `apps/api/src/whatsapp.ts` and its test.

### 2026-10-22: Validator telemetry as structured log lines until PostHog exists
- Status: DECIDED (reversible)
- Branch: claude/validator-telemetry
- Context: doc 10 gates track the validator catch rate and banned-phrase hit rate (< 0.5%); PostHog needs an account and keys (blocked).
- Choice: one `telemetry {"event":"voice_emission",...}` log line per daily, weekly, card, chat and adaptation-reason emission: surface, attempts, fallback, caught, banned labels, unbacked count. No text, no health values (after review 4, the older validator warning lines also log only labels and a count, never the unbacked numbers). Countable from Railway logs now; the same call can forward to PostHog later. `npx tsx scripts/voice-gate-report.ts <log export>` (from apps/api) prints catch, fallback and banned rates per surface and checks the doc 10 banned-phrase bar (counted on drafts: an emission whose draft had any banned hit counts, even if the retry or fallback was clean).
- To reverse: `apps/api/src/telemetry.ts` and its `trackVoice` calls.

### 2026-10-22: Send to Watch (WorkoutKit scheduling), code half
- Status: DECIDED (reversible; needs your device try)
- Branch: claude/workoutkit-schedule
- Context: PLAN item "WorkoutKit scheduling to the Watch" needs a paired device to try; the code can be built and tested without one.
- Choice: `GET /api/plan` now returns each session's `workout_structure_json`. Your Plan shows "Send to Watch" on SCORA plan sessions the Watch can run as written (run or ride, with steps, today to 7 days out); it asks WorkoutScheduler for permission and schedules the session at 06:00 on its day (today after 06:00: a minute from now). Sending again replaces the earlier send of that session; when the Watch's scheduled list is full it says so. Pasted and imported plans have no steps, so they never show the button. Messages: "Sent to your Watch for Fri Oct 23." and three failure lines (copy is yours).
- Not yet known: whether WorkoutScheduler needs an extra Info.plist usage string on a real device; the first device try will say. DEBUG `-demo-plan-sessions` shows two sample sessions (screens/2026-10-22-send-to-watch.png).
- To reverse: the "Send to Watch" button in `PlanView.swift`; `WatchSend` in `WorkoutExport.swift`.

### 2026-10-22: Banned-phrase list brought in line with CLAUDE.md §4.1
- Status: DECIDED
- Branch: claude/banned-phrase-parity
- Context: a probe of every §4.1 ban found 8 misses ("go for an", "run an", "make today a rest day", "smarter/better than your coach", "replace your coach") and 3 false positives on history ("your last long run a week ago" read as "run a").
- Choice: added the missing bans; "run a/an" now counts as an order only when it is not part of a session name ("long run a week ago") or a span of time. After review: a clause that opens on a command verb (go, take, head, hit, try, jog, ease, keep, "do a", "run 30/easy/tempo...") is banned too; "the plan has you run a tempo" and "you have a rest day scheduled" pass. Review 3: dashes and parentheses start a clause too, stay/ride/skip/rest/start/just were added, and verbs that double as nouns or idioms (take, keep, hit, try, go) need a workout object, so "Keep in mind", "Hit rate" and "Plan today: run tempo" pass. A parity test lists one phrasing per ban plus the descriptive sentences that must pass.
- Why: false positives cost a retry or the plain fallback read; misses let prescriptive or anti-coach text through.
- To reverse: BANNED_PATTERNS in `apps/api/src/validator.ts`.

### 2026-10-22: Chat (CDV) replies get the driver-existence check
- Status: DECIDED (reversible)
- Branch: claude/cdv-driver-check
- Context: CDV replies only had the banned-phrase check. Their numbers were never checked, because the model's own METRIC lines served as the drivers, so an invented number with an invented METRIC line passed. CLAUDE.md §3.2 applies the rule to CDV, and doc 10 §6.1 says nothing is sent without passing validators or falling back.
- Choice: every number in the voice line and in each METRIC line (name, value, trend) must be a measured value in the data block sent to the model (dates, run names and weekday indexes do not count), or a small count (12 or under, followed by runs/weeks/days and similar) in the athlete's question. A time or pace (8:47) is one value, so its seconds back nothing else. A thousands separator reads as one number. When nothing survives, the reply says it could not be checked rather than claiming there is no data. The model is asked not to add, average or convert numbers, and to name days by weekday. The prompt also holds the read under pushback (CLAUDE.md §3.6): restate the data, never flip to agree. METRIC lines with unbacked numbers are dropped; an unbacked voice line becomes the plain fallback ("Here: ..."). The prompt now asks for numbers exactly as written in the data.
- On a catch, the model gets one retry with the violations named (as the daily read does): one more gpt-4o-mini call only when a reply fails, never counted against the athlete's 3 a day. Watch "CDV validator catch" warnings in the logs after deploy.
- To reverse: `checkCdvReply` call in the /api/cdv route (`apps/api/src/index.ts`).

### 2026-10-22: Rest posture with no move window drops the session to easy (Q19)
- Status: DECIDED (Evan silent 3 days on a bucket 2 question, reversible). Review flagged that CLAUDE.md §6.2 says rest + hard means move and insert rest; it is silent on no window, so this fills the gap, but you may prefer rest (option C) there
- Branch: claude/rest-no-window-downgrade
- Context: in a normal Tue/Thu/Sat-quality week every open day sits next to another hard day, so a rest-posture move found no window and the hard session stayed on the plan.
- Choice: option B. When no day can take it (no window, or every window breaks the volume band), the session becomes easy at the same duration, reason code `posture_rest_hard_no_window`, named reason ("...is now an easy run at the same 45 minutes. Today's posture reads rest, and no other day this week could take it."; worded so it is true whether adjacency, the volume band or race week blocked the move). Long runs are excluded: they stay as planned and the skip is logged, since a long run is the block cornerstone. Engine version bumped to adaptation-v1.2.0.
- Alternatives: A, leave it (hard session stays); C, skip it (drops about 15% of the week, breaks the 10% rule).
- To reverse: delete the fallback block at the end of `evaluateAdaptation` in `packages/plan-engine/src/adaptation-rules.ts` and the matching tests.

### 2026-10-22: Calendar (iCal) import as a plan source (Q17)
- Status: DECIDED (Evan silent 3 days on a bucket 2 question, reversible)
- Branch: claude/ical-plan-import
- Context: Strava API v3 has no planned-workout endpoint, so "Strava scheduled activities ingestion" cannot be built. Q17 recommended iCal import.
- Choice: option B, `POST /api/plan/ical`, off unless `ICAL_IMPORT=on`. The app fetches the athlete's feed and sends the .ics text; the server never fetches a URL (no SSRF surface, no stored feed link). No LLM: each VEVENT is a session, date from DTSTART (UTC times moved to the athlete's zone), type and intensity from plain keywords, and a duration or distance only when exactly one is written in the event's text; the rows then pass the same validator as a pasted plan. Repeating, cancelled and undated events are left out with a reason; past events are skipped quietly. One plan per athlete: a calendar import or a paste replaces the active pasted, imported or SCORA plan (as generating a SCORA plan already replaces an external one); a coach plan is never touched; old plans are marked replaced, never deleted. After review: a bare h:mm is read as a start time, never a duration; "rest" counts only in the event title; the event cap counts upcoming events only. The calendar text is not stored, only the kept rows.
- Alternatives: A, drop the item and rely on manual paste; an LLM transcription like manual paste (one more gpt-4o-mini call per import, more fields filled); server-side feed fetch with refresh (needs the feed URL stored, which is often a private link, and SSRF guards).
- Refresh (claude/ical-refresh): the app keeps the link on the phone and re-imports when Your Plan opens, at most every 12 hours, silently (a failure keeps the plan shown); a "Refresh from your calendar" button does it on demand; pasting a plan or signing out clears the link, which is stored per athlete. After review: a refresh asks the server to replace the plan only if it is still the calendar import (`refresh_ical_plan`, 409 otherwise), so a plan pasted here or on another device is never overwritten; a silent refresh stops if editing or a paste begins and never closes the editor. The server still never sees the link.
- Open for later: repeating events.
- To reverse: delete `apps/api/src/plan-ical.ts`, the route in `index.ts`, and migration `20261022000000_ical_plans.sql` (restores the manual-only unique index).

### 2026-10-22: Review round 4 leftovers: observed plan changes, HRV trend, Week So Far wording
- Status: DECIDED (reversible; the Week So Far line is copy, yours to change)
- Branch: claude/review4-leftovers
- Context: three findings left open on 2026-10-18.
- Choice: (1) The plan-override check lets a clause through when its only hits are "moved ... to" or "instead", it says the change happened ("is now", "was", "moved", "the plan"), every day and session word in it appears in one recorded plan change, and it has no advice cue (a clause opening on "moved" or "instead" counts as advice). Tightened after review: sharing one word was enough to let "The tempo is now yours to run Saturday instead." through. Everything else still fails. (2) HRV shows no trend when there is no week average, instead of "n/a wk". (3) Week So Far names the weekday it compares through ("95 min through Thursday last week") instead of "by this point", since today may not be over.
- Alternatives: (1) drop the override check when any plan change exists (too loose); (3) compare through yesterday.
- To reverse: `overrideIsObservation` in `apps/api/src/validator.ts`; the `through` line in `apps/api/src/week-so-far.ts`.

### 2026-10-18: Week So Far line is built in code, not by the LLM
- Status: DECIDED (reversible; copy is yours)
- Branch: claude/week-so-far
- Context: PRD §5.A.3 asks for a mini visual plus a "one-line voice" for the week so far.
- Choice: the line is a fixed sentence from the same numbers as the bars ("3 runs, 120 min since Monday; 95 min by this point last week."), so it costs no LLM call and cannot cite an unbacked number. Run minutes only (rides and swims not counted yet); planned minutes are not overlaid yet.
- Alternative: a short gpt-4o line through the voice validators, at one more call per read.
- Update 2026-10-22 (claude/week-planned): with a plan (pasted, imported or SCORA), each day carries its planned run minutes, drawn as a dashed outline behind the bar, and the line adds "Plan: 135 min through Thursday." Stored durations only; rest days and other sports count 0. No comparison or advice is added.
- To reverse: `apps/api/src/week-so-far.ts`.

### 2026-10-18: The read observes plan changes touching today
- Status: DECIDED (reversible)
- Branch: claude/read-sees-plan-changes (on claude/integration-2026-10-18)
- Context: CLAUDE.md §1.3 allows "Today's tempo was moved to Wednesday because..." in the voice, since the plan engine already decided.
- Choice: with `PLAN_ADAPTATIONS=on`, the read loads active-plan changes whose original or new date is today, adds each stored reason as a "Plan change" driver (so the voice may quote it and the validator accepts its numbers), and adds a PLAN CHANGE line telling the model it may observe the change, never argue with it, add to it or suggest another. Gives up after 2 s; never blocks the read.
- To reverse: remove the planChange block in POST /api/read.


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

### 2026-10-18: Plan generation route shape
- Status: DECIDED (reversible, review when you can)
- Branch: claude/plan-generate (on claude/plan-adapt-job)
- Context: doc 07 v2 §6.1 describes POST /plan/generate; no reviewed templates exist yet and Plan tier gating needs Stripe.
- Choice: `POST /api/plan/generate` behind `PLAN_GENERATION=on` (404 when off). Loads reviewed templates only. The race must fit the template from this week's Monday, otherwise `race_too_soon`; no match is `template_not_available`, never an improvised plan. Sessions before today are not stored. A new plan marks the active SCORA or pasted plan `replaced` (rows kept). The request must carry the athlete's local `today`. A template version is immutable: the same slug and version with different content is refused (review fields may move from draft to reviewed). Refused while a coach plan is active, with the copy "Your coach sets your plan." Triathlon sessions store `planned_type` 'other' until templates name a discipline per session. planned_description stays empty until the workout-description prompt exists.
- Why: everything a plan contains traces to a reviewed template (CLAUDE.md §6.1, §6.3).
- To reverse: `apps/api/src/plan-generate.ts` and migration `20261018020000_create_scora_plan.sql`.

### 2026-10-18: Adaptation reasons worded by gpt-4o-mini, checked in code
- Status: DECIDED (reversible); turning it on is NEEDS EVAN (small OpenAI cost per adaptation)
- Branch: claude/adaptation-reason-llm (on claude/plan-adapt-job)
- Context: CLAUDE.md §6.4 has the LLM write the adaptation reason ("Moved to Wednesday because you slept 5.5 hours last night"); until now the stored reason was a fixed sentence.
- Choice: behind `ADAPTATION_REASON_LLM=on` (default off) and only when adaptations are on. One gpt-4o-mini call per adaptation with the decided change, today's posture and the posture's drivers. Code rejects a line that names the wrong or an extra weekday (any case, short forms), names another session type, names the wrong posture, describes a signed driver in the wrong direction ("-12%" as "above"), spells a number out, cites a number not in the drivers, advises or asks, says "coach", runs past two sentences or 220 characters, or hits the banned-phrase validator (review fixes); then the fixed sentence is stored and the issues are logged. No retry.
- Prompt copy is yours to change (`apps/api/src/adaptation-reason.ts`, SYSTEM).
- To reverse: leave the flag off; nothing else changes.

### 2026-10-18: Inline chart-expansion: spans found in code, recorded values only
- Status: DECIDED (reversible, review when you can)
- Branch: claude/inline-charts (on claude/plan-adapt-job)
- Context: CLAUDE.md §3.4 makes every driver in the read tappable to a mini-chart (Plan tier). Nothing specified how words map to drivers or what the chart shows.
- Choice: behind `INLINE_CHARTS=on` (default off; Plan tier gating waits for Stripe). After validation, code links each driver's quoted value in the read (or its name: sleep, load, volume, HRV, resting HR) to a 28-day series: Strava run minutes and miles as rolling 7-day totals, so the newest point is the number the read cites (review fix; was per-day), and Oura nightly sleep, HRV and resting HR (nights with no value are left out, never filled in). One link per series, first mention. The chart marks the newest day and draws the average of the days before it. Oura sleep is now fetched for 29 days (was 9) so the chart can show a month. HealthKit-only athletes: the app now sends up to 28 dated nights (`claude/healthkit-nights`), and the API drops malformed days and implausible values instead of charting them.
- Alternative: the LLM marks driver spans in its output. Rejected: the spans would need validating anyway, and code finds them reliably on numeric-first text.
- To reverse: leave the flag off; the app shows plain text when `links` is absent.

### 2026-10-18: Race predictions v1: Riegel range from recent efforts
- Status: DECIDED (reversible); the formula is a coaching call worth a look
- Branch: claude/race-predictions (on claude/plan-adapt-job)
- Context: PRD §5.B.6 asks for a range from current fitness, plan progression, recent races and body state; it gives no formula.
- Choice: `GET /api/plan/prediction`, behind `RACE_PREDICTIONS=on`. Runs of 3 km or more from the last 8 weeks are projected to the race with Riegel (exponent 1.06); Strava-tagged races (timed start to finish) are used instead of training runs when any exist. The range spans the best three projections, never narrower than ±2%. No prediction without 3 qualifying runs, or without a long run of half the race distance (capped at 25 km). Every effort used is returned with the range. Plan progression and body state are not in v1.
- Alternatives: VDOT tables (Daniels), or a model fitted on HR and pace. Riegel is the simplest that is honest with a range.
- To reverse: constants in `apps/api/src/race-prediction.ts` (PREDICTION), versioned.

### 2026-10-18: Calorie engine v1: ACSM running, measured work or METs for rides
- Status: DECIDED (reversible, review when you can)
- Branch: claude/calorie-engine (on claude/plan-adapt-job)
- Context: PRD §5.B.7 lists weight, duration, HR, elevation and sport coefficients; no formula given. Burn only, never intake (CLAUDE.md §11).
- Choice: `GET /api/calories` (last 14 days), behind `CALORIE_ENGINE=on`. Runs: ACSM running equation with uphill grade from elevation gain. Rides: Strava kilojoules when from a real power meter (`device_watts`), else a Compendium MET by average speed. Swims and other sports: no estimate in v1. Weight from the Strava profile; no weight, no estimate. HR is left out: HR equations need age and sex, which SCORA does not have.
- Caveat: Strava sends weight only with `profile:read_all`; if the app's OAuth scope lacks it, nobody gets estimates until weight comes from HealthKit or onboarding.
- To reverse: `apps/api/src/calories.ts`, versioned.

### 2026-10-18: CDV daily quota resets at the athlete's midnight
- Status: DECIDED (reversible)
- Branch: claude/cdv-local-day (on claude/plan-adapt-job)
- Context: the 3 queries/day count reset at UTC midnight, which is mid-evening in the US (noted 2026-10-17).
- Choice: the app sends its local date with each CDV query; the server uses it when it is within a day of the server's date, and the stored quota day never moves backwards, so a changed phone clock buys at most one early reset. Without a date (older app builds) the UTC day is used as before.
- To reverse: drop `quotaDay(...)` from the `/api/cdv` call in `apps/api/src/index.ts`.

### 2026-10-18: WorkoutKit export copies the plan structure exactly
- Status: DECIDED (reversible)
- Branch: claude/workoutkit-export (on claude/plan-adapt-job)
- Context: Plan tier pushes today's session to Apple Watch (CLAUDE.md §5.2). WorkoutKit repeats a [work, recovery] block on every rep, which would add a recovery after the last rep that the template does not have.
- Choice: a leading warmup and trailing cooldown map to WorkoutKit's own; each interval step becomes reps - 1 [work, recovery] rounds plus one final work step, so the Watch total equals the plan's minutes; steady steps are single-step blocks. Run and ride only; swims are refused until the plan says pool or open water, and a warmup-only session keeps its step as a block (review fixes). No pace or heart-rate alerts yet (templates do not carry targets). Scheduling to the Watch is not wired: it needs a paired device to try.
- To reverse: `apps/ios/Scora/WorkoutExport.swift`.

### 2026-10-18: Plan adaptations run with the daily read, not a separate nightly cron
- Status: DECIDED (reversible, review when you can)
- Branch: claude/plan-adapt-job (on plan-schema + plan-assembler + driver-record)
- Context: doc 07 v2 §6.2 describes a nightly job, but posture needs HealthKit data, which only the app sends with the read request.
- Choice: when `/api/read` has decided today's posture and `PLAN_ADAPTATIONS=on`, tomorrow's workouts on the athlete's active SCORA plan go through `evaluateAdaptation`; changes are written by `apply_plan_adaptation` in one transaction. One automatic adaptation per workout (reruns and later reads that day change nothing). A displaced easy session becomes a rest day and is logged as `skipped` with its own reason. A downgrade replaces the structure with one continuous step at the same duration.
- Reason text is a fixed sentence built from the decision (for example "Thursday's tempo is now an endurance run at the same 40 minutes. Today's posture reads back-off."), checked against the banned-phrase list in tests. The gpt-4o-mini adaptation-reason prompt (CLAUDE.md §6.4) can replace it later; copy is yours.
- Review fixes: nothing adapts while a coach plan is active (CLAUDE.md §5.3); plans on draft templates never adapt in production; the week is re-read after each write so two sessions on one day cannot both move to the same day; the next Monday is fetched so a move to Sunday sees it; "today" falls back to the newest activity's UTC offset (the app does not send it yet), never the server's UTC day; the hook gives up after 4 s so a slow database cannot stall the read; `GET /api/plan/adaptations` is off with the flag. Like `/api/plan`, it trusts `athleteId` until Sign in with Apple lands.
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
  6. Review fixes: a workout labelled recovery, easy or endurance may not contain tempo, threshold or vo2max steps (strides, `sprint`, are allowed), because the adaptation engine reads only the label. A pattern with no sessions, or a `reviewed_on` that is not a real date, is refused. Several versions of one slug load side by side; the same slug and version twice is refused.
- Why: a bad template must fail at boot with a named rule, not while an athlete's plan is built.
- To reverse: `packages/plan-engine/src/template-loader.ts`, one check per block, each with a test.

### 2026-10-18: Plan adaptation rules, details the spec left open
- Status: DECIDED (reversible, review when you can)
- Branch: claude/plan-engine-adaptation
- Context: doc 07 v2 §6.2/§9 and CLAUDE.md §6.2 define the rules but not the move window, the volume unit or which plans adapt.
- Choice:
  1. A move stays inside the plan week (Mon to Sun) and lands on the first later day that is rest or a single easy/recovery session, with no hard day either side. The displaced easy session is dropped. If no day qualifies, no adaptation (logged `skip_no_window`).
  2. Weekly volume is measured in planned minutes (templates are duration-based). The ±10% guard blocks a change only if it leaves the week outside the band and further from the template than before; a downgrade (same duration) or a change that brings the week closer is never blocked. The week means Monday to Sunday; the caller also passes the next Monday so a move to Sunday never lands right before a hard session (review fix).
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

### 2026-10-28: Plan adherence counts an unmarked session as not done
- Status: DECIDED
- Branch: claude/plan-gates
- Context: doc 10 3.1.10 compares Strava activities to scheduled sessions, but activities are fetched live and never stored, so the SQL report can only use the athlete's done/missed marks.
- Choice: done = marked done; missed and unmarked both count against adherence; rest days left out; last 28 days up to yesterday (UTC); SCORA plans only.
- Alternatives: leave unmarked out of the denominator (flatters adherence when athletes stop marking); store activity dates to match them (needs a migration and a sync job).
- Why: a gate should not pass because nobody marks sessions. The unmarked column is shown so the cause is visible.
- To reverse: in apps/api/scripts/plan-gates.sql, divide by `done + missed` instead of `scheduled`.
