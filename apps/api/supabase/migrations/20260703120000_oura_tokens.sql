-- Add Oura token storage so we can pull sleep + readiness and auto-refresh.
-- Oura returns expires_in (relative); we store an absolute unix-seconds expiry
-- to match the strava_expires_at convention.
alter table athletes
  add column if not exists oura_access_token text,
  add column if not exists oura_refresh_token text,
  add column if not exists oura_expires_at bigint; -- unix seconds (computed from expires_in)
