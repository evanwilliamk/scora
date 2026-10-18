-- Apply one plan adaptation in a single transaction (doc 07 v2 §6.2 step 4):
-- log the named adaptation, then change the workout. A move that displaces an
-- easy session also logs that session as 'skipped' with its own reason and
-- turns it into a rest day; the original rows live on in original_workout_json.
-- Returns the adaptation id, or null when the engine already adapted this
-- workout (one automatic adaptation per workout, so reruns are harmless).

create or replace function apply_plan_adaptation(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_athlete text := p->>'athlete_id';
  v_plan uuid := (p->>'training_plan_id')::uuid;
  v_workout scheduled_workouts%rowtype;
  v_displaced scheduled_workouts%rowtype;
  v_id uuid;
begin
  select * into v_workout from scheduled_workouts
  where id = (p->>'scheduled_workout_id')::uuid and athlete_id = v_athlete and training_plan_id = v_plan
  for update;
  if not found then
    raise exception 'Workout not on this athlete''s plan';
  end if;
  if exists (select 1 from plan_adaptations where scheduled_workout_id = v_workout.id and triggered_by = 'auto_engine') then
    return null;
  end if;

  insert into plan_adaptations (athlete_id, training_plan_id, scheduled_workout_id, adaptation_type,
    original_date, new_date, original_workout_json, new_workout_json, reason_code, reason_text, engine_version, triggered_by)
  values (v_athlete, v_plan, v_workout.id, p->>'type',
    v_workout.scheduled_date, (p->>'new_date')::date, to_jsonb(v_workout), p->'new_workout',
    p->>'reason_code', p->>'reason_text', p->>'engine_version', 'auto_engine')
  returning id into v_id;

  if p->>'type' = 'moved' then
    update scheduled_workouts set scheduled_date = (p->>'new_date')::date, updated_at = now() where id = v_workout.id;
    if p->>'displaced_workout_id' is not null then
      select * into v_displaced from scheduled_workouts
      where id = (p->>'displaced_workout_id')::uuid and athlete_id = v_athlete and training_plan_id = v_plan
      for update;
      if not found then
        raise exception 'Displaced workout not on this athlete''s plan';
      end if;
      insert into plan_adaptations (athlete_id, training_plan_id, scheduled_workout_id, adaptation_type,
        original_date, original_workout_json, reason_code, reason_text, engine_version, triggered_by)
      values (v_athlete, v_plan, v_displaced.id, 'skipped', v_displaced.scheduled_date, to_jsonb(v_displaced),
        'displaced_by_move', p->>'displaced_reason_text', p->>'engine_version', 'auto_engine');
      update scheduled_workouts
      set planned_intensity = 'rest', planned_duration_min = null, workout_structure_json = null, updated_at = now()
      where id = v_displaced.id;
    end if;
  elsif p->>'type' = 'downgraded' then
    update scheduled_workouts
    set planned_intensity = p->'new_workout'->>'planned_intensity',
        workout_structure_json = p->'new_workout'->'workout_structure_json',
        updated_at = now()
    where id = v_workout.id;
  else
    raise exception 'Unknown adaptation type %', p->>'type';
  end if;

  return v_id;
end;
$$;
