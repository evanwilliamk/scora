import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

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
  const { data, error } = await supabase
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
