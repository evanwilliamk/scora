import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { storeStravaTokens, getValidStravaToken } from './strava';
import { buildDashboard, buildWeeklySummary } from './metrics';
import {
  buildOuraAuthorizeUrl,
  exchangeOuraCode,
  storeOuraTokens,
  getValidOuraToken,
  fetchOuraSummary,
  OURA_CLIENT_ID,
} from './oura';
import { consumeCdvQuota } from './usage';
import { generateValidatedVoice } from './voice';
import { validateVoice, buildFallbackVoice } from './validator';
import {
  registerDeviceToken,
  getDeviceTokens,
  removeDeviceToken,
  sendPush,
  apnsConfigured,
} from './push';
import { startScheduler } from './scheduler';

dotenv.config();

const fastify = Fastify({ logger: true });
fastify.register(cors);

fastify.get('/', async (request, reply) => {
  return reply.type('text/html').send('<html><head><meta charset="utf-8"><style>body{background:#000;color:#fff;font-family:system-ui;margin:0;padding:40px;display:flex;align-items:center;justify-content:center;min-height:100vh}.container{max-width:600px;text-align:center}.logo{font-size:100px;margin:0;margin-bottom:20px}.title{font-size:48px;margin:0 0 20px;font-weight:700}.tagline{color:#999;font-size:18px;margin:0 0 50px}ul{list-style:none;margin:40px 0;padding:0;text-align:left;display:inline-block}li{color:#ccc;font-size:16px;padding:12px 0}li:before{content:"•";margin-right:12px;color:#666}.footer{margin-top:60px;padding-top:40px;border-top:1px solid #222;font-size:13px;color:#666}a{color:#fff;text-decoration:none}a:hover{color:#999}</style></head><body><div class="container"><div class="logo">S</div><h1 class="title">SCORA</h1><p class="tagline">A second opinion on your training, in a voice you\'ll actually trust.</p><ul><li>Daily reads that name what\'s happening</li><li>Every claim backed by your numbers</li><li>Strava + Oura</li><li>Connect a real coach when you\'re ready</li></ul><div class="footer"><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a></p></div></div></body></html>');
});

fastify.get('/privacy', async (request, reply) => {
  return reply.type('text/html').send('<html><head><meta charset="utf-8"><style>body{background:#000;color:#fff;font-family:system-ui;margin:0;padding:40px}div{max-width:600px;margin:0 auto}h1{font-size:32px;margin-bottom:8px}p{color:#999}p.date{font-size:13px;margin-bottom:30px}p.content{color:#ccc;line-height:1.6}</style></head><body><div><h1>Privacy Policy</h1><p class="date">Updated July 1, 2026</p><p class="content">We collect fitness data from Strava, Oura, and Apple Health with your permission. Your data is protected with industry-standard encryption. Contact hello@scora.app to access or delete your data.</p></div></body></html>');
});

fastify.get('/terms', async (request, reply) => {
  return reply.type('text/html').send('<html><head><meta charset="utf-8"><style>body{background:#000;color:#fff;font-family:system-ui;margin:0;padding:40px}div{max-width:600px;margin:0 auto}h1{font-size:32px;margin-bottom:8px}p{color:#999}p.date{font-size:13px;margin-bottom:30px}p.content{color:#ccc;line-height:1.6}</style></head><body><div><h1>Terms of Service</h1><p class="date">Updated July 1, 2026</p><p class="content">By using SCORA, you accept these terms. Use SCORA only for personal, non-commercial purposes. SCORA is provided as-is without warranties or liability for damages.</p></div></body></html>');
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString(), api: 'scora' };
});

// Strava OAuth
const STRAVA_CLIENT_ID = '228067';
const STRAVA_CLIENT_SECRET = (process.env.STRAVA_CLIENT_SECRET || '').trim();
const STRAVA_REDIRECT_URI = 'https://zonal-prosperity-production-3965.up.railway.app/api/auth/strava/callback';

