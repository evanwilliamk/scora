import Fastify from 'fastify';

const fastify = Fastify({ logger: true });

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

fastify.get('/api/auth/strava', async (request, reply) => {
  const clientId = '228067';
  const redirectUri = 'https://zonal-prosperity-production-3965.up.railway.app/api/auth/strava/callback';
  const url = `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read,activity:read_all`;
  return reply.redirect(302, url);
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
