-- Users table
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- Athletes table
create table athletes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  strava_id text unique,
  oura_id text unique,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- Activities table
create table activities (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  strava_activity_id text unique,
  activity_type text,
  duration_seconds int,
  distance_meters numeric,
  elevation_meters numeric,
  activity_date date,
  created_at timestamp default now()
);

-- Workouts table
create table workouts (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  workout_type text,
  duration_minutes int,
  intensity_level text,
  scheduled_date date,
  completed_at timestamp,
  created_at timestamp default now()
);

-- Health data (Oura, Apple Health)
create table health_data (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  data_type text, -- 'sleep', 'hrv', 'rhr', 'temperature'
  value numeric,
  recorded_date date,
  created_at timestamp default now()
);

create index on athletes(user_id);
create index on activities(athlete_id);
create index on workouts(athlete_id);
create index on health_data(athlete_id);
