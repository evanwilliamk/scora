// The distance unit the athlete reads plan sessions in (DECISIONS.md,
// 2026-11-02, Q32 B). Plans store km (scheduled_workouts.planned_distance_km);
// what the athlete sees is converted here, in one place, so a real per-athlete
// preference (Strava's measurement_preference: "feet" = mi, "meters" = km)
// can plug in later without touching the callers.

export type DistanceUnit = 'mi' | 'km';

export const KM_PER_MI = 1.609344;

// No preference is stored or fetched today, so every athlete reads miles,
// the same as every other distance driver in the read (metrics.ts).
export function distanceUnit(measurementPreference?: string | null): DistanceUnit {
  return measurementPreference === 'meters' ? 'km' : 'mi';
}

// A stored km value in the athlete's unit, as the number shown. Miles round to
// one decimal (13.1 mi stored as 21.08 km reads back as 13.1, 16 mi as 16);
// km stay as stored. A positive distance never reads as 0: under 0.1 it keeps
// two decimals, and nothing above zero shows less than 0.01 (the same rule as
// PlanDistance in the iOS app).
export function planDistanceValue(km: number, unit: DistanceUnit = distanceUnit()): number {
  const v = unit === 'mi' ? Number(km) / KM_PER_MI : Number(km);
  if (v > 0 && v < 0.1) return Math.max(0.01, +v.toFixed(2));
  return unit === 'mi' ? +v.toFixed(1) : v;
}

// "13.1 mi" / "25.75 km": the exact string the read and the card show.
export function formatPlanDistance(km: number, unit: DistanceUnit = distanceUnit()): string {
  return `${planDistanceValue(km, unit)} ${unit}`;
}
