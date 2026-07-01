import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

const fastify = Fastify({ logger: true });

fastify.register(cors);

fastify.get('/', async (request, reply) => {
  const html = '<html><head><title>SCORA</title><meta name="viewport" content="width=device-width"><style>body { font-family: sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; } .container { background: white; padding: 60px 40px; border-radius: 16px; text-align: center; max-width: 600px; } .logo { font-size: 72px; font-weight: 900; color: #667eea; margin-bottom: 20px; } h1 { font-size: 36px; margin-bottom: 16px; } .tagline { font-size: 18px; color: #666; margin-bottom: 40px; } ul { text-align: left; margin: 40px 0; padding: 30px; background: #f8f9fa; border-radius: 12px; } li { list-style: none; padding: 12px 0; color: #555; } li:before { content: "✓ "; color: #667eea; font-weight: bold; margin-right: 12px; } .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #999; } a { color: #667eea; text-decoration: none; margin: 0 12px; }</style></head><body><div class="container"><div class="logo">S</div><h1>SCORA</h1><p class="tagline">Your AI fitness coach that reads your body and adapts your training in real-time.</p><ul><li>Daily posture reads powered by AI</li><li>Real-time workout adaptation</li><li>Integrates Strava, Oura, Apple Health</li><li>Marketplace of human coaches</li></ul><div class="footer"><p>SCORA is in early access.</p><p><a href="/privacy">Privacy Policy</a> • <a href="/terms">Terms of Service</a></p></div></div></body></html>';
  return reply.type('text/html').send(html);
});

fastify.get('/privacy', async (request, reply) => {
  const html = '<html><head><title>Privacy Policy</title><meta name="viewport" content="width=device-width"><style>body { font-family: sans-serif; background: #f8f9fa; padding: 40px 20px; line-height: 1.8; } .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; } h1 { font-size: 32px; margin-bottom: 30px; } h2 { font-size: 20px; margin-top: 30px; margin-bottom: 15px; } p { margin-bottom: 15px; color: #666; } a { color: #667eea; }</style></head><body><div class="container"><h1>Privacy Policy</h1><p style="color: #999; font-size: 14px;">Last updated: July 1, 2026</p><h2>1. Introduction</h2><p>SCORA operates the SCORA mobile application. This page informs you of our policies regarding data collection and use.</p><h2>2. Information Collection</h2><p>We collect information you provide and automatically through fitness data from Strava, Oura, and Apple Health.</p><h2>3. Data Security</h2><p>We implement appropriate measures to protect your personal data.</p><h2>4. Your Rights</h2><p>You have the right to access, correct, or delete your personal data by contacting us at hello@scora.app</p></div></body></html>';
  return reply.type('text/html').send(html);
});

fastify.get('/terms', async (request, reply) => {
  const html = '<html><head><title>Terms of Service</title><meta name="viewport" content="width=device-width"><style>body { font-family: sans-serif; background: #f8f9fa; padding: 40px 20px; line-height: 1.8; } .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; } h1 { font-size: 32px; margin-bottom: 30px; } h2 { font-size: 20px; margin-top: 30px; margin-bottom: 15px; } p { margin-bottom: 15px; color: #666; }</style></head><body><div class="container"><h1>Terms of Service</h1><p style="color: #999; font-size: 14px;">Last updated: July 1, 2026</p><h2>1. Acceptance of Terms</h2><p>By using SCORA, you accept and agree to be bound by the terms of this agreement.</p><h2>2. Use License</h2><p>Permission is granted to use SCORA for personal, non-commercial purposes only.</p><h2>3. Disclaimer</h2><p>The materials on SCORA are provided on an as is basis without warranties.</p><h2>4. Limitations</h2><p>SCORA is not liable for damages arising from your use of the Service.</p></div></body></html>';
  return reply.type('text/html').send(html);
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString(), api: 'scora' };
});

const STRAVA_CLIENT_ID = '228067';
const STRAVA_CLIENT_SECRET = *** || '';
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
    const userAgent = (request.headers['user-agent'] || '').toLowerCase();
    const isIOS = userAgent.includes('iphone') || userAgent.includes('ipad');
    
    if (isIOS) return reply.redirect(302, deepLink);
    
    const html = `<html><head><meta name="viewport" content="width=device-width"><title>SCORA</title><style>body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); } .container { background: white; padding: 40px; border-radius: 12px; max-width: 400px; text-align: center; } h1 { font-size: 48px; margin: 0; } h2 { margin: 20px 0 10px; } p { margin: 0 0 30px; color: #666; } a { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; }</style></head><body><div class="container"><h1>✅</h1><h2>Strava Connected</h2><p>Welcome, ${athleteName}!</p><a href="${deepLink}">Open SCORA</a></div></body></html>`;
    return reply.type('text/html').send(html);
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed' });
  }
});

fastify.get('/api/auth/oura', async (request, reply) => {
  return reply.code(501).send({ message: 'Oura OAuth not yet implemented' });
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('API running on http://0.0.0.0:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

export default fastify;
