-- Calendar refresh keeps the plan's past (review 2026-11-03).
-- The importer leaves out sessions dated before yesterday (plan-ical.ts), so
-- a refresh mid-week replaced the plan with one that started yesterday: the
-- earlier sessions of the week, with the athlete's done/missed marks and
-- Watch sends, dropped off the active plan (rows kept on the replaced plan,
-- but no longer read by the plan view, the daily read or the weekly read).
--
-- refresh_ical_plan(athlete, rows, keep_before) is a new version beside the
-- two-argument one (20261030000000, unchanged, kept for any caller still on
-- it). It does what that one does, then copies every old session dated before
-- keep_before (and before the first new row) onto the new plan unchanged,
-- marks and Watch send included, and starts the new plan where the old one
-- started. The API passes the athlete's yesterday, the importer's cut.

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
  where athlete_id = p_athlete_id and external_source = 'ical' and current_status = 'active';
  if v_old is null then
    return null;
  end if;
  -- Same lock key: re-entrant within this transaction.
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
