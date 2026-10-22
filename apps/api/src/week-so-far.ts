// Week So Far (PRD §5.A.3): Monday to today in run minutes, as a mini visual
// plus one plain line. The line is built from the numbers in code, not by the
// LLM: every figure in it is one of the values shown, and it states, never
// advises.

export interface WeekDay {
  date: string; // local YYYY-MM-DD
  weekday: string; // 'Mon' ... 'Sun'
  run_min: number | null; // null for days still ahead
  planned_min?: number; // run minutes the athlete's plan has that day (only with a plan)
}

export interface WeekSoFar {
  days: WeekDay[];
  runs: number;
  total_min: number;
  last_week_to_date_min: number;
  planned_to_date_min?: number; // Monday through today, only with a plan
  line: string;
}

export const mondayOf = (day: string): string => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
};

// Planned run minutes per day from the plan's rows (rest days and other
// sports count 0). Only stored durations: nothing is estimated.
export function plannedRunMinutes(rows: { scheduled_date: string; planned_type: string; planned_intensity: string | null; planned_duration_min: number | null }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const min = r.planned_type === 'run' && r.planned_intensity !== 'rest' ? r.planned_duration_min ?? 0 : 0;
    out.set(r.scheduled_date, (out.get(r.scheduled_date) ?? 0) + min);
  }
  return out;
}

const DAY = 86_400_000;
const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function weekSoFar(activities: any[], today: string, planned?: Map<string, number>): WeekSoFar {
  const t = Date.parse(`${today}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 0 = Monday
  const monday = t - dow * DAY;
  const runs = activities.filter((a) => a.type === 'Run' && typeof a.start_date_local === 'string');
  const minutesOn = (date: string) =>
    runs.filter((a) => a.start_date_local.slice(0, 10) === date).reduce((s, a) => s + (a.moving_time || 0) / 60, 0);

  const days: WeekDay[] = NAMES.map((weekday, i) => {
    const date = iso(monday + i * DAY);
    return { date, weekday, run_min: i <= dow ? Math.round(minutesOn(date)) : null, ...(planned ? { planned_min: planned.get(date) ?? 0 } : {}) };
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
  // Last week through the same weekday, named, so the comparison says exactly
  // what it counts (today may not be over; last Wednesday was).
  const through = new Date(t).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  if (last > 0) line += n === 0 ? ` Last week had ${last} min through ${through}.` : `; ${last} min through ${through} last week.`;
  else if (n > 0) line += '.';
  // The plan's minutes through today, stated, never compared as advice.
  const plannedToDate = planned ? days.slice(0, dow + 1).reduce((s, d) => s + (d.planned_min ?? 0), 0) : undefined;
  if (plannedToDate) line += ` Plan: ${plannedToDate} min through ${through}.`;
  return { days, runs: n, total_min: total, last_week_to_date_min: last, ...(planned ? { planned_to_date_min: plannedToDate } : {}), line };
}
