import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { VendorHttpError, vendorHttpError } from './vendor-error';
import { vendorLimitLine } from './telemetry';

// Lazy Supabase client so a missing env var can't crash the whole API at boot.
// Only the token endpoints depend on it; /health and OAuth pages stay up.
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

export const STRAVA_CLIENT_ID = '228067';
export const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || 'ce6388291cb662437a32b561f9f338b5c8db2bc1';
export const STRAVA_REDIRECT_URI = `${process.env.API_URL || 'https://zonal-prosperity-production-3965.up.railway.app'}/api/auth/strava/callback`;

export async function exchangeStravaCode(code: string) {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token exchange failed: ${response.statusText}`);
  }

  return response.json();
}

export async function linkStravaAthlete(userId: string, stravaData: any) {
  // Upsert athlete record with Strava data
  const { data, error } = await getSupabase()
    .from('athletes')
    .upsert(
      {
        user_id: userId,
        strava_id: String(stravaData.athlete.id),
        name: `${stravaData.athlete.firstname} ${stravaData.athlete.lastname}`,
      },
      { onConflict: 'strava_id' }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to link Strava athlete: ${error.message}`);
  }

  return data;
}

// --- Token storage + auto-refresh ---------------------------------------
// Persist the full token set (access + refresh + expiry) so we can renew
// silently instead of forcing the user to re-auth every ~6 hours.
export async function storeStravaTokens(stravaId: string, tokenData: any) {
  const athleteName = tokenData.athlete
    ? `${tokenData.athlete.firstname} ${tokenData.athlete.lastname}`
    : 'Unknown';

  const { error } = await getSupabase()
    .from('athletes')
    .upsert(
      {
        strava_id: String(stravaId),
        name: athleteName,
        strava_access_token: tokenData.access_token || null,
        strava_refresh_token: tokenData.refresh_token || null,
        strava_expires_at: tokenData.expires_at || null, // unix seconds
      },
      { onConflict: 'strava_id' }
    );

  if (error) {
    throw new Error(`Failed to store Strava tokens: ${error.message}`);
  }
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

// Strava's limits belong to the application, not the athlete, so after one 429
// every other athlete's call fails too, and each failed call is still a request.
// Without this a morning send would keep asking, one failed call per due athlete
// per retry. Until the window turns, this process asks nothing and answers as
// Strava would. Windows turn on the clock's quarter hours, the day at 00:00 UTC.
const QUARTER_HOUR_MS = 15 * 60_000;
let stravaCooldownUntil = 0;

export function resetStravaCooldown(): void {
  stravaCooldownUntil = 0;
}

// When a 429 ends. Strava's headers carry "15-minute,daily" pairs, overall and
// for reads; a spent daily count waits for midnight UTC, anything else (headers
// missing included) for the next quarter hour.
export function stravaCooldownEnd(headers: Headers | undefined, now: number): number {
  const pair = (name: string) => (headers?.get(name) ?? '').split(',').map(Number);
  const dailySpent = ['X-RateLimit', 'X-ReadRateLimit'].some((prefix) => {
    const daily = pair(`${prefix}-Limit`)[1];
    return daily > 0 && pair(`${prefix}-Usage`)[1] >= daily;
  });
  if (dailySpent) return (Math.floor(now / 86_400_000) + 1) * 86_400_000;
  return (Math.floor(now / QUARTER_HOUR_MS) + 1) * QUARTER_HOUR_MS;
}

async function stravaFetch(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  if (Date.now() < stravaCooldownUntil) throw new VendorHttpError('Strava', 429);
  const res = await fetchImpl(url, init);
  if (res.status === 429) {
    const now = Date.now();
    // Never shorter: answers to calls already out can arrive after a daily 429,
    // and one without headers would read as a 15-minute limit.
    stravaCooldownUntil = Math.max(stravaCooldownUntil, stravaCooldownEnd(res.headers, now));
    console.warn(vendorLimitLine('Strava', Math.ceil((stravaCooldownUntil - now) / 60_000)));
  }
  return res;
}

async function refreshStravaToken(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<StravaTokenResponse> {
  const response = await stravaFetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    // Callers for this athlete share one refresh; a hung one must not hold them all.
    signal: AbortSignal.timeout(15_000),
  }, fetchImpl);

  // The status decides what the athlete is told (stravaTokenFailureLine).
  if (!response.ok) throw await vendorHttpError(response, 'Strava token refresh failed:');

  return (await response.json()) as StravaTokenResponse;
}

