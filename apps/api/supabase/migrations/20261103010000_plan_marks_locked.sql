-- Done/missed marks and Watch sends in one locked call (review 2026-11-03).
-- The API checked the session was on the active plan, then updated it in a
-- second request filtered by plan id, not by status. A calendar refresh (or
-- paste, or plan setup) landing between the two moved the plan on, and the
-- mark or send went onto the replaced plan's row: the API answered OK, the
-- active plan showed nothing. Each function below takes the per-athlete plan
-- lock (the key replace_external_plan, refresh_ical_plan and
-- create_scora_plan use), so it runs wholly before or after a plan change,
-- and a refresh then carries the mark over. True when a row was changed.

create or replace function mark_scheduled_workout(p_athlete_id text, p_workout_id uuid, p_completed boolean, p_today date)
returns boolean
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext('scora.plan:' || p_athlete_id));
  update scheduled_workouts w set athlete_completed = p_completed, updated_at = now()
  where w.id = p_workout_id and w.athlete_id = p_athlete_id and w.scheduled_date <= p_today
    and exists (select 1 from training_plans p where p.id = w.training_plan_id and p.current_status = 'active');
  return found;
end;
$$;

create or replace function mark_workout_watch_sent(p_athlete_id text, p_workout_id uuid)
returns boolean
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext('scora.plan:' || p_athlete_id));
  update scheduled_workouts w set workout_kit_pushed_at = now(), updated_at = now()
  where w.id = p_workout_id and w.athlete_id = p_athlete_id
    and exists (select 1 from training_plans p where p.id = w.training_plan_id and p.current_status = 'active');
  return found;
end;
$$;
