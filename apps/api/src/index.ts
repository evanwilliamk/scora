import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { landingPageHTML, privacyPolicyHTML, termsOfServiceHTML } from './pages';

dotenv.config();

const fastify = Fastify({ logger: true });

fastify.register(cors);

// Landing pages
fastify.get('/', async (request, reply) => {
  return reply.type('text/html').send(landingPageHTML);
});

fastify.get('/privacy', async (request, reply) => {
  return reply.type('text/html').send(privacyPolicyHTML);
});

fastify.get('/terms', async (request, reply) => {
  return reply.type('text/html').send(termsOfServiceHTML);
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString(), api: 'scora' };
});

// Strava OAuth
const STRAVA_CLIENT_ID = '228067';
const STRAVA_CLIENT_SECRET = proces…CRET || '';
const STRAVA_REDIRECT_URI = `${process.env.API_URL || 'https://zonal-prosperity-production-3965.up.railway.app'}/api/auth/strava/callback`;

fastify.get('/api/auth/strava', async (request, reply) => {
  const redirectUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}&scope=read,activity:read_all`;
  return reply.redirect(302, redirectUrl);
});

fastify.get('/api/auth/strava/callback', async (request, reply) => {
  const { code } = request.query as { code?: string };
  
  if (!code) {
    return reply.type('text/html').send(`
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5;">
          <div style="text-align: center;">
            <h1>⚠️ Missing Authorization</h1>
            <p>No authorization code received. Please try again.</p>
          </div>
        </body>
      </html>
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
      return reply.type('text/html').send(`
        <html>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5;">
            <div style="text-align: center;">
              <h1>⚠️ Authentication Failed</h1>
              <p>Could not exchange code with Strava. Please try again.</p>
            </div>
          </body>
        </html>
      `);
    }

    const tokenData = await tokenResponse.json();
    const athleteId = tokenData.athlete.id;
    const athleteName = tokenData.athlete.firstname;
    
    const deepLink = `scora://auth/success?athlete_id=${athleteId}&name=${encodeURIComponent(athleteName)}`;
    const userAgent = request.headers['user-agent'] || '';
    const isIOS = /iPhone|iPad|iPod/.test(userAgent);
    
    if (isIOS) {
      return reply.redirect(302, deepLink);
    }
    
    return reply.type('text/html').send(`
      <html>
        <head>
          <title>SCORA - Strava Linked</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
          <div style="text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); max-width: 400px;">
            <h1 style="margin: 0; font-size: 48px;">✅</h1>
            <h2 style="margin: 20px 0 10px; color: #333;">Strava Connected</h2>
            <p style="margin: 0 0 30px; color: #666; font-size: 16px;">Welcome, ${athleteName}!</p>
            <a href="${deepLink}" style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
              Open SCORA
            </a>
            <p style="margin-top: 20px; color: #999; font-size: 14px;">If you're not redirected, tap the button above.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    fastify.log.error(error);
    return reply.type('text/html').send(`
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5;">
          <div style="text-align: center;">
            <h1>⚠️ Error</h1>
            <p>Failed to link your Strava account. Please try again.</p>
          </div>
        </body>
      </html>
    `);
  }
});

// Oura OAuth (placeholder — will implement after we register the app)
fastify.get('/api/auth/oura', async (request, reply) => {
  return reply.code(501).send({ message: 'Oura OAuth not yet implemented' });
});

fastify.get('/api/auth/oura/callback', async (request, reply) => {
  return reply.code(501).send({ message: 'Oura OAuth callback not yet implemented' });
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('API running on http://0.0.0.0:3000');
    console.log(`Landing page: GET /`);
    console.log(`Privacy Policy: GET /privacy`);
    console.log(`Terms of Service: GET /terms`);
    console.log(`Strava OAuth: GET /api/auth/strava`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

export default fastify;
