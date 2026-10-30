import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { storeStravaTokens, getValidStravaToken, fetchActivitiesSince, fetchRecentActivities } from './strava';
import { buildDashboard, buildWeeklySummary } from './metrics';
import { athleteLocalToday, postureForRead, raceWithinWeek } from './drivers';
import { SnapshotCache, planCardExpansion } from './card-expand';
import { CHART_MENU, parseChartKind, buildChartSpec } from './cdv-chart';
import { knowledgeForRead, knowledgeDepsFromEnv, recordCitations } from './knowledge-retrieval';
import {
  buildOuraAuthorizeUrl,
  exchangeOuraCode,
  storeOuraTokens,
  getValidOuraToken,
  fetchOuraSummary,
  OURA_CLIENT_ID,
} from './oura';
import { consumeCdvQuota, pingDatabase, quotaDay, refundCdvQuota } from './usage';
import { generateValidatedVoice } from './voice';
import { checkCdvWithRetry } from './cdv-check';
import { trackVoice, pushOpenLine, readPlanLine } from './telemetry';

class LlmHttpError extends Error {}
import {
  registerDeviceToken, unregisterDeviceToken,
  getDeviceTokens,
  removeDeviceToken,
  sendPush,
  apnsConfigured,
} from './push';
import { startScheduler } from './scheduler';
import { resultPage, escapeHtml, scriptString, oauthErrorMessage } from './pages';
import { supabasePrefsStore } from './preferences';
import type { PrefsStore } from './preferences';
import { isValidTimezone, isValidDeliveryMinute } from './delivery';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { parsePlanText, openAiPlanLlm, PlanParseError } from './plan-parse';
import { supabasePlanStore, withDescriptions, type StoredWorkout } from './plan-store';
import { importIcs, IcalImportError } from './plan-ical';
import { planForRead, planTodayCard, readNamesPlan, todayLine, weeklyPlanDriver } from './plan-read';
import { numericLine } from './numeric-line';
import { weekSoFar, plannedRunMinutes, mondayOf } from './week-so-far';
import { adaptTomorrow, adaptationsEnabled, planChangeContext, supabaseAdaptStore, withTimeout } from './plan-adapt';
import {
  GenerateError, generatePlan, generationEnabled, parseGenerateRequest, planBlock, planOptions, supabaseGenerateStore,
} from './plan-generate';
import { TEMPLATE_DIR, describeWorkout, loadTemplates } from '../../../packages/plan-engine/src/index';
import type { PlanTemplate } from '../../../packages/plan-engine/src/index';
import { openAiReasonLlm, reasonLlmEnabled, writeReason } from './adaptation-reason';
import { buildDriverSeries, inlineChartsEnabled, linkDrivers, parseHealthNights } from './driver-links';
import type { SeriesKey } from './driver-links';
import { predictRace, predictionsEnabled } from './race-prediction';
import { CALORIE_ENGINE_VERSION, caloriesEnabled, estimateCalories } from './calories';
import { createClient } from '@supabase/supabase-js';
import { isRun } from './activity-types';

dotenv.config();

const fastify = Fastify({ logger: true });

// What each athlete's last read showed, for card tap-to-expand (10 min).
const readSnapshots = new SnapshotCache();
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

