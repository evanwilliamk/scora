# Vendor budget: Strava, Oura, OpenAI

Reviewed 2026-11-04 by code reading and fakes only. No real service was called. Line numbers are for `apps/api/src` on `claude/vendor-budget-1104`.

**What binds first:** Strava's 15-minute limit, at the 101st athlete in one morning window. Nothing caches a Strava pull and no webhook or nightly pull exists yet (CLAUDE.md 8.4 asks for both), so every surface below asks Strava live.

## Strava

Assumption: the default limits are 100 requests per 15 minutes and 1000 per day, per application, as commonly documented. Not checked against this app's settings page, which may also show a lower athlete capacity. Windows turn on the clock's quarter hours, the day at 00:00 UTC.

| Surface | API calls | Where |
|---|---|---|
| Daily read | 1 (35 days), up to 5 only with 200+ activities per page | `index.ts:622`, `strava.ts:235` |
| Weekly read | 1 (15 days), same page rule | `index.ts:1374` |
| Chat query | 1 (56 days); 0 once capped (fixed) | `index.ts:318`, `index.ts:298` |
| Card expand | 0, reads the 10-minute snapshot | `index.ts:932` |
| Race prediction | 1 (60 days), on each Plan screen open with the flag on | `index.ts:1246`, `PlanView.swift:849` |
| Calories (flag off) | 2 | `index.ts:1278`, `index.ts:1284` |
| Scheduler tick | 0 itself; 1 per due read, 2 for an athlete on Monday (read and weekly) | `scheduler.ts:309`, `scheduler.ts:61` |
| Token refresh | +1 on any of the above when the token is near expiry (about 6 hours, so nearly every 06:00 read) | `strava.ts:133` |

| Limit | Athletes who reach it | How |
|---|---|---|
| 100 per 15 min, one morning send, all at the default 06:00 | **100** on time; 50 on a Monday | 1 call each, 2 on Monday. If token refreshes count (not documented either way), halve both |
| Same, within the 120-minute late window (`delivery.ts:10`) | **800**; past that the push is skipped | 8 windows at 100, retried every 15 minutes (`scheduler.ts:130`). Only 100 meet the 5-minute bar (doc 10) |
| 1000 per day, pushes only | **1000**; 500 on a Monday | |
| 1000 per day, realistic use | **about 330** | Estimate: push, one app open, one chat. The app also rereads after 3 hours (`DashboardView.swift:478`) |

**429 handling, before and after this review:**
- A pull that got a 429 said "not answering" correctly, but nothing held back the rest. Each remaining due athlete made a failing call, again every 15 minutes, spending the daily count. Fixed: after one 429 the process asks nothing until the window turns, or midnight UTC if the daily count is spent (`strava.ts:111`, `strava.ts:121`). One `vendor_limit` line is logged.
- A 429 or 5xx on the token refresh told the athlete to reconnect. Fixed: only a refused refresh does (`vendor-error.ts`).
- Nothing else retries Strava. The only repeat is the scheduler's 15-minute retry, capped by the late window.
- Still 401 on a transient failure, on purpose: the app shows the `error` sentence and does not read the status (`DashboardView.swift:881`), and chat's own 429 means the daily limit (`ChatView.swift:615`).

## Oura

Assumption: 5000 requests per 5 minutes, treated as per application (the worst reading). From memory of Oura's docs, not verified.

| Surface | API calls | Where |
|---|---|---|
| Daily read | 3, side by side | `oura.ts:261` to `oura.ts:263`, `index.ts:603` |
| Weekly read | 3 | `index.ts:1386` |
| Chat, card, prediction, calories | 0 | |
| Scheduler tick | 0 itself; 3 per due read, 6 on Monday | |
| Token refresh | +1 when near expiry | `oura.ts:164` |

| Limit | Athletes who reach it | How |
|---|---|---|
| 5000 per 5 min | **1666**; 833 on a Monday | Strava caps the send long before this, and 4 reads at a time (`scheduler.ts:170`) would not reach it in 5 minutes |

**429 handling:** nothing retries. A failed route leaves its values empty and the read goes on. It was silent, so a rate limit looked like a ring with no data: now one `Oura route failed` warning with the route and category. A 429 or 5xx on the refresh showed the connect prompt on a connected ring: fixed (`index.ts`, `loadOura`).

## OpenAI

Assumption for the limit: Tier 1, gpt-4o 30,000 tokens per minute. From memory, and the account's real tier was not checked. Prices are not assumed: see telemetry below.

