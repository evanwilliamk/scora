-- Plan content bars (doc 10 §6.2, CLAUDE.md §6.2) checked against what the
-- engine actually did to SCORA plans in the last 90 days. Read-only. Paste
-- into the Supabase SQL editor. One row per violation; no rows means every
-- bar held. Engine adaptations only (an athlete's or coach's own change is
-- theirs).
--   long_run_changed  a long session was downgraded or displaced
--   race_week         an adaptation in the 7 days before the goal race
--   weekly_volume     a plan week's planned minutes moved more than 10%
--   hard_days_cluster a moved hard session now sits next to another hard day
with params as (
  select (current_date - 90)::date as since
),
engine as (
  select a.*, p.goal_race_date
  from plan_adaptations a
  join training_plans p on p.id = a.training_plan_id
  cross join params
  where p.source = 'scora_ai' and a.triggered_by = 'auto_engine'
    and a.triggered_at >= params.since
),
long_changed as (
  select 'long_run_changed'::text as check_name, athlete_id, training_plan_id, original_date as day,
         adaptation_type as detail
  from engine
  where original_workout_json->>'planned_intensity' = 'long' and adaptation_type in ('downgraded', 'skipped')
),
race_week as (
  select 'race_week', athlete_id, training_plan_id, original_date, adaptation_type
  from engine
  where goal_race_date is not null and adaptation_type <> 'frozen_race_week'
    and original_date between goal_race_date - 7 and goal_race_date
),
-- Minutes each adaptation took out of or put into a Monday-start week.
moves as (
  select training_plan_id, athlete_id, date_trunc('week', original_date)::date as week,
         -coalesce((original_workout_json->>'planned_duration_min')::int, 0) as delta
  from engine
  where adaptation_type = 'skipped'
     or (adaptation_type = 'moved' and date_trunc('week', original_date) <> date_trunc('week', new_date))
  union all
  select training_plan_id, athlete_id, date_trunc('week', new_date)::date,
         coalesce((original_workout_json->>'planned_duration_min')::int, 0)
  from engine
  where adaptation_type = 'moved' and date_trunc('week', original_date) <> date_trunc('week', new_date)
),
week_delta as (
  select training_plan_id, athlete_id, week, sum(delta) as delta
  from moves group by training_plan_id, athlete_id, week
),
week_now as (
  select w.training_plan_id, date_trunc('week', w.scheduled_date)::date as week,
         sum(coalesce(w.planned_duration_min, 0)) as minutes
  from scheduled_workouts w
  where w.training_plan_id in (select training_plan_id from week_delta)
  group by w.training_plan_id, date_trunc('week', w.scheduled_date)
),
weekly_volume as (
  select 'weekly_volume', d.athlete_id, d.training_plan_id, d.week,
         round(100.0 * d.delta / nullif(coalesce(n.minutes, 0) - d.delta, 0), 1) || '% of the week'
  from week_delta d
  left join week_now n on n.training_plan_id = d.training_plan_id and n.week = d.week
  where abs(d.delta) > 0.1 * greatest(coalesce(n.minutes, 0) - d.delta, 0)
),
hard as (
  select id, training_plan_id, scheduled_date
  from scheduled_workouts
  where planned_intensity in ('hard', 'tempo', 'threshold', 'intervals', 'long')
),
hard_cluster as (
  select distinct 'hard_days_cluster', e.athlete_id, e.training_plan_id, e.new_date, 'moved next to another hard day'
  from engine e
  join hard h on h.id = e.scheduled_workout_id and h.scheduled_date = e.new_date
  join hard o on o.training_plan_id = h.training_plan_id and o.id <> h.id
    and abs(o.scheduled_date - h.scheduled_date) <= 1
  where e.adaptation_type = 'moved'
)
select * from long_changed
union all select * from race_week
union all select * from weekly_volume
union all select * from hard_cluster
order by 1, 2, 4;
