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

export type GenerateErrorCode = 'bad_request' | 'template_not_available' | 'race_too_soon' | 'coach_plan_active' | 'volume_out_of_range';

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
  // A coach's plan replaces SCORA's; generation is hidden while one is active (CLAUDE.md §5.3).
  hasActiveCoachPlan(athleteId: string): Promise<boolean>;
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
  if (await store.hasActiveCoachPlan(athleteId)) {
    throw new GenerateError('coach_plan_active', 'Your coach sets your plan.');
  }
  const template = matchTemplate(templates, req);
  if (!template) {
    // Doc 09 §2.6: when the race has templates but not at this volume, say so.
    const sameRace = templates.filter((t) => t.sport === req.sport && t.goal_type === req.goal_type && t.experience_level === req.experience_level);
    if (sameRace.length > 0) {
      const low = Math.min(...sameRace.map((t) => t.weekly_volume_range_km[0]));
      const high = Math.max(...sameRace.map((t) => t.weekly_volume_range_km[1]));
      if (req.current_weekly_km < low) {
        throw new GenerateError('volume_out_of_range', `This plan would ramp too fast from your current volume. It starts from ${low} km a week.`);
      }
      if (req.current_weekly_km >= high) {
        throw new GenerateError('volume_out_of_range', `This plan is built for under ${high} km a week, below your current volume.`);
      }
    }
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
    async hasActiveCoachPlan(athleteId) {
      const r = await db.query(
        `select 1 from training_plans where athlete_id = $1 and source = 'coach' and current_status = 'active' limit 1`,
        [athleteId],
      );
      return r.rows.length > 0;
    },
    async createPlan(payload) {
      const r = await db.query('select create_scora_plan($1::jsonb) as id', [JSON.stringify(payload)]);
      return r.rows[0].id as string;
    },
  };
}

export function supabaseGenerateStore(sb: { from: (t: string) => any; rpc: (fn: string, args: any) => any }): GenerateStore {
  return {
    async hasActiveCoachPlan(athleteId) {
      const r = await sb.from('training_plans').select('id')
        .eq('athlete_id', athleteId).eq('source', 'coach').eq('current_status', 'active').limit(1);
      if (r.error) throw new Error(`Load coach plan: ${r.error.message}`);
      return (r.data ?? []).length > 0;
    },
    async createPlan(payload) {
      // One transaction in Postgres (create_scora_plan, migration 20261018020000).
      const r = await sb.rpc('create_scora_plan', { p: payload });
      if (r.error) throw new Error(`Save plan: ${r.error.message}`);
      return r.data as string;
    },
  };
}

// What the plan setup screen may offer (doc 09 §2.3): each sport and goal the
// loaded templates cover, and per experience level the weekly km the
// templates take ([min, max), as matchTemplate checks) and the shortest plan
// in weeks (a race must be at least that far out). With an empty library the
// list is empty and the app shows no setup entry.
export interface PlanLevelOption {
  level: string;
  weekly_km: [number, number];
  min_weeks: number;
}

export interface PlanOption {
  sport: string;
  goal_type: string;
  label: string;
  levels: PlanLevelOption[];
}

const GOAL_LABELS: Record<string, string> = {
  '5k': '5K', '10k': '10K', half_marathon: 'Half marathon', marathon: 'Marathon',
  '50k': '50K', '100k': '100K', '100mi': '100 miles', gravel_century: 'Gravel century',
  century: 'Century', olympic_tri: 'Olympic tri', sprint_tri: 'Sprint tri',
};

export function goalLabel(goal: string): string {
  if (GOAL_LABELS[goal]) return GOAL_LABELS[goal];
  const words = goal.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function planOptions(templates: {
  sport: string; goal_type: string; experience_level: string; weekly_volume_range_km: [number, number]; duration_weeks: number;
}[]): PlanOption[] {
  const order = ['first_timer', 'regular', 'competitive'];
  const byGoal = new Map<string, PlanOption>();
  for (const t of templates) {
    const key = `${t.sport}|${t.goal_type}`;
    const o = byGoal.get(key) ?? { sport: t.sport, goal_type: t.goal_type, label: goalLabel(t.goal_type), levels: [] };
    const l = o.levels.find((x) => x.level === t.experience_level);
    if (l) {
      // Several templates for one level: their ranges together (a gap between
      // them still answers with a named volume error).
      l.weekly_km = [Math.min(l.weekly_km[0], t.weekly_volume_range_km[0]), Math.max(l.weekly_km[1], t.weekly_volume_range_km[1])];
      l.min_weeks = Math.min(l.min_weeks, t.duration_weeks);
    } else {
      o.levels.push({ level: t.experience_level, weekly_km: [...t.weekly_volume_range_km], min_weeks: t.duration_weeks });
    }
    byGoal.set(key, o);
  }
  return [...byGoal.values()]
    .map((o) => ({ ...o, levels: o.levels.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level)) }))
    .sort((a, b) => a.sport.localeCompare(b.sport) || a.label.localeCompare(b.label));
}
