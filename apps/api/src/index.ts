import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import staticPlugin from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ logger: true });

fastify.register(cors);

// Serve static files from public folder
fastify.register(staticPlugin, {
  root: path.join(__dirname, '../public'),
  prefix: '/',
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString(), api: 'scora' };
});

// Strava OAuth
const STRAVA_CLIENT_ID = '228067';
const STRAVA_CLIENT_SECRET = *** || '';
const STRAVA_REDIRECT_URI = 'https://zonal-prosperity-production-3965.up.railway.app/api/auth/strava/callback';

fastify.get('/api/auth/strava', async (request, reply) => {
  const redirectUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}&scope=read,activity:read_all`;
  return reply.redirect(302, redirectUrl);
});

fastify.get('/api/auth/strava/callback', async (request, reply) => {
  const { code } = request.query as { code?: string };
  
  if (!code) {
    return reply.code(400).send({ error: 'Missing authorization code' });
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
      return reply.code(400).send({ error: 'Failed to exchange code' });
    }

    const tokenData = await tokenResponse.json();
    const athleteId = tokenData.athlete.id;
    const athleteName = tokenData.athlete.firstname;
    const deepLink = `scora://auth/success?athlete_id=${athleteId}&name=${encodeURIComponent(athleteName)}`;
    const userAgent = (request.headers['user-agent'] || '').toLowerCase();
    const isIOS = userAgent.includes('iphone') || userAgent.includes('ipad');
    
    if (isIOS) {
      return reply.redirect(302, deepLink);
    }
    
    const html = `<html><head><meta name="viewport" content="width=device-width"><title>SCORA</title><style>body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); } .container { background: white; padding: 40px; border-radius: 12px; max-width: 400px; text-align: center; } h1 { font-size: 48px; margin: 0; } h2 { margin: 20px 0 10px; } p { margin: 0 0 30px; color: #666; } a { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; }</style></head><body><div class="container"><h1>✅</h1><h2>Strava Connected</h2><p>Welcome, ${athleteName}!</p><a href="${deepLink}">Open SCORA</a></div></body></html>`;
    return reply.type('text/html').send(html);
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed' });
  }
});

// Oura OAuth (placeholder)
fastify.get('/api/auth/oura', async (request, reply) => {
  return reply.code(501).send({ message: 'Oura OAuth not yet implemented' });
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
