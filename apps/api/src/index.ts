import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { STRAVA_CLIENT_ID, STRAVA_REDIRECT_URI, exchangeStravaCode, linkStravaAthlete } from './strava';

dotenv.config();

const fastify = Fastify({ logger: true });

fastify.register(cors);

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString(), api: 'scora' };
});

// Strava OAuth
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
    const tokenData = await exchangeStravaCode(code);
    const userId = tokenData.athlete.id;
    await linkStravaAthlete(String(userId), tokenData);
    
    return reply.send({ 
      success: true, 
      message: 'Strava linked successfully',
      athlete: tokenData.athlete
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed to link Strava account' });
  }
});

// Oura OAuth (placeholder)
fastify.get('/api/auth/oura/callback', async (request, reply) => {
  return { message: 'Oura OAuth callback (not yet implemented)' };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('API running on http://0.0.0.0:3000');
    console.log(`Strava OAuth: GET /api/auth/strava`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

export default fastify;
// Updated
