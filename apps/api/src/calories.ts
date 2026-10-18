// Calorie engine (Plan tier, PRD §5.B.7): a burn estimate per activity that
// is better than a generic watch default, from body weight, duration, speed,
// elevation and, for rides, measured work. Estimates burn only; it never
// suggests what to eat (CLAUDE.md §11). Each estimate names its method and
// the inputs it used. No weight, no estimate. Off unless CALORIE_ENGINE=on.
//
// v1 leaves heart rate out: HR-based equations (Keytel 2005) need age and
// sex, which SCORA does not have.

export const caloriesEnabled = () => process.env.CALORIE_ENGINE === 'on';
export const CALORIE_ENGINE_VERSION = 'calories-v1.0.0';

export interface CalorieEstimate {
  activity_id: number | string;
  date: string;
  sport: string;
  kcal: number;
  method: 'acsm_running' | 'measured_work' | 'met_cycling';
  inputs: Record<string, number>;
}

const KCAL_PER_L_O2 = 5;

// ACSM equations, speed in m/min, grade = climb over distance (uphill only).
// Running (above ~134 m/min): VO2 = 3.5 + 0.2 x speed + 0.9 x speed x grade.
// Below that the walking equation holds (hiking pace on a trail "run"):
// VO2 = 3.5 + 0.1 x speed + 1.8 x speed x grade.
export const ACSM_RUNNING_MIN_SPEED = 134;

export function runningKcal(weightKg: number, distanceM: number, movingS: number, climbM = 0): number {
  const minutes = movingS / 60;
  const speed = distanceM / minutes;
  const grade = distanceM > 0 ? Math.max(0, climbM) / distanceM : 0;
  const vo2 = speed >= ACSM_RUNNING_MIN_SPEED
    ? 3.5 + 0.2 * speed + 0.9 * speed * grade
    : 3.5 + 0.1 * speed + 1.8 * speed * grade;
  return (vo2 * weightKg / 1000) * KCAL_PER_L_O2 * minutes;
}

// Compendium of Physical Activities, road cycling by speed (km/h).
export function cyclingMet(kmh: number): number {
  if (kmh < 16) return 4;
  if (kmh < 19) return 6.8;
  if (kmh < 22) return 8;
  if (kmh < 25.5) return 10;
  if (kmh < 30.5) return 12;
  return 15.8;
}

export function estimateCalories(a: any, weightKg: number | null | undefined): CalorieEstimate | null {
  if (!weightKg || weightKg < 30 || weightKg > 250) return null;
  const moving = Number(a.moving_time);
  const distance = Number(a.distance);
  if (!(moving > 0)) return null;
  const date = typeof a.start_date_local === 'string' ? a.start_date_local.slice(0, 10) : '';
  const base = { activity_id: a.id, date, sport: a.type };
  const climb = Number(a.total_elevation_gain) || 0;

  if (a.type === 'Run' && distance > 0) {
    return {
      ...base,
      kcal: Math.round(runningKcal(weightKg, distance, moving, climb)),
      method: 'acsm_running',
      inputs: { weight_kg: weightKg, distance_m: distance, moving_s: moving, climb_m: climb },
    };
  }
  if (a.type === 'Ride' || a.type === 'VirtualRide') {
    // Work done at the pedals in kJ is close to kcal burned (about 24% gross
    // efficiency cancels the 4.184 kJ per kcal).
    const kj = Number(a.kilojoules);
    if (kj > 0 && a.device_watts) {
      return { ...base, kcal: Math.round(kj), method: 'measured_work', inputs: { kilojoules: kj } };
    }
    if (distance > 0) {
      const kmh = (distance / 1000) / (moving / 3600);
      const met = cyclingMet(kmh);
      return {
        ...base,
        kcal: Math.round(met * weightKg * (moving / 3600)),
        method: 'met_cycling',
        inputs: { weight_kg: weightKg, moving_s: moving, avg_kmh: Math.round(kmh * 10) / 10, met },
      };
    }
  }
  return null;
}

// Every activity since `afterSec`, page by page (Strava returns oldest first
// with `after`, so one capped page could drop the newest).
export async function fetchActivitiesSince(token: string, afterSec: number, fetchImpl: typeof fetch = fetch, maxPages = 5): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchImpl(`https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${afterSec}&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Strava ${res.status}`);
    const batch = (await res.json()) as any[];
    out.push(...batch);
    if (batch.length < 200) break;
  }
  return out;
}