// One refresh per athlete at a time in this process. Strava may rotate the
// refresh token on use, so two reads racing on an expired token would both spend the
// same old refresh token and the second would fail. Concurrent callers share
// the in-flight lookup (and refresh, if one is needed) instead.
const stravaTokenInFlight = new Map<string, Promise<string>>();

export async function getValidStravaToken(
  stravaId: string,
  // Injectable for tests; production uses the shared client and fetch.
  supabase: Pick<SupabaseClient, 'from'> = getSupabase(),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const key = String(stravaId);
  const pending = stravaTokenInFlight.get(key);
  if (pending) return pending;
  const p = getValidStravaTokenOnce(stravaId, supabase, fetchImpl).finally(() => stravaTokenInFlight.delete(key));
  stravaTokenInFlight.set(key, p);
  return p;
}

/**
 * Returns a valid Strava access token for the athlete, refreshing it first
 * if it is expired or within a 5-minute safety window. Rotates the stored
 * refresh token (Strava may issue a new one on refresh).
 */
async function getValidStravaTokenOnce(
  stravaId: string,
  // Injectable for tests; production uses the shared client and fetch.
  supabase: Pick<SupabaseClient, 'from'> = getSupabase(),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { data: athlete, error } = await supabase
    .from('athletes')
    .select('strava_access_token, strava_refresh_token, strava_expires_at')
    .eq('strava_id', String(stravaId))
    .single();

  if (error || !athlete) {
    throw new Error('Athlete not found or no Strava tokens stored. Please reconnect Strava.');
  }
  if (!athlete.strava_refresh_token) {
    throw new Error('No Strava refresh token stored. Please reconnect Strava.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const safetyWindow = 300; // refresh 5 min before actual expiry

  // Still valid — use it as-is.
  if (athlete.strava_expires_at && athlete.strava_expires_at - safetyWindow > nowSec) {
    return athlete.strava_access_token;
  }

  // Expired (or about to) — refresh and persist the new set.
  const refreshed = await refreshStravaToken(athlete.strava_refresh_token, fetchImpl);
  const { data: saved, error: saveError } = await supabase
    .from('athletes')
    .update({
      strava_access_token: refreshed.access_token,
      strava_refresh_token: refreshed.refresh_token,
      strava_expires_at: refreshed.expires_at,
    })
    .eq('strava_id', String(stravaId))
    // Only over the token we spent: never overwrite a newer set (a reconnect).
    .eq('strava_refresh_token', athlete.strava_refresh_token)
    .select('strava_id');
  // The provider may have retired the old refresh token, so a lost save means
  // the next refresh fails and the athlete must reconnect. Say so loudly; the
  // fresh access token still serves this request.
  if (saveError) console.error(`Strava token refresh not saved: ${saveError.message}`);
  else if (!saved || saved.length === 0) console.error(`Strava token refresh not saved: no athlete row matched`);

  return refreshed.access_token;
}

// Every activity since `afterSec`, page by page. With `after`, Strava returns
// the oldest first, so a single capped page would drop the newest runs.
export async function fetchActivitiesSince(
  token: string,
  afterSec: number,
  fetchImpl: typeof fetch = fetch,
  maxPages = 5,
): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await stravaFetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${afterSec}&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
      // A hung page must not hold the read (and the scheduler tick behind it).
      signal: AbortSignal.timeout(15_000),
    }, fetchImpl);
    if (!res.ok) throw await vendorHttpError(res, 'Strava');
    const body: unknown = await res.json();
    // Outside data: anything but a list is a failed pull, and entries that
    // are not objects would crash the card math downstream.
    if (!Array.isArray(body)) throw new Error('Strava returned no activity list');
    out.push(...body.filter((a) => a !== null && typeof a === 'object'));
    if (body.length < 200) break;
  }
  return out;
}

// The athlete's Strava profile (the calorie engine's weight).
export async function fetchStravaAthlete(token: string, fetchImpl: typeof fetch = fetch): Promise<{ weight?: number | null }> {
  const res = await stravaFetch('https://www.strava.com/api/v3/athlete', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  }, fetchImpl);
  if (!res.ok) throw await vendorHttpError(res, 'Strava');
  return (await res.json()) as { weight?: number | null };
}

// The athlete's activities from the last `days` days, newest first: the order
// Strava uses without `after`, which callers slice from the front. A count
// cap (per_page=50) can cover far fewer days for a multi-sport athlete.
export async function fetchRecentActivities(
  token: string,
  days: number,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<any[]> {
  const list = await fetchActivitiesSince(token, Math.floor(now / 1000) - days * 86400, fetchImpl);
  const at = (a: any) => Date.parse(a?.start_date ?? '') || 0;
  return list.sort((a, b) => at(b) - at(a));
}
