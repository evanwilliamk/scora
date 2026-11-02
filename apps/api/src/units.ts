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
// km stay as stored.
export function planDistanceValue(km: number, unit: DistanceUnit = distanceUnit()): number {
  return unit === 'mi' ? +(Number(km) / KM_PER_MI).toFixed(1) : Number(km);
}

// "13.1 mi" / "25.75 km": the exact string the read and the card show.
export function formatPlanDistance(km: number, unit: DistanceUnit = distanceUnit()): string {
  return `${planDistanceValue(km, unit)} ${unit}`;
}
