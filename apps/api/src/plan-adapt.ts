// Plan adaptations for SCORA's own plans (doc 07 v2 §6.2, CLAUDE.md §6.2).
//
// Runs when the daily read has decided today's posture: tomorrow's scheduled
// workout goes through @scora/plan-engine's deterministic rules, and any
// change is written with a named reason in one transaction
// (apply_plan_adaptation, migration 20261018010000). The engine decides; the
// reason text below only states the decision. Off unless PLAN_ADAPTATIONS=on.

import {
  ADAPTATION_ENGINE_VERSION, evaluateAdaptation, templateWeekMinutes, validateTemplate,
} from '../../../packages/plan-engine/src/index';
import type {
  AdaptationDecision, Intensity, PlanTemplate, PlannedWorkout, Posture, WorkoutStep,
} from '../../../packages/plan-engine/src/index';

export const adaptationsEnabled = () => process.env.PLAN_ADAPTATIONS === 'on';

// Reject after ms so a slow database never stalls the read. The work itself
// may still finish; apply_plan_adaptation is one transaction either way.
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export interface ActiveScoraPlan {
  id: string;
  start_date: string;
  goal_race_date: string | null;
  template: PlanTemplate;
}

export interface PlanAdaptationRow {
  id: string;
  adaptation_type: string;
  original_date: string | null;
  new_date: string | null;
  reason_code: string;
  reason_text: string;
  triggered_at: string;
}

export interface AdaptationWrite {
  athlete_id: string;
  training_plan_id: string;
  scheduled_workout_id: string;
  type: 'moved' | 'downgraded';
  new_date: string | null;
  new_workout: { planned_intensity: Intensity; workout_structure_json: WorkoutStep[] | null } | null;
  displaced_workout_id: string | null;
  reason_code: string;
  reason_text: string;
  displaced_reason_text: string | null;
  engine_version: string;
}

export interface AdaptStore {
  // A coach's plan replaces SCORA's (CLAUDE.md §5.3).
  hasActiveCoachPlan(athleteId: string): Promise<boolean>;
  activeScoraPlan(athleteId: string): Promise<ActiveScoraPlan | null>;
  // Workouts of that plan from `from` to `to` inclusive.
  workoutsBetween(planId: string, from: string, to: string): Promise<(PlannedWorkout & { workout_structure_json?: WorkoutStep[] | null })[]>;
  // Returns the adaptation id, or null if the engine already adapted it.
  apply(write: AdaptationWrite): Promise<string | null>;
  recent(athleteId: string, limit: number): Promise<PlanAdaptationRow[]>;
}

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const mondayOf = (d: string) => addDays(d, -((new Date(Date.parse(`${d}T00:00:00Z`)).getUTCDay() + 6) % 7));

const INTENSITY_WORDS: Record<Intensity, string> = {
  rest: 'rest day', recovery: 'recovery run', easy: 'easy run', moderate: 'moderate run', endurance: 'endurance run',
  steady_state: 'steady-state run', tempo: 'tempo', threshold: 'threshold session', intervals: 'intervals',
  hard: 'hard session', long: 'long run',
};
const POSTURE_WORDS: Record<Posture, string> = {
  primed: 'primed', steady: 'steady', moderate: 'moderate', 'back-off': 'back-off', rest: 'rest', taper: 'taper',
};

// Plain statement of what the engine changed and the posture behind it. Plan
// text, not the voice: it names the change, it does not argue for it.
export function reasonText(d: Exclude<AdaptationDecision, { type: 'none' }>): string {
  const day = weekday(d.facts.workout_date);
  const what = INTENSITY_WORDS[d.facts.workout_intensity];
  const posture = POSTURE_WORDS[d.facts.posture];
  if (d.type === 'moved') {
    return `${day}'s ${what} moved to ${weekday(d.to)}. Today's posture reads ${posture}, and ${weekday(d.to)} keeps the week's hard days apart.`;
  }
  const mins = d.duration_min ? ` at the same ${d.duration_min} minutes` : ' at the same duration';
  const to = INTENSITY_WORDS[d.to_intensity];
  const article = /^[aeiou]/.test(to) ? 'an' : 'a';
  return `${day}'s ${what} is now ${article} ${to}${mins}. Today's posture reads ${posture}.`;
}

export function displacedReasonText(d: Extract<AdaptationDecision, { type: 'moved' }>, displaced: PlannedWorkout): string {
  return `${weekday(displaced.scheduled_date)}'s ${INTENSITY_WORDS[displaced.planned_intensity]} gives way to ${weekday(d.from)}'s ${INTENSITY_WORDS[d.facts.workout_intensity]}.`;
}

