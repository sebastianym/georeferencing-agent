import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import healthRoutes from './routes/health.js';
import jobsRoutes from './routes/jobs.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

await app.register(healthRoutes);
await app.register(jobsRoutes);

const port = Number(process.env.PORT ?? 8080);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`api listening on ${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
