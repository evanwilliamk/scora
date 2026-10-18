// SCORA plan generation (doc 07 v2 §6.1, CLAUDE.md §6.1). The athlete picks a
// goal race; the plan engine picks a reviewed template and assembles it; this
// module stores the result in one transaction (create_scora_plan, migration
// 20261018020000). No LLM is involved: plain-English workout descriptions
// come later, from the template values (CLAUDE.md §6.4).
// Off unless PLAN_GENERATION=on. Plan tier gating waits for the Stripe item.

import {
  assemblePlan, matchTemplate, startDateForRace,
} from '../../../packages/plan-engine/src/index';
import type { AssembledPlan, ExperienceLevel, PlanTemplate, Sport } from '../../../packages/plan-engine/src/index';
import { EXPERIENCE_LEVELS, SPORTS } from '../../../packages/plan-engine/src/index';

export const generationEnabled = () => process.env.PLAN_GENERATION === 'on';

export type GenerateErrorCode = 'bad_request' | 'template_not_available' | 'race_too_soon';

export class GenerateError extends Error {
  constructor(public code: GenerateErrorCode, message: string) {
    super(message);
    this.name = 'GenerateError';
  }
}

export interface GenerateRequest {
  sport: Sport;
  goal_type: string;
  experience_level: ExperienceLevel;
  current_weekly_km: number;
  goal_race_date: string;
}

export interface GenerateStore {
  // Returns the new plan id.
  createPlan(payload: CreatePlanPayload): Promise<string>;
}

export interface CreatePlanPayload {
  athlete_id: string;
  template: PlanTemplate;
  goal_race_type: string;
  goal_race_date: string;
  start_date: string;
  end_date: string;
  weekly_volume_start_km: number;
  planned_type: string;
  workouts: AssembledPlan['workouts'];
}

const DAY = 86_400_000;
const isoDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const mondayOf = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};

// scheduled_workouts.planned_type per template sport. Triathlon templates do
// not yet say which discipline each session is, so they store 'other'.
const PLANNED_TYPE: Record<Sport, string> = { run: 'run', ride: 'ride', swim: 'swim', tri: 'other' };

export function parseGenerateRequest(body: any): GenerateRequest {
  const bad = (m: string): never => {
    throw new GenerateError('bad_request', m);
  };
  if (!body || typeof body !== 'object') bad('Missing body');
  if (!SPORTS.includes(body.sport)) bad(`sport must be one of ${SPORTS.join(', ')}`);
  if (typeof body.goal_type !== 'string' || !body.goal_type.trim()) bad('goal_type is required');
  if (!EXPERIENCE_LEVELS.includes(body.experience_level)) bad(`experience_level must be one of ${EXPERIENCE_LEVELS.join(', ')}`);
  const km = Number(body.current_weekly_km);
  if (!Number.isFinite(km) || km < 0 || km > 500) bad('current_weekly_km must be a number from 0 to 500');
  if (!isoDay(body.goal_race_date)) bad('goal_race_date must be YYYY-MM-DD');
  return {
    sport: body.sport,
    goal_type: body.goal_type.trim(),
    experience_level: body.experience_level,
    current_weekly_km: km,
    goal_race_date: body.goal_race_date,
  };
}

// Match, assemble, store. `today` is the athlete's local date. Workouts dated
// before today are not stored (the plan may start earlier this week).
export async function generatePlan(
  athleteId: string,
  req: GenerateRequest,
  today: string,
  templates: PlanTemplate[],
  store: GenerateStore,
): Promise<{ planId: string; plan: AssembledPlan }> {
  const template = matchTemplate(templates, req);
  if (!template) {
    throw new GenerateError('template_not_available', 'No plan template fits that race and volume yet.');
  }
  const start = startDateForRace(template, req.goal_race_date);
  if (start < mondayOf(today)) {
    throw new GenerateError(
      'race_too_soon',
      `This ${template.duration_weeks}-week plan would have started ${start}. Pick a later race or a shorter plan.`,
    );
  }
  const plan = assemblePlan({ template, start_date: start, goal_race_date: req.goal_race_date });
  const workouts = plan.workouts.filter((w) => w.scheduled_date >= today);
  if (workouts.length === 0) {
    throw new GenerateError('race_too_soon', 'No sessions are left before the race.');
  }
  const planId = await store.createPlan({
    athlete_id: athleteId,
    template,
    goal_race_type: req.goal_type,
    goal_race_date: req.goal_race_date,
    start_date: plan.start_date,
    end_date: plan.end_date,
    weekly_volume_start_km: req.current_weekly_km,
    planned_type: PLANNED_TYPE[template.sport],
    workouts,
  });
  return { planId, plan: { ...plan, workouts } };
}

type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

export function sqlGenerateStore(db: Db): GenerateStore {
  return {
    async createPlan(payload) {
      const r = await db.query('select create_scora_plan($1::jsonb) as id', [JSON.stringify(payload)]);
      return r.rows[0].id as string;
    },
  };
}

export function supabaseGenerateStore(sb: { rpc: (fn: string, args: any) => any }): GenerateStore {
  return {
    async createPlan(payload) {
      // One transaction in Postgres (create_scora_plan, migration 20261018020000).
      const r = await sb.rpc('create_scora_plan', { p: payload });
      if (r.error) throw new Error(`Save plan: ${r.error.message}`);
      return r.data as string;
    },
  };
}
