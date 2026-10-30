-- Calendar refresh carries marks one-to-one (review 2026-10-30).
-- 20261022000000 joined old and new sessions on (date, type, description), so
-- two identical sessions on one day (one done, one missed) could both come
-- back with the same mark, and the Watch send time was dropped, so a
-- refreshed session could be sent to the Watch again.
--
-- Now old and new rows are paired by position within each (date, type,
-- description, planned duration) group, in the order the stores read them
-- (created_at, then id), and the done/missed mark and workout_kit_pushed_at
-- both carry over. Rows from one insert share created_at, so within a group
-- the order falls back to the random uuid: the duration is in the key so two
-- sessions that differ in length never pair with each other. Only true twins
-- (every key the same) are paired by position, and either pairing is right.

create or replace function refresh_ical_plan(p_athlete_id text, p_rows jsonb)
returns uuid
language plpgsql
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  perform pg_advisory_xact_lock(hashtext('scora.plan:' || p_athlete_id));
  select id into v_old from training_plans
  where athlete_id = p_athlete_id and external_source = 'ical' and current_status = 'active';
  if v_old is null then
    return null;
  end if;
  v_new := replace_external_plan(p_athlete_id, 'ical', null, p_rows);
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
