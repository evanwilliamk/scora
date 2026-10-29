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
  // The session's steps on a SCORA plan (doc 07 v2 §4.4), for the Watch
  // export. Null for pasted and imported plans.
  workout_structure_json?: unknown[] | null;
  // The athlete's own mark: true done, false missed, null not marked yet.
  athlete_completed?: boolean | null;
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
  // The athlete marks a session on or before `today` done or missed
  // (CLAUDE.md §6.2: a miss is acknowledged, never rescheduled). False when
  // it is not theirs, not on an active plan, or still ahead.
  markCompleted(athleteId: string, workoutId: string, completed: boolean, today: string): Promise<boolean>;
  // The app scheduled this session on the athlete's Watch (doc 10 3.1.9).
  // False when it is not theirs or not on an active plan.
  markWatchSent(athleteId: string, workoutId: string): Promise<boolean>;
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
                w.planned_description, w.workout_structure_json, w.athlete_completed
         from scheduled_workouts w
         join training_plans p on p.id = w.training_plan_id
         where w.athlete_id = $1 and p.current_status = 'active'
           and w.scheduled_date between $2 and $3
         order by w.scheduled_date, w.created_at`,
        [athleteId, from, to]
      );
      return r.rows as StoredWorkout[];
    },
    async markCompleted(athleteId, workoutId, completed, today) {
      const r = await db.query(
        `update scheduled_workouts w set athlete_completed = $3, updated_at = now()
         where w.id = $1 and w.athlete_id = $2 and w.scheduled_date <= $4::date
           and exists (select 1 from training_plans p where p.id = w.training_plan_id and p.current_status = 'active')
         returning w.id`,
        [workoutId, athleteId, completed, today],
      );
      return r.rows.length === 1;
    },
    async markWatchSent(athleteId, workoutId) {
      const r = await db.query(
        `update scheduled_workouts w set workout_kit_pushed_at = now(), updated_at = now()
         where w.id = $1 and w.athlete_id = $2
           and exists (select 1 from training_plans p where p.id = w.training_plan_id and p.current_status = 'active')
         returning w.id`,
        [workoutId, athleteId],
      );
      return r.rows.length === 1;
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
        .select('id, scheduled_date, planned_type, planned_intensity, planned_duration_min, planned_distance_km, planned_description, workout_structure_json, athlete_completed, training_plans!inner(current_status)')
        .eq('athlete_id', athleteId).eq('training_plans.current_status', 'active')
        .gte('scheduled_date', from).lte('scheduled_date', to)
        .order('scheduled_date', { ascending: true });
      check(r, 'Load workouts');
      return (r.data ?? []).map(({ training_plans: _p, planned_distance_km, ...w }: any) => ({
        ...w,
        planned_distance_km: planned_distance_km == null ? null : Number(planned_distance_km),
      }));
    },
    async markCompleted(athleteId, workoutId, completed, today) {
      // Only the active plan's sessions: the row's plan is checked first.
      const w = await sb.from('scheduled_workouts')
        .select('id, training_plan_id, training_plans!inner(current_status)')
        .eq('id', workoutId).eq('athlete_id', athleteId).lte('scheduled_date', today)
        .eq('training_plans.current_status', 'active').maybeSingle();
      check(w, 'Load workout');
      if (!w.data) return false;
      const r = await sb.from('scheduled_workouts')
        .update({ athlete_completed: completed, updated_at: new Date().toISOString() })
        // Same plan and date as checked: a plan replaced in between is not marked.
        .eq('id', workoutId).eq('athlete_id', athleteId).eq('training_plan_id', (w.data as any).training_plan_id)
        .lte('scheduled_date', today).select('id');
      check(r, 'Mark workout');
      return (r.data ?? []).length === 1;
    },
    async markWatchSent(athleteId, workoutId) {
      const w = await sb.from('scheduled_workouts')
        .select('id, training_plan_id, training_plans!inner(current_status)')
        .eq('id', workoutId).eq('athlete_id', athleteId)
        .eq('training_plans.current_status', 'active').maybeSingle();
      check(w, 'Load workout');
      if (!w.data) return false;
      const now = new Date().toISOString();
      const r = await sb.from('scheduled_workouts')
        .update({ workout_kit_pushed_at: now, updated_at: now })
        .eq('id', workoutId).eq('athlete_id', athleteId).eq('training_plan_id', (w.data as any).training_plan_id)
        .select('id');
      check(r, 'Record Watch send');
      return (r.data ?? []).length === 1;
    },
  };
}

// SCORA plan sessions carry no stored description; it is said from the
// session's own steps when the plan is read (CLAUDE.md §6.4). Pasted and
// imported sessions keep the athlete's own text.
export function withDescriptions(rows: StoredWorkout[], describe: (intensity: string, steps: any) => string | null): StoredWorkout[] {
  return rows.map((w) => (w.planned_description || !w.workout_structure_json
    ? w
    : { ...w, planned_description: describe(w.planned_intensity ?? w.planned_type, w.workout_structure_json) }));
}
