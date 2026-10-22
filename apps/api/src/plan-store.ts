// Storage for pasted and calendar-imported plans. Saving a new one marks the
// previous active one 'replaced'; its rows stay in the table but stop being read, so
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
  // A calendar import (plan-ical.ts). Replaces the active pasted or imported
  // plan; the calendar text itself is not stored, only the kept rows.
  saveIcalPlan(athleteId: string, rows: ParsedRow[]): Promise<{ planId: string }>;
  // Re-import from the phone: replaces the plan only if it is still the
  // calendar import. Null when it is not (a paste replaced it).
  refreshIcalPlan(athleteId: string, rows: ParsedRow[]): Promise<{ planId: string } | null>;
  // Active-plan workouts from `from` to `to` inclusive, oldest first.
  workoutsBetween(athleteId: string, from: string, to: string): Promise<StoredWorkout[]>;
}

type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

export function sqlPlanStore(db: Db): PlanStore {
  return {
    async saveManualPlan(athleteId, rawText, rows) {
      if (rows.length === 0) throw new Error('No workouts to save');
      const r = await db.query('select replace_manual_plan($1, $2, $3::jsonb) as id', [athleteId, rawText, JSON.stringify(rows)]);
      return { planId: r.rows[0].id as string };
    },
    async saveIcalPlan(athleteId, rows) {
      if (rows.length === 0) throw new Error('No workouts to save');
      const r = await db.query(`select replace_external_plan($1, 'ical', null, $2::jsonb) as id`, [athleteId, JSON.stringify(rows)]);
      return { planId: r.rows[0].id as string };
    },
    async refreshIcalPlan(athleteId, rows) {
      if (rows.length === 0) throw new Error('No workouts to save');
      const r = await db.query('select refresh_ical_plan($1, $2::jsonb) as id', [athleteId, JSON.stringify(rows)]);
      return r.rows[0].id ? { planId: r.rows[0].id as string } : null;
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
export function supabasePlanStore(sb: { from: (t: string) => any; rpc: (fn: string, args: any) => any }): PlanStore {
  const check = (r: { error: any }, what: string) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
  };
  return {
    async saveManualPlan(athleteId, rawText, rows) {
      if (rows.length === 0) throw new Error('No workouts to save');
      // One transaction in Postgres (replace_manual_plan, migration 20261017010000).
      const r = await sb.rpc('replace_manual_plan', { p_athlete_id: athleteId, p_raw_text: rawText, p_rows: rows });
      check(r, 'Save plan');
      return { planId: r.data as string };
    },
    async saveIcalPlan(athleteId, rows) {
      if (rows.length === 0) throw new Error('No workouts to save');
      // One transaction in Postgres (replace_external_plan, migration 20261022000000).
      const r = await sb.rpc('replace_external_plan', { p_athlete_id: athleteId, p_external_source: 'ical', p_raw_text: null, p_rows: rows });
      check(r, 'Save calendar plan');
      return { planId: r.data as string };
    },
    async refreshIcalPlan(athleteId, rows) {
      if (rows.length === 0) throw new Error('No workouts to save');
      const r = await sb.rpc('refresh_ical_plan', { p_athlete_id: athleteId, p_rows: rows });
      check(r, 'Refresh calendar plan');
      return r.data ? { planId: r.data as string } : null;
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
