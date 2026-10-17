-- External training plans, starting with manual paste (doc 09 §1.4, PRD
-- 5.A.6). Shapes follow doc 07 v2 §4.3 and §4.4, keyed by athlete_id
-- (strava_id) like the rest of the live API rather than users.id, and without
-- the Plan-tier columns (templates, WorkoutKit) that nothing writes yet.

create table if not exists training_plans (
  id uuid primary key default gen_random_uuid(),
  athlete_id text not null,
  source text not null check (source in ('scora_ai', 'coach', 'external')),
  external_source text check (external_source in ('strava', 'runna', 'manual')),
  start_date date not null,
  end_date date not null,
  raw_text text, -- what the athlete pasted, kept for re-parsing
  current_status text not null default 'active'
    check (current_status in ('active', 'paused', 'completed', 'abandoned', 'replaced')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists training_plans_athlete_status_idx on training_plans (athlete_id, current_status);

create table if not exists scheduled_workouts (
  id uuid primary key default gen_random_uuid(),
  athlete_id text not null,
  training_plan_id uuid references training_plans(id) on delete cascade,
  scheduled_date date not null,
  planned_type text not null check (planned_type in ('run', 'ride', 'swim', 'strength', 'brick', 'other')),
  planned_intensity text check (planned_intensity in
    ('easy', 'moderate', 'hard', 'tempo', 'threshold', 'intervals', 'long', 'recovery', 'rest')),
  planned_duration_min smallint check (planned_duration_min is null or planned_duration_min between 1 and 1440),
  planned_distance_km numeric(6, 2) check (planned_distance_km is null or planned_distance_km > 0),
  planned_description text,
  source text not null check (source in ('scora_ai', 'coach', 'external_strava', 'external_runna', 'manual')),
  raw_source_json jsonb,
  athlete_completed boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_workouts_athlete_date_idx on scheduled_workouts (athlete_id, scheduled_date desc);

alter table training_plans enable row level security;
alter table scheduled_workouts enable row level security;

-- At most one active manual plan per athlete.
create unique index if not exists training_plans_one_active_manual_idx
  on training_plans (athlete_id) where external_source = 'manual' and current_status = 'active';

-- Replace an athlete's manual plan in one transaction: the old plan is marked
-- 'replaced' (rows kept), the new plan and its sessions are inserted. If any
-- insert fails, nothing changes. p_rows is the validated ParsedRow[] JSON.
create or replace function replace_manual_plan(p_athlete_id text, p_raw_text text, p_rows jsonb)
returns uuid
language plpgsql
as $$
declare
  v_plan_id uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No workouts to save';
  end if;

  update training_plans set current_status = 'replaced', updated_at = now()
  where athlete_id = p_athlete_id and external_source = 'manual' and current_status = 'active';

  insert into training_plans (athlete_id, source, external_source, start_date, end_date, raw_text)
  select p_athlete_id, 'external', 'manual', min((r->>'date')::date), max((r->>'date')::date), p_raw_text
  from jsonb_array_elements(p_rows) r
  returning id into v_plan_id;

  insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity,
    planned_duration_min, planned_distance_km, planned_description, source, raw_source_json)
  select p_athlete_id, v_plan_id, (r->>'date')::date, r->>'type', r->>'intensity',
    (r->>'duration_min')::smallint, (r->>'distance_km')::numeric, nullif(r->>'description', ''), 'manual', r
  from jsonb_array_elements(p_rows) r;

  return v_plan_id;
end;
$$;
