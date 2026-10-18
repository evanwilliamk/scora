-- Plan tier schema (doc 07 v2 §4.2 to §4.5): template library, SCORA plan
-- columns on training_plans, WorkoutKit columns on scheduled_workouts, and the
-- named adaptation log. Keyed by athlete_id like the rest of the live API.
-- Nothing writes these yet; packages/plan-engine produces the rows.

create table if not exists plan_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null,                       -- e.g. 'run-half-marathon-12wk-regular'
  version text not null check (version ~ '^\d+\.\d+\.\d+$'),
  sport text not null check (sport in ('run', 'ride', 'swim', 'tri')),
  goal_type text not null,
  duration_weeks smallint not null check (duration_weeks between 1 and 52),
  experience_level text not null check (experience_level in ('first_timer', 'regular', 'competitive')),
  weekly_volume_range_km numrange not null,
  author text not null,
  status text not null default 'draft' check (status in ('draft', 'reviewed')),
  reviewed_by text,
  reviewed_on date,
  structure_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Athletes stay pinned to the version they started on, so every version is kept.
  unique (slug, version),
  check (status = 'draft' or (reviewed_by is not null and reviewed_on is not null))
);

alter table training_plans
  add column if not exists template_id uuid references plan_templates(id),
  add column if not exists coach_id uuid,
  add column if not exists goal_race_type text,
  add column if not exists goal_race_date date,
  add column if not exists weekly_volume_start_km numeric(6, 2);

-- A SCORA plan names its template; coach and external plans do not.
alter table training_plans drop constraint if exists training_plans_template_source_check;
alter table training_plans add constraint training_plans_template_source_check
  check ((source = 'scora_ai') = (template_id is not null));

-- At most one active SCORA plan per athlete.
create unique index if not exists training_plans_one_active_scora_idx
  on training_plans (athlete_id) where source = 'scora_ai' and current_status = 'active';

alter table scheduled_workouts
  add column if not exists workout_structure_json jsonb,
  add column if not exists workout_kit_pushed_at timestamptz;

-- Downgrade targets from the adaptation rules (doc 07 v2 §6.2).
alter table scheduled_workouts drop constraint if exists scheduled_workouts_planned_intensity_check;
alter table scheduled_workouts add constraint scheduled_workouts_planned_intensity_check
  check (planned_intensity in ('easy', 'moderate', 'hard', 'tempo', 'threshold', 'intervals', 'long', 'recovery',
    'rest', 'endurance', 'steady_state'));

create table if not exists plan_adaptations (
  id uuid primary key default gen_random_uuid(),
  athlete_id text not null,
  training_plan_id uuid not null references training_plans(id) on delete cascade,
  scheduled_workout_id uuid not null references scheduled_workouts(id) on delete cascade,
  adaptation_type text not null check (adaptation_type in
    ('moved', 'downgraded', 'skipped', 'substituted', 'frozen_race_week')),
  original_date date,
  new_date date,
  original_workout_json jsonb,
  new_workout_json jsonb,
  reason_code text not null,                -- machine-readable, e.g. 'posture_rest_hard_scheduled'
  reason_text text not null check (length(trim(reason_text)) > 0), -- never silent (CLAUDE.md §6.2)
  engine_version text,                      -- e.g. 'adaptation-v1.0.0'
  triggered_by text not null check (triggered_by in ('auto_engine', 'coach_manual', 'athlete_manual')),
  triggered_at timestamptz not null default now(),
  dismissed_at timestamptz,                 -- POST /plan/adaptations/{id}/dismiss
  check (adaptation_type <> 'moved' or (original_date is not null and new_date is not null and new_date <> original_date))
);

create index if not exists plan_adaptations_athlete_time_idx on plan_adaptations (athlete_id, triggered_at desc);

alter table plan_templates enable row level security;
alter table plan_adaptations enable row level security;
