-- Users
create table public.users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  email text unique,
  display_name text,
  strava_athlete_id bigint unique
);

alter table public.users enable row level security;

create policy "Users can read own row"
  on public.users for select
  using (auth.uid() = id);

-- Strava tokens (never exposed to client)
create table public.strava_tokens (
  user_id uuid primary key references public.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  updated_at timestamptz default now()
);

alter table public.strava_tokens enable row level security;
-- No client-facing policies — service role only

-- Workouts imported from Strava
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  strava_activity_id bigint unique not null,
  sport_type text not null,            -- Run, Ride, Walk, etc.
  start_time timestamptz not null,
  duration_seconds int not null,
  distance_meters double precision,
  elevation_gain_meters double precision,
  average_heartrate double precision,
  max_heartrate double precision,
  average_watts double precision,       -- cycling power
  suffer_score int,                     -- Strava's own load proxy
  calories double precision,
  raw jsonb,                            -- full Strava payload for future use
  created_at timestamptz default now()
);

alter table public.workouts enable row level security;

create policy "Users can read own workouts"
  on public.workouts for select
  using (auth.uid() = user_id);

create index workouts_user_start on public.workouts(user_id, start_time desc);

-- Daily readiness scores
create table public.readiness_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  score_date date not null,
  score int not null check (score between 0 and 100),
  label text not null,                  -- "Ready to push", "Back off today", etc.
  recommendation text not null,
  why text not null,
  load_7d double precision,             -- rolling 7-day TRIMP
  intensity_yesterday double precision,
  consecutive_hard_days int,
  computed_at timestamptz default now(),
  unique(user_id, score_date)
);

alter table public.readiness_scores enable row level security;

create policy "Users can read own scores"
  on public.readiness_scores for select
  using (auth.uid() = user_id);

create index readiness_user_date on public.readiness_scores(user_id, score_date desc);
