-- scora_due_deliveries: only the athletes whose morning push is due now, so
-- an idle scheduler tick is one request instead of reading every athlete's
-- preferences (2026-11-01). Same rules as dueDeliveries() in
-- apps/api/src/delivery.ts, on each athlete's local wall clock:
--   - the daily read is due from the set minute for p_window_minutes (120),
--     once per local date (last_daily_sent_on is the claim);
--   - the weekly review is due on Monday with the daily;
--   - a late set time keeps its window past local midnight, keyed by
--     yesterday's date, never once a later day was sent;
--   - a set time the spring-forward gap skips (02:30) is first reached at
--     03:00, and a repeated fall-back hour (01:30 twice) sends once, because
--     the claim already holds that date;
--   - a released claim (failed read) reads as not sent, so it is due again.
-- Athletes are those with a device; no preferences row means the defaults
-- (America/New_York, 06:00). A zone Postgres cannot read falls back to the
-- default, as the TypeScript does for one Intl cannot read.
-- Pages by athlete id: rows after p_after, at most p_limit (PostgREST's
-- max-rows is 1000). Optional: the scheduler falls back to reading every
-- athlete's preferences while this function does not exist.

create or replace function scora_delivery_zone(p_tz text)
returns text
language plpgsql
stable
as $$
begin
  if p_tz is null or length(p_tz) = 0 or length(p_tz) > 64 then
    return 'America/New_York';
  end if;
  perform now() at time zone p_tz;
  return p_tz;
exception when others then
  return 'America/New_York';
end;
$$;

create or replace function scora_due_deliveries(
  p_now timestamptz,
  p_window_minutes int default 120,
  p_after text default null,
  p_limit int default 1000
)
returns table (
  athlete_id text,
  timezone text,
  delivery_minute int,
  last_daily_sent_on text,
  last_weekly_sent_on text,
  local_date text,
  daily boolean,
  weekly boolean
)
language sql
stable
as $$
  with athletes as (
    select distinct d.athlete_id
    from device_tokens d
    where p_after is null or d.athlete_id > p_after
  ),
  prefs as (
    select
      a.athlete_id,
      coalesce(p.timezone, 'America/New_York') as tz,
      coalesce(p.delivery_minute, 360)::int as dm,
      p.last_daily_sent_on as ld,
      p.last_weekly_sent_on as lw
    from athletes a
    left join athlete_preferences p on p.athlete_id = a.athlete_id
  ),
  -- Each stored zone checked once, not once per athlete.
  zones as materialized (
    select z.tz, p_now at time zone scora_delivery_zone(z.tz) as lt
    from (select distinct tz from prefs) z
  ),
  clock as (
    select p.*, z.lt from prefs p join zones z on z.tz = p.tz
  ),
  parts as (
    select c.*,
      c.lt::date as d,
      (extract(hour from c.lt) * 60 + extract(minute from c.lt))::int as mi,
      extract(dow from c.lt)::int as wd
    from clock c
  ),
  due as (
    -- Today's window.
    select x.athlete_id, x.tz, x.dm, x.ld, x.lw, x.d as day,
      x.ld is distinct from x.d as daily,
      x.wd = 1 and x.lw is distinct from x.d as weekly
    from parts x
    where x.mi >= x.dm and x.mi < x.dm + p_window_minutes
    union all
    -- Yesterday's window running past local midnight.
    select x.athlete_id, x.tz, x.dm, x.ld, x.lw, x.d - 1 as day,
      x.ld is null or x.ld < x.d - 1 as daily,
      (x.wd + 6) % 7 = 1 and (x.lw is null or x.lw < x.d - 1) as weekly
    from parts x
    where not (x.mi >= x.dm and x.mi < x.dm + p_window_minutes)
      and x.mi + 1440 < x.dm + p_window_minutes
  )
  select u.athlete_id, u.tz, u.dm,
    to_char(u.ld, 'YYYY-MM-DD'), to_char(u.lw, 'YYYY-MM-DD'), to_char(u.day, 'YYYY-MM-DD'),
    u.daily, u.weekly
  from due u
  where u.daily or u.weekly
  order by u.athlete_id
  limit p_limit;
$$;
