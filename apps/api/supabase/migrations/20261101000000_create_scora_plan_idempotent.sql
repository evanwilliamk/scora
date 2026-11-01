-- create_scora_plan answers a repeat of the athlete's active setup with the
-- plan it already made. A double tap on "Build my plan", or a retry after a
-- dropped reply, used to replace the plan with a copy of itself, which lost
-- the athlete's done and missed marks and every named plan change. The check
-- runs under the per-athlete lock, so two submits arriving together also end
-- with one plan. Any change (race, date, template, version, weekly km) still
-- makes a new plan and replaces the old one. Otherwise unchanged from
-- 20261030010000_create_scora_plan_lock.sql (same signature).

create or replace function create_scora_plan(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_athlete text := p->>'athlete_id';
  v_template uuid;
  v_stored jsonb;
  v_plan uuid;
begin
  -- One plan change per athlete at a time (same key as replace_external_plan).
  perform pg_advisory_xact_lock(hashtext('scora.plan:' || v_athlete));
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
  select id, structure_json into v_template, v_stored from plan_templates
  where slug = p->'template'->>'slug' and version = p->'template'->>'version';
  -- A version is immutable: the same slug and version with different training
  -- content is an authoring error, never a silent swap. Review fields may
  -- move forward (draft to reviewed) without a new version.
  if (v_stored - 'status'::text - 'reviewed_by'::text - 'reviewed_on'::text) <> ((p->'template') - 'status'::text - 'reviewed_by'::text - 'reviewed_on'::text) then
    raise exception 'Template %@% changed without a version bump', p->'template'->>'slug', p->'template'->>'version';
  end if;
  update plan_templates
  set status = p->'template'->>'status', reviewed_by = p->'template'->>'reviewed_by',
      reviewed_on = (p->'template'->>'reviewed_on')::date, structure_json = p->'template', updated_at = now()
  where id = v_template and status <> p->'template'->>'status';

  -- The same setup again: the active plan it already made, untouched.
  select id into v_plan from training_plans
  where athlete_id = v_athlete and source = 'scora_ai' and current_status = 'active'
    and template_id = v_template
    and goal_race_type is not distinct from p->>'goal_race_type'
    and goal_race_date is not distinct from (p->>'goal_race_date')::date
    and start_date = (p->>'start_date')::date
    and end_date = (p->>'end_date')::date
    and weekly_volume_start_km is not distinct from (p->>'weekly_volume_start_km')::numeric
  limit 1;
  if v_plan is not null then
    return v_plan;
  end if;

  -- The new plan is the athlete's plan: an active SCORA or pasted plan is
  -- marked replaced (rows kept). Coach plans are refused before this runs.
  update training_plans set current_status = 'replaced', updated_at = now()
  where athlete_id = v_athlete and source in ('scora_ai', 'external') and current_status = 'active';

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
