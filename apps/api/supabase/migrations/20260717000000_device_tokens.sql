-- APNs device tokens for push delivery (the free-tier daily doorbell, §5.1).
-- Keyed by our athlete id (strava_id). One row per device; unique on token so
-- re-registration upserts rather than duplicating.
create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  athlete_id text not null,
  token text not null unique,
  platform text not null default 'ios',
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create index if not exists device_tokens_athlete_idx on device_tokens(athlete_id);
