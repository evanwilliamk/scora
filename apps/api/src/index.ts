import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

const fastify = Fastify({ logger: true });
fastify.register(cors);

fastify.get('/health', (r, p) => ({ ok: true }));

const SID = '228067';
const SS = (process.env.STRAVA_CLIENT_SECRET || '').trim();
const SR = 'https://zonal-prosperity-production-3965.up.railway.app/api/auth/strava/callback';

fastify.get('/api/auth/strava', (r, p) => p.redirect(302, `https://www.strava.com/oauth/authorize?client_id=${SID}&response_type=code&redirect_uri=${encodeURIComponent(SR)}&scope=read,activity:read_all`));

fastify.get('/api/auth/strava/callback', async (r, p) => {
  const { code } = r.query as { code?: string };
  if (!code) return p.code(400).send({ error: 'no code' });
  try {
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: SID, client_secret: SS, code, grant_type: 'authorization_code' }),
    });
    if (!res.ok) return p.code(400).send({ error: 'failed' });
    const d = await res.json();
    const link = `scora://auth/success?athlete_id=${d.athlete.id}&name=${encodeURIComponent(d.athlete.firstname)}`;
    if ((r.headers['user-agent'] || '').includes('iPhone')) return p.redirect(302, link);
    return p.type('text/html').send(`<html><body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:60px">S</h1><h2>${d.athlete.firstname}</h2><a href="${link}" style="color:#fff">Open</a></div></body></html>`);
  } catch (e) {
    return p.code(500).send({ error: 'error' });
  }
});

fastify.listen({ port: 3000, host: '0.0.0.0' }, (e, a) => {
  if (e) { fastify.log.error(e); process.exit(1); }
  console.log(a);
});