fastify.get('/api/auth/strava', async (request, reply) => {
  const redirectUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}&scope=read,activity:read_all`;
  return reply.redirect(302, redirectUrl);
});

fastify.get('/api/auth/strava/callback', async (request, reply) => {
  const { code } = request.query as { code?: string };

  if (!code) {
    return reply.type('text/html').send(`
      <html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5;">
        <div style="text-align: center;"><h1>⚠️ Missing Authorization</h1><p>No authorization code received. Please try again.</p></div>
      </body></html>
    `);
  }
  
  try {
    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      fastify.log.error('Strava token error:', errText);
      return reply.code(400).send({ error: 'Token exchange failed', detail: errText });
    }

    const tokenData = await tokenResponse.json();
    const athleteId = tokenData.athlete.id;
    const athleteName = tokenData.athlete.firstname;
    const accessToken = tokenData.access_token;

    // Persist the full token set (access + refresh + expiry) so the backend
    // can auto-refresh later instead of forcing the user to re-auth every ~6h.
    // If storage fails, fail the auth visibly rather than sending the user
    // into the app with tokens that were never saved.
    try {
      await storeStravaTokens(athleteId, tokenData);
    } catch (e) {
      fastify.log.error('Failed to persist Strava tokens:', e);
      return reply.code(500).send({
        error: 'Token storage failed',
        detail: e instanceof Error ? e.message : String(e),
        athleteId,
      });
    }

    const deepLink = `scora://auth/success?athlete_id=${athleteId}&name=${encodeURIComponent(athleteName)}&token=${encodeURIComponent(accessToken)}`;

    // Use location.href in JS to open the deep link, which bypasses Safari's confirmation dialog.
    const html = `
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { background: #000; color: #fff; font-family: system-ui; margin: 0; padding: 40px; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
            .container { max-width: 400px; text-align: center; }
            .logo { font-size: 100px; margin-bottom: 20px; }
            h1 { font-size: 40px; margin: 0 0 20px; font-weight: 700; }
            p { color: #999; font-size: 16px; margin: 0 0 30px; }
            a { display: inline-block; padding: 14px 32px; background: #fff; color: #000; text-decoration: none; border-radius: 4px; font-weight: 600; }
            a:hover { opacity: 0.9; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #222; font-size: 13px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">S</div>
            <h1>Strava Linked</h1>
            <p>Welcome, ${athleteName}!</p>
            <p style="color: #666; font-size: 14px; margin-top: 20px;">Opening SCORA...</p>
            <a href="#" id="fallback">Open SCORA</a>
            <div class="footer"><p>If the app doesn't open, tap the button above.</p></div>
          </div>
          <script>
            var deepLink = '${deepLink}';
            document.getElementById('fallback').href = deepLink;
            setTimeout(function() { window.location.href = deepLink; }, 100);
          </script>
        </body>
      </html>
    `;
    return reply.type('text/html').send(html);
  } catch (error) {
    fastify.log.error('Strava exception:', error);
    return reply.code(500).send({
      error: 'Auth failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

// Oura OAuth. The athlete is already signed in (via Strava), so we thread
// their athlete id through the `state` param to link the Oura tokens back to
// the existing athlete row on callback.
fastify.get('/api/auth/oura', async (request, reply) => {
  const { athlete_id } = request.query as { athlete_id?: string };
  if (!athlete_id) {
    return reply.code(400).send({ error: 'Missing athlete_id — sign in with Strava first.' });
  }
  if (!OURA_CLIENT_ID) {
    return reply.code(500).send({ error: 'Oura not configured (OURA_CLIENT_ID missing).' });
  }
  return reply.redirect(302, buildOuraAuthorizeUrl(athlete_id));
});

fastify.get('/api/auth/oura/callback', async (request, reply) => {
  const { code, state, error: oauthError } = request.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  if (oauthError) {
    return reply.type('text/html').send(
      `<html><body style="font-family:system-ui;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>Oura connection cancelled</h1><p style="color:#999">${oauthError}</p></div></body></html>`
    );
  }
  if (!code || !state) {
    return reply.code(400).type('text/html').send(
      `<html><body style="font-family:system-ui;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>Missing authorization</h1><p style="color:#999">No code/state received from Oura.</p></div></body></html>`
    );
  }

  try {
    const tokenData = await exchangeOuraCode(code);
    await storeOuraTokens(state, tokenData); // state === athleteId
  } catch (e) {
    fastify.log.error('Oura auth failed:', e);
    return reply.code(500).send({
      error: 'Oura connection failed',
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // Reopen the app; the dashboard reloads and the Oura cards light up.
  const deepLink = 'scora://oura/success';
  const html = `
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { background: #000; color: #fff; font-family: system-ui; margin: 0; padding: 40px; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
          .container { max-width: 400px; text-align: center; }
          .logo { font-size: 100px; margin-bottom: 20px; }
          h1 { font-size: 40px; margin: 0 0 20px; font-weight: 700; }
          p { color: #999; font-size: 16px; margin: 0 0 30px; }
          a { display: inline-block; padding: 14px 32px; background: #fff; color: #000; text-decoration: none; border-radius: 4px; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">S</div>
          <h1>Oura Connected</h1>
          <p style="color:#666;font-size:14px;margin-top:20px;">Opening SCORA...</p>
          <a href="#" id="fallback">Open SCORA</a>
        </div>
        <script>
          var deepLink = '${deepLink}';
          document.getElementById('fallback').href = deepLink;
          setTimeout(function() { window.location.href = deepLink; }, 100);
        </script>
      </body>
    </html>
  `;
  return reply.type('text/html').send(html);
});

// CDV endpoint - simple and safe
fastify.post('/api/cdv', async (request, reply) => {
  try {
    const body = request.body as any;
    const { message, athleteId } = body;

    if (!message || !athleteId) {
      return reply.code(400).send({ error: 'Missing: message, athleteId' });
    }

    // Resolve a valid token from storage, auto-refreshing if expired.
    // The app no longer needs to pass (or hold a fresh) token.
    let stravaToken: string;
    try {
      stravaToken = await getValidStravaToken(athleteId);
    } catch (e) {
      return reply.code(401).send({
        error: 'Strava not connected or refresh failed — please reconnect Strava.',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Fetch Strava data (larger window for real trend analysis)
    const stravaRes = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=50', {
      headers: { 'Authorization': `Bearer ${stravaToken}` },
    });

    if (!stravaRes.ok) {
      return reply.code(401).send({ error: 'Strava token invalid or expired' });
    }

    const activities: any[] = await stravaRes.json();

    const M = 1609.34;
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86400000);
    const paceMinPerMi = (a: any) => {
      if (!a.distance || !a.moving_time) return null;
      const secPerMi = a.moving_time / (a.distance / M);
      const min = Math.floor(secPerMi / 60);
      const sec = Math.round(secPerMi % 60);
      return `${min}:${sec.toString().padStart(2, '0')}`;
    };

    const runs = activities.filter(a => a.type === 'Run');
    const inWindow = (a: any, from: Date, to: Date) => {
      const d = new Date(a.start_date);
      return d > from && d <= to;
    };

    // This week vs last week
    const thisWeek = runs.filter(a => inWindow(a, daysAgo(7), new Date(now)));
    const lastWeek = runs.filter(a => inWindow(a, daysAgo(14), daysAgo(7)));
    const miles = (arr: any[]) => arr.reduce((s, a) => s + (a.distance || 0) / M, 0);
    const thisWeekMiles = miles(thisWeek);
    const lastWeekMiles = miles(lastWeek);
    const weekDelta = lastWeekMiles > 0
      ? `${(((thisWeekMiles - lastWeekMiles) / lastWeekMiles) * 100).toFixed(0)}%`
      : 'n/a';

    // Per-run detail for the last 10 runs (this is what makes answers vary)
    const recentRuns = runs.slice(0, 10).map(a => ({
      name: a.name,
      date: (a.start_date_local || a.start_date || '').slice(0, 10),
      miles: a.distance ? +(a.distance / M).toFixed(1) : 0,
      pace: paceMinPerMi(a),
      avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
      maxHr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
      elevFt: a.total_elevation_gain ? Math.round(a.total_elevation_gain * 3.281) : 0,
      movingMin: a.moving_time ? Math.round(a.moving_time / 60) : 0,
    }));

    // --- Weekday pattern detection (last 6 weeks) ---
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const sixWeeks = runs.filter(a => inWindow(a, daysAgo(42), new Date(now)));
    // Group runs by weekday
    const byDay: Record<number, any[]> = {};
    for (const a of sixWeeks) {
      const dow = new Date(a.start_date_local || a.start_date).getDay();
      (byDay[dow] ||= []).push(a);
    }
    // Count distinct weeks in window to judge "how many of the last N weeks"
    const weeksInWindow = 6;
    const weekdayPatterns = Object.entries(byDay)
      .map(([dow, arr]) => {
        const d = Number(dow);
        const avgMiles = +(miles(arr) / arr.length).toFixed(1);
        const avgMin = Math.round(arr.reduce((s, a) => s + (a.moving_time || 0), 0) / arr.length / 60);
        const avgElev = Math.round(arr.reduce((s, a) => s + (a.total_elevation_gain || 0) * 3.281, 0) / arr.length);
        return {
          weekday: WEEKDAYS[d],
          dow: d,
          occurrences: arr.length,
          weeksSeen: `${arr.length}/${weeksInWindow}`,
          avgMiles,
          avgMin,
          avgElevFt: avgElev,
          consistent: arr.length >= 3, // ran this weekday 3+ of last 6 weeks
        };
      })
      .filter(p => p.consistent)
      .sort((a, b) => b.occurrences - a.occurrences);

    // --- Today's usual signal ---
    const todayDow = new Date(now).getDay();
    const todayName = WEEKDAYS[todayDow];
    const todayPattern = weekdayPatterns.find(p => p.dow === todayDow) || null;
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const ranToday = runs.some(a => new Date(a.start_date_local || a.start_date) >= startOfToday);
    const todaySignal = todayPattern
      ? {
          today: todayName,
          usualSession: `~${todayPattern.avgMiles}mi / ~${todayPattern.avgMin}min${todayPattern.avgElevFt > 300 ? ` / ~${todayPattern.avgElevFt}ft climb` : ''}`,
          seenPattern: todayPattern.weeksSeen + ' recent weeks',
          loggedToday: ranToday,
        }
      : { today: todayName, usualSession: null, loggedToday: ranToday };

    const dataBlock = {
      thisWeek: { miles: +thisWeekMiles.toFixed(1), runs: thisWeek.length },
      lastWeek: { miles: +lastWeekMiles.toFixed(1), runs: lastWeek.length },
      weekOverWeekMiles: weekDelta,
      recentRuns,
      weekdayPatterns,
      todaySignal,
    };

    const systemPrompt = `You are SCORA, a voice layer for endurance athletes. You READ and NAME patterns using postures: primed, steady, moderate, back-off, rest, taper.
HARD RULES:
- Every claim must be backed by a specific number in the data provided. Never invent data.
- Answer the athlete's ACTUAL question using the relevant data. Different questions -> different answers.
- Numeric-first: lead with the number, then the interpretation.
- Tone: calm, precise, human. No fitness-bro hype, no exclamation spam, no cheerleading ("great job", "amazing", "keep it up" are banned).

PATTERN-AWARENESS (allowed, NOT prescription):
- You MAY point out recurring patterns the data shows, e.g. "You've run hills every Thursday for the last 4 weeks (~9mi, ~90min). It's Thursday and nothing's logged yet."
- This is an OBSERVATION of a real pattern + a factual gap. It is allowed.
- The line you must NOT cross: telling them what to do. Never say "you should", "go do", "time to", "get your run in". State the pattern and the current fact; let them decide.
- Use weekdayPatterns + todaySignal to surface this ONLY when relevant to the question or when there's a clear, notable pattern-vs-today gap.

OUTPUT FORMAT (exactly):
- Line 1: one-sentence voice read that directly answers the question (may include a pattern observation if relevant).
- Then 2-4 metric lines, each: METRIC: <name> | VALUE: <number+unit> | TREND: <primed|steady|moderate|back-off|rest|taper OR short trend like +12% / flat / down>
Only cite metrics that exist in the data.`;

    const userPrompt = `Athlete question: "${message}"

Data (JSON):
${JSON.stringify(dataBlock, null, 2)}

Answer THIS question specifically using the data above. If the data can't answer it (e.g. sleep/HRV not present), say so plainly and pivot to what the run data does show.`;

    const weeklyMiles = thisWeekMiles.toFixed(1);
    const runCount = thisWeek.length;
    const lastRun = runs[0] || {};

    // Free-tier gate: 3 CDV queries/day (§5.1). Consumed here, after the data
    // is in hand, so infra failures (bad token, etc.) don't burn a query but
    // the expensive LLM call is never made once the daily limit is hit.
    //
    // Fail-open: if the usage lookup errors (e.g. the migration hasn't run yet,
    // or a transient DB issue), log it and let the query through rather than
    // breaking the chat. A soft cap must never take down core functionality.
    let quota = null;
    try {
      quota = await consumeCdvQuota(athleteId);
    } catch (e) {
      fastify.log.error('CDV quota check failed — allowing query (fail-open):', e);
    }
    if (quota && !quota.allowed) {
      return reply.code(429).send({
        error: `You've used your ${quota.limit} chats for today. Resets tomorrow.`,
        used: quota.used,
        limit: quota.limit,
        remaining: 0,
      });
    }

    // Call OpenAI
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 350,
        temperature: 0.5,
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.text();
      fastify.log.error('OpenAI error:', err);
      return reply.code(500).send({ error: 'LLM failed', detail: err });
    }

    const llmResult = await openaiRes.json();
    const responseText = llmResult.choices[0].message.content;

    // Parse voice and drivers
    const lines = responseText.split('\n');
    const voice = lines[0] || '';

    const drivers = [];
    for (const line of lines.slice(1)) {
      if (line.includes('METRIC:')) {
        const metric = line.match(/METRIC:\s*([^|]+)/)?.[1]?.trim();
        const value = line.match(/VALUE:\s*([^|]+)/)?.[1]?.trim();
        const trend = line.match(/TREND:\s*(.+)$/)?.[1]?.trim();
        if (metric && value) {
          drivers.push({ metric, value, trend });
        }
      }
    }

    // Banned-phrase check on the CDV voice line. (Number-existence isn't checked
    // here: the drivers are parsed from the same output, so it would be circular
    // — the voice legitimately cites data-block values not in the METRIC lines.)
    let safeVoice = voice;
    const banned = validateVoice(voice, drivers).bannedHits;
    if (banned.length > 0) {
      fastify.log.warn(`CDV voice banned-phrase catch (${banned.join(', ')}) — using fallback`);
      safeVoice = buildFallbackVoice(drivers, 'Here');
    }

    return reply.send({
      voice: safeVoice,
      drivers,
      data: {
        weeklyMiles: parseFloat(weeklyMiles),
        runCount,
        lastRun: lastRun.name,
      },
      remaining: quota?.remaining,
      limit: quota?.limit,
    });
  } catch (error) {
    fastify.log.error('CDV exception:', error);
    return reply.code(500).send({ error: 'CDV failed', detail: error instanceof Error ? error.message : String(error) });
  }
});

// Daily read — the free-tier core. Returns Today's Read (the voice) plus the
// six dashboard cards, all computed from the athlete's real Strava data.
fastify.post('/api/read', async (request, reply) => {
  try {
    const { athleteId } = (request.body as any) || {};
    if (!athleteId) {
      return reply.code(400).send({ error: 'Missing: athleteId' });
    }

    let stravaToken: string;
    try {
      stravaToken = await getValidStravaToken(athleteId);
    } catch (e) {
      return reply.code(401).send({
        error: 'Strava not connected or refresh failed — please reconnect Strava.',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    const stravaRes = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=50', {
      headers: { Authorization: `Bearer ${stravaToken}` },
    });
    if (!stravaRes.ok) {
      return reply.code(401).send({ error: 'Strava token invalid or expired' });
    }
    const activities: any[] = await stravaRes.json();

    // Pull Oura if the athlete has connected it; otherwise the Sleep + Recovery
    // cards fall back to connect prompts. Never blocks the read on Oura errors.
    let ouraSummary = null;
    let ouraConnected = false;
    try {
      const ouraToken = await getValidOuraToken(athleteId);
      ouraConnected = true;
      ouraSummary = await fetchOuraSummary(ouraToken);
    } catch (e) {
      fastify.log.info(`Oura not available for ${athleteId}: ${e instanceof Error ? e.message : e}`);
    }

    // HealthKit lives on-device, so the client sends a summary in the request.
    // Oura wins when both exist; HealthKit fills Sleep + Recovery otherwise.
    const health = (request.body as any)?.health;
    let recovery = ouraSummary;
    let recoverySource = 'Oura';
    let healthKitUsed = false;
    if (!ouraConnected && health && typeof health === 'object') {
      recovery = {
        sleepSeconds: health.sleepSeconds ?? null,
        sleepScore: null, // HealthKit has no Oura-style score
        hrvMs: health.hrvMs != null ? Math.round(health.hrvMs) : null,
        restingHr: health.restingHr != null ? Math.round(health.restingHr) : null,
        readinessScore: null,
        hrvWeekAvgMs: health.hrvWeekAvgMs != null ? Math.round(health.hrvWeekAvgMs) : null,
      };
      recoverySource = 'Apple Health';
      healthKitUsed = true;
    }

    const { cards, drivers, connections } = buildDashboard(
      activities,
      { strava: true, oura: ouraConnected, healthKit: healthKitUsed },
      recovery,
      recoverySource
    );

    // With no drivers there is nothing the voice can honestly say. Don't invent.
    if (drivers.length === 0) {
      return reply.send({
        read: {
          voice: 'Not enough recent activity to read yet. Once a few runs land in Strava, the morning read fills in.',
        },
        cards,
        drivers,
        connections,
        generatedAt: new Date().toISOString(),
      });
    }

    const systemPrompt = `You are SCORA, an interpretation layer for endurance athletes. You READ and NAME what the data shows. You are NOT a coach and you never prescribe.

HARD RULES:
- Every claim must be backed by a driver in the DRIVERS list. Never invent a number or reference data that isn't listed (no sleep, HRV, or recovery unless present).
- Numeric-first: reference the raw value, then say what it means.
- Non-prescriptive: never tell the athlete what workout to do, never use "you should / you need to / do a / go for". You may name a posture (primed, steady, moderate, back-off, rest, taper) as an observation, not an instruction.
- Tone: calm, considered, short sentences, plain English. No exclamation points, no emoji, no hype ("great job", "crush it", "keep it up" are banned). No "coach".

OUTPUT: 2-3 sentences of plain prose. No headers, no bullet points, no metric lines — just the read.`;

    const driverBlock = drivers
      .map((d) => `- ${d.metric}: ${d.value}${d.trend ? ` (${d.trend})` : ''}`)
      .join('\n');
    const userPrompt = `DRIVERS (the only values you may cite):
${driverBlock}

Write today's read using only these drivers.`;

    let voice: string;
    try {
      const result = await generateValidatedVoice({
        systemPrompt,
        userPrompt,
        drivers,
        maxTokens: 200,
        leadIn: "Today's numbers",
        log: fastify.log,
      });
      voice = result.voice;
    } catch (e) {
      fastify.log.error('OpenAI error (read):');
      return reply.code(500).send({
        error: 'Read generation failed',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    return reply.send({
      read: { voice },
      cards,
      drivers,
      connections,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    fastify.log.error('Read exception:', error);
    return reply.code(500).send({
      error: 'Read failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

// Weekly read — the Sunday review. Reflects on the past 7 days (vs the prior 7)
// and names the week's shape in the voice. Same rules as the daily read:
// non-prescriptive, numeric-first, only cites drivers that exist.
//
// This is the generation half. Scheduled delivery (Sunday/Mon morning push)
// is future work, gated on APNS + a scheduler.
fastify.post('/api/weekly', async (request, reply) => {
  try {
    const { athleteId } = (request.body as any) || {};
    if (!athleteId) {
      return reply.code(400).send({ error: 'Missing: athleteId' });
    }

    let stravaToken: string;
    try {
      stravaToken = await getValidStravaToken(athleteId);
    } catch (e) {
      return reply.code(401).send({
        error: 'Strava not connected or refresh failed — please reconnect Strava.',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    const stravaRes = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=50', {
      headers: { Authorization: `Bearer ${stravaToken}` },
    });
    if (!stravaRes.ok) {
      return reply.code(401).send({ error: 'Strava token invalid or expired' });
    }
    const activities: any[] = await stravaRes.json();

    let ouraSummary = null;
    try {
      const ouraToken = await getValidOuraToken(athleteId);
      ouraSummary = await fetchOuraSummary(ouraToken);
    } catch {
      // Oura optional — weekly read works on Strava alone.
    }

    const { stats, drivers, hasData } = buildWeeklySummary(activities, ouraSummary);

    if (!hasData) {
      return reply.send({
        read: {
          voice: 'No runs logged in the last week. Once the week has some training in it, the Sunday review has something to reflect on.',
        },
        stats,
        drivers,
        generatedAt: new Date().toISOString(),
      });
    }

    const systemPrompt = `You are SCORA, an interpretation layer for endurance athletes, writing the Sunday weekly review. You READ and NAME the shape of the past week. You are NOT a coach and you never prescribe.

HARD RULES:
- Every claim must be backed by a driver in the DRIVERS list. Never invent a number or reference data that isn't listed (no sleep/HRV unless present).
- Numeric-first: reference the raw value, then say what it means.
- Non-prescriptive: never tell the athlete what to do next week, never use "you should / you need to / do a / go for". You may name a posture (primed, steady, moderate, back-off, rest, taper) as an observation.
- Reflect across the week — connect the numbers into the week's story (e.g. volume + long run + how it sat relative to last week). This is where patterns get named.
- Tone: calm, considered, plain English. No exclamation points, no emoji, no hype. No "coach".

OUTPUT: 4-6 sentences of plain prose. No headers, no bullets, no metric lines — just the review.`;

    const driverBlock = drivers
      .map((d) => `- ${d.metric}: ${d.value}${d.trend ? ` (${d.trend})` : ''}`)
      .join('\n');
    const userPrompt = `DRIVERS (the only values you may cite):
${driverBlock}

Write this week's review using only these drivers.`;

    let voice: string;
    try {
      const result = await generateValidatedVoice({
        systemPrompt,
        userPrompt,
        drivers,
        maxTokens: 320,
        leadIn: 'This week',
        log: fastify.log,
      });
      voice = result.voice;
    } catch (e) {
      fastify.log.error('OpenAI error (weekly):');
      return reply.code(500).send({
        error: 'Weekly read generation failed',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    return reply.send({
      read: { voice },
      stats,
      drivers,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    fastify.log.error('Weekly exception:', error);
    return reply.code(500).send({
      error: 'Weekly read failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

// Register an APNs device token for the athlete so we can push the daily read.
fastify.post('/api/register-device', async (request, reply) => {
  const { athleteId, deviceToken } = (request.body as any) || {};
  if (!athleteId || !deviceToken) {
    return reply.code(400).send({ error: 'Missing: athleteId, deviceToken' });
  }
  try {
    await registerDeviceToken(athleteId, deviceToken);
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error('register-device failed:', e);
    return reply.code(500).send({
      error: 'Failed to register device',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

// Manual test push — send a sample alert to all of an athlete's devices.
// Used to verify APNs end-to-end before the scheduler is wired.
fastify.post('/api/push/test', async (request, reply) => {
  const { athleteId } = (request.body as any) || {};
  if (!athleteId) {
    return reply.code(400).send({ error: 'Missing: athleteId' });
  }
  if (!apnsConfigured()) {
    return reply.code(503).send({ error: 'APNs not configured (missing APNS_* env).' });
  }
  try {
    const tokens = await getDeviceTokens(athleteId);
    if (tokens.length === 0) {
      return reply.code(404).send({ error: 'No devices registered for this athlete.' });
    }
    const results = [];
    for (const token of tokens) {
      const r = await sendPush(token, {
        title: 'SCORA',
        body: 'Your morning read is ready.',
      });
      // Prune tokens APNs says are dead so they don't linger.
      if (r.reason === 'BadDeviceToken' || r.reason === 'Unregistered') {
        await removeDeviceToken(token);
      }
      results.push({ token: token.slice(0, 8) + '…', ...r });
    }
    return reply.send({ sent: results.filter((r) => r.ok).length, results });
  } catch (e) {
    fastify.log.error('push test failed:', e);
    return reply.code(500).send({
      error: 'Push test failed',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('API running on 0.0.0.0:3000');
    console.log('POST /api/cdv - Chat-driven analysis');
    // Push scheduler (daily + weekly). No-op until APNS_* env is configured.
    startScheduler(3000, fastify.log);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

export default fastify;
