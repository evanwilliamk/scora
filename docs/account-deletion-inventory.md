# Account deletion: where athlete data lives (prep for Q27, nothing built)

Status: waiting on Q27 (deleting real user data is Evan's call). Doc 10 §6.6 asks for deletion within 7 days; App Store guideline 5.1.1(v) asks for it in the app. This is the inventory a `DELETE /api/account` would work through, taken from `apps/api/supabase/migrations` as of 2026-10-29.

## Two keys

Older tables hang off `athletes.id` (uuid) and cascade from it. Every later table (device tokens from July, everything from October) keys by the Strava id as text (`athlete_id text`), with no foreign key to `athletes`, so they do **not** cascade and each needs its own delete.

## Tables holding an athlete's data

| Table | Key | What it holds | Removed by |
|---|---|---|---|
| `athletes` | `strava_id` | name, Strava and Oura access/refresh tokens, chat counter | delete the row (after revoking tokens, below) |
| `activities` | `athlete_id uuid` → `athletes.id` | stored activities (the live API never reads or writes these three tables) | cascade from `athletes` |
| `workouts` | `athlete_id uuid` → `athletes.id` | legacy | cascade from `athletes` |
| `health_data` | `athlete_id uuid` → `athletes.id` | legacy | cascade from `athletes` |
| `users` | `athletes.user_id` | email | delete when no other athlete row points at it; cascades to `athletes` |
| `device_tokens` | `athlete_id text` (Strava id) | APNs tokens | own delete |
| `athlete_preferences` | `athlete_id text` | time zone, delivery time, last-sent dates, onboarding | own delete |
| `training_plans` | `athlete_id text` | plans, pasted plan text (`raw_text`), goal race | own delete; cascades to `scheduled_workouts` and `plan_adaptations` |
| `scheduled_workouts` | `athlete_id text` | sessions, done/missed marks, Watch sends | cascade from `training_plans` (delete by `athlete_id` too, in case of orphans) |
| `plan_adaptations` | `athlete_id text` | engine changes and reasons | cascade from `training_plans` (same belt and braces) |
| `read_citations` | `athlete_id text` | which knowledge chunks a read used | own delete |

Shared content with no athlete data, left alone: `plan_templates`, `knowledge_sources`, `knowledge_chunks`.

## Outside the database

- **Strava**: revoke with `POST https://www.strava.com/oauth/deauthorize` (access token), before deleting the row.
- **Oura**: revoke the token through Oura's OAuth revoke endpoint (confirm the URL in Oura's API docs when building).
- **Railway logs**: log lines carry the athlete id (no PHI, per the log audit). They age out with Railway's log retention; nothing to delete per athlete, but the privacy text should say logs are kept for that period.
- **Supabase backups**: deleted rows stay in backups until they age out. Doc 10 says "completes within 7 days"; the privacy text should state the backup window.
- **PostHog / Sentry**: not set up yet. When they are, deletion should call their per-person delete APIs.
- **The phone**: the app clears its keychain token and local caches on delete, as sign-out does.

## Suggested order (one transaction for the database part)

1. Revoke Strava and Oura tokens (best effort, logged; a failed revoke does not block deletion).
2. In one transaction: `read_citations`, `plan_adaptations`, `scheduled_workouts`, `training_plans`, `athlete_preferences`, `device_tokens` by `athlete_id`; then `athletes` by `strava_id` (cascades the uuid tables); then `users` if orphaned.
3. Answer 204; the app signs out.

A Postgres function `delete_athlete(p_strava_id text)` keeps step 2 atomic, like `replace_manual_plan` does for plans, and can be tested on PGlite with every table seeded (a test that fails when a new athlete table is added without joining the function would keep this list honest).

## Blockers

- Q27 itself (Evan).
- Sign in with Apple: until a request carries a verified identity, any caller could delete any athlete by id. Deletion should ship with, or after, Sign in with Apple.
