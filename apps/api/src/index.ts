import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '../public');

const fastify = Fastify({ logger: true });

fastify.register(cors);

// Lazy load HTML files (read on first request, not at startup)
let indexHtml = '';
let privacyHtml = '';
let termsHtml = '';

const loadFiles = () => {
  if (!indexHtml) indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  if (!privacyHtml) privacyHtml = fs.readFileSync(path.join(publicDir, 'privacy.html'), 'utf8');
  if (!termsHtml) termsHtml = fs.readFileSync(path.join(publicDir, 'terms.html'), 'utf8');
};

fastify.get('/', (req, rep) => { loadFiles(); return rep.type('text/html').send(indexHtml); });
fastify.get('/index.html', (req, rep) => { loadFiles(); return rep.type('text/html').send(indexHtml); });
fastify.get('/privacy.html', (req, rep) => { loadFiles(); return rep.type('text/html').send(privacyHtml); });
fastify.get('/privacy', (req, rep) => { loadFiles(); return rep.type('text/html').send(privacyHtml); });
fastify.get('/terms.html', (req, rep) => { loadFiles(); return rep.type('text/html').send(termsHtml); });
fastify.get('/terms', (req, rep) => { loadFiles(); return rep.type('text/html').send(termsHtml); });

fastify.get('/health', (req, rep) => ({ status: 'ok', timestamp: new Date().toISOString() }));

const STRAVA_ID = '228067';
const STRAVA_SECRET = *** || '';
const STRAVA_REDIRECT = 'https://zonal-prosperity-production-3965.up.railway.app/api/auth/strava/callback';

fastify.get('/api/auth/strava', (req, rep) => {
  const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_ID}&response_type=code&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT)}&scope=read,activity:read_all`;
  return rep.redirect(302, url);
});

fastify.get('/api/auth/strava/callback', async (req, rep) => {
  const { code } = req.query as { code?: string };
  if (!code) return rep.code(400).send({ error: 'Missing code' });
  
  try {
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: STRAVA_ID, client_secret: STRAVA_SECRET, code, grant_type: 'authorization_code' }),
    });
    if (!res.ok) return rep.code(400).send({ error: 'Failed' });
    
    const data = await res.json();
    const name = data.athlete.firstname;
    const id = data.athlete.id;
    const link = `scora://auth/success?athlete_id=${id}&name=${encodeURIComponent(name)}`;
    const isIOS = (req.headers['user-agent'] || '').includes('iPhone');
    
    if (isIOS) return rep.redirect(302, link);
    
    const html = `<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:linear-gradient(135deg,#667eea,#764ba2)"><div style="background:white;padding:40px;border-radius:12px;max-width:400px;text-align:center"><h1 style="font-size:48px;margin:0">✅</h1><h2 style="margin:20px 0 10px">Strava Connected</h2><p style="margin:0 0 30px">Welcome, ${name}!</p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:6px;font-weight:600">Open SCORA</a></div></body></html>`;
    return rep.type('text/html').send(html);
  } catch (e) { fastify.log.error(e); return rep.code(500).send({ error: 'Failed' }); }
});

const OURA_ID = process.env.OURA_CLIENT_ID || '';
const OURA_SECRET = *** || '';
const OURA_REDIRECT = 'https://zonal-prosperity-production-3965.up.railway.app/api/auth/oura/callback';

fastify.get('/api/auth/oura', (req, rep) => {
  const url = `https://cloud.ouraring.com/oauth/authorize?client_id=${OURA_ID}&response_type=code&redirect_uri=${encodeURIComponent(OURA_REDIRECT)}&scope=personal`;
  return rep.redirect(302, url);
});

fastify.get('/api/auth/oura/callback', async (req, rep) => {
  const { code } = req.query as { code?: string };
  if (!code) return rep.code(400).send({ error: 'Missing code' });
  
  try {
    const res = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: OURA_ID, client_secret: OURA_SECRET, code, grant_type: 'authorization_code' }),
    });
    if (!res.ok) return rep.code(400).send({ error: 'Failed' });
    
    const data = await res.json();
    const link = 'scora://auth/oura/success';
    const isIOS = (req.headers['user-agent'] || '').includes('iPhone');
    
    if (isIOS) return rep.redirect(302, link);
    
    const html = `<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:linear-gradient(135deg,#667eea,#764ba2)"><div style="background:white;padding:40px;border-radius:12px;max-width:400px;text-align:center"><h1 style="font-size:48px;margin:0">✅</h1><h2 style="margin:20px 0 10px">Oura Linked</h2><p style="margin:0 0 30px">Your sleep data is connected!</p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:6px;font-weight:600">Open SCORA</a></div></body></html>`;
    return rep.type('text/html').send(html);
  } catch (e) { fastify.log.error(e); return rep.code(500).send({ error: 'Failed' }); }
});

fastify.listen({ port: 3000, host: '0.0.0.0' }, (err, addr) => {
  if (err) { fastify.log.error(err); process.exit(1); }
  console.log(`API running on ${addr}`);
});
