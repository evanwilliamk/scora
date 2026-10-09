import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID")!;
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// TRIMP (Training Impulse) — simple proxy for workout load
// duration_min * avg_hr_ratio^2 where ratio = avgHR / maxHR (assumed 190)
function computeTRIMP(durationSeconds: number, avgHR: number | null): number {
  if (!avgHR) return durationSeconds / 60; // fallback: 1 point per minute
  const hrRatio = avgHR / 190;
  return (durationSeconds / 60) * hrRatio * hrRatio;
}

async function refreshStravaToken(userId: string): Promise<string | null> {
  const { data: tokenRow } = await supabase
    .from("strava_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (!tokenRow) return null;

  const expiresAt = new Date(tokenRow.expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) return tokenRow.access_token;

  // Refresh
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();

  await supabase.from("strava_tokens").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(data.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);

  return data.access_token;
}

async function syncRecentWorkouts(userId: string, accessToken: string) {
  const since = Math.floor(Date.now() / 1000) - 14 * 86400; // last 14 days
  const res = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${since}&per_page=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return;

  const activities = await res.json();
  for (const a of activities) {
    await supabase.from("workouts").upsert({
      user_id: userId,
      strava_activity_id: a.id,
      sport_type: a.sport_type,
      start_time: a.start_date,
      duration_seconds: a.moving_time,
      distance_meters: a.distance,
      elevation_gain_meters: a.total_elevation_gain,
      average_heartrate: a.average_heartrate ?? null,
      max_heartrate: a.max_heartrate ?? null,
      average_watts: a.average_watts ?? null,
      suffer_score: a.suffer_score ?? null,
      calories: a.calories ?? null,
      raw: a,
    }, { onConflict: "strava_activity_id" });
  }
}

function computeReadiness(workouts: any[]): {
  score: number;
  label: string;
  recommendation: string;
  why: string;
  load7d: number;
  intensityYesterday: number;
  consecutiveHardDays: number;
} {
  const now = new Date();
  const dayMs = 86400_000;

  const last7 = workouts.filter(
    (w) => now.getTime() - new Date(w.start_time).getTime() < 7 * dayMs
  );
  const yesterday = workouts.filter((w) => {
    const diff = now.getTime() - new Date(w.start_time).getTime();
    return diff < 2 * dayMs && diff >= dayMs;
  });

  const load7d = last7.reduce(
    (sum, w) => sum + computeTRIMP(w.duration_seconds, w.average_heartrate),
    0
  );

  const intensityYesterday = yesterday.reduce(
    (sum, w) => sum + computeTRIMP(w.duration_seconds, w.average_heartrate),
    0
  );

  // Count consecutive days with hard sessions (TRIMP > 40 = "hard")
  let consecutiveHardDays = 0;
  for (let i = 1; i <= 5; i++) {
    const dayWorkouts = workouts.filter((w) => {
      const diff = now.getTime() - new Date(w.start_time).getTime();
      return diff < (i + 1) * dayMs && diff >= i * dayMs;
    });
    const dayLoad = dayWorkouts.reduce(
      (sum, w) => sum + computeTRIMP(w.duration_seconds, w.average_heartrate),
      0
    );
    if (dayLoad > 40) consecutiveHardDays++;
    else break;
  }

  // Score formula (0–100): start at 100, subtract fatigue signals
  let score = 100;
  score -= Math.min(40, load7d * 0.15);         // high weekly load → fatigue
  score -= Math.min(20, intensityYesterday * 0.4); // hard yesterday → less ready
  score -= consecutiveHardDays * 8;              // stacking hard days
  score = Math.round(Math.max(0, Math.min(100, score)));

  let label: string;
  let recommendation: string;
  let why: string;

  if (score >= 80) {
    label = "Ready to push";
    recommendation = "Hard workout or long effort — go for it";
    why = load7d < 100
      ? "Light recent load and adequate recovery."
      : "Good training balance over the past week.";
  } else if (score >= 60) {
    label = "Moderate readiness";
    recommendation = "Aerobic effort — keep intensity controlled";
    why = consecutiveHardDays >= 2
      ? `${consecutiveHardDays} hard days in a row — back off slightly.`
      : "Moderate load building — stay aerobic today.";
  } else if (score >= 40) {
    label = "Back off today";
    recommendation = "Easy recovery run or spin — 30–45 min max";
    why = intensityYesterday > 60
      ? "Hard session yesterday is still in your legs."
      : "Cumulative load is high — recovery will pay off tomorrow.";
  } else {
    label = "Rest day";
    recommendation = "Full rest or gentle walk only";
    why = "Your body is carrying significant fatigue. A rest day now prevents overtraining.";
  }

  return { score, label, recommendation, why, load7d, intensityYesterday, consecutiveHardDays };
}

serve(async () => {
  // Fetch all users with tokens
  const { data: tokens } = await supabase
    .from("strava_tokens")
    .select("user_id");

  if (!tokens?.length) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  const today = new Date().toISOString().split("T")[0];
  let processed = 0;

  for (const { user_id } of tokens) {
    const accessToken = await refreshStravaToken(user_id);
    if (!accessToken) continue;

    await syncRecentWorkouts(user_id, accessToken);

    const { data: workouts } = await supabase
      .from("workouts")
      .select("start_time, duration_seconds, average_heartrate")
      .eq("user_id", user_id)
      .gte("start_time", new Date(Date.now() - 14 * 86400_000).toISOString())
      .order("start_time", { ascending: false });

    const result = computeReadiness(workouts ?? []);

    await supabase.from("readiness_scores").upsert({
      user_id,
      score_date: today,
      score: result.score,
      label: result.label,
      recommendation: result.recommendation,
      why: result.why,
      load_7d: result.load7d,
      intensity_yesterday: result.intensityYesterday,
      consecutive_hard_days: result.consecutiveHardDays,
    }, { onConflict: "user_id,score_date" });

    processed++;
  }

  return new Response(JSON.stringify({ processed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
