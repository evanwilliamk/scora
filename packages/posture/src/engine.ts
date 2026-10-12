// Deterministic posture engine (doc 07 v1 §8.3).
//
// Rules run in order; the first one that matches wins; steady is the default.
// Same inputs always give the same posture (PRD §5.D). A clause that needs a
// driver the user doesn't have is false: no data, no claim. A user with no
// connected data therefore reads steady.

import { POSTURE_ENGINE_VERSION, T } from './constants';
import type {
  Clause, Comparator, PostureDrivers, PostureResult, RuleId, RuleTrace, UserBaselines, Posture,
} from './types';

type Num = number | null | undefined;

function num(v: Num): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cmp(driver: string, value: Num, op: Comparator, threshold: Num): Clause {
  const a = num(value);
  const b = num(threshold);
  let met = false;
  if (a !== null && b !== null) {
    if (op === '>') met = a > b;
    else if (op === '>=') met = a >= b;
    else if (op === '<') met = a < b;
    else if (op === '<=') met = a <= b;
    else met = a === b;
  }
  return { driver, value: a, op, threshold: b, met };
}

function isTrue(driver: string, value: boolean | null | undefined): Clause {
  const v = typeof value === 'boolean' ? value : null;
  return { driver, value: v, op: '=', threshold: true, met: v === true };
}

const all = (cs: Clause[]) => cs.every((c) => c.met);
const any = (groups: Clause[][]) => groups.some(all);

interface Rule {
  id: Exclude<RuleId, 'default'>;
  evaluate(d: PostureDrivers, b: UserBaselines): { met: boolean; clauses: Clause[] };
}

const weeklyChronic = (d: PostureDrivers): number | null => {
  const l28 = num(d.load_28d);
  return l28 === null ? null : (l28 / 4) * T.taper.load_7d_vs_weekly_chronic;
};

const RULES: Rule[] = [
  {
    id: 'taper',
    evaluate(d) {
      const clauses = [
        isTrue('race_in_next_7d', d.race_in_next_7d),
        cmp('days_since_long_effort', d.days_since_long_effort, '<', T.taper.max_days_since_long_effort),
        cmp('load_7d', d.load_7d, '>', weeklyChronic(d)),
      ];
      return { met: all(clauses), clauses };
    },
  },
  {
    id: 'rest',
    evaluate(d, b) {
      const a = [
        cmp('consecutive_hard_days', d.consecutive_hard_days, '>=', T.rest.min_consecutive_hard_days),
        cmp('sleep_last_night_score', d.sleep_last_night_score, '<', b.sleep_score_p25),
      ];
      const c = [
        cmp('hrv_7d_avg_delta', d.hrv_7d_avg_delta, '<', T.rest.hrv_7d_avg_delta_below),
        cmp('rhr_7d_avg_delta', d.rhr_7d_avg_delta, '>', T.rest.rhr_7d_avg_delta_above),
      ];
      return { met: any([a, c]), clauses: [...a, ...c] };
    },
  },
  {
    id: 'back-off',
    evaluate(d) {
      const a = [cmp('acwr', d.acwr, '>', T.backOff.acwr_above)];
      const h = [cmp('consecutive_hard_days', d.consecutive_hard_days, '>=', T.backOff.min_consecutive_hard_days)];
      const s = [
        cmp('sleep_7d_avg_delta', d.sleep_7d_avg_delta, '<', T.backOff.sleep_7d_avg_delta_below),
        cmp('consecutive_low_sleep_nights', d.consecutive_low_sleep_nights, '>=', T.backOff.min_consecutive_low_sleep_nights),
      ];
      return { met: any([a, h, s]), clauses: [...a, ...h, ...s] };
    },
  },
  {
    id: 'moderate',
    evaluate(d) {
      const clauses = [
        cmp('acwr', d.acwr, '>', T.moderate.acwr_above),
        cmp('sleep_7d_avg_delta', d.sleep_7d_avg_delta, '<', T.moderate.sleep_7d_avg_delta_below),
        cmp('rhr_7d_avg_delta', d.rhr_7d_avg_delta, '>', T.moderate.rhr_7d_avg_delta_above),
      ];
      return { met: clauses.some((c) => c.met), clauses };
    },
  },
  {
    id: 'primed',
    evaluate(d, b) {
      const clauses = [
        cmp('acwr', d.acwr, '<', T.primed.acwr_below),
        cmp('sleep_last_night_score', d.sleep_last_night_score, '>', b.sleep_score_p75),
        cmp('consecutive_hard_days', d.consecutive_hard_days, '=', T.primed.max_consecutive_hard_days),
        cmp('hrv_7d_avg_delta', d.hrv_7d_avg_delta, '>=', T.primed.hrv_7d_avg_delta_min),
      ];
      return { met: all(clauses), clauses };
    },
  },
];

export function computePosture(drivers: PostureDrivers, baselines: UserBaselines = {}): PostureResult {
  const reasoning: RuleTrace[] = [];
  for (const rule of RULES) {
    const { met, clauses } = rule.evaluate(drivers, baselines);
    reasoning.push({ rule: rule.id, met, clauses });
    if (met) {
      return { posture: rule.id as Posture, rule: rule.id, engine_version: POSTURE_ENGINE_VERSION, reasoning };
    }
  }
  reasoning.push({ rule: 'default', met: true, clauses: [] });
  return { posture: 'steady', rule: 'default', engine_version: POSTURE_ENGINE_VERSION, reasoning };
}
