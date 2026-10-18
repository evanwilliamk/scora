-- Store a SCORA-generated plan in one transaction (doc 07 v2 §6.1 steps 6 and
-- 7): pin the template version, mark any previous active SCORA plan
-- 'replaced' (rows kept), insert the plan and all its workouts upfront.
-- p is built by apps/api/src/plan-generate.ts from @scora/plan-engine output.

create or replace function create_scora_plan(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_athlete text := p->>'athlete_id';
  v_template uuid;
  v_plan uuid;
begin
  if jsonb_typeof(p->'workouts') <> 'array' or jsonb_array_length(p->'workouts') = 0 then
    raise exception 'No workouts to save';
  end if;

  -- Templates are immutable per version: insert once, reuse after.
  insert into plan_templates (slug, version, sport, goal_type, duration_weeks, experience_level,
    weekly_volume_range_km, author, status, reviewed_by, reviewed_on, structure_json)
  select t->>'slug', t->>'version', t->>'sport', t->>'goal_type', (t->>'duration_weeks')::smallint,
    t->>'experience_level',
    numrange((t->'weekly_volume_range_km'->>0)::numeric, (t->'weekly_volume_range_km'->>1)::numeric, '[)'),
    t->>'author', t->>'status', t->>'reviewed_by', (t->>'reviewed_on')::date, t
  from (select p->'template' as t) x
  on conflict (slug, version) do nothing;
  select id into v_template from plan_templates
  where slug = p->'template'->>'slug' and version = p->'template'->>'version';

  update training_plans set current_status = 'replaced', updated_at = now()
  where athlete_id = v_athlete and source = 'scora_ai' and current_status = 'active';

  insert into training_plans (athlete_id, source, template_id, goal_race_type, goal_race_date, start_date, end_date,
    weekly_volume_start_km)
  values (v_athlete, 'scora_ai', v_template, p->>'goal_race_type', (p->>'goal_race_date')::date,
    (p->>'start_date')::date, (p->>'end_date')::date, (p->>'weekly_volume_start_km')::numeric)
  returning id into v_plan;

  insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type, planned_intensity,
    planned_duration_min, source, workout_structure_json, raw_source_json)
  select v_athlete, v_plan, (w->>'scheduled_date')::date, p->>'planned_type', w->>'planned_intensity',
    (w->>'planned_duration_min')::smallint, 'scora_ai', w->'structure', w
  from jsonb_array_elements(p->'workouts') w;

  return v_plan;
end;
$$;
