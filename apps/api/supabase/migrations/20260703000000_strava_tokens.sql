-- Add Strava token storage so we can auto-refresh instead of forcing re-auth every ~6h.
alter table athletes
  add column if not exists strava_access_token text,
  add column if not exists strava_refresh_token text,
  add column if not exists strava_expires_at bigint; -- unix seconds (Strava expires_at)
