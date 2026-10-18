import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import { closeDatabase } from './spotify/tokens.js';
import { runMigrations } from './db/migrate.js';
import { attachAdmin } from './lib/session.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { startSyncScheduler, stopSyncScheduler } from './services/sync.js';

const app = Fastify({
  logger: {
    level: config.logLevel,
    transport: config.isProduction ? undefined : { target: 'pino-pretty' },
  },
  trustProxy: config.trustProxy,
  bodyLimit: 128 * 1024,
});

await app.register(cookie, { secret: config.session.secret });
await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
});

// W produkcji nginx jest tym samym originem, więc CORS nie jest potrzebny.
// Pozostawiamy go dla trybu deweloperskiego (Vite na porcie 5173).
await app.register(cors, {
  origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true,
  credentials: true,
});

app.addHook('onRequest', attachAdmin);

app.get('/api/health', async () => ({
  ok: true,
  env: config.env,
  playlistId: config.spotify.playlistId,
  uptime: Math.round(process.uptime()),
}));

await app.register(authRoutes);
await app.register(publicRoutes);
await app.register(adminRoutes);

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Nie znaleziono zasobu.' });
  }
  return reply.redirect('/');
});

app.setErrorHandler((error: unknown, request, reply) => {
  request.log.error({ err: error }, 'Nieobsłużony błąd');
  const status = typeof error === 'object' && error && 'statusCode' in error
    ? Number((error as { statusCode?: number }).statusCode ?? 500)
    : 500;
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message)
      : 'Nieznany błąd';
  return reply.code(status).send({
    error: status >= 500 ? 'Wystąpił nieoczekiwany błąd serwera.' : message,
  });
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[api] Otrzymano ${signal}, zamykam...`);
  stopSyncScheduler();
  await app.close();
  await closeDatabase();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await runMigrations();
  await app.listen({ port: config.port, host: config.host });
  startSyncScheduler();
} catch (error) {
  app.log.error({ err: error }, 'Nie udało się uruchomić aplikacji');
  console.error('[api] Start nie powiódł się:', error);
  process.exit(1);
}
