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

const STRAVA_CLIENT_ID = '228067';
const STRAVA_CLIENT_SECRET = proces…CRET || '';
const STRAVA_REDIRECT_URI = 'https://zonal-prosperity-production-3965.up.railway.app/api/auth/strava/callback';

fastify.get('/api/auth/strava', async (request, reply) => {
  const redirectUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}&scope=read,activity:read_all`;
  return reply.redirect(302, redirectUrl);
});

fastify.get('/api/auth/strava/callback', async (request, reply) => {
  const { code } = request.query as { code?: string };
  if (!code) return reply.code(400).send({ error: 'Missing code' });
  
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

    if (!tokenResponse.ok) return reply.code(400).send({ error: 'Token exchange failed' });

    const tokenData = await tokenResponse.json();
    const athleteId = tokenData.athlete.id;
    const athleteName = tokenData.athlete.firstname;
    const deepLink = `scora://auth/success?athlete_id=${athleteId}&name=${encodeURIComponent(athleteName)}`;
    const userAgent = request.headers['user-agent'] || '';
    const isIOS = /iPhone|iPad|iPod/.test(userAgent);
    
    if (isIOS) return reply.redirect(302, deepLink);
    
    return reply.type('text/html').send(`<html><head><meta charset="utf-8"><style>body{background:#000;color:#fff;font-family:system-ui;margin:0;padding:40px;display:flex;align-items:center;justify-content:center;min-height:100vh}.container{max-width:400px;text-align:center}.logo{font-size:100px;margin-bottom:20px}h1{font-size:40px;margin:0 0 20px;font-weight:700}p{color:#999;font-size:16px;margin:0 0 30px}a{display:inline-block;padding:14px 32px;background:#fff;color:#000;text-decoration:none;border-radius:4px;font-weight:600}a:hover{opacity:0.9}.footer{margin-top:40px;padding-top:20px;border-top:1px solid #222;font-size:13px;color:#666}</style></head><body><div class="container"><div class="logo">S</div><h1>Strava Linked</h1><p>Welcome, ${athleteName}!</p><a href="${deepLink}">Open SCORA</a><div class="footer"><p>If you're not redirected, tap the button above.</p></div></div></body></html>`);
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed' });
  }
});

const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID || '';
const OURA_CLIENT_SECRET = proces…CRET || '';
const OURA_REDIRECT_URI = 'https://zonal-prosperity-production-3965.up.railway.app/api/auth/oura/callback';

fastify.get('/api/auth/oura', async (request, reply) => {
  const redirectUrl = `https://cloud.ouraring.com/oauth/authorize?client_id=${OURA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(OURA_REDIRECT_URI)}`;
  return reply.redirect(302, redirectUrl);
});

fastify.get('/api/auth/oura/callback', async (request, reply) => {
  const { code } = request.query as { code?: string };
  if (!code) return reply.code(400).send({ error: 'Missing code' });
  try {
    const body = `client_id=${encodeURIComponent(OURA_CLIENT_ID)}&client_secret=***)}&code=***)}&grant_type=authorization_code`;
    const tokenResponse = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      return reply.code(400).send({ error: 'Token exchange failed', detail: errText });
    }
    const deepLink = 'scora://auth/oura/success';
    const userAgent = request.headers['user-agent'] || '';
    const isIOS = /iPhone|iPad/.test(userAgent);
    if (isIOS) return reply.redirect(302, deepLink);
    return reply.type('text/html').send(`<html><head><meta charset="utf-8"><style>body{background:#000;color:#fff;font-family:system-ui;margin:0;padding:40px;display:flex;align-items:center;justify-content:center;min-height:100vh}.container{max-width:400px;text-align:center}.logo{font-size:100px;margin-bottom:20px}h1{font-size:40px;margin:0 0 20px;font-weight:700}p{color:#999;font-size:16px;margin:0 0 30px}a{display:inline-block;padding:14px 32px;background:#fff;color:#000;text-decoration:none;border-radius:4px;font-weight:600}a:hover{opacity:0.9}.footer{margin-top:40px;padding-top:20px;border-top:1px solid #222;font-size:13px;color:#666}</style></head><body><div class="container"><div class="logo">S</div><h1>Oura Linked</h1><p>Your sleep data is connected!</p><a href="${deepLink}">Open SCORA</a><div class="footer"><p>If you're not redirected, tap the button above.</p></div></div></body></html>`);
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed' });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('API running on 0.0.0.0:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

export default fastify;