| Surface | Model | Worst-case calls | Where |
|---|---|---|---|
| Daily read | gpt-4o | 2 (draft, validator retry); 0 with no drivers | `voice.ts:131`, `voice.ts:153` |
| Daily read, `KNOWLEDGE_RETRIEVAL=on` | text-embedding-3-small | +1 | `knowledge-retrieval.ts:131` |
| Daily read, `ADAPTATION_REASON_LLM=on` | gpt-4o-mini | +1 per session changed tomorrow, no retry | `plan-adapt.ts:168`, `adaptation-reason.ts:208` |
| Weekly read | gpt-4o | 2; 0 with no runs | `index.ts:1441` |
| Chat query | gpt-4o-mini | 2 | `index.ts:507`, `index.ts:537`, `cdv-check.ts:164` |
| Card expand | gpt-4o | 2 per tap, not cached; 0 for a static card | `index.ts:932` |
| Manual plan | gpt-4o-mini | 1, no retry | `plan-parse.ts:209` |
| Race prediction, calories | none | 0 | |
| WhatsApp why, more | gpt-4o | 2, not wired to any route yet | `whatsapp.ts:235` |
| Scheduler tick | | 0 itself; each due read is a daily or weekly read above | |

| Limit | Athletes who reach it | How |
|---|---|---|
| 30,000 tokens per minute | **about 200** in a 5-minute send | Estimate of 750 tokens per read gives 40 reads a minute; 4 at a time at about 3 seconds each is 80. Unreachable while Strava allows 100 per 15 minutes. Past it, reads fall back to the deterministic text and still count as delivered |

**Can a loop or failed validation multiply calls?** No unbounded loop exists. Validation retries once, then falls back, and a hard failure never retries. No SDK retries behind it. Two ways to re-buy a read were found and fixed:
- An empty completion passed every validator (nothing to catch) and went out as a blank read, which the scheduler then bought again every 15 minutes. It is now a failed call and the fallback (`voice.ts:73`).
- A device-token lookup failing after the read threw it away, up to 8 tries of 4 calls each in the late window. Tokens are now read first (`scheduler.ts:61`).

Three OpenAI wrappers had no timeout (embedding, reason, plan parse); a hung embedding held the read and a scheduler slot. All have one now.

**Per-user cost telemetry (CLAUDE.md 8.6):** it did not exist. `voice_emission` has `attempts` but no athlete, model or tokens, and plan parsing and embeddings logged nothing. Added one `llm_call` line per request through `llm-meter.ts`, retries and failures included, with surface, athlete, model, attempt, status and tokens. Dollars are not stored: multiply tokens by the price of the day. Sum one athlete from an exported log:

```
grep llm_call railway.log | grep -o '{.*}' | jq -s 'group_by(.athlete) | map({athlete: .[0].athlete, calls: length, prompt: (map(.prompt_tokens // 0) | add), completion: (map(.completion_tokens // 0) | add)})'
```

Not done: it is log lines only, not PostHog, and nothing alerts on it.

## Free-tier chat quota

Can a path spend a model call without counting? Yes, these:

| Path | Spends | Status |
|---|---|---|
| Quota lookup throws (missing column, DB error, 5 lost compare-and-swaps) | Uncounted calls for as long as it lasts | By design, fail-open (`index.ts:469`), tested. Logged as an error only |
| Validator retry | 2 calls for 1 count | By design |
| Refund after a timeout or a reply with no text | Possibly billed, count returned (`index.ts:514`) | By design; small |
| Read, weekly, card expand, manual plan | Not chat, so no quota at all, and no limit of any kind | **Open**, see below |

Two races checked and sound: the count is compare-and-swap (`usage.ts:84`), and the day never moves backwards. Plan's 30/day does not exist yet (Q30).

## Open questions and things left alone

1. **Nothing limits how often a route can be called, and routes trust `athleteId` until auth lands.** One script calling `/api/read` spends 2 gpt-4o calls per request and can spend Strava's whole day, which then takes the morning send down for everyone. Options: (A) keep each athlete's Strava pull for 15 minutes in memory and allow one generated read per athlete per few minutes; (B) store activities from webhooks and a nightly pull, as 8.4 specifies; (C) leave it and rely on Sign in with Apple. Recommendation: A now, ask Strava for a higher limit before beta, B before 300 athletes. A changes how fresh a read is, so it was not done unattended.
2. **`strava.ts:20` has a Strava client secret committed as the fallback value.** Not touched (secrets are Evan's). Recommendation: rotate it in Strava and remove the fallback, as `index.ts:95` already does.
3. **A database error on the Strava token lookup still says reconnect** (`strava.ts`, `getValidStravaTokenOnce`). Not a vendor limit, so left.
4. **The cooldown is per process.** A second API instance would keep asking until its own 429.
