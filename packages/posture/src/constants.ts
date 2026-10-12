// Every posture threshold lives here (doc 07 v1 §8.4). Changing any value
// means bumping POSTURE_ENGINE_VERSION so stored postures stay explainable.

export const POSTURE_ENGINE_VERSION = 'posture-v1.0.0';

export const T = {
  taper: {
    max_days_since_long_effort: 5, // days_since_long_effort < 5
    load_7d_vs_weekly_chronic: 0.8, // load_7d > (load_28d / 4) * 0.8
  },
  rest: {
    min_consecutive_hard_days: 3, // >= 3 AND last night below user p25
    hrv_7d_avg_delta_below: -10, // hrv delta < -10 AND rhr delta > 4
    rhr_7d_avg_delta_above: 4,
  },
  backOff: {
    acwr_above: 1.5,
    min_consecutive_hard_days: 2,
    sleep_7d_avg_delta_below: -5, // AND consecutive_low_sleep_nights >= 2
    min_consecutive_low_sleep_nights: 2,
  },
  moderate: {
    acwr_above: 1.2,
    sleep_7d_avg_delta_below: -3,
    rhr_7d_avg_delta_above: 2,
  },
  primed: {
    acwr_below: 0.8, // AND last night above user p75, 0 hard days, hrv delta >= 0
    max_consecutive_hard_days: 0,
    hrv_7d_avg_delta_min: 0,
  },
} as const;
