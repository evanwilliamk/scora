# @scora/api

Fastify + TypeScript backend on Railway (runs via `tsx`, no build step).
Postgres on Supabase. Serves the free-tier interpretation layer: the daily
read, weekly review, dashboard cards, chat, and push delivery.

## Run

```bash
npm install
npm start        # tsx src/index.ts, listens on :3000
npm test         # node:test unit suite (validators + metrics)
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | Liveness JSON |
| GET  | `/`, `/privacy`, `/terms` | Marketing + legal pages |
| GET  | `/api/auth/strava` → `/callback` | Strava OAuth; stores tokens, deep-links back |
| GET  | `/api/auth/oura` → `/callback` | Oura OAuth; athlete id threaded via `state` |
| POST | `/api/read` | Today's Read + 6 dashboard cards. Body: `{ athleteId, health? }` |
| POST | `/api/weekly` | Sunday review + weekly stat tiles. Body: `{ athleteId }` |
| POST | `/api/cdv` | Chat-driven analysis. Body: `{ athleteId, message }`. 3/day free-tier cap |
| POST | `/api/register-device` | Store an APNs device token. Body: `{ athleteId, deviceToken }` |
| POST | `/api/push/test` | Send a test push to an athlete's devices |

All voice output (`/api/read`, `/api/weekly`, `/api/cdv`) passes the validators
in `validator.ts` before it is returned — see below.

## Data flow (free tier)

- **Strava** and **Oura** are pulled server-side via stored OAuth tokens
  (auto-refreshed). **HealthKit** is on-device, so the iOS client reads a
  summary and sends it in the `/api/read` body as `health`.
- Recovery source precedence for Sleep + Recovery cards: **Oura > Apple Health**.
  With neither, the cards show honest connect prompts — never fabricated numbers.
- `metrics.ts` turns activities (+ recovery summary) into cards + a driver list.
- `voice.ts` generates the read: LLM draft → validate → one retry with the
  violations fed back → deterministic driver-only fallback if it still fails.
- **Scheduler** (`scheduler.ts`): cron jobs push the daily read (6am) and weekly
  review (Mon 6am, `PUSH_TZ`). Idle until `APNS_*` env is set.

## The validators (`validator.ts`)

App-code enforcement of the voice rules (CLAUDE.md §3.2 / §4 / §8.5):
- **Banned-phrase**: coach self-reference, "you should/need to", workout
  imperatives, hype, exclamation points, emoji, clinical claims.
- **Driver-existence**: every number in the voice must trace to a real driver
  value. Fabricated figures are caught.

Covered by `npm test` (32 cases).

## Environment

Set in Railway → API service → Variables.

| Var | Status | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ✅ | DB access |
| `OPENAI_API_KEY` | ✅ | gpt-4o (reads), gpt-4o-mini (CDV) |
| `STRAVA_CLIENT_SECRET` | ✅ | Strava OAuth |
| `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET` | ✅ | Oura OAuth |
| `APNS_KEY_ID` | ⏳ pending | 10-char Key ID of the .p8 |
| `APNS_TEAM_ID` | ⏳ pending | Apple Team ID |
| `APNS_BUNDLE_ID` | ⏳ pending | e.g. `app.scora.Scora` |
| `APNS_KEY` | ⏳ pending | Full .p8 contents (BEGIN/END included) |
| `APNS_ENV` | ⏳ pending | `sandbox` for dev builds, `production` for TestFlight/App Store |
| `PUSH_TZ` | optional | Scheduler timezone (default `America/New_York`) |

Until the `APNS_*` vars are set, push endpoints return 503 and the scheduler
stays idle — everything else works.

## Migrations (`supabase/migrations/`)

Applied by hand in the Supabase SQL Editor (no CLI wired).

| File | Status |
|---|---|
| `..._init.sql`, `..._strava_tokens.sql`, `..._oura_tokens.sql` | ✅ applied |
| `..._cdv_usage.sql` | ⏳ pending — needed to *enforce* the 3/day chat cap (fail-open until then) |
| `..._device_tokens.sql` | ⏳ pending — needed before push device registration |
