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

export interface CdvQuota {
  allowed: boolean;
  used: number; // queries used today, including this one when allowed
  remaining: number; // remaining after this call
  limit: number;
}

const todayStr = () => new Date().toISOString().slice(0, 10); // UTC calendar day

// Check the athlete's CDV usage for today and, if under the limit, count this
// query. Returns whether the call is allowed plus usage numbers for the UI.
//
// Read-modify-write (not atomic). At single-user scale a race could at worst
// permit an occasional extra query — acceptable for a soft free-tier cap. If
// this ever needs to be strict, move the increment into a Postgres RPC.
export async function consumeCdvQuota(
  athleteId: string,
  limit: number = FREE_CDV_DAILY_LIMIT
): Promise<CdvQuota> {
  const supabase = getSupabase();
  const today = todayStr();

  const { data: athlete, error } = await supabase
    .from('athletes')
    .select('cdv_count, cdv_count_date')
    .eq('strava_id', String(athleteId))
    .single();

  if (error || !athlete) {
    throw new Error('Athlete not found — please reconnect Strava.');
  }

  // A new day resets the count.
  const usedBefore = athlete.cdv_count_date === today ? athlete.cdv_count ?? 0 : 0;

  if (usedBefore >= limit) {
    return { allowed: false, used: usedBefore, remaining: 0, limit };
  }

  const usedAfter = usedBefore + 1;
  await supabase
    .from('athletes')
    .update({ cdv_count: usedAfter, cdv_count_date: today })
    .eq('strava_id', String(athleteId));

  return { allowed: true, used: usedAfter, remaining: limit - usedAfter, limit };
}