// Keep-alive: serving this request keeps Railway warm, and the trivial DB query
// keeps the Supabase free-tier project from pausing after 7 idle days. Hit once
// a day by the GitHub Actions keepalive workflow.
fastify.get('/api/keepalive', async (request, reply) => {
  const supabase = await pingDatabase();
  return { ok: true, railway: true, supabase, timestamp: new Date().toISOString() };
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
  const { code, error: oauthError } = request.query as { code?: string; error?: string };

  // A denial (?error=access_denied, no code) or a missing code still hands
  // back to the app, like the Oura callback.
  if (oauthError) {
    return reply.type('text/html').send(resultPage({
      title: 'Strava not connected',
      lines: [oauthErrorMessage(oauthError, 'Strava')],
      deepLink: 'scora://auth/failed?reason=cancelled',
      buttonLabel: 'Back to SCORA',
    }));
  }
  if (!code) {
    return reply.code(400).type('text/html').send(resultPage({
      title: 'Strava not connected',
      lines: ['No authorization came back from Strava.'],
      deepLink: 'scora://auth/failed?reason=missing',
      buttonLabel: 'Back to SCORA',
    }));
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
      fastify.log.error({ err: errText }, 'Strava token error');
      return reply.code(400).send({ error: 'Token exchange failed' });
    }

    const tokenData: any = await tokenResponse.json();
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
      fastify.log.error({ err: e }, 'Failed to persist Strava tokens');
      return reply.code(500).send({
        error: 'Token storage failed',
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
            <p>Welcome, ${escapeHtml(String(athleteName))}.</p>
            <p style="color: #666; font-size: 14px; margin-top: 20px;">Opening SCORA...</p>
            <a href="#" id="fallback">Open SCORA</a>
            <div class="footer"><p>If the app doesn't open, tap the button above.</p></div>
          </div>
          <script>
            var deepLink = ${scriptString(deepLink)};
            document.getElementById('fallback').href = deepLink;
            setTimeout(function() { window.location.href = deepLink; }, 100);
          </script>
        </body>
      </html>
    `;
    return reply.type('text/html').send(html);
  } catch (error) {
    fastify.log.error({ err: error }, 'Strava exception');
    return reply.code(500).send({
      error: 'Auth failed',
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

  // Every outcome hands back to the app, which says what happened.
  if (oauthError) {
    return reply.type('text/html').send(resultPage({
      title: 'Oura not connected',
      lines: [oauthErrorMessage(oauthError)],
      deepLink: 'scora://oura/failed?reason=cancelled',
      buttonLabel: 'Back to SCORA',
    }));
  }
  if (!code || !state) {
    return reply.code(400).type('text/html').send(resultPage({
      title: 'Oura not connected',
      lines: ['No authorization came back from Oura.'],
      deepLink: 'scora://oura/failed?reason=missing',
      buttonLabel: 'Back to SCORA',
    }));
  }

  try {
    const tokenData = await exchangeOuraCode(code);
    await storeOuraTokens(state, tokenData); // state === athleteId
  } catch (e) {
    fastify.log.error({ err: e }, 'Oura auth failed');
    return reply.code(500).type('text/html').send(resultPage({
      title: 'Oura not connected',
      lines: ['Something went wrong linking Oura. Nothing was saved.'],
      deepLink: 'scora://oura/failed?reason=exchange',
      buttonLabel: 'Back to SCORA',
    }));
  }

  // Reopen the app; the dashboard reloads and the Oura cards light up.
  return reply.type('text/html').send(resultPage({
    title: 'Oura connected',
    lines: ['Opening SCORA...'],
    deepLink: 'scora://oura/success',
  }));
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
      fastify.log.warn(`Strava token unavailable for ${athleteId}: ${e instanceof Error ? e.message : e}`);
      return reply.code(401).send({
        error: 'Strava not connected or refresh failed — please reconnect Strava.',
      });
    }

    // Eight weeks: the weekday patterns claim "x of the last 6 weeks" and the
    // weekly miles chart spans 8, so the window is by date, not by count.
    let activities: any[];
    try {
      activities = await fetchRecentActivities(stravaToken, 56);
    } catch {
      return reply.code(401).send({ error: 'Strava token invalid or expired' });
    }

    const M = 1609.34;
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86400000);
    const paceMinPerMi = (a: any) => {
      if (!a.distance || !a.moving_time) return null;
      // Round the whole pace first, so 479.6 s reads 8:00, never 7:60.
      const secPerMi = Math.round(a.moving_time / (a.distance / M));
      return `${Math.floor(secPerMi / 60)}:${(secPerMi % 60).toString().padStart(2, '0')}`;
    };

    const runs = activities.filter(isRun);
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
    // Signed like the dashboard, never "-0%".
    const weekDeltaPct = lastWeekMiles > 0 ? Math.round(((thisWeekMiles - lastWeekMiles) / lastWeekMiles) * 100) : null;
    const weekDelta = weekDeltaPct === null ? 'n/a' : `${weekDeltaPct > 0 ? '+' : ''}${weekDeltaPct === 0 ? 0 : weekDeltaPct}%`;

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
    // Weekdays and "today" are the athlete's, never the server's (UTC on
    // Railway): start_date_local is local wall time marked Z, so its date part
    // is the athlete's day, and the app sends its local date.
    const localDay = (a: any): string => String(a.start_date_local || a.start_date || '').slice(0, 10);
    const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
    const todayLocal = isoDay(body.today) ?? athleteLocalToday(activities);
    // The last six weeks by the athlete's dates: exactly six of each weekday.
    const windowStart = new Date(Date.parse(`${todayLocal}T00:00:00Z`) - 42 * 86400000).toISOString().slice(0, 10);
    const sixWeeks = runs.filter(a => { const d = localDay(a); return d > windowStart && d <= todayLocal; });
    // Group by weekday, then by date: a weekday counts once per week, however
    // many runs fell on it ("Thursdays in 4 of the last 6 weeks").
    const byDay: Record<number, Map<string, any[]>> = {};
    for (const a of sixWeeks) {
      const date = localDay(a);
      const dates = (byDay[weekdayOf(date)] ||= new Map());
      dates.set(date, [...(dates.get(date) ?? []), a]);
    }
    const weeksInWindow = 6;
    const weekdayPatterns = Object.entries(byDay)
      .map(([dow, dates]) => {
        const d = Number(dow);
        const arr = [...dates.values()].flat();
        const weeks = dates.size;
        // Per day run, so two runs on one Thursday add up to that Thursday.
        const avgMiles = +(miles(arr) / weeks).toFixed(1);
        const avgMin = Math.round(arr.reduce((s, a) => s + (a.moving_time || 0), 0) / weeks / 60);
        const avgElev = Math.round(arr.reduce((s, a) => s + (a.total_elevation_gain || 0) * 3.281, 0) / weeks);
        return {
          weekday: WEEKDAYS[d],
          dow: d,
          occurrences: weeks,
          weeksSeen: `${weeks}/${weeksInWindow}`,
          avgMiles,
          avgMin,
          avgElevFt: avgElev,
          consistent: weeks >= 3, // ran this weekday in 3+ of the last 6 weeks
        };
      })
      .filter(p => p.consistent)
      .sort((a, b) => b.occurrences - a.occurrences);

    // --- Today's usual signal ---
    const todayDow = weekdayOf(todayLocal);
    const todayName = WEEKDAYS[todayDow];
    const todayPattern = weekdayPatterns.find(p => p.dow === todayDow) || null;
    const ranToday = runs.some(a => localDay(a) === todayLocal);
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
      // Derived here so answers can cite them: the model may not compute numbers.
      weekOverWeekMilesChange: +(thisWeekMiles - lastWeekMiles).toFixed(1),
      recentRunCount: recentRuns.length,
      recentRuns,
      weekdayPatterns,
      todaySignal,
    };

    const systemPrompt = `You are SCORA, a voice layer for endurance athletes. You READ and NAME patterns in the athlete's data. Posture is decided by rules elsewhere; never label one here.
HARD RULES:
- Every claim must be backed by a specific number in the data provided. Never invent data.
- Write every number exactly as it appears in the data (18.4, not "about 18"); do not add, average or convert numbers yourself. Name days by weekday, not by date. Replies with any other number are replaced.
- Answer the athlete's ACTUAL question using the relevant data. Different questions -> different answers.
- Numeric-first: lead with the number, then the interpretation.
- Tone: calm, precise, human. No fitness-bro hype, no exclamation spam, no cheerleading ("great job", "amazing", "keep it up" are banned).
- Authority (CLAUDE.md 3.6): if the athlete disagrees or pushes back, restate what the data shows and stop. Never change the read to agree, never apologize for it, never say "you're right" or "good catch". If something they mention is not in the data, say it is not in the data.

PATTERN-AWARENESS (allowed, NOT prescription):
- You MAY point out recurring patterns the data shows, e.g. "You've run hills every Thursday for the last 4 weeks (~9mi, ~90min). It's Thursday and nothing's logged yet."
- This is an OBSERVATION of a real pattern + a factual gap. It is allowed.
- The line you must NOT cross: telling them what to do. Never say "you should", "go do", "time to", "get your run in". State the pattern and the current fact; let them decide.
- Use weekdayPatterns + todaySignal to surface this ONLY when relevant to the question or when there's a clear, notable pattern-vs-today gap.

OUTPUT FORMAT (exactly):
- Line 1: one-sentence voice read that directly answers the question (may include a pattern observation if relevant).
- Then 2-4 metric lines, each: METRIC: <name> | VALUE: <number+unit> | TREND: <short trend only: up, down or flat, with a percent from the data if there is one, like +12% / down 5% / flat>. Never a posture word in TREND.
- Last line: CHART: <kind>, the one chart that best shows the data behind your answer. SCORA draws it from the real data; you only pick the kind:
${CHART_MENU}
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
      quota = await consumeCdvQuota(athleteId, undefined, undefined, quotaDay((request.body as any)?.today));
    } catch (e) {
      fastify.log.error({ err: e }, 'CDV quota check failed — allowing query (fail-open)');
    }
    if (quota && !quota.allowed) {
      return reply.code(429).send({
        error: `You've used your ${quota.limit} chats for today. Resets tomorrow.`,
        used: quota.used,
        limit: quota.limit,
        remaining: 0,
      });
    }

    const askModel = async (user: string): Promise<string> => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: user },
          ],
          max_tokens: 350,
          temperature: 0.5,
        }),
      });
      if (!res.ok) throw new LlmHttpError(await res.text());
      const json: any = await res.json();
      return json.choices[0].message.content;
    };

    let rawText: string;
    try {
      rawText = await askModel(userPrompt);
    } catch (e) {
      const err = e instanceof LlmHttpError ? e.message : String(e);
      fastify.log.error({ err }, 'OpenAI error');
      // No answer, so no query spent: give it back.
      if (quota?.allowed) {
        try {
          await refundCdvQuota(athleteId, quota.day);
        } catch (re) {
          fastify.log.error({ err: re }, 'CDV quota refund failed');
        }
      }
      return reply.code(500).send({ error: 'LLM failed' });
    }

    // Validators on the reply (CLAUDE.md §3.2): every number in the voice and
    // in each METRIC line must be in the data block sent to the model or in
    // the athlete's question. The METRIC lines are the model's own words, so
    // they never vouch for the voice. One retry, then the plain fallback.
    const final = await checkCdvWithRetry(rawText, dataBlock, String(message ?? ''), (note) => askModel(`${userPrompt}\n\n${note}`));
    const checked = final.checked;
    trackVoice(fastify.log, {
      surface: 'cdv', attempts: final.attempts, fallback: checked.fallback,
      bannedHits: final.seenBanned, unbackedCount: final.seenUnbacked,
    });
    if (checked.fallback) {
      fastify.log.warn(`CDV validator catch after ${final.attempts} attempts (banned: ${checked.bannedHits.join(', ') || 'none'}; unbacked numbers: ${checked.unbackedNumbers.length}), using fallback`);
    }
    // The model picks a chart kind; the spec and its data come from the activities.
    const chartKind = parseChartKind(final.raw);
    const chart = chartKind ? buildChartSpec(chartKind, activities, now) : null;

    return reply.send({
      voice: checked.voice,
      drivers: checked.drivers,
      data: {
        weeklyMiles: parseFloat(weeklyMiles),
        runCount,
        lastRun: lastRun.name,
      },
      remaining: quota?.remaining,
      limit: quota?.limit,
      ...(chart ? { chart } : {}),
    });
  } catch (error) {
    fastify.log.error({ err: error }, 'CDV exception');
    return reply.code(500).send({ error: 'CDV failed' });
  }
});

