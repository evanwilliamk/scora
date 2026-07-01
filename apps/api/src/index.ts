import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

const fastify = Fastify({ logger: true });

fastify.register(cors);

// Landing page HTML (inline)
const landingHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>SCORA — AI Fitness Coach</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.container{background:white;border-radius:16px;padding:60px 40px;max-width:600px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3)}.logo{font-size:72px;font-weight:900;color:#667eea;margin-bottom:20px}h1{font-size:36px;margin-bottom:16px;color:#333}.tagline{font-size:18px;color:#666;margin-bottom:40px;line-height:1.6}ul{text-align:left;margin:40px 0;padding:30px;background:#f8f9fa;border-radius:12px;list-style:none}li{padding:12px 0;font-size:16px;color:#555}li:before{content:"✓ ";color:#667eea;font-weight:bold;margin-right:12px}.footer{margin-top:40px;padding-top:20px;border-top:1px solid #eee;font-size:14px;color:#999}a{color:#667eea;text-decoration:none;margin:0 12px}a:hover{text-decoration:underline}</style></head><body><div class="container"><div class="logo">S</div><h1>SCORA</h1><p class="tagline">Your AI fitness coach that reads your body and adapts your training in real-time.</p><ul><li>Daily posture reads powered by AI</li><li>Real-time workout adaptation</li><li>Integrates Strava, Oura, Apple Health</li><li>Marketplace of human coaches</li></ul><div class="footer"><p>SCORA is in early access.</p><p><a href="/privacy">Privacy Policy</a> • <a href="/terms">Terms of Service</a></p></div></div></body></html>`;

const privacyHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Privacy Policy — SCORA</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;padding:40px 20px;line-height:1.8}.container{max-width:800px;margin:0 auto;background:white;padding:40px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1)}h1{font-size:32px;margin-bottom:30px;color:#333}h2{font-size:20px;margin-top:30px;margin-bottom:15px;color:#555}p{margin-bottom:15px;color:#666}.updated{color:#999;font-size:14px;margin-bottom:30px}a{color:#667eea}</style></head><body><div class="container"><h1>Privacy Policy</h1><p class="updated">Last updated: July 1, 2026</p><h2>1. Introduction</h2><p>SCORA ("we," "us," or "our") operates the SCORA mobile application and website. This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our Service.</p><h2>2. Information Collection and Use</h2><p>We collect information you provide directly (account creation, profile data) and automatically through your use of the Service (fitness data from integrated services like Strava, Oura, and Apple Health).</p><h2>3. Data from Third Parties</h2><p>With your authorization, we access fitness data from Strava (activities, performance metrics), Oura Ring (sleep, HRV, recovery data), and Apple Health (general health metrics).</p><h2>4. Data Security</h2><p>We implement appropriate technical and organizational measures to protect your personal data against unauthorized processing, accidental loss, destruction, or damage.</p><h2>5. Your Rights</h2><p>You have the right to access, correct, or delete your personal data at any time by contacting us at hello@scora.app.</p><h2>6. Contact Us</h2><p>If you have questions about this Privacy Policy, please contact us at <a href="mailto:hello@scora.app">hello@scora.app</a>.</p></div></body></html>`;

const termsHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Terms of Service — SCORA</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;padding:40px 20px;line-height:1.8}.container{max-width:800px;margin:0 auto;background:white;padding:40px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1)}h1{font-size:32px;margin-bottom:30px;color:#333}h2{font-size:20px;margin-top:30px;margin-bottom:15px;color:#555}p{margin-bottom:15px;color:#666}.updated{color:#999;font-size:14px;margin-bottom:30px}a{color:#667eea}</style></head><body><div class="container"><h1>Terms of Service</h1><p class="updated">Last updated: July 1, 2026</p><h2>1. Acceptance of Terms</h2><p>By accessing and using SCORA, you accept and agree to be bound by the terms and provision of this agreement.</p><h2>2. Use License</h2><p>Permission is granted to temporarily download one copy of the materials on SCORA for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not modify or copy the materials, use them for any commercial purpose, attempt to decompile or reverse engineer any software, remove any copyright or other proprietary notations, or transfer the materials to another person.</p><h2>3. Disclaimer</h2><p>The materials on SCORA are provided on an 'as is' basis. SCORA makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property.</p><h2>4. Limitations</h2><p>In no event shall SCORA or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials.</p><h2>5. Modifications</h2><p>SCORA may revise these terms of service at any time without notice. By using this Service, you are agreeing to be bound by the then current version of these terms of service.</p><h2>6. Contact</h2><p>If you have any questions about these Terms of Service, please contact us at <a href="mailto:hello@scora.app">hello@scora.app</a>.</p></div></body></html>`;

// Static routes
fastify.get('/', async (request, reply) => {
  return reply.type('text/html').send(landingHTML);
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
const STRAVA_CLIENT_SECRET = proces…CRET || '';
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
    
    const html = `<html><head><meta name="viewport" content="width=device-width"><title>SCORA</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}.container{background:white;padding:40px;border-radius:12px;max-width:400px;text-align:center}h1{font-size:48px;margin:0}h2{margin:20px 0 10px}p{margin:0 0 30px;color:#666}a{display:inline-block;padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:6px;font-weight:600}</style></head><body><div class="container"><h1>✅</h1><h2>Strava Connected</h2><p>Welcome, ${athleteName}!</p><a href="${deepLink}">Open SCORA</a></div></body></html>`;
    return reply.type('text/html').send(html);
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed' });
  }
});

// Oura OAuth
const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID || '';
const OURA_CLIENT_SECRET = proces…CRET || '';
const OURA_REDIRECT_URI = `${process.env.API_URL || 'https://zonal-prosperity-production-3965.up.railway.app'}/api/auth/oura/callback`;

fastify.get('/api/auth/oura', async (request, reply) => {
  const redirectUrl = `https://cloud.ouraring.com/oauth/authorize?client_id=${OURA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(OURA_REDIRECT_URI)}&scope=personal`;
  return reply.redirect(302, redirectUrl);
});

fastify.get('/api/auth/oura/callback', async (request, reply) => {
  const { code } = request.query as { code?: string };
  
  if (!code) {
    return reply.code(400).send({ error: 'Missing authorization code' });
  }

  try {
    const tokenResponse = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: OURA_CLIENT_ID,
        client_secret: OURA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      return reply.code(400).send({ error: 'Failed to exchange code' });
    }

    const tokenData = await tokenResponse.json();
    const deepLink = `scora://auth/oura/success?access_token=${toke…oken}`;
    const userAgent = (request.headers['user-agent'] || '').toLowerCase();
    const isIOS = userAgent.includes('iphone') || userAgent.includes('ipad');
    
    if (isIOS) {
      return reply.redirect(302, deepLink);
    }
    
    const html = `<html><head><meta name="viewport" content="width=device-width"><title>SCORA</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}.container{background:white;padding:40px;border-radius:12px;max-width:400px;text-align:center}h1{font-size:48px;margin:0}h2{margin:20px 0 10px}p{margin:0 0 30px;color:#666}a{display:inline-block;padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:6px;font-weight:600}</style></head><body><div class="container"><h1>✅</h1><h2>Oura Linked</h2><p>Your sleep data is now connected!</p><a href="${deepLink}">Open SCORA</a></div></body></html>`;
    return reply.type('text/html').send(html);
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
