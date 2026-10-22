-- Calendar (iCal) import as a plan source (Q17 option B, 2026-10-22).
-- Strava has no planned-workout API, so athletes whose plan app publishes a
-- calendar feed can import it. Rows land in the same tables as a pasted plan.
--
-- One plan per athlete: a calendar import replaces a pasted plan or a SCORA
-- plan, and a paste replaces a calendar import, so the read never sees two
-- plans for the same day. Old plans are marked 'replaced', never deleted.

alter table training_plans drop constraint if exists training_plans_external_source_check;
alter table training_plans add constraint training_plans_external_source_check
  check (external_source in ('strava', 'runna', 'manual', 'ical'));

alter table scheduled_workouts drop constraint if exists scheduled_workouts_source_check;
alter table scheduled_workouts add constraint scheduled_workouts_source_check
  check (source in ('scora_ai', 'coach', 'external_strava', 'external_runna', 'manual', 'external_ical'));

drop index if exists training_plans_one_active_manual_idx;
create unique index if not exists training_plans_one_active_external_idx
  on training_plans (athlete_id) where external_source in ('manual', 'ical') and current_status = 'active';

-- Replace the athlete's active pasted or imported plan in one transaction.
-- p_rows is the validated ParsedRow[] JSON (plan-parse.ts).
create or replace function replace_external_plan(p_athlete_id text, p_external_source text, p_raw_text text, p_rows jsonb)
returns uuid
language plpgsql
as $$
declare
  v_plan_id uuid;
  v_row_source text;
begin
  v_row_source := case p_external_source when 'manual' then 'manual' when 'ical' then 'external_ical' end;
  if v_row_source is null then
    raise exception 'Unknown plan source %', p_external_source;
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No workouts to save';
  end if;

  -- A SCORA plan goes too, as create_scora_plan replaces an external one: the
  -- athlete follows one plan at a time. A coach's plan is never touched here.
  update training_plans set current_status = 'replaced', updated_at = now()
  where athlete_id = p_athlete_id and current_status = 'active'
    and (external_source in ('manual', 'ical') or source = 'scora_ai');

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

-- Kept for the app and API already calling it.
create or replace function replace_manual_plan(p_athlete_id text, p_raw_text text, p_rows jsonb)
returns uuid
language sql
as $$
  select replace_external_plan(p_athlete_id, 'manual', p_raw_text, p_rows);
$$;
