-- A calendar feed that names Runna is stored as external_source 'runna' with
-- rows 'external_runna' (PLAN.md Phase 2; both values are already allowed by
-- the checks in 20261022000000). It behaves exactly as an 'ical' plan: one
-- external plan per athlete, replaced by a paste, kept across a refresh.
--
-- Three things named only 'manual' and 'ical':
-- 1. the one-active-plan index, 2. replace_external_plan, 3. both versions of
-- refresh_ical_plan. A refresh keeps the plan's source from its first import.

drop index if exists training_plans_one_active_external_idx;
create unique index if not exists training_plans_one_active_external_idx
  on training_plans (athlete_id) where external_source in ('manual', 'ical', 'runna') and current_status = 'active';

create or replace function replace_external_plan(p_athlete_id text, p_external_source text, p_raw_text text, p_rows jsonb)
returns uuid
language plpgsql
as $$
declare
  v_plan_id uuid;
  v_row_source text;
begin
  perform pg_advisory_xact_lock(hashtext('scora.plan:' || p_athlete_id));
  v_row_source := case p_external_source when 'manual' then 'manual' when 'ical' then 'external_ical' when 'runna' then 'external_runna' end;
  if v_row_source is null then
    raise exception 'Unknown plan source %', p_external_source;
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No workouts to save';
  end if;

  update training_plans set current_status = 'replaced', updated_at = now()
  where athlete_id = p_athlete_id and current_status = 'active'
    and (external_source in ('manual', 'ical', 'runna') or source = 'scora_ai');

  insert into training_plans (athlete_id, source, external_source, start_date, end_date, raw_text)
  select p_athlete_id, 'external', p_external_source, min((r->>'date')::date), max((r->>'date')::date), p_raw_text
  from jsonb_array_elements(p_rows) r
  returning id into v_plan_id;

  insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity,
    planned_duration_min, planned_distance_km, planned_description, source, raw_source_json)
  select p_athlete_id, v_plan_id, (r->>'date')::date, r->>'type', r->>'intensity',
    (r->>'duration_min')::smallint, (r->>'distance_km')::numeric, nullif(r->>'description', ''), v_row_source, r
  from jsonb_array_elements(p_rows) r;

  return v_plan_id;
end;
$$;

create or replace function refresh_ical_plan(p_athlete_id text, p_rows jsonb)
returns uuid
language plpgsql
as $$
declare
  v_old uuid;
  v_new uuid;
  v_source text;
begin
  perform pg_advisory_xact_lock(hashtext('scora.plan:' || p_athlete_id));
  select id, external_source into v_old, v_source from training_plans
  where athlete_id = p_athlete_id and external_source in ('ical', 'runna') and current_status = 'active';
  if v_old is null then
    return null;
  end if;
  v_new := replace_external_plan(p_athlete_id, v_source, null, p_rows);
  with o as (
    select athlete_completed, workout_kit_pushed_at, scheduled_date, planned_type, planned_description, planned_duration_min,
      row_number() over (partition by scheduled_date, planned_type, planned_description, planned_duration_min order by created_at, id) as k
    from scheduled_workouts where training_plan_id = v_old
  ), n as (
    select id, scheduled_date, planned_type, planned_description, planned_duration_min,
      row_number() over (partition by scheduled_date, planned_type, planned_description, planned_duration_min order by created_at, id) as k
    from scheduled_workouts where training_plan_id = v_new
  )
  update scheduled_workouts w
  set athlete_completed = o.athlete_completed, workout_kit_pushed_at = o.workout_kit_pushed_at
  from n join o on n.scheduled_date = o.scheduled_date and n.planned_type = o.planned_type
    and n.planned_description is not distinct from o.planned_description
    and n.planned_duration_min is not distinct from o.planned_duration_min and n.k = o.k
  where w.id = n.id and (o.athlete_completed is not null or o.workout_kit_pushed_at is not null);
  return v_new;
end;
$$;

create or replace function refresh_ical_plan(p_athlete_id text, p_rows jsonb, p_keep_before date)
returns uuid
language plpgsql
as $$
declare
  v_old uuid;
  v_new uuid;
  v_cut date;
begin
  perform pg_advisory_xact_lock(hashtext('scora.plan:' || p_athlete_id));
  select id into v_old from training_plans
  where athlete_id = p_athlete_id and external_source in ('ical', 'runna') and current_status = 'active';
  if v_old is null then
    return null;
  end if;
  v_new := refresh_ical_plan(p_athlete_id, p_rows);
  if v_new is null or p_keep_before is null then
    return v_new;
  end if;
  select least(p_keep_before, min((r->>'date')::date)) into v_cut from jsonb_array_elements(p_rows) r;

  insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity,
    planned_duration_min, planned_distance_km, planned_description, source, raw_source_json, athlete_completed,
    workout_structure_json, workout_kit_pushed_at, created_at)
  select athlete_id, v_new, scheduled_date, planned_type, planned_intensity,
    planned_duration_min, planned_distance_km, planned_description, source, raw_source_json, athlete_completed,
    workout_structure_json, workout_kit_pushed_at, created_at
  from scheduled_workouts
  where training_plan_id = v_old and scheduled_date < v_cut;

  update training_plans n set start_date = least(n.start_date, o.start_date), updated_at = now()
  from training_plans o
  where n.id = v_new and o.id = v_old
    and exists (select 1 from scheduled_workouts where training_plan_id = v_new and scheduled_date < v_cut);
  return v_new;
end;
$$;
