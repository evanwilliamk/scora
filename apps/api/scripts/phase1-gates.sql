-- Free tier alpha gates kept in the database (doc 10 §2.1), since the phase
-- start below (edit it; it defaults to 21 days ago):
--   2.1.1 at least 10 athletes completed onboarding
--   2.1.9 at least 50% of them made a chat chart (CDV) query
-- Read-only. Paste into the Supabase SQL editor. The CDV counter keeps only
-- the last day used (cdv_count is that day's count), so "made a query" means
-- a last use on or after the phase start with a count above 0: a failed
-- request is refunded (count lowered, date kept), so a date with a count of
-- 0 is not a query. Only the last day is kept, so an athlete whose last day
-- was all refunds is missed even if an earlier day had a real query. The other Phase 1 gates come from the logs
-- (scripts/voice-gate-report.ts) or are manual. Doc 10 counts only
-- tier = 'free'; there is no tier column yet, so every onboarded athlete counts.
with params as (
  select (current_date - 21)::date as phase_start
),
onboarded as (
  select p.athlete_id, p.onboarded_at
  from athlete_preferences p cross join params
  where p.onboarded_at is not null and p.onboarded_at >= params.phase_start
),
per_athlete as (
  select o.athlete_id, o.onboarded_at,
         coalesce(a.cdv_count_date >= params.phase_start and a.cdv_count > 0, false) as used_cdv
  from onboarded o
  cross join params
  left join athletes a on a.strava_id = o.athlete_id
)
select count(*) as onboarded,
       count(*) filter (where used_cdv) as used_cdv,
       '2.1.1 ' || count(*) || ' onboarded ' || case when count(*) >= 10 then 'PASS' else 'FAIL' end
       || '; 2.1.9 ' || case when count(*) = 0 then 'NO DATA'
            else round(100.0 * count(*) filter (where used_cdv) / count(*), 1) || '% used CDV '
              || case when count(*) filter (where used_cdv) * 2 >= count(*) then 'PASS' else 'FAIL' end end as verdict
from per_athlete;
