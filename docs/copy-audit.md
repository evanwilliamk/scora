# Copy audit: fixed athlete-facing strings (2026-11-03)

Branch: `claude/copy-audit-1103` (from `claude/integration-2026-10-28`).
Scope: strings that are NOT LLM output and can reach the athlete. LLM prompts, log lines, SQL and developer validation errors were read only to sort them out of scope.

Rules checked: no prescriptive workout language in voice surfaces, no SCORA-as-coach, no exclamation points, no emoji, no fitness-bro words, no clinical claims, no sycophancy, calm short plain sentences, no em dashes in copy.

## Counts

| Area | Strings checked |
| --- | --- |
| iOS (`apps/ios/Scora`): Text, labels, alerts, accessibility labels, error lines, demo data, Info.plist usage text | 286 (196 multi-word, 89 one or two word labels, 1 plist) |
| API (`apps/api/src`): `error` sentences the app shows, fallback reads, card bodies, adaptation reason templates, WhatsApp replies, push titles and bodies, OAuth result pages | 152 (107 sentences, 45 labels and chart titles) |
| Packages: voice pattern templates (`packages/voice/patterns`), plan-engine workout description fragments | 21 (12 templates, 9 fragments) |
| Total | 459 |

Automated scans across all three areas: 0 emoji, 0 exclamation points in copy, 0 em dashes in athlete-facing strings (the em dashes found are in LLM prompts, regexes, test names and developer errors), 0 hits for "you should", "you need to", "do an easy", "run a", "go for a", "take a rest day", "medical", "diagnose", "prescribe", fitness-bro words or sycophancy phrases.

## Changes

None. No string met the bar for a clear violation, so nothing was edited.

| file:line | before | after | rule |
| --- | --- | --- | --- |
| (none) | | | |

Uses of "coach" found are all allowed by CLAUDE.md §4.2: "Your coach sets your plan." (`apps/api/src/plan-generate.ts:95`, Coach tier UX), "Plans come from coach-reviewed templates" (`apps/ios/Scora/PlanView.swift:529`), the landing page line "Connect a real coach when you're ready" and the `{{coach_name}}` voice templates (third person). "Your plan has a rest day today." (`apps/api/src/plan-read.ts:91`) and "Made a rest day" (`PlanView.swift:178`) are descriptive, not imperative.

## Borderline, left for Evan

1. `packages/voice/patterns/plan-says-hard-body-says-back-off.yaml` template: "A call worth thinking about consciously." It does not prescribe, but it invites the athlete to second-guess the plan, which sits close to §1.3 (voice never overrides the plan). Option: "The plan and the body read differently this morning." Voice library copy, so left as is.
2. `packages/voice/patterns/plan-says-rest-body-agrees.yaml`: "the body's cashing the check." Idiom is a little casual for §3.7. Option: "and the body agrees."
3. Six API error sentences end "Please reconnect Strava." or "Please reconnect Oura." and pass the app's `APIErrorText.isForAthlete` filter, so they show on screen: `apps/api/src/index.ts:294, 568, 990, 1354` ("Strava not connected or refresh failed. Please reconnect Strava."), `apps/api/src/strava.ts:154, 157`, `apps/api/src/oura.ts:154`, `apps/api/src/usage.ts:101`. "refresh failed" is developer wording and "Please" is off the plain style. Option: "Strava is not connected right now. Reconnect it to load your read." Left because it sits next to the auth flow.
4. `apps/ios/Scora/PlanView.swift:571` shows the server `error` from plan build without the `APIErrorText` filter, so a developer line such as "experience_level must be one of ..." (`apps/api/src/plan-generate.ts:64-73`) could reach the screen if the app ever sent a bad value. Code change, not copy.
5. Slot rendering, not copy: `packages/voice/test/render.test.ts` shows "HRV down -9%". Templates that say "HRV down {{hrv_pct_change}}%" or "{{hrv_pct_change}}% below baseline" read as a double negative if the caller passes a signed value. Worth a check where the slot is filled.
6. Minor consistency: "Saving...", "Paste plan here...", "Opening SCORA..." use three dots while "Reading…" and "Building…" use the ellipsis character.
