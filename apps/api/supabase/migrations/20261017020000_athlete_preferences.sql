-- Per-athlete delivery preferences (doc 09 §1.4: time zone + morning
-- notification time, default 6 AM local) and push bookkeeping so each read
-- goes out once per local day.

create table if not exists athlete_preferences (
  athlete_id text primary key, -- strava_id, same key as device_tokens
  timezone text not null default 'America/New_York',
  delivery_minute smallint not null default 360 check (delivery_minute between 0 and 1439), -- minutes after local midnight
  onboarded_at timestamptz,
  last_daily_sent_on date,  -- athlete-local date of the last daily push
  last_weekly_sent_on date, -- athlete-local date of the last weekly push
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table athlete_preferences enable row level security;
