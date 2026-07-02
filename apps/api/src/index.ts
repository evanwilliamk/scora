import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

const fastify = Fastify({ logger: true });
fastify.register(cors);

fastify.get('/', async (request, reply) => {
  return reply.type('text/html').send('<html><head><meta charset="utf-8"><style>body{background:#000;color:#fff;font-family:system-ui;margin:0;padding:40px;display:flex;align-items:center;justify-content:center;min-height:100vh}.container{max-width:600px;text-align:center}.logo{font-size:100px;margin:0;margin-bottom:20px}.title{font-size:48px;margin:0 0 20px;font-weight:700}.tagline{color:#999;font-size:18px;margin:0 0 50px}ul{list-style:none;margin:40px 0;padding:0;text-align:left;display:inline-block}li{color:#ccc;font-size:16px;padding:12px 0}li:before{content:"•";margin-right:12px;color:#666}.footer{margin-top:60px;padding-top:40px;border-top:1px solid #222;font-size:13px;color:#666}a{color:#fff;text-decoration:none}a:hover{color:#999}</style></head><body><div class="container"><div class="logo">S</div><h1 class="title">SCORA</h1><p class="tagline">AI fitness coach that reads your body and adapts your training.</p><ul><li>Daily posture reads</li><li>Real-time adaptation</li><li>Strava + Oura integration</li><li>Human coach marketplace</li></ul><div class="footer"><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a></p></div></div></body></html>');
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

    const deepLink = `scora://auth/success?athlete_id=${athleteId}&name=${encodeURIComponent(athleteName)}&token=${encodeURIComponent(accessToken)}`;
    
    const userAgent = request.headers['user-agent'] || '';
    const isIOS = /iPhone|iPad|iPod/.test(userAgent);

    if (isIOS) {
      return reply.redirect(302, deepLink);
    }

    return reply.type('text/html').send(`
      <html><head><meta charset="utf-8"><style>body{background:#000;color:#fff;font-family:system-ui;margin:0;padding:40px;display:flex;align-items:center;justify-content:center;min-height:100vh}.container{max-width:400px;text-align:center}.logo{font-size:100px;margin-bottom:20px}h1{font-size:40px;margin:0 0 20px;font-weight:700}p{color:#999;font-size:16px;margin:0 0 30px}a{display:inline-block;padding:14px 32px;background:#fff;color:#000;text-decoration:none;border-radius:4px;font-weight:600}a:hover{opacity:0.9}.footer{margin-top:40px;padding-top:20px;border-top:1px solid #222;font-size:13px;color:#666}</style></head><body><div class="container"><div class="logo">S</div><h1>Strava Linked</h1><p>Welcome, ${athleteName}!</p><a href="${deepLink}">Open SCORA</a><div class="footer"><p>If you're not redirected, tap the button above.</p></div></div></body></html>
    `);
  } catch (error) {
    fastify.log.error('Strava exception:', error);
    return reply.code(500).send({ error: 'Failed', detail: String(error) });
  }
});

// CDV endpoint - simple and safe
fastify.post('/api/cdv', async (request, reply) => {
  try {
    const body = request.body as any;
    const { message, stravaToken, athleteId } = body;

    if (!message || !stravaToken || !athleteId) {
      return reply.code(400).send({ error: 'Missing: message, stravaToken, athleteId' });
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

    return reply.send({
      voice,
      drivers,
      data: {
        weeklyMiles: parseFloat(weeklyMiles),
        runCount,
        lastRun: lastRun.name,
      },
    });
  } catch (error) {
    fastify.log.error('CDV exception:', error);
    return reply.code(500).send({ error: 'CDV failed', detail: error instanceof Error ? error.message : String(error) });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('API running on 0.0.0.0:3000');
    console.log('POST /api/cdv - Chat-driven analysis');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

export default fastify;
