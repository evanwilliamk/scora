// Storage for manual plans. Saving a new paste marks the previous active
// manual plan 'replaced'; its rows stay in the table but stop being read, so
// nothing the athlete entered is deleted.

import type { ParsedRow } from './plan-parse';

export interface StoredWorkout {
  id: string;
  scheduled_date: string;
  planned_type: string;
  planned_intensity: string | null;
  planned_duration_min: number | null;
  planned_distance_km: number | null;
  planned_description: string | null;
}

export interface PlanStore {
  saveManualPlan(athleteId: string, rawText: string, rows: ParsedRow[]): Promise<{ planId: string }>;
  // Active-plan workouts from `from` to `to` inclusive, oldest first.
  workoutsBetween(athleteId: string, from: string, to: string): Promise<StoredWorkout[]>;
}

const rowValues = (athleteId: string, planId: string, r: ParsedRow) => ({
  athlete_id: athleteId,
  training_plan_id: planId,
  scheduled_date: r.date,
  planned_type: r.type,
  planned_intensity: r.intensity,
  planned_duration_min: r.duration_min,
  planned_distance_km: r.distance_km,
  planned_description: r.description || null,
  source: 'manual',
  raw_source_json: r,
});

const span = (rows: ParsedRow[]) => ({ start: rows[0].date, end: rows[rows.length - 1].date });

type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

export function sqlPlanStore(db: Db): PlanStore {
  return {
    async saveManualPlan(athleteId, rawText, rows) {
      if (rows.length === 0) throw new Error('No workouts to save');
      await db.query(
        `update training_plans set current_status = 'replaced', updated_at = now()
         where athlete_id = $1 and external_source = 'manual' and current_status = 'active'`,
        [athleteId]
      );
      const { start, end } = span(rows);
      const plan = await db.query(
        `insert into training_plans (athlete_id, source, external_source, start_date, end_date, raw_text)
         values ($1, 'external', 'manual', $2, $3, $4) returning id`,
        [athleteId, start, end, rawText]
      );
      const planId = plan.rows[0].id as string;
      for (const r of rows) {
        const v = rowValues(athleteId, planId, r);
        await db.query(
          `insert into scheduled_workouts (athlete_id, training_plan_id, scheduled_date, planned_type,
             planned_intensity, planned_duration_min, planned_distance_km, planned_description, source, raw_source_json)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [v.athlete_id, v.training_plan_id, v.scheduled_date, v.planned_type, v.planned_intensity,
            v.planned_duration_min, v.planned_distance_km, v.planned_description, v.source, JSON.stringify(v.raw_source_json)]
        );
      }
      return { planId };
    },
    async workoutsBetween(athleteId, from, to) {
      const r = await db.query(
        `select w.id, to_char(w.scheduled_date, 'YYYY-MM-DD') as scheduled_date, w.planned_type,
                w.planned_intensity, w.planned_duration_min, w.planned_distance_km::float8 as planned_distance_km,
                w.planned_description
         from scheduled_workouts w
         join training_plans p on p.id = w.training_plan_id
         where w.athlete_id = $1 and p.current_status = 'active'
           and w.scheduled_date between $2 and $3
         order by w.scheduled_date, w.created_at`,
        [athleteId, from, to]
      );
      return r.rows as StoredWorkout[];
    },
  };
}

// Production store over supabase-js (service role).
export function supabasePlanStore(sb: { from: (t: string) => any }): PlanStore {
  const check = (r: { error: any }, what: string) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
  };
  return {
    async saveManualPlan(athleteId, rawText, rows) {
      if (rows.length === 0) throw new Error('No workouts to save');
      check(await sb.from('training_plans')
        .update({ current_status: 'replaced', updated_at: new Date().toISOString() })
        .eq('athlete_id', athleteId).eq('external_source', 'manual').eq('current_status', 'active'), 'Replace plan');
      const { start, end } = span(rows);
      const plan = await sb.from('training_plans')
        .insert({ athlete_id: athleteId, source: 'external', external_source: 'manual', start_date: start, end_date: end, raw_text: rawText })
        .select('id').single();
      check(plan, 'Insert plan');
      check(await sb.from('scheduled_workouts').insert(rows.map((r) => rowValues(athleteId, plan.data.id, r))), 'Insert workouts');
      return { planId: plan.data.id };
    },
    async workoutsBetween(athleteId, from, to) {
      const r = await sb.from('scheduled_workouts')
        .select('id, scheduled_date, planned_type, planned_intensity, planned_duration_min, planned_distance_km, planned_description, training_plans!inner(current_status)')
        .eq('athlete_id', athleteId).eq('training_plans.current_status', 'active')
        .gte('scheduled_date', from).lte('scheduled_date', to)
        .order('scheduled_date', { ascending: true });
      check(r, 'Load workouts');
      return (r.data ?? []).map(({ training_plans: _p, planned_distance_km, ...w }: any) => ({
        ...w,
        planned_distance_km: planned_distance_km == null ? null : Number(planned_distance_km),
      }));
    },
  };
}
