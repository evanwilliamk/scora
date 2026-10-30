import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

// Check the athlete's CDV usage for today and, if under the limit, count this
// query. Returns whether the call is allowed plus usage numbers for the UI.
//
// Read-modify-write (not atomic). At single-user scale a race could at worst
// permit an occasional extra query — acceptable for a soft free-tier cap. If
// this ever needs to be strict, move the increment into a Postgres RPC.
// `supabase` and `today` are injectable for tests; production uses the
// defaults.
export async function consumeCdvQuota(
  athleteId: string,
  limit: number = FREE_CDV_DAILY_LIMIT,
  supabase: Pick<SupabaseClient, 'from'> = getSupabase(),
  today: string = todayStr()
): Promise<CdvQuota> {

  const { data: athlete, error } = await supabase
    .from('athletes')
    .select('cdv_count, cdv_count_date')
    .eq('strava_id', String(athleteId))
    .single();

  if (error || !athlete) {
    throw new Error('Athlete not found — please reconnect Strava.');
  }

  // A new day resets the count; the day never moves backwards.
  const day = athlete.cdv_count_date && athlete.cdv_count_date > today ? athlete.cdv_count_date : today;
  const usedBefore = athlete.cdv_count_date === day ? athlete.cdv_count ?? 0 : 0;

  if (usedBefore >= limit) {
    return { allowed: false, used: usedBefore, remaining: 0, limit, day };
  }

  const usedAfter = usedBefore + 1;
  await supabase
    .from('athletes')
    .update({ cdv_count: usedAfter, cdv_count_date: day })
    .eq('strava_id', String(athleteId));

  return { allowed: true, used: usedAfter, remaining: limit - usedAfter, limit, day };
}

// Give back a query counted by consumeCdvQuota whose answer never came (the
// LLM call failed), so a provider outage does not spend the athlete's day.
// Only on the same quota day and never below zero. Same read-modify-write
// caveat as consumeCdvQuota.
export async function refundCdvQuota(
  athleteId: string,
  day: string,
  supabase: Pick<SupabaseClient, 'from'> = getSupabase(),
): Promise<void> {
  const { data: athlete, error } = await supabase
    .from('athletes')
    .select('cdv_count, cdv_count_date')
    .eq('strava_id', String(athleteId))
    .single();
  if (error || !athlete) throw new Error('Athlete not found');
  if (athlete.cdv_count_date !== day || !(athlete.cdv_count > 0)) return;
  await supabase
    .from('athletes')
    .update({ cdv_count: athlete.cdv_count - 1 })
    .eq('strava_id', String(athleteId));
}
