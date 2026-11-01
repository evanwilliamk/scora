# Free-tier boundaries: API today vs CLAUDE.md §5.1

Status: 2026-11-01, branch `claude/free-tier-boundaries`. Tests only, no source changes. There is no tier column yet (Q30), so every athlete gets the same behavior; a feature flag, not a tier, decides each Plan-tier surface. Tests: `apps/api/test/free-tier-boundaries.test.ts` (names below drop the `free ` prefix). Route-by-route gating design: `docs/tier-gating-design.md`.

| Boundary | Spec (§5.1 / §5.2) | Current behavior | Test | Gap |
|---|---|---|---|---|
| CDV daily limit | Free 3/day; Plan ~30/day soft | 3/day for everyone (`FREE_CDV_DAILY_LIMIT`), 429 on the 4th with no model call; failed model calls are refunded | `cdv: the limit is 3 a day...` | Plan 30/day needs Q30. Quota lookup failing lets the query through (fail-open, by design): `cdv: a failed quota lookup...` |
| CDV reset | daily | Resets at the athlete's local midnight from the stored zone; the app's date only counts with no zone stored, and the day never moves back | `cdv: the count resets at the athlete's local midnight...` | None |
| History: read, CDV, weekly | Free 90 days; Plan unlimited | Strava pulled by date: read 35 days, CDV 56, weekly 15 (calories 14, flag off) | `history: the read, chat and weekly ask Strava...` | Matches the Free cap (all under 90). Nothing stores history, so "unlimited for Plan" does not exist yet (needs Q30 and storage) |
| History: Oura, HealthKit, charts | same | Oura at most 30 days back; HealthKit nights capped at 35; inline chart series 28 days | `history: Oura is asked for at most 30 days...` | Same as above |
| History: card expansion | same | Uses the last read's snapshot (35 days), no own pull | `expansion: with INLINE_CHARTS off...` | None |
| Sunday weekly read | Free 24h late; Plan Sunday morning | Push due Monday at the delivery time, never Sunday, for everyone | `weekly: the push is due Monday...` | Plan Sunday push needs Q30. **Gap:** `POST /api/weekly` has no weekday gate and the app's Weekly screen calls it on demand, so a Free athlete can read it Sunday: `weekly (gap): POST /api/weekly has no weekday gate...` |
| Card vs word-level expansion | Free card-level; Plan word-level links | `INLINE_CHARTS` off (default): no `links`/`series` in the read, card expand answers. On: every athlete gets word links | `expansion: with INLINE_CHARTS off...`, `expansion (gap, needs Q30)...` | Needs Q30 (already noted in DECISIONS.md) |
| WhatsApp doorbell | Plan only | Not built; `/api/whatsapp/inbound` is 404 | `scope: plan generation, adaptations...` | None today |
| Plan generation, adaptations | Plan only | `PLAN_GENERATION` / `PLAN_ADAPTATIONS` off: routes 404, the read never queries a SCORA plan or `plan_adaptations` | `scope: plan generation...`, `scope: the read never queries a SCORA plan...` | Turning a flag on opens it to everyone (needs Q30) |
| Race predictions, calorie engine | Plan only | `RACE_PREDICTIONS` / `CALORIE_ENGINE` off: 404 | `scope: plan generation...` | Same as above |
| WorkoutKit push | Plan only | `POST /api/plan/workouts/:id/watch-sent` has no flag and answers 200 for any athlete's active-plan session | `scope (gap): WorkoutKit watch-sent has no flag...` | **Gap:** the only Plan-tier route with no flag. A flag needs no tier column |
| Plan-aware read (plan source) | Free, from a connected plan source | A pasted session today becomes the `Plan today` driver and prompt line, with no Plan-tier `Today:` line. Manual paste is open | `plan-aware read: a pasted session today...`, `plan source: manual paste is open...` | **Gap:** iCal import is 404 unless `ICAL_IMPORT=on`, so a Free athlete with an iCal plan has no plan-aware read while the flag is off |

## Gaps that need no tier column (listed, not changed)

1. `POST /api/weekly` answers any day, so the 24h delay is only in the push. Options: refuse or serve the previous week before Monday, or accept it (the delay is a push timing only).
2. `watch-sent` (WorkoutKit) has no feature flag, unlike every other Plan-tier route.
3. iCal import, a Free plan source, is behind `ICAL_IMPORT`; check the flag is on in production.
