import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

const fastify = Fastify({ logger: true });

fastify.register(cors);

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// OAuth Callbacks (Phase 1)
fastify.post('/api/auth/strava/callback', async (request, reply) => {
  // TODO: Exchange code for Strava access token
  // TODO: Fetch athlete data from Strava
  // TODO: Upsert athlete record in DB
  // TODO: Create/link user session
  return { message: 'Strava OAuth callback (not yet implemented)' };
});

fastify.post('/api/auth/oura/callback', async (request, reply) => {
  // TODO: Exchange code for Oura access token
  // TODO: Fetch health data from Oura
  // TODO: Link Oura account to athlete
  return { message: 'Oura OAuth callback (not yet implemented)' };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('API running on http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
