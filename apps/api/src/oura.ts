import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Oura OAuth + data pull. Mirrors strava.ts, with three Oura-specific
// differences that bit the earlier attempt:
//   1. The token endpoint is api.ouraring.com/oauth/token and expects
//      application/x-www-form-urlencoded — NOT JSON (Strava tolerates JSON;
//      Oura returns 400 invalid_request for it).
//   2. Oura returns expires_in (relative seconds), not expires_at. We convert
//      to an absolute unix-seconds expiry so the refresh logic matches Strava.
//   3. Oura auth carries no Strava id, so we thread the already-authenticated
//      athlete id through the OAuth `state` param to link the tokens.

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

export const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID || '';
export const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET || '';
export const OURA_REDIRECT_URI = `${process.env.API_URL || 'https://zonal-prosperity-production-3965.up.railway.app'}/api/auth/oura/callback`;

const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const OURA_API = 'https://api.ouraring.com/v2/usercollection';

// `daily` unlocks daily_sleep / daily_readiness; the detailed `sleep` route
// (average_hrv, lowest_heart_rate) also lives under `daily`. `personal` gives
// basic profile. `heartrate` is included for future resting-HR timeseries.
const OURA_SCOPES = 'personal daily heartrate';

export function buildOuraAuthorizeUrl(athleteId: string): string {
  const params = new URLSearchParams({
    client_id: OURA_CLIENT_ID,
    redirect_uri: OURA_REDIRECT_URI,
    response_type: 'code',
    scope: OURA_SCOPES,
    state: athleteId, // links the Oura tokens back to the signed-in athlete
  });
  return `${OURA_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeOuraCode(code: string): Promise<any> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: OURA_REDIRECT_URI,
    client_id: OURA_CLIENT_ID,
    client_secret: OURA_CLIENT_SECRET,
  });

  const response = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Oura token exchange failed (${response.status}): ${detail}`);
  }
  return response.json();
}

async function refreshOuraToken(refreshToken: string): Promise<any> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OURA_CLIENT_ID,
    client_secret: OURA_CLIENT_SECRET,
  });

  const response = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Oura token refresh failed (${response.status}): ${detail}`);
  }
  return response.json();
}

// Persist Oura tokens onto the existing athlete row (keyed by Strava id, which
// is the athlete id we threaded through `state`). Converts Oura's relative
// expires_in into an absolute unix-seconds expiry.
export async function storeOuraTokens(athleteId: string, tokenData: any): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = tokenData.expires_in ? nowSec + Number(tokenData.expires_in) : null;

  const { data, error } = await getSupabase()
    .from('athletes')
    .update({
      oura_access_token: tokenData.access_token || null,
      oura_refresh_token: tokenData.refresh_token || null,
      oura_expires_at: expiresAt,
    })
    .eq('strava_id', String(athleteId))
    .select();

  if (error) {
    throw new Error(`Failed to store Oura tokens: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`No athlete row for id ${athleteId} — connect Strava first.`);
  }
}

// Returns a valid Oura access token, refreshing if expired. Throws if the
// athlete has not connected Oura (the dashboard treats this as "not connected").
export async function getValidOuraToken(athleteId: string): Promise<string> {
  const supabase = getSupabase();
  const { data: athlete, error } = await supabase
    .from('athletes')
    .select('oura_access_token, oura_refresh_token, oura_expires_at')
    .eq('strava_id', String(athleteId))
    .single();

  if (error || !athlete || !athlete.oura_access_token) {
    throw new Error('Oura not connected.');
  }
  if (!athlete.oura_refresh_token) {
    throw new Error('No Oura refresh token stored — please reconnect Oura.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const safetyWindow = 300;

  if (athlete.oura_expires_at && athlete.oura_expires_at - safetyWindow > nowSec) {
    return athlete.oura_access_token;
  }

  const refreshed = await refreshOuraToken(athlete.oura_refresh_token);
  const expiresAt = refreshed.expires_in ? nowSec + Number(refreshed.expires_in) : null;
  await supabase
    .from('athletes')
    .update({
      oura_access_token: refreshed.access_token,
      oura_refresh_token: refreshed.refresh_token,
      oura_expires_at: expiresAt,
    })
    .eq('strava_id', String(athleteId));

  return refreshed.access_token;
}

export interface OuraSummary {
  // Last night
  sleepSeconds: number | null; // total sleep duration
  sleepScore: number | null; // 0-100 daily sleep score
  hrvMs: number | null; // average HRV last night (ms)
  restingHr: number | null; // lowest HR last night (bpm)
  readinessScore: number | null; // 0-100 daily readiness score
  // Trend context
  hrvWeekAvgMs: number | null; // avg HRV over prior ~7 nights
}

// Pull the last week of Oura data and reduce it to the values the two cards
// (Sleep, Recovery Signal) and the read actually cite. Best-effort: any route
// that fails leaves its fields null rather than blocking the dashboard.
export async function fetchOuraSummary(token: string): Promise<OuraSummary> {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const day = 86400000;
  const iso = (d: number) => new Date(d).toISOString().slice(0, 10);
  const end = Date.now() + day; // inclusive of today
  const start = Date.now() - 8 * day;
  const range = `start_date=${iso(start)}&end_date=${iso(end)}`;

  const summary: OuraSummary = {
    sleepSeconds: null,
    sleepScore: null,
    hrvMs: null,
    restingHr: null,
    readinessScore: null,
    hrvWeekAvgMs: null,
  };

  // Detailed sleep periods: total_sleep_duration, average_hrv, lowest_heart_rate.
  try {
    const res = await fetch(`${OURA_API}/sleep?${range}`, auth);
    if (res.ok) {
      const json: any = await res.json();
      const periods: any[] = (json.data || []).filter((p: any) => p.type !== 'nap');
      periods.sort((a, b) => (a.day < b.day ? 1 : -1)); // newest first
      const latest = periods[0];
      if (latest) {
        summary.sleepSeconds = latest.total_sleep_duration ?? null;
        summary.hrvMs = latest.average_hrv ?? null;
        summary.restingHr = latest.lowest_heart_rate ?? null;
      }
      const hrvs = periods
        .slice(1, 8)
        .map((p) => p.average_hrv)
        .filter((v) => typeof v === 'number');
      if (hrvs.length > 0) {
        summary.hrvWeekAvgMs = Math.round(hrvs.reduce((s, v) => s + v, 0) / hrvs.length);
      }
    }
  } catch {
    // leave sleep fields null
  }

  // Daily sleep score.
  try {
    const res = await fetch(`${OURA_API}/daily_sleep?${range}`, auth);
    if (res.ok) {
      const json: any = await res.json();
      const rows: any[] = (json.data || []).slice().sort((a: any, b: any) => (a.day < b.day ? 1 : -1));
      if (rows[0]) summary.sleepScore = rows[0].score ?? null;
    }
  } catch {
    // leave null
  }

  // Daily readiness score.
  try {
    const res = await fetch(`${OURA_API}/daily_readiness?${range}`, auth);
    if (res.ok) {
      const json: any = await res.json();
      const rows: any[] = (json.data || []).slice().sort((a: any, b: any) => (a.day < b.day ? 1 : -1));
      if (rows[0]) summary.readinessScore = rows[0].score ?? null;
    }
  } catch {
    // leave null
  }

  return summary;
}
