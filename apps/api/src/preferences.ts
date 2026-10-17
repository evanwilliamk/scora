// athlete_preferences storage: delivery time zone and minute, onboarding
// completion, and the per-day push bookkeeping the scheduler uses.

import { defaultPrefs, type DeliveryPrefs } from './delivery';

export interface AthletePrefs extends DeliveryPrefs {
  athlete_id: string;
  onboarded_at: string | null;
}

export interface PrefsUpdate {
  timezone?: string;
  delivery_minute?: number;
  onboarded?: boolean;
}

export interface PrefsStore {
  get(athleteId: string): Promise<AthletePrefs>;
  getMany(athleteIds: string[]): Promise<Map<string, AthletePrefs>>;
  update(athleteId: string, u: PrefsUpdate): Promise<AthletePrefs>;
  markSent(athleteId: string, kind: 'daily' | 'weekly', localDate: string): Promise<void>;
}

const withDefaults = (athleteId: string, row?: Partial<AthletePrefs> | null): AthletePrefs => ({
  athlete_id: athleteId,
  ...defaultPrefs(),
  onboarded_at: null,
  ...(row ?? {}),
});

const COLS = 'athlete_id, timezone, delivery_minute, onboarded_at, last_daily_sent_on, last_weekly_sent_on';

type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

const sqlRow = (r: any): AthletePrefs => ({
  athlete_id: r.athlete_id,
  timezone: r.timezone,
  delivery_minute: Number(r.delivery_minute),
  onboarded_at: r.onboarded_at ? new Date(r.onboarded_at).toISOString() : null,
  last_daily_sent_on: r.last_daily_sent_on ?? null,
  last_weekly_sent_on: r.last_weekly_sent_on ?? null,
});

const SELECT = `select athlete_id, timezone, delivery_minute, onboarded_at,
  to_char(last_daily_sent_on, 'YYYY-MM-DD') as last_daily_sent_on,
  to_char(last_weekly_sent_on, 'YYYY-MM-DD') as last_weekly_sent_on
  from athlete_preferences`;

export function sqlPrefsStore(db: Db): PrefsStore {
  const store: PrefsStore = {
    async get(id) {
      const r = await db.query(`${SELECT} where athlete_id = $1`, [id]);
      return r.rows[0] ? sqlRow(r.rows[0]) : withDefaults(id);
    },
    async getMany(ids) {
      const out = new Map<string, AthletePrefs>();
      if (ids.length === 0) return out;
      const r = await db.query(`${SELECT} where athlete_id = any($1)`, [ids]);
      for (const row of r.rows) out.set(row.athlete_id, sqlRow(row));
      for (const id of ids) if (!out.has(id)) out.set(id, withDefaults(id));
      return out;
    },
    async update(id, u) {
      await db.query(
        `insert into athlete_preferences (athlete_id, timezone, delivery_minute, onboarded_at)
         values ($1, coalesce($2, 'America/New_York'), coalesce($3, 360), case when $4 then now() end)
         on conflict (athlete_id) do update set
           timezone = coalesce($2, athlete_preferences.timezone),
           delivery_minute = coalesce($3, athlete_preferences.delivery_minute),
           onboarded_at = coalesce(athlete_preferences.onboarded_at, case when $4 then now() end),
           updated_at = now()`,
        [id, u.timezone ?? null, u.delivery_minute ?? null, u.onboarded === true]
      );
      return store.get(id);
    },
    async markSent(id, kind, date) {
      const col = kind === 'daily' ? 'last_daily_sent_on' : 'last_weekly_sent_on';
      await db.query(
        `insert into athlete_preferences (athlete_id, ${col}) values ($1, $2)
         on conflict (athlete_id) do update set ${col} = excluded.${col}, updated_at = now()`,
        [id, date]
      );
    },
  };
  return store;
}

export function supabasePrefsStore(sb: { from: (t: string) => any }): PrefsStore {
  const check = (r: { error: any }, what: string) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
  };
  const store: PrefsStore = {
    async get(id) {
      const r = await sb.from('athlete_preferences').select(COLS).eq('athlete_id', id).maybeSingle();
      check(r, 'Load preferences');
      return withDefaults(id, r.data);
    },
    async getMany(ids) {
      const out = new Map<string, AthletePrefs>();
      if (ids.length === 0) return out;
      const r = await sb.from('athlete_preferences').select(COLS).in('athlete_id', ids);
      check(r, 'Load preferences');
      for (const row of r.data ?? []) out.set(row.athlete_id, withDefaults(row.athlete_id, row));
      for (const id of ids) if (!out.has(id)) out.set(id, withDefaults(id));
      return out;
    },
    async update(id, u) {
      const current = await store.get(id);
      const row: Record<string, unknown> = {
        athlete_id: id,
        timezone: u.timezone ?? current.timezone,
        delivery_minute: u.delivery_minute ?? current.delivery_minute,
        updated_at: new Date().toISOString(),
      };
      if (u.onboarded && !current.onboarded_at) row.onboarded_at = new Date().toISOString();
      check(await sb.from('athlete_preferences').upsert(row, { onConflict: 'athlete_id' }), 'Save preferences');
      return store.get(id);
    },
    async markSent(id, kind, date) {
      const col = kind === 'daily' ? 'last_daily_sent_on' : 'last_weekly_sent_on';
      check(await sb.from('athlete_preferences').upsert({ athlete_id: id, [col]: date }, { onConflict: 'athlete_id' }), 'Mark sent');
    },
  };
  return store;
}