// A downgrade keeps the duration and drops the intensity: one continuous step.
export function downgradedStructure(to: Intensity, minutes: number | null): WorkoutStep[] | null {
  if (!minutes) return null;
  return [{ type: 'steady', duration_min: minutes, intensity: to === 'steady_state' ? 'steady' : 'easy' }];
}

export interface AdaptResult {
  decision: AdaptationDecision;
  workout_id: string;
  adaptation_id: string | null;
}

export interface AdaptOptions {
  // Drafts never adapt in production (doc 07 v2 §8.3); tests opt in.
  allowDrafts?: boolean;
  // Words the reason (adaptation-reason.ts). Gets the fixed sentence to fall
  // back on; without it the fixed sentence is stored.
  writeReason?: (decision: Exclude<AdaptationDecision, { type: 'none' }>, fallback: string) => Promise<string>;
}

// Evaluate tomorrow's workouts on the athlete's active SCORA plan against
// today's posture, and write whatever the engine decides.
export async function adaptTomorrow(
  athleteId: string,
  today: string,
  posture: Posture,
  store: AdaptStore,
  opts: AdaptOptions = {},
): Promise<AdaptResult[]> {
  if (await store.hasActiveCoachPlan(athleteId)) return [];
  const plan = await store.activeScoraPlan(athleteId);
  if (!plan) return [];
  if (plan.template.status !== 'reviewed' && !opts.allowDrafts) return [];
  const tomorrow = addDays(today, 1);
  const monday = mondayOf(tomorrow);
  // The plan week plus the next Monday, so a move to Sunday sees a hard
  // session right after it (the engine counts only Mon to Sun as the week).
  const loadWeek = () => store.workoutsBetween(plan.id, monday, addDays(monday, 7));
  let week = await loadWeek();
  const weekIndex = Math.floor((Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${mondayOf(plan.start_date)}T00:00:00Z`)) / (7 * DAY));
  const template_week_minutes = templateWeekMinutes(plan.template)[weekIndex] ?? null;

  const out: AdaptResult[] = [];
  const targets = week.filter((w) => w.scheduled_date === tomorrow && w.planned_intensity !== 'rest').map((w) => w.id);
  for (const id of targets) {
    // Re-read after every write: a second session that day must see the first one's move.
    const workout = week.find((w) => w.id === id);
    if (!workout || workout.scheduled_date !== tomorrow || workout.planned_intensity === 'rest') continue;
    const decision = evaluateAdaptation({
      posture,
      workout,
      plan: { source: 'scora_ai', goal_race_date: plan.goal_race_date, week, template_week_minutes },
      today,
    });
    if (decision.type === 'none') {
      out.push({ decision, workout_id: workout.id, adaptation_id: null });
      continue;
    }
    const displaced = decision.type === 'moved' && decision.displaced_workout_id
      ? week.find((w) => w.id === decision.displaced_workout_id) ?? null
      : null;
    const fixed = reasonText(decision);
    const reason_text = opts.writeReason ? await opts.writeReason(decision, fixed) : fixed;
    const adaptation_id = await store.apply({
      athlete_id: athleteId,
      training_plan_id: plan.id,
      scheduled_workout_id: workout.id,
      type: decision.type,
      new_date: decision.type === 'moved' ? decision.to : null,
      new_workout: decision.type === 'downgraded'
        ? { planned_intensity: decision.to_intensity, workout_structure_json: downgradedStructure(decision.to_intensity, decision.duration_min) }
        : null,
      displaced_workout_id: displaced?.id ?? null,
      reason_code: decision.reason_code,
      reason_text,
      displaced_reason_text: decision.type === 'moved' && displaced ? displacedReasonText(decision, displaced) : null,
      engine_version: ADAPTATION_ENGINE_VERSION,
    });
    out.push({ decision, workout_id: workout.id, adaptation_id });
    if (adaptation_id) week = await loadWeek();
  }
  return out;
}

type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

const planFrom = (r: any): ActiveScoraPlan => ({
  id: r.id,
  start_date: r.start_date,
  goal_race_date: r.goal_race_date ?? null,
  // Validated when the plan was generated; parsed again so a hand-edited row
  // cannot feed the engine a broken template.
  template: validateTemplate(r.structure_json, `plan_templates/${r.slug}@${r.version}`, { allowDrafts: true }),
});

const workoutFrom = (r: any) => ({
  id: r.id,
  scheduled_date: r.scheduled_date,
  planned_intensity: (r.planned_intensity ?? 'moderate') as Intensity,
  planned_duration_min: r.planned_duration_min ?? null,
  planned_distance_km: r.planned_distance_km == null ? null : Number(r.planned_distance_km),
  athlete_completed: r.athlete_completed ?? null,
  workout_structure_json: r.workout_structure_json ?? null,
});

export function sqlAdaptStore(db: Db): AdaptStore {
  return {
    async hasActiveCoachPlan(athleteId) {
      const r = await db.query(
        `select 1 from training_plans where athlete_id = $1 and source = 'coach' and current_status = 'active' limit 1`,
        [athleteId],
      );
      return r.rows.length > 0;
    },
    async activeScoraPlan(athleteId) {
      const r = await db.query(
        `select p.id, to_char(p.start_date, 'YYYY-MM-DD') as start_date, to_char(p.goal_race_date, 'YYYY-MM-DD') as goal_race_date,
                t.slug, t.version, t.structure_json
         from training_plans p join plan_templates t on t.id = p.template_id
         where p.athlete_id = $1 and p.source = 'scora_ai' and p.current_status = 'active'`,
        [athleteId],
      );
      return r.rows[0] ? planFrom(r.rows[0]) : null;
    },
    async workoutsBetween(planId, from, to) {
      const r = await db.query(
        `select id, to_char(scheduled_date, 'YYYY-MM-DD') as scheduled_date, planned_intensity, planned_duration_min,
                planned_distance_km::float8 as planned_distance_km, athlete_completed, workout_structure_json
         from scheduled_workouts where training_plan_id = $1 and scheduled_date between $2 and $3
         order by scheduled_date, created_at`,
        [planId, from, to],
      );
      return r.rows.map(workoutFrom);
    },
    async apply(write) {
      const r = await db.query('select apply_plan_adaptation($1::jsonb) as id', [JSON.stringify(write)]);
      return r.rows[0].id ?? null;
    },
    async recent(athleteId, limit) {
      const r = await db.query(
        `select id, adaptation_type, to_char(original_date, 'YYYY-MM-DD') as original_date,
                to_char(new_date, 'YYYY-MM-DD') as new_date, reason_code, reason_text,
                to_char(triggered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as triggered_at
         from plan_adaptations a
         where a.athlete_id = $1 and a.dismissed_at is null
           and exists (select 1 from training_plans p where p.id = a.training_plan_id and p.current_status = 'active')
         order by a.triggered_at desc, a.id limit $2`,
        [athleteId, limit],
      );
      return r.rows as PlanAdaptationRow[];
    },
  };
}

// Production store over supabase-js (service role).
export function supabaseAdaptStore(sb: { from: (t: string) => any; rpc: (fn: string, args: any) => any }): AdaptStore {
  const check = (r: { error: any }, what: string) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
  };
  return {
    async hasActiveCoachPlan(athleteId) {
      const r = await sb.from('training_plans').select('id')
        .eq('athlete_id', athleteId).eq('source', 'coach').eq('current_status', 'active').limit(1);
      check(r, 'Load coach plan');
      return (r.data ?? []).length > 0;
    },
    async activeScoraPlan(athleteId) {
      const r = await sb.from('training_plans')
        .select('id, start_date, goal_race_date, plan_templates!inner(slug, version, structure_json)')
        .eq('athlete_id', athleteId).eq('source', 'scora_ai').eq('current_status', 'active')
        .limit(1);
      check(r, 'Load plan');
      const row = r.data?.[0];
      return row ? planFrom({ ...row, ...row.plan_templates }) : null;
    },
    async workoutsBetween(planId, from, to) {
      const r = await sb.from('scheduled_workouts')
        .select('id, scheduled_date, planned_intensity, planned_duration_min, planned_distance_km, athlete_completed, workout_structure_json')
        .eq('training_plan_id', planId).gte('scheduled_date', from).lte('scheduled_date', to)
        .order('scheduled_date', { ascending: true });
      check(r, 'Load workouts');
      return (r.data ?? []).map(workoutFrom);
    },
    async apply(write) {
      // One transaction in Postgres (apply_plan_adaptation, migration 20261018010000).
      const r = await sb.rpc('apply_plan_adaptation', { p: write });
      check(r, 'Apply adaptation');
      return (r.data as string | null) ?? null;
    },
    async recent(athleteId, limit) {
      const r = await sb.from('plan_adaptations')
        .select('id, adaptation_type, original_date, new_date, reason_code, reason_text, triggered_at, training_plans!inner(current_status)')
        .eq('athlete_id', athleteId).is('dismissed_at', null).eq('training_plans.current_status', 'active')
        .order('triggered_at', { ascending: false }).order('id').limit(limit);
      check(r, 'Load adaptations');
      // Same shape as the SQL store: ISO 8601 in UTC with milliseconds.
      return (r.data ?? []).map(({ training_plans: _p, ...a }: any) => ({ ...a, triggered_at: new Date(a.triggered_at).toISOString() })) as PlanAdaptationRow[];
    },
  };
}
