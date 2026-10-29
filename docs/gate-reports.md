# Gate reports (doc 10)

How to measure the doc 10 gates with what exists today, before PostHog. Nothing here writes data.

## From the API logs

Export the Railway logs for the window (14 days for Phase 0, 21 for Phase 1) to a file, then from `apps/api`:

```
npx tsx scripts/voice-gate-report.ts <log-file>
npx tsx scripts/log-audit.ts <log-file>
```

`voice-gate-report.ts` exits 0 when every bar with data passes, 1 when one fails, 3 when the file has no telemetry lines. `log-audit.ts` exits 1 on any finding and prints line numbers and categories only, never the matched text.

| Gate | Bar | Source line | Report section |
|---|---|---|---|
| 1.1.1 Daily delivery on time | within 5 min of the set time, 13 of 14 mornings | `push_delivery` | Morning delivery |
| 1.1.2 Opened from the push | within 4 h, 12 of 14 mornings | `push_sent`, `push_open` | Opened within 4h |
| 1.1.3 / 2.1.4 Banned phrases | 0 in Phase 0, under 0.5% after | `voice_emission` | Banned-phrase hit rate |
| 1.1.4 Validator fail-throughs | 0 | `voice_emission.final_ok` | Validator fail-throughs |
| 1.1.6 No PHI in logs | none | every line | `log-audit.ts` |
| 1.1.7 Numbers first | every morning message | `push_sent.numeric_first` | Numeric-first |
| 2.1.5 Validator fallback rate | under 10% | `voice_emission` | fallback column |
| 2.1.8 Plan-aware reads | plan named on 60% of plan days, per athlete | `read_plan` | Plan named |

Morning gates judge each athlete's last 14 mornings. With fewer, a gate can already fail but shows NOT ENOUGH MORNINGS instead of passing. Mornings no phone accepted are left out of the open rate.

The open rate needs an app build with the push tap handler (`claude/phase0-gates`) and a server that sends the `scora` payload; older builds simply report no opens.

## From the database

Paste into the Supabase SQL editor. Both are read-only `select`s.

| File | Gates |
|---|---|
| `apps/api/scripts/phase1-gates.sql` | 2.1.1 ten athletes onboarded, 2.1.9 half used a chat chart. Edit `phase_start` first |
| `apps/api/scripts/plan-gates.sql` | 3.1.10 plan adherence 70%, 3.1.11 at most 2 adaptations per athlete per week, last 28 days |

Adherence uses the athlete's done/missed marks, since Strava activities are not stored; an unmarked session counts as not done (DECISIONS.md, 2026-10-28).

## Not covered yet

- Manual: 1.1.5 wow moment, 2.1.3 voice panel, 2.1.6 coach forwarding, 2.1.10 voice incidents, 3.1.12 plan complaints.
- Needs Twilio, Stripe or App Store data: 2.1.7, 3.1.2 to 3.1.8, 3.1.13.
- 3.1.9 WorkoutKit push success: the app does not report a Watch send to the API yet.
