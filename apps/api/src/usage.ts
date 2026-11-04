import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isValidTimezone, localClock } from './delivery';

// Daily CDV quota. Free tier = 3 chat-driven-viz queries/day (CLAUDE.md §5.1).
// When a subscription/tier concept lands, FREE_CDV_DAILY_LIMIT is the seam:
// Plan tier should get an effectively-unlimited (~30/day soft) limit instead.
export const FREE_CDV_DAILY_LIMIT = 3;

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase env not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  _supabase = createClient(supabaseUrl, supabaseKey);
  return _supabase;
}

// Trivial query to generate Supabase activity (keeps the free-tier project from
// pausing after 7 idle days). Returns whether the DB responded; never throws.
export async function pingDatabase(): Promise<boolean> {
  try {
    const { error } = await getSupabase().from('athletes').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

export interface CdvQuota {
  allowed: boolean;
  used: number; // queries used today, including this one when allowed
  remaining: number; // remaining after this call
  limit: number;
  day: string; // the quota day this call was counted on
}

const todayStr = () => new Date().toISOString().slice(0, 10); // UTC calendar day

// The quota day: the athlete's local date when the app sends one, so the
// count resets at their midnight, not at UTC midnight (evening in the US).
// A client date more than a day from the server's is ignored, and
// consumeCdvQuota never lets the day move backwards, so a changed clock buys
// at most one early reset, not a fresh quota per request.
export function quotaDay(clientDay: string | null | undefined, now: Date = new Date()): string {
  const utc = now.toISOString().slice(0, 10);
  if (!clientDay || !/^\d{4}-\d{2}-\d{2}$/.test(clientDay)) return utc;
  const t = Date.parse(`${clientDay}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== clientDay) return utc;
  return Math.abs(t - Date.parse(`${utc}T00:00:00Z`)) <= 86_400_000 ? clientDay : utc;
}

// The quota day for one athlete: their local date now, from the time zone
// stored in athlete_preferences, so the client cannot pick it. Only with no
// zone stored (or the lookup failing) does the app's date decide, through
// quotaDay. `supabase` is injectable for tests.
export async function athleteQuotaDay(
  athleteId: string,
  clientDay: string | null | undefined,
  now: Date = new Date(),
  supabase: Pick<SupabaseClient, 'from'> = getSupabase(),
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('athlete_preferences')
      .select('timezone')
      .eq('athlete_id', String(athleteId))
      .maybeSingle();
    const tz = !error && data ? (data as { timezone?: unknown }).timezone : null;
    if (isValidTimezone(tz)) return localClock(now, tz).date;
  } catch {
    // Fall through to the app's date.
  }
  return quotaDay(clientDay, now);
}

// Compare-and-swap attempts before giving up under contention.
const CAS_TRIES = 5;

// Write `values` only if the counter still holds what was read, so two
// requests that read the same count cannot both write over it.
async function swapCount(
  supabase: Pick<SupabaseClient, 'from'>,
  athleteId: string,
  seen: { cdv_count: number | null; cdv_count_date: string | null },
  values: { cdv_count: number; cdv_count_date?: string },
): Promise<boolean> {
  // A refund keeps the day it read (the filter below pins it anyway).
  const patch = { cdv_count: values.cdv_count, cdv_count_date: values.cdv_count_date ?? seen.cdv_count_date };
  let q = supabase.from('athletes').update(patch).eq('strava_id', String(athleteId));
  q = seen.cdv_count == null ? q.is('cdv_count', null) : q.eq('cdv_count', seen.cdv_count);
  q = seen.cdv_count_date == null ? q.is('cdv_count_date', null) : q.eq('cdv_count_date', seen.cdv_count_date);
  const { data, error } = await q.select('strava_id');
  if (error) throw new Error(`CDV count not saved: ${error.message}`);
  return (data ?? []).length === 1;
}

async function readCount(supabase: Pick<SupabaseClient, 'from'>, athleteId: string) {
  const { data, error } = await supabase
    .from('athletes')
    .select('cdv_count, cdv_count_date')
    .eq('strava_id', String(athleteId))
    .single();
  if (error || !data) return null;
  return data as { cdv_count: number | null; cdv_count_date: string | null };
}

// Read-only: the refusal when today's queries are already spent, else null.
// The route asks this before pulling from Strava, so a capped athlete tapping
// send again spends no call of the application's shared Strava limit.
export async function cdvQuotaSpent(
  athleteId: string,
  limit: number = FREE_CDV_DAILY_LIMIT,
  supabase: Pick<SupabaseClient, 'from'> = getSupabase(),
  today: string = todayStr()
): Promise<CdvQuota | null> {
  const athlete = await readCount(supabase, athleteId);
  if (!athlete) return null;
  const day = athlete.cdv_count_date && athlete.cdv_count_date > today ? athlete.cdv_count_date : today;
  const used = athlete.cdv_count_date === day ? athlete.cdv_count ?? 0 : 0;
  return used >= limit ? { allowed: false, used, remaining: 0, limit, day } : null;
}

// Check the athlete's CDV usage for today and, if under the limit, count this
// query. Returns whether the call is allowed plus usage numbers for the UI.
//
// The count is written only over the value read (compare-and-swap, retried),
// so two queries at once cannot both take the last one, and a refund racing
// a query loses neither. `supabase` and `today` are injectable for tests;
// production uses the defaults.
export async function consumeCdvQuota(
  athleteId: string,
  limit: number = FREE_CDV_DAILY_LIMIT,
  supabase: Pick<SupabaseClient, 'from'> = getSupabase(),
  today: string = todayStr()
): Promise<CdvQuota> {
  for (let i = 0; i < CAS_TRIES; i++) {
    const athlete = await readCount(supabase, athleteId);
    if (!athlete) throw new Error('Athlete not found. Please reconnect Strava.');

    // A new day resets the count; the day never moves backwards.
    const day = athlete.cdv_count_date && athlete.cdv_count_date > today ? athlete.cdv_count_date : today;
    const usedBefore = athlete.cdv_count_date === day ? athlete.cdv_count ?? 0 : 0;

    if (usedBefore >= limit) {
      return { allowed: false, used: usedBefore, remaining: 0, limit, day };
    }

    const usedAfter = usedBefore + 1;
    if (await swapCount(supabase, athleteId, athlete, { cdv_count: usedAfter, cdv_count_date: day })) {
      return { allowed: true, used: usedAfter, remaining: limit - usedAfter, limit, day };
    }
  }
  throw new Error('CDV count busy: not counted');
}

// Give back a query counted by consumeCdvQuota whose answer never came (the
// LLM call failed), so a provider outage does not spend the athlete's day.
// Only on the same quota day and never below zero, written over the value
// read like consumeCdvQuota. True only when a query was given back, so the
// route reports the count that is stored, never one it did not write.
export async function refundCdvQuota(
  athleteId: string,
  day: string,
  supabase: Pick<SupabaseClient, 'from'> = getSupabase(),
): Promise<boolean> {
  for (let i = 0; i < CAS_TRIES; i++) {
    const athlete = await readCount(supabase, athleteId);
    if (!athlete) throw new Error('Athlete not found');
    if (athlete.cdv_count_date !== day || !((athlete.cdv_count ?? 0) > 0)) return false;
    if (await swapCount(supabase, athleteId, athlete, { cdv_count: (athlete.cdv_count ?? 0) - 1 })) return true;
  }
  throw new Error('CDV refund not saved: count busy');
}
