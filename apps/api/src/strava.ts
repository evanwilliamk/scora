import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
  console.log(`storeStravaTokens: storing for strava_id=${stravaId}`);
  
  const { error } = await getSupabase()
    .from('athletes')
    .upsert(
      {
        strava_id: String(stravaId),
        name: tokenData.athlete
          ? `${tokenData.athlete.firstname} ${tokenData.athlete.lastname}`
          : undefined,
        strava_access_token: tokenData.access_token,
        strava_refresh_token: tokenData.refresh_token,
        strava_expires_at: tokenData.expires_at, // unix seconds
      },
      { onConflict: 'strava_id' }
    );

  if (error) {
    console.error(`storeStravaTokens failed: ${error.message}`);
    throw new Error(`Failed to store Strava tokens: ${error.message}`);
  }
  console.log(`storeStravaTokens: success for strava_id=${stravaId}`);
}

async function refreshStravaToken(refreshToken: string) {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token refresh failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Returns a valid Strava access token for the athlete, refreshing it first
 * if it is expired or within a 5-minute safety window. Rotates the stored
 * refresh token (Strava may issue a new one on refresh).
 */
export async function getValidStravaToken(stravaId: string): Promise<string> {
  const supabase = getSupabase();
  const { data: athlete, error } = await supabase
    .from('athletes')
    .select('strava_access_token, strava_refresh_token, strava_expires_at')
    .eq('strava_id', String(stravaId))
    .single();

  if (error || !athlete) {
    throw new Error('Athlete not found or no Strava tokens stored — please reconnect Strava.');
  }
  if (!athlete.strava_refresh_token) {
    throw new Error('No Strava refresh token stored — please reconnect Strava.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const safetyWindow = 300; // refresh 5 min before actual expiry

  // Still valid — use it as-is.
  if (athlete.strava_expires_at && athlete.strava_expires_at - safetyWindow > nowSec) {
    return athlete.strava_access_token;
  }

  // Expired (or about to) — refresh and persist the new set.
  const refreshed = await refreshStravaToken(athlete.strava_refresh_token);
  await supabase
    .from('athletes')
    .update({
      strava_access_token: refreshed.access_token,
      strava_refresh_token: refreshed.refresh_token,
      strava_expires_at: refreshed.expires_at,
    })
    .eq('strava_id', String(stravaId));

  return refreshed.access_token;
}
