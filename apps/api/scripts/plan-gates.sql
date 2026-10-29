-- Plan tier gates (doc 10 §3.1), SCORA plans only, the last 28 days up to
-- yesterday:
--   3.1.10 plan adherence: at least 70% of scheduled sessions done
--   3.1.11 adaptation frequency: at most 2 per athlete per week
-- Read-only. Paste into the Supabase SQL editor. Strava activities are not
-- stored, so "done" is the athlete's own mark; an unmarked session counts as
-- not done. Rest days are left out. The last row (athlete_id = 'ALL') carries
-- the verdicts. Dates are the database's (UTC on Supabase).
with win as (
  select (current_date - 28)::date as from_day, (current_date - 1)::date as to_day
),
sessions as (
  select w.athlete_id,
         count(*) as scheduled,
         count(*) filter (where w.athlete_completed is true) as done,
         count(*) filter (where w.athlete_completed is false) as missed,
         count(*) filter (where w.athlete_completed is null) as unmarked
  from scheduled_workouts w
  join training_plans p on p.id = w.training_plan_id
  cross join win
  where p.source = 'scora_ai' and p.current_status = 'active'
    and w.scheduled_date between win.from_day and win.to_day
    and coalesce(w.planned_intensity, '') <> 'rest'
  group by w.athlete_id
),
adaptations as (
  select a.athlete_id, count(*) as adaptations
  from plan_adaptations a
  join training_plans p on p.id = a.training_plan_id
  cross join win
  where p.source = 'scora_ai' and a.triggered_by = 'auto_engine'
    and a.triggered_at >= win.from_day and a.triggered_at < win.to_day + 1
  group by a.athlete_id
),
per_athlete as (
  select s.athlete_id, s.scheduled, s.done, s.missed, s.unmarked,
         coalesce(a.adaptations, 0) as adaptations
  from sessions s left join adaptations a using (athlete_id)
),
rows as (
  select athlete_id, scheduled, done, missed, unmarked, adaptations,
         round(adaptations / 4.0, 2) as adaptations_per_week, null::text as verdict, 0 as sort
  from per_athlete
  union all
  select 'ALL', coalesce(sum(scheduled), 0), coalesce(sum(done), 0), coalesce(sum(missed), 0),
         coalesce(sum(unmarked), 0), coalesce(sum(adaptations), 0),
         round(coalesce(sum(adaptations), 0) / greatest(count(*), 1) / 4.0, 2),
         case when count(*) = 0 then '3.1.10 NO DATA; 3.1.11 NO DATA'
           else '3.1.10 adherence ' || round(100.0 * sum(done) / sum(scheduled), 1) || '% '
             || case when sum(done) >= 0.7 * sum(scheduled) then 'PASS' else 'FAIL' end
             || '; 3.1.11 ' || round(sum(adaptations) / count(*) / 4.0, 2) || ' adaptations per athlete per week '
             || case when sum(adaptations) <= 2 * 4 * count(*) then 'PASS' else 'FAIL' end
         end,
         1
  from per_athlete
)
select athlete_id, scheduled, done, missed, unmarked, adaptations, adaptations_per_week, verdict
from rows
order by sort, athlete_id;
