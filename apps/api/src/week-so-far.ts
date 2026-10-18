// Week So Far (PRD §5.A.3): Monday to today in run minutes, as a mini visual
// plus one plain line. The line is built from the numbers in code, not by the
// LLM: every figure in it is one of the values shown, and it states, never
// advises.

export interface WeekDay {
  date: string; // local YYYY-MM-DD
  weekday: string; // 'Mon' ... 'Sun'
  run_min: number | null; // null for days still ahead
}

export interface WeekSoFar {
  days: WeekDay[];
  runs: number;
  total_min: number;
  last_week_to_date_min: number;
  line: string;
}

const DAY = 86_400_000;
const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function weekSoFar(activities: any[], today: string): WeekSoFar {
  const t = Date.parse(`${today}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 0 = Monday
  const monday = t - dow * DAY;
  const runs = activities.filter((a) => a.type === 'Run' && typeof a.start_date_local === 'string');
  const minutesOn = (date: string) =>
    runs.filter((a) => a.start_date_local.slice(0, 10) === date).reduce((s, a) => s + (a.moving_time || 0) / 60, 0);

  const days: WeekDay[] = NAMES.map((weekday, i) => {
    const date = iso(monday + i * DAY);
    return { date, weekday, run_min: i <= dow ? Math.round(minutesOn(date)) : null };
  });
  const thisWeek = runs.filter((a) => {
    const d = a.start_date_local.slice(0, 10);
    return d >= iso(monday) && d <= today;
  });
  const total = days.reduce((s, d) => s + (d.run_min ?? 0), 0);
  let last = 0;
  for (let i = 0; i <= dow; i++) last += minutesOn(iso(monday - 7 * DAY + i * DAY));
  last = Math.round(last);

  const n = thisWeek.length;
  let line = n === 0
    ? 'No runs yet this week.'
    : `${n} run${n === 1 ? '' : 's'}, ${total} min since Monday`;
  if (last > 0) line += n === 0 ? ` Last week had ${last} min by this point.` : `; ${last} min by this point last week.`;
  else if (n > 0) line += '.';
  return { days, runs: n, total_min: total, last_week_to_date_min: last, line };
}
