// The Sunday weekly review (PRD 5.A.5): helpers for the /api/weekly route.

import type { Driver } from './metrics';
import type { StoredWorkout } from './plan-store';
import { isRun } from './activity-types';
import { plannedRunMinutes } from './week-so-far';

const addDay = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// How the 7 complete days [from, to] tracked against the athlete's plan, as
// one driver ("150 of 150 planned run min"). Counted exactly as the Week So
// Far card counts (PRD 5.A.3): run minutes rounded per local day, then summed;
// planned minutes from plannedRunMinutes. So the Monday review of a
// Monday-to-Sunday week states the numbers Sunday's card showed. Null when
// the plan has no run minutes in the window, or a run with no stored
// duration makes them unknown (no driver that understates the plan).
export function weeklyPlanDriver(
  rows: Pick<StoredWorkout, 'scheduled_date' | 'planned_type' | 'planned_intensity' | 'planned_duration_min'>[],
  activities: any[],
  from: string,
  to: string,
): Driver | null {
  const planned = plannedRunMinutes(rows.filter((r) => r.scheduled_date >= from && r.scheduled_date <= to));
  const runs = activities.filter((a) => isRun(a) && typeof a.start_date_local === 'string');
  let plan = 0;
  let done = 0;
  for (let day = from; day <= to; day = addDay(day, 1)) {
    const p = planned.get(day);
    if (p === null) return null;
    plan += p ?? 0;
    done += Math.round(runs
      .filter((a) => a.start_date_local.slice(0, 10) === day)
      .reduce((s, a) => s + (a.moving_time || 0) / 60, 0));
  }
  if (plan <= 0) return null;
  // Complete days only (a Sunday-morning review must not count Sunday's run
  // as missed), named so the voice never reads it as the same week as Load.
  return { metric: 'Plan, last 7 full days', value: `${done} of ${plan} planned run min` };
}
