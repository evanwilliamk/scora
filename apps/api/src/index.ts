import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

const fastify = Fastify({ logger: true });

fastify.register(cors);

// Landing page HTML
const landingPageHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SCORA — Fitness Coaching</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 60px 40px;
      max-width: 600px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo {
      font-size: 72px;
      font-weight: 900;
      color: #667eea;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 36px;
      margin-bottom: 16px;
      color: #333;
    }
    .tagline {
      font-size: 18px;
      color: #666;
      margin-bottom: 40px;
      line-height: 1.6;
    }
    .features {
      text-align: left;
      margin: 40px 0;
      padding: 30px;
      background: #f8f9fa;
      border-radius: 12px;
    }
    .features li {
      list-style: none;
      padding: 12px 0;
      font-size: 16px;
      color: #555;
    }
    .features li:before {
      content: "✓ ";
      color: #667eea;
      font-weight: bold;
      margin-right: 12px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 14px;
      color: #999;
    }
    a {
      color: #667eea;
      text-decoration: none;
      margin: 0 12px;
    }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">S</div>
    <h1>SCORA</h1>
    <p class="tagline">
      Your AI fitness coach that reads your body and adapts your training in real-time.
    </p>
    <ul class="features">
      <li>Daily posture reads powered by AI</li>
      <li>Real-time workout adaptation</li>
      <li>Integrates Strava, Oura, Apple Health</li>
      <li>Marketplace of human coaches</li>
    </ul>
    <div class="footer">
      <p>SCORA is in early access.</p>
      <p><a href="/privacy">Privacy Policy</a> • <a href="/terms">Terms of Service</a></p>
    </div>
  </div>
</body>
</html>
`;

const privacyHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — SCORA</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; padding: 40px 20px; line-height: 1.8; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 32px; margin-bottom: 30px; color: #333; }
    h2 { font-size: 20px; margin-top: 30px; margin-bottom: 15px; color: #555; }
    p { margin-bottom: 15px; color: #666; }
    a { color: #667eea; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Privacy Policy</h1>
    <p style="color: #999; font-size: 14px;">Last updated: July 1, 2026</p>
    <h2>1. Introduction</h2>
    <p>SCORA operates the SCORA mobile application. This page informs you of our policies regarding data collection and use.</p>
    <h2>2. Information Collection</h2>
    <p>We collect information you provide and automatically through fitness data from Strava, Oura, and Apple Health.</p>
    <h2>3. Data Security</h2>
    <p>We implement appropriate measures to protect your personal data against unauthorized processing or loss.</p>
    <h2>4. Your Rights</h2>
    <p>You have the right to access, correct, or delete your personal data by contacting us at <a href="mailto:hello@scora.app">hello@scora.app</a>.</p>
  </div>
</body>
</html>
`;

const termsHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service — SCORA</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; padding: 40px 20px; line-height: 1.8; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 32px; margin-bottom: 30px; color: #333; }
    h2 { font-size: 20px; margin-top: 30px; margin-bottom: 15px; color: #555; }
    p { margin-bottom: 15px; color: #666; }
    a { color: #667eea; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Terms of Service</h1>
    <p style="color: #999; font-size: 14px;">Last updated: July 1, 2026</p>
    <h2>1. Acceptance of Terms</h2>
    <p>By using SCORA, you accept and agree to be bound by the terms of this agreement.</p>
    <h2>2. Use License</h2>
    <p>Permission is granted to use SCORA for personal, non-commercial purposes only.</p>
    <h2>3. Disclaimer</h2>
    <p>The materials on SCORA are provided on an 'as is' basis without warranties.</p>
    <h2>4. Limitations</h2>
    <p>SCORA is not liable for damages arising from your use of the Service.</p>
    <h2>5. Contact</h2>
    <p>For questions, contact us at <a href="mailto:hello@scora.app">hello@scora.app</a>.</p>
  </div>
</body>
</html>
`;

// Routes
fastify.get('/', async (request, reply) => {
  return reply.type('text/html').send(landingPageHTML);
});

fastify.get('/privacy', async (request, reply) => {
  return reply.type('text/html').send(privacyHTML);
});

fastify.get('/terms', async (request, reply) => {
  return reply.type('text/html').send(termsHTML);
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString(), api: 'scora' };
});

// Strava OAuth
const STRAVA_CLIENT_ID = '228067';
const STRAVA_CLIENT_SECRET = *** || '';
const STRAVA_REDIRECT_URI = `${process.env.API_URL || 'https://zonal-prosperity-production-3965.up.railway.app'}/api/auth/strava/callback`;

fastify.get('/api/auth/strava', async (request, reply) => {
  const redirectUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}&scope=read,activity:read_all`;
  return reply.redirect(302, redirectUrl);
});

fastify.get('/api/auth/strava/callback', async (request, reply) => {
  const { code } = request.query as { code?: string };
  
  if (!code) {
    return reply.type('text/html').send(`<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>Missing Authorization Code</h1><p>Please try again.</p></body></html>`);
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
      return reply.type('text/html').send(`<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>Authentication Failed</h1></body></html>`);
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
        <head><meta name="viewport" content="width=device-width"><title>SCORA - Strava Linked</title></head>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
          <div style="text-align: center; background: white; padding: 40px; border-radius: 12px; max-width: 400px;">
            <h1 style="margin: 0; font-size: 48px;">✅</h1>
            <h2 style="margin: 20px 0 10px;">Strava Connected</h2>
            <p style="margin: 0 0 30px; color: #666;">Welcome, ${athleteName}!</p>
            <a href="${deepLink}" style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">Open SCORA</a>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).type('text/html').send(`<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>Error</h1></body></html>`);
  }
});

// Oura OAuth (placeholder)
fastify.get('/api/auth/oura', async (request, reply) => {
  return reply.code(501).send({ message: 'Oura OAuth not yet implemented' });
});

fastify.get('/api/auth/oura/callback', async (request, reply) => {
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