// Daily read — the free-tier core. Returns Today's Read (the voice) plus the
// six dashboard cards, all computed from the athlete's real Strava data.
fastify.post('/api/read', async (request, reply) => {
  try {
    const { athleteId, today: clientToday } = (request.body as any) || {};
    if (!athleteId) {
      return reply.code(400).send({ error: 'Missing: athleteId' });
    }

    let stravaToken: string;
    try {
      stravaToken = await getValidStravaToken(athleteId);
    } catch (e) {
      fastify.log.warn(`Strava token unavailable for ${athleteId}: ${e instanceof Error ? e.message : e}`);
      return reply.code(401).send({
        error: 'Strava not connected or refresh failed — please reconnect Strava.',
      });
    }

    // Everything since 35 days ago (the driver record needs a full 28 days;
    // 50 most recent activities can fall short for multi-sport athletes).
    let activities: any[];
    try {
      activities = await fetchRecentActivities(stravaToken, 35);
    } catch {
      return reply.code(401).send({ error: 'Strava token invalid or expired' });
    }

    // The athlete's local date for "last night" and calendar-day counts: the
    // app's, else the newest activity's offset.
    const localToday = isoDay((request.body as any)?.today) ?? athleteLocalToday(activities);

    // Pull Oura if the athlete has connected it; otherwise the Sleep + Recovery
    // cards fall back to connect prompts. Never blocks the read on Oura errors.
    let ouraSummary = null;
    let ouraConnected = false;
    try {
      const ouraToken = await getValidOuraToken(athleteId);
      ouraConnected = true;
      ouraSummary = await fetchOuraSummary(ouraToken, { localToday });
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
        nights: parseHealthNights(health.nights),
      };
      recoverySource = 'Apple Health';
      healthKitUsed = true;
    }

    const { cards, drivers, connections } = buildDashboard(
      activities,
      { strava: true, oura: ouraConnected, healthKit: healthKitUsed },
      recovery,
      recoverySource,
      localToday
    );

    // Posture is decided by rules from the driver record, not by the LLM.
    // race_in_next_7d comes from the active SCORA plan's race date (the same
    // plan /api/plan/block shows); no plan or no date leaves it null. Never
    // blocks the read.
    let raceInNext7d: boolean | null = null;
    if (generationEnabled()) {
      try {
        const active = await withTimeout(adaptStore().activeScoraPlan(String(athleteId)), 2000);
        raceInNext7d = raceWithinWeek(active?.goal_race_date, localToday);
      } catch (e) {
        fastify.log.warn(`Race date not loaded for read: ${e instanceof Error ? e.message : e}`);
      }
    }
    const posture = postureForRead(activities, recovery, { localToday, raceInNext7d });
    // A posture no rule backed (the engine's default, empty evidence) is not
    // shown or cited anywhere: no badge, no POSTURE line, no snapshot posture.
    const postureOut = posture.backed
      ? {
          posture: posture.result.posture,
          rule: posture.result.rule,
          engineVersion: posture.result.engine_version,
          completeness: posture.record.completeness,
        }
      : null;

    readSnapshots.set(athleteId, { cards, drivers: [...drivers, ...posture.evidence], posture: posture.backed ? posture.result.posture : null });
    // Plan tier: tomorrow's workout on a SCORA plan goes through the
    // deterministic adaptation rules (doc 07 v2 §6.2). Off unless
    // PLAN_ADAPTATIONS=on; never blocks or fails the read.
    if (adaptationsEnabled()) {
      // The scheduler sends the athlete's local date; the app does not yet, so
      // fall back to the newest activity's UTC offset, never the server's UTC day.
      const today = isoDay((request.body as any)?.today) ?? athleteLocalToday(activities);
      try {
        // Optional: gpt-4o-mini words the reason from the posture drivers,
        // checked in code, fixed sentence on any failure (ADAPTATION_REASON_LLM).
        const llm = reasonLlmEnabled() ? openAiReasonLlm(process.env.OPENAI_API_KEY || '') : null;
        const opts = llm
          ? {
              writeReason: async (d: Parameters<typeof writeReason>[0], fallback: string) => {
                const r = await writeReason(d, posture.evidence, llm, fallback);
                // Numbers masked: an unbacked number can be a health value.
                if (r.source === 'fallback') fastify.log.info(`adaptation reason fell back: ${r.issues.map((x) => x.replace(/\d+(?:\.\d+)?/g, '#')).join('; ')}`);
                trackVoice(fastify.log, {
                  surface: 'adaptation_reason', attempts: 1, fallback: r.source === 'fallback',
                  // The reason check's own advice and coach catches count as banned too.
                  bannedHits: r.issues.flatMap((x) => x.startsWith('banned: ') ? [x.slice('banned: '.length)] : x === 'advice' || x === 'coach' ? [x] : []),
                  unbackedCount: r.issues.filter((x) => x.startsWith('unbacked number')).length,
                });
                return r.text;
              },
            }
          : {};
        await withTimeout(adaptTomorrow(String(athleteId), today, posture.result.posture, adaptStore(), opts), llm ? 8000 : 4000);
      } catch (e) {
        fastify.log.error(`Plan adaptation failed for ${athleteId}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // The athlete's own plan for today, if they pasted one. The read may name
    // it; it never changes it (CLAUDE.md §1.3). Never blocks the read. Loaded
    // before the no-drivers return so Plan Today shows without recent runs.
    const today = isoDay(clientToday) ?? athleteLocalToday(activities);
    let plan = planForRead([], today);
    let weekPlanRows: StoredWorkout[] | null = null;
    try {
      // From this Monday (for Week So Far) to a week ahead, so "nothing
      // scheduled today" is known when a plan exists.
      const rows = await planStore().workoutsBetween(String(athleteId), mondayOf(today), addDays(today, 6));
      weekPlanRows = rows;
      plan = planForRead(rows.filter((r) => r.scheduled_date >= today), today);
      // PRD §5.A.3: a Plan Today card when a plan exists, before Connections.
      // The read snapshot holds this same array, so a tap on it finds it.
      const planCard = planTodayCard(rows, today);
      if (planCard) {
        const at = cards.findIndex((c) => c.id === 'connections');
        cards.splice(at < 0 ? cards.length : at, 0, planCard);
      }
    } catch (e) {
      fastify.log.warn(`Plan not loaded for read: ${e instanceof Error ? e.message : e}`);
    }

    // CLAUDE.md §3.3: a SCORA session adds the Plan tier's "Today:" line,
    // even on a day with too little activity to read.
    const planTodayLine = todayLine(plan.workout, describeWorkout);

    // With no drivers there is nothing the voice can honestly say. Don't invent.
    if (drivers.length === 0) {
      return reply.send({
        read: {
          voice: 'Not enough recent activity to read yet. Once a few runs land in Strava, the morning read fills in.',
          ...(planTodayLine ? { today: planTodayLine } : {}),
        },
        posture: postureOut,
        cards,
        drivers,
        connections,
        generatedAt: new Date().toISOString(),
      });
    }

    // Plan changes the engine made that touch today: the read may observe
    // them (CLAUDE.md §1.3). Only when adaptations are on; never blocks.
    let planChange = planChangeContext([]);
    if (adaptationsEnabled()) {
      try {
        planChange = planChangeContext(await withTimeout(adaptStore().forDay(String(athleteId), today), 2000));
      } catch (e) {
        fastify.log.warn(`Plan changes not loaded for read: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Substance for the read: the knowledge library when KNOWLEDGE_RETRIEVAL=on,
    // else the curated pattern library, else nothing. Never blocks the read.
    const knowledgeDeps = knowledgeDepsFromEnv({ warn: (m) => fastify.log.warn(m) });
    const knowledge = await knowledgeForRead(
      {
        posture: posture.result.posture,
        postureBacked: posture.backed,
        drivers: posture.record.drivers,
        completeness: posture.record.completeness,
        scheduled: plan.scheduled,
        sleepSeconds: recovery?.sleepSeconds ?? null,
      },
      knowledgeDeps
    );

    // The numbers behind the posture are drivers too, so naming it is backed.
    // The numbers behind the posture and today's planned session are drivers
    // too, so naming either is backed.
    const readDrivers = [...drivers, ...posture.evidence, ...(plan.driver ? [plan.driver] : []), ...planChange.drivers];

    const systemPrompt = `You are SCORA, an interpretation layer for endurance athletes. You READ and NAME what the data shows. You are NOT a coach and you never prescribe.

HARD RULES:
- Every claim must be backed by a driver in the DRIVERS list. Never invent a number or reference data that isn't listed (no sleep, HRV, or recovery unless present).
- Numeric-first: reference the raw value, then say what it means.
- Non-prescriptive: never tell the athlete what workout to do, never use "you should / you need to / do a / go for". ${posture.backed ? "The POSTURE line is already decided by SCORA's rules. You may name that posture as an observation, never a different one, and never as an instruction." : 'No posture is given today: name none (primed, steady, moderate, back-off, rest, taper) and do not sum up the body as settled, ready or recovered.'}
- The athlete's plan is theirs: never suggest skipping, moving, shortening, delaying or easing a planned session, even when the posture and the plan disagree. Name both and stop.
- Tone: calm, considered, short sentences, plain English. No exclamation points, no emoji, no hype ("great job", "crush it", "keep it up" are banned). No "coach".

OUTPUT: 2-3 sentences of plain prose. No headers, no bullet points, no metric lines — just the read.`;

    const driverBlock = readDrivers
      .map((d) => `- ${d.metric}: ${d.value}${d.trend ? ` (${d.trend})` : ''}`)
      .join('\n');
    const userPrompt = `DRIVERS (the only values you may cite):
${driverBlock}

${[posture.promptLine, plan.promptLine, planChange.promptLine].filter(Boolean).join('\n')}
${knowledge.promptBlock ? `\n${knowledge.promptBlock}\n` : ''}
Write today's read using only these drivers.`;

    let voice: string;
    try {
      const result = await generateValidatedVoice({
        systemPrompt,
        userPrompt,
        drivers: readDrivers,
        maxTokens: 200,
        leadIn: "Today's numbers", surface: 'daily',
        log: fastify.log,
      });
      voice = result.voice;
      if (plan.driver && plan.workout?.planned_intensity !== 'rest') {
        fastify.log.info(readPlanLine({ athleteId, localDate: today, named: readNamesPlan(voice, plan.driver) }));
      }
    } catch (e) {
      fastify.log.error({ err: e }, 'OpenAI error (read)');
      return reply.code(500).send({
        error: 'Read generation failed',
      });
    }

    const generatedAt = new Date().toISOString();
    if (knowledge.mode === 'library' && knowledgeDeps.sb) {
      recordCitations(knowledgeDeps.sb, athleteId, generatedAt, knowledge.chunks).catch((e) =>
        fastify.log.warn(`read_citations insert failed: ${e instanceof Error ? e.message : e}`)
      );
    }

    // Plan tier: drivers in the read link to the raw series behind them
    // (CLAUDE.md §3.4). Spans are found in code on the validated text.
    let charts: { links: ReturnType<typeof linkDrivers>; series: ReturnType<typeof buildDriverSeries> } | undefined;
    if (inlineChartsEnabled()) {
      // Charts are extra: any failure leaves the read as plain text.
      try {
        const today = isoDay((request.body as any)?.today) ?? athleteLocalToday(activities);
        const series = buildDriverSeries(activities, recovery, today);
        const links = linkDrivers(voice, readDrivers, new Set(Object.keys(series) as SeriesKey[]));
        const used = new Set(links.map((l) => l.key));
        charts = { links, series: Object.fromEntries(Object.entries(series).filter(([k]) => used.has(k as SeriesKey))) };
      } catch (e) {
        fastify.log.error(`Inline charts failed for ${athleteId}: ${e instanceof Error ? e.message : e}`);
      }
    }

    return reply.send({
      read: { voice, numbers: numericLine(readDrivers), ...(charts ?? {}), ...(planTodayLine ? { today: planTodayLine } : {}) },
      weekSoFar: weekSoFar(activities, today, weekPlanRows && weekPlanRows.length ? plannedRunMinutes(weekPlanRows) : undefined),
      posture: postureOut,
      knowledge: { mode: knowledge.mode, chunks: knowledge.chunks.length, pattern: knowledge.pattern?.id ?? null },
      plan: { today: plan.driver?.value ?? null },
      cards,
      drivers: readDrivers,
      connections,
      generatedAt,
    });
  } catch (error) {
    fastify.log.error({ err: error }, 'Read exception');
    return reply.code(500).send({
      error: 'Read failed',
    });
  }
});

// Card tap-to-expand (Free tier, card level). Interprets one dashboard card
// from the athlete's last read. Needs a read in the last 10 minutes; on 409
// the app keeps showing the card's own translation.
fastify.post('/api/card-expand', async (request, reply) => {
  const { athleteId, cardId } = (request.body as any) || {};
  if (!athleteId || !cardId) {
    return reply.code(400).send({ error: 'Missing: athleteId, cardId' });
  }
  const snapshot = readSnapshots.get(String(athleteId));
  if (!snapshot) {
    return reply.code(409).send({ error: 'No recent read. Refresh the dashboard first.' });
  }
  const card = snapshot.cards.find((c) => c.id === cardId);
  if (!card) {
    return reply.code(404).send({ error: `Unknown card: ${cardId}` });
  }

  const plan = planCardExpansion(card, snapshot);
  if (plan.kind === 'static') {
    return reply.send({ cardId, reply: plan.reply, drivers: [], generated: false });
  }
  try {
    const result = await generateValidatedVoice({
      systemPrompt: plan.systemPrompt,
      userPrompt: plan.userPrompt,
      drivers: plan.drivers,
      maxTokens: 150,
      leadIn: card.title, surface: 'card',
      log: fastify.log,
    });
    return reply.send({ cardId, reply: result.voice, drivers: plan.drivers, generated: true });
  } catch (e) {
    fastify.log.error(`Card expansion failed: ${e instanceof Error ? e.message : e}`);
    trackVoice(fastify.log, { surface: 'card', attempts: 1, fallback: true, bannedHits: [], unbackedCount: 0 });
    return reply.send({ cardId, reply: card.translation ?? '', drivers: [], generated: false });
  }
});

// Delivery preferences (doc 09 §1.4): time zone and morning push time, set
// in onboarding. The Supabase client is created on first use.
let _prefs: PrefsStore | null = null;
const prefsStore: PrefsStore = new Proxy({} as PrefsStore, {
  get(_t, key: keyof PrefsStore) {
    if (!_prefs) {
      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase env not configured');
      _prefs = supabasePrefsStore(createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY));
    }
    return (_prefs[key] as any).bind(_prefs);
  },
});

fastify.get('/api/preferences', async (request, reply) => {
  const { athleteId } = request.query as { athleteId?: string };
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  try {
    const p = await prefsStore.get(athleteId);
    return reply.send({ timezone: p.timezone, deliveryMinute: p.delivery_minute, onboarded: p.onboarded_at != null });
  } catch (e) {
    fastify.log.error(`Preferences load failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Loading preferences failed.' });
  }
});

fastify.put('/api/preferences', async (request, reply) => {
  const { athleteId, timezone, deliveryMinute, onboarded } = (request.body as any) || {};
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  if (timezone !== undefined && !isValidTimezone(timezone)) {
    return reply.code(400).send({ error: 'Unknown time zone.' });
  }
  if (deliveryMinute !== undefined && !isValidDeliveryMinute(deliveryMinute)) {
    return reply.code(400).send({ error: 'Delivery time must be a whole minute between 0 and 1439.' });
  }
  try {
    const p = await prefsStore.update(String(athleteId), {
      timezone, delivery_minute: deliveryMinute, onboarded: onboarded === true,
    });
    return reply.send({ timezone: p.timezone, deliveryMinute: p.delivery_minute, onboarded: p.onboarded_at != null });
  } catch (e) {
    fastify.log.error(`Preferences save failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Saving preferences failed.' });
  }
});

// Manual plan entry (Free tier plan source, doc 09 §1.4). The athlete pastes
// a plan; gpt-4o-mini transcribes it and plan-parse.ts keeps only rows whose
// dates resolve and whose numbers appear in the pasted text.
// A real calendar date or null: 2026-13-01 and 2026-02-31 do not pass.
const isoDay = (v: unknown): string | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
};
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
let _planSb: ReturnType<typeof createClient> | null = null;
const planStore = () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase env not configured');
  _planSb = _planSb ?? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  return supabasePlanStore(_planSb);
};
const adaptStore = () => {
  planStore(); // same env check and client
  return supabaseAdaptStore(_planSb!);
};

