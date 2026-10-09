import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID")!;
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    return new Response(JSON.stringify({ error: "Strava auth denied or missing code" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return new Response(JSON.stringify({ error: "Token exchange failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tokenData = await tokenRes.json();
  const athlete = tokenData.athlete;
  const expiresAt = new Date(tokenData.expires_at * 1000).toISOString();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Upsert user
  const { data: user, error: userErr } = await supabase
    .from("users")
    .upsert(
      {
        strava_athlete_id: athlete.id,
        display_name: `${athlete.firstname} ${athlete.lastname}`.trim(),
      },
      { onConflict: "strava_athlete_id" }
    )
    .select("id")
    .single();

  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Failed to upsert user" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Store tokens (service role only — never exposed to client)
  await supabase.from("strava_tokens").upsert({
    user_id: user.id,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: expiresAt,
    scope: tokenData.scope,
    updated_at: new Date().toISOString(),
  });

  // Return user_id to the iOS app — it uses this to sign in via Supabase Auth
  return new Response(JSON.stringify({ user_id: user.id, athlete }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