fastify.post('/api/plan/manual', async (request, reply) => {
  const { athleteId, text, today: clientToday } = (request.body as any) || {};
  if (!athleteId || typeof text !== 'string') {
    return reply.code(400).send({ error: 'Missing: athleteId, text' });
  }
  // The app sends its local date so weekday names resolve in the athlete's zone.
  const today = isoDay(clientToday) ?? new Date().toISOString().slice(0, 10);
  try {
    const parsed = await parsePlanText(text, today, openAiPlanLlm(process.env.OPENAI_API_KEY || ''));
    if (parsed.rows.length === 0) {
      return reply.code(422).send({
        error: 'No sessions with a day or date were found. Try one session per line, like "Tue: 45 min tempo".',
        rejected: parsed.rejected.map((r) => r.reason),
      });
    }
    const { planId } = await planStore().saveManualPlan(String(athleteId), text.trim(), parsed.rows);
    return reply.send({
      planId,
      workouts: parsed.rows,
      rejected: parsed.rejected.map((r) => r.reason),
      adjusted: parsed.adjusted.map((r) => r.reason),
    });
  } catch (e) {
    if (e instanceof PlanParseError) return reply.code(422).send({ error: e.message });
    fastify.log.error(`Manual plan failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Saving the plan failed.' });
  }
});

// Calendar import (Q17 option B): the app fetches the athlete's plan feed and
// sends the .ics text; the server never fetches a URL. Off unless ICAL_IMPORT=on.
// JSON escaping can grow a 1 MB feed to about 2.5 MB (\r\n, quotes, slashes).
fastify.post('/api/plan/ical', { bodyLimit: 3_000_000 }, async (request, reply) => {
  if (process.env.ICAL_IMPORT !== 'on') return reply.code(404).send({ error: 'Not found' });
  const { athleteId, ics, today: clientToday, timeZone, refresh } = (request.body as any) || {};
  if (!athleteId || typeof ics !== 'string') {
    return reply.code(400).send({ error: 'Missing: athleteId, ics' });
  }
  const today = isoDay(clientToday) ?? new Date().toISOString().slice(0, 10);
  try {
    const parsed = importIcs(ics, today, typeof timeZone === 'string' ? timeZone : undefined);
    if (parsed.rows.length === 0) {
      return reply.code(422).send({
        error: 'No upcoming sessions were found in this calendar.',
        rejected: parsed.rejected.map((r) => r.reason),
      });
    }
    // A refresh never replaces a plan the athlete pasted since the import.
    const saved = refresh === true
      ? await planStore().refreshIcalPlan(String(athleteId), parsed.rows)
      : await planStore().saveIcalPlan(String(athleteId), parsed.rows);
    if (!saved) return reply.code(409).send({ error: 'Your plan no longer comes from this calendar.' });
    const { planId } = saved;
    return reply.send({
      planId,
      workouts: parsed.rows,
      rejected: parsed.rejected.map((r) => r.reason),
      adjusted: parsed.adjusted.map((r) => r.reason),
      skipped_past: parsed.skipped_past,
    });
  } catch (e) {
    if (e instanceof IcalImportError) return reply.code(422).send({ error: e.message });
    fastify.log.error(`Calendar import failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Importing the calendar failed.' });
  }
});

// The next 14 sessions of the active plan, up to 26 weeks ahead (a plan can
// start next month).
fastify.get('/api/plan', async (request, reply) => {
  const { athleteId, today: clientToday } = request.query as { athleteId?: string; today?: string };
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  const today = isoDay(clientToday) ?? new Date().toISOString().slice(0, 10);
  try {
    const store = planStore();
    const workouts = withDescriptions((await store.workoutsBetween(athleteId, today, addDays(today, 182))).slice(0, 14), describeWorkout);
    // The last 7 days' sessions the athlete has not marked yet (CLAUDE.md
    // §6.2: a miss is theirs to acknowledge; nothing reschedules it).
    const recent = withDescriptions((await store.workoutsBetween(athleteId, addDays(today, -7), addDays(today, -1)))
      .filter((w) => w.athlete_completed == null && w.planned_intensity !== 'rest'), describeWorkout);
    return reply.send({ today, workouts, recent });
  } catch (e) {
    fastify.log.error(`Plan load failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Loading the plan failed.' });
  }
});

// The app scheduled a session on the athlete's Watch (doc 10 3.1.9: share of
// sessions pushed). Records the time only; the Watch copy is the app's.
fastify.post('/api/plan/workouts/:id/watch-sent', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { athleteId } = (request.body as any) || {};
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return reply.code(404).send({ error: 'No such session.' });
  }
  try {
    const ok = await planStore().markWatchSent(String(athleteId), id);
    return ok ? reply.send({ id }) : reply.code(404).send({ error: 'No such session on your plan.' });
  } catch (e) {
    fastify.log.error(`Recording Watch send failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Recording the Watch send failed.' });
  }
});

// The athlete marks a past or today's session done or missed. A miss is only
// recorded: the plan engine never moves a missed session (CLAUDE.md §6.2).
fastify.post('/api/plan/workouts/:id/status', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { athleteId, status, today: clientToday } = (request.body as any) || {};
  if (!athleteId || (status !== 'done' && status !== 'missed')) {
    return reply.code(400).send({ error: 'Missing: athleteId, status (done or missed)' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return reply.code(404).send({ error: 'No such session.' });
  }
  // The app's local date, within a day of the server's (time zones), so a
  // far-future "today" cannot mark sessions still ahead.
  const serverDay = new Date().toISOString().slice(0, 10);
  const asked = isoDay(clientToday);
  const today = asked && asked >= addDays(serverDay, -1) && asked <= addDays(serverDay, 1) ? asked : serverDay;
  try {
    const ok = await planStore().markCompleted(String(athleteId), id, status === 'done', today);
    return ok ? reply.send({ id, status }) : reply.code(404).send({ error: 'No such session on your plan, or it is still ahead.' });
  } catch (e) {
    fastify.log.error(`Marking session failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Marking the session failed.' });
  }
});

// SCORA plan generation (doc 07 v2 §6.1). Reviewed templates only; drafts
// never load here. Off unless PLAN_GENERATION=on; Plan tier gating waits for
// the Stripe item.
let _templates: PlanTemplate[] | null = null;
// The goals the plan setup screen may offer (doc 09 §2.3), from the loaded
// templates. Off unless PLAN_GENERATION=on, like generation itself. Empty
// while a coach's plan is active: generation is hidden then (CLAUDE.md §5.3).
fastify.get('/api/plan/options', async (request, reply) => {
  if (!generationEnabled()) return reply.code(404).send({ error: 'Not found' });
  const { athleteId } = request.query as { athleteId?: string };
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  try {
    _templates = _templates ?? loadTemplates(TEMPLATE_DIR);
    planStore(); // same env check and client
    if (await supabaseGenerateStore(_planSb!).hasActiveCoachPlan(String(athleteId))) return reply.send({ goals: [] });
    return reply.send({ goals: planOptions(_templates) });
  } catch (e) {
    fastify.log.error(`Plan options failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Loading plan options failed.' });
  }
});

// The active SCORA plan as a block: this week, the phases, the race (PRD
// §5.B.1). Null without one, or while a coach's plan is active. Off unless
// PLAN_GENERATION=on, since only generation makes SCORA plans.
fastify.get('/api/plan/block', async (request, reply) => {
  if (!generationEnabled()) return reply.code(404).send({ error: 'Not found' });
  const { athleteId, today: clientToday } = request.query as { athleteId?: string; today?: string };
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  const today = isoDay(clientToday);
  if (!today) return reply.code(400).send({ error: 'Missing: today (YYYY-MM-DD, local)' });
  try {
    const store = adaptStore();
    if (await store.hasActiveCoachPlan(athleteId)) return reply.send({ block: null });
    const plan = await store.activeScoraPlan(athleteId);
    return reply.send({ block: plan ? planBlock(plan, today) : null });
  } catch (e) {
    fastify.log.error(`Plan block load failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Loading the plan failed.' });
  }
});

fastify.post('/api/plan/generate', async (request, reply) => {
  if (!generationEnabled()) return reply.code(404).send({ error: 'Not found' });
  const body = (request.body as any) || {};
  if (!body.athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  // The athlete's local date decides which sessions are still ahead; the
  // server's UTC day would drop today's for a US evening request.
  const today = isoDay(body.today);
  if (!today) return reply.code(400).send({ error: 'Missing: today (YYYY-MM-DD, local)' });
  try {
    _templates = _templates ?? loadTemplates(TEMPLATE_DIR);
    const req = parseGenerateRequest(body);
    planStore(); // same env check and client
    const { planId, plan } = await generatePlan(String(body.athleteId), req, today, _templates, supabaseGenerateStore(_planSb!));
    return reply.send({
      planId,
      template: { slug: plan.template_slug, version: plan.template_version },
      start_date: plan.start_date,
      end_date: plan.end_date,
      workouts: plan.workouts.length,
    });
  } catch (e) {
    if (e instanceof GenerateError) {
      return reply.code(e.code === 'bad_request' ? 400 : 422).send({ error: e.message, code: e.code });
    }
    fastify.log.error(`Plan generation failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Building the plan failed.' });
  }
});

// Race prediction (Plan tier, PRD §5.B.6): a range from the athlete's own
// recent runs, with the efforts it was built from. `race` defaults to the
// goal of the active SCORA plan. Off unless RACE_PREDICTIONS=on.
fastify.get('/api/plan/prediction', async (request, reply) => {
  if (!predictionsEnabled()) return reply.code(404).send({ error: 'Not found' });
  const { athleteId, race: raceParam, today: clientToday } = request.query as { athleteId?: string; race?: string; today?: string };
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  try {
    const race = raceParam ?? (await adaptStore().activeScoraPlan(athleteId))?.template.goal_type;
    if (!race) return reply.code(422).send({ error: 'No race given and no active plan with a goal race.' });
    const token = await getValidStravaToken(athleteId);
    let activities: any[];
    try {
      activities = await fetchActivitiesSince(token, Math.floor(Date.now() / 1000) - 60 * 86400);
    } catch {
      return reply.code(401).send({ error: 'Strava token invalid or expired' });
    }
    const today = isoDay(clientToday) ?? athleteLocalToday(activities);
    return reply.send({ prediction: predictRace(activities, race, today) });
  } catch (e) {
    fastify.log.error(`Prediction failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Prediction failed.' });
  }
});

// Calorie engine (Plan tier, PRD §5.B.7): burn estimates for the last 14
// days of activities, each with its method and inputs. Weight comes from the
// athlete's Strava profile; without it there are no estimates. Off unless
// CALORIE_ENGINE=on.
fastify.get('/api/calories', async (request, reply) => {
  if (!caloriesEnabled()) return reply.code(404).send({ error: 'Not found' });
  const { athleteId } = request.query as { athleteId?: string };
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  try {
    const token = await getValidStravaToken(athleteId);
    const headers = { Authorization: `Bearer ${token}` };
    const after = Math.floor(Date.now() / 1000) - 14 * 86400;
    const athleteRes = await fetch('https://www.strava.com/api/v3/athlete', { headers });
    if (!athleteRes.ok) return reply.code(401).send({ error: 'Strava token invalid or expired' });
    const athlete = (await athleteRes.json()) as { weight?: number | null };
    let activities: any[];
    try {
      activities = await fetchActivitiesSince(token, after);
    } catch {
      return reply.code(401).send({ error: 'Strava token invalid or expired' });
    }
    const weight = typeof athlete.weight === 'number' && athlete.weight > 0 ? athlete.weight : null;
    const estimates = activities.map((a) => estimateCalories(a, weight)).filter((e) => e !== null);
    return reply.send({ version: CALORIE_ENGINE_VERSION, weight_kg: weight, estimates });
  } catch (e) {
    fastify.log.error(`Calories failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Calorie estimates failed.' });
  }
});

// Named plan adaptations, newest first (doc 07 v2 §5: GET /plan/adaptations).
// Every change the engine made shows its reason; none are silent.
// The athlete acknowledges a plan change (doc 07 v2 §5). It leaves the list
// and the read; the change itself stays in the plan.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
fastify.post('/api/plan/adaptations/:id/dismiss', async (request, reply) => {
  if (!adaptationsEnabled()) return reply.code(404).send({ error: 'Not found' });
  const { id } = request.params as { id: string };
  const { athleteId } = (request.body as any) || {};
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  if (!UUID.test(id)) return reply.code(404).send({ error: 'No such plan change.' });
  try {
    const ok = await adaptStore().dismiss(String(athleteId), id);
    return ok ? reply.send({ dismissed: id }) : reply.code(404).send({ error: 'No such plan change.' });
  } catch (e) {
    fastify.log.error(`Adaptation dismiss failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Dismissing the plan change failed.' });
  }
});

fastify.get('/api/plan/adaptations', async (request, reply) => {
  // Off with the feature. Like /api/plan it trusts athleteId until Sign in
  // with Apple lands (auth is Evan's item).
  if (!adaptationsEnabled()) return reply.code(404).send({ error: 'Not found' });
  const { athleteId } = request.query as { athleteId?: string };
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  try {
    const store = adaptStore();
    // A coach's plan replaces SCORA's (CLAUDE.md §5.3): its old changes go too.
    if (await store.hasActiveCoachPlan(athleteId)) return reply.send({ adaptations: [] });
    return reply.send({ adaptations: await store.recent(athleteId, 20) });
  } catch (e) {
    fastify.log.error(`Adaptations load failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Loading plan changes failed.' });
  }
});

// Every change the engine made to the active plan, dismissed ones included
// (PRD §5.B.1). Same flag and coach rule as the list above.
fastify.get('/api/plan/adaptations/history', async (request, reply) => {
  if (!adaptationsEnabled()) return reply.code(404).send({ error: 'Not found' });
  const { athleteId } = request.query as { athleteId?: string };
  if (!athleteId) return reply.code(400).send({ error: 'Missing: athleteId' });
  try {
    const store = adaptStore();
    if (await store.hasActiveCoachPlan(athleteId)) return reply.send({ adaptations: [] });
    return reply.send({ adaptations: await store.history(athleteId, 200) });
  } catch (e) {
    fastify.log.error(`Adaptation history load failed: ${e instanceof Error ? e.message : e}`);
    return reply.code(500).send({ error: 'Loading plan changes failed.' });
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
      fastify.log.warn(`Strava token unavailable for ${athleteId}: ${e instanceof Error ? e.message : e}`);
      return reply.code(401).send({
        error: 'Strava not connected or refresh failed — please reconnect Strava.',
      });
    }

    // This week and the one before, plus a day for time zones.
    let activities: any[];
    try {
      activities = await fetchRecentActivities(stravaToken, 15);
    } catch {
      return reply.code(401).send({ error: 'Strava token invalid or expired' });
    }

    let ouraSummary = null;
    try {
      const ouraToken = await getValidOuraToken(athleteId);
      ouraSummary = await fetchOuraSummary(ouraToken, { localToday: isoDay((request.body as any)?.today) ?? athleteLocalToday(activities) });
    } catch {
      // Oura optional — weekly read works on Strava alone.
    }

    // The 7 complete days before the athlete's today: a Monday-morning push
    // must not count this morning's run, and the plan driver reads the same days.
    const today = isoDay((request.body as any)?.today) ?? athleteLocalToday(activities);
    const { stats, drivers, hasData } = buildWeeklySummary(activities, ouraSummary, today);

    // The athlete's plan over the same 7 days, if they have one: the review
    // may name how the week tracked against it, never what to do about it.
    if (hasData) {
      try {
        // The 7 complete days before today: a Sunday-morning review must not
        // count Sunday's long run as missed.
        const from = addDays(today, -7);
        const to = addDays(today, -1);
        const planDriverWeek = weeklyPlanDriver(await planStore().workoutsBetween(String(athleteId), from, to), activities, from, to);
        if (planDriverWeek) drivers.push(planDriverWeek);
      } catch (e) {
        fastify.log.warn(`Plan not loaded for weekly: ${e instanceof Error ? e.message : e}`);
      }
    }

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
- If a "Plan, last 7 full days" driver is listed, you may say how the week tracked against the athlete's plan, as a fact. Never judge it, never suggest catching up or cutting back.

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
        leadIn: 'This week', surface: 'weekly',
        log: fastify.log,
      });
      voice = result.voice;
    } catch (e) {
      fastify.log.error({ err: e }, 'OpenAI error (weekly)');
      return reply.code(500).send({
        error: 'Weekly read generation failed',
      });
    }

    return reply.send({
      read: { voice },
      stats,
      drivers,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    fastify.log.error({ err: error }, 'Weekly exception');
    return reply.code(500).send({
      error: 'Weekly read failed',
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
    fastify.log.error({ err: e }, 'register-device failed');
    return reply.code(500).send({
      error: 'Failed to register device',
    });
  }
});

fastify.post('/api/unregister-device', async (request, reply) => {
  const { athleteId, deviceToken } = (request.body as any) || {};
  if (!athleteId || !deviceToken) {
    return reply.code(400).send({ error: 'Missing: athleteId, deviceToken' });
  }
  try {
    await unregisterDeviceToken(String(athleteId), String(deviceToken));
    return reply.send({ ok: true });
  } catch (e) {
    fastify.log.error({ err: e }, 'unregister-device failed');
    return reply.code(500).send({ error: 'Failed to remove device' });
  }
});

// The app was opened from a scheduled push (doc 10 1.1.2: opened within 4h of
// delivery). Logged only, nothing stored. The app echoes the push's kind,
// local date and send time (unix seconds).
fastify.post('/api/events/push-open', async (request, reply) => {
  const { athleteId, kind, date, sentAt } = (request.body as any) || {};
  // The Strava athlete id the app stores at sign-in (device_tokens are keyed
  // by it), a real date and a send time in the last 7 days (a minute of clock
  // skew allowed): nothing else can reach the log line or skew the gate.
  const now = Date.now();
  if (typeof athleteId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(athleteId)
      || (kind !== 'daily' && kind !== 'weekly')
      || typeof date !== 'string' || !isoDay(date)
      || typeof sentAt !== 'number' || !Number.isFinite(sentAt)
      || sentAt * 1000 > now + 60_000 || sentAt * 1000 < now - 7 * 86_400_000) {
    return reply.code(400).send({ error: 'Missing: athleteId, kind (daily or weekly), date, sentAt' });
  }
  const afterMin = Math.max(0, Math.round((now - sentAt * 1000) / 60000));
  fastify.log.info(pushOpenLine({ kind, athleteId, localDate: date, afterMin }));
  return reply.code(204).send();
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
    fastify.log.error({ err: e }, 'push test failed');
    return reply.code(500).send({
      error: 'Push test failed',
    });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('API running on 0.0.0.0:3000');
    console.log('POST /api/cdv - Chat-driven analysis');
    // Push scheduler (daily + weekly). No-op until APNS_* env is configured.
    startScheduler(3000, fastify.log, prefsStore);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Tests import this module and drive the routes with fastify.inject, so they
// set SCORA_NO_LISTEN=1 with NODE_ENV=test: no port, no push scheduler. Both
// are required, so a stray SCORA_NO_LISTEN in a deploy still starts the server.
if (process.env.SCORA_NO_LISTEN === '1' && process.env.NODE_ENV === 'test') {
  console.log('SCORA_NO_LISTEN: not listening (tests)');
} else {
  start();
}

export default fastify;
