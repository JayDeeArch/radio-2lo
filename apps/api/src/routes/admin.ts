import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { rejectRequestSchema, rejectDedicationSchema, REQUEST_SORTS } from '@radio/shared';
import { requireAdmin } from '../lib/session.js';
import {
  AlreadyOnPlaylistError,
  approveRequest,
  ModerationError,
  recentActivity,
  rejectRequest,
  undoRequest,
} from '../services/moderation.js';
import {
  getRequestById,
  getRequestHistory,
  getRequestVotes,
  listRequests,
  NotFoundError,
} from '../services/requests.js';
import { listOrphanTracks, runSync } from '../services/sync.js';
import { addAllowedAdmin, listAllowedAdmins, removeAllowedAdmin } from '../services/admins.js';
import { listDedications, approveDedication, rejectDedication, undoDedication, getDedication } from '../services/dedications.js';

const uuidParam = z.object({ id: z.string().uuid('Nieprawidłowy identyfikator prośby.') });

const queueQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sort: z.enum(REQUEST_SORTS).optional().default('priorytet'),
  /** Filtr po klasie - dopasowuje KAŻDEGO głosującego, nie tylko pierwszego zgłaszającego. */
  class: z.string().trim().max(8).optional().default(''),
});

const historyQuery = z.object({
  q: z.string().trim().max(120).optional().default(''),
  status: z
    .enum(['WSZYSTKIE', 'OCZEKUJACE', 'ZATWIERDZONE', 'ODRZUCONE'])
    .optional()
    .default('WSZYSTKIE'),
  sort: z.enum(REQUEST_SORTS).optional().default('priorytet'),
  class: z.string().trim().max(8).optional().default(''),
  page: z.coerce.number().int().min(1).max(200).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/** Dekoruje trasę moderacji wspólną obsługą błędów. */
function moderationRoute<T>(
  handler: (request: FastifyRequest<{ Params: unknown }>, reply: FastifyReply) => Promise<unknown>,
) {
  return async (request: FastifyRequest<{ Params: unknown }>, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof AlreadyOnPlaylistError) {
        // 200 zamiast błędu - akcja zakończyła się sukcesem, tylko bez zapisu.
        return reply.code(200).send({ info: error.message });
      }
      if (error instanceof ModerationError) {
        return reply.code(error.status).send({ error: error.message, code: error.code });
      }
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      request.log.error({ err: error }, 'Nieobsłużony błąd moderacji');
      return reply.code(500).send({ error: 'Wystąpił nieoczekiwany błąd serwera.' });
    }
  };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  /** Kolejka: prośby czekające, domyślnie wg liczby głosów. */
  app.get<{ Querystring: unknown }>('/api/admin/queue', async (request, reply) => {
    const parsed = queueQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Nieprawidłowe parametry.' });

    return listRequests({
      q: '',
      status: 'OCZEKUJACE',
      class: parsed.data.class,
      sort: parsed.data.sort,
      page: Math.floor(parsed.data.offset / parsed.data.limit) + 1,
      perPage: parsed.data.limit,
    });
  });

  /** Wszystkie prośby z filtrami - historia w panelu. */
  app.get<{ Querystring: unknown }>('/api/admin/requests', async (request, reply) => {
    const parsed = historyQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Nieprawidłowe parametry.' });

    return listRequests({
      q: parsed.data.q,
      status: parsed.data.status,
      class: parsed.data.class,
      sort: parsed.data.sort,
      page: parsed.data.page,
      perPage: parsed.data.perPage,
    });
  });

  app.get<{ Params: unknown }>('/api/admin/requests/:id', async (request, reply) => {
    const parsed = uuidParam.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Nieprawidłowy identyfikator.' });

    const dto = await getRequestById(parsed.data.id);
    if (!dto) return reply.code(404).send({ error: 'Nie znaleziono prośby.' });

    return {
      request: dto,
      history: await getRequestHistory(parsed.data.id),
      votes: await getRequestVotes(parsed.data.id),
    };
  });

  /** Dodaj do playlisty szkolnego radia. */
  app.post<{ Params: unknown }>(
    '/api/admin/requests/:id/approve',
    moderationRoute(async (request) => {
      const { id } = uuidParam.parse(request.params);
      return { request: await approveRequest(id, request.admin!.id) };
    }),
  );

  /** Odrzuć z powodem widocznym dla ucznia. */
  app.post<{ Params: unknown; Body: unknown }>(
    '/api/admin/requests/:id/reject',
    moderationRoute(async (request, reply) => {
      const { id } = uuidParam.parse(request.params);
      const body = rejectRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Podaj powód odrzucenia.' });
      }
      return { request: await rejectRequest(id, request.admin!.id, body.data.reason) };
    }),
  );

  /** Cofnij decyzję: zdejmij z playlisty i wróć do kolejki. */
  app.post<{ Params: unknown }>(
    '/api/admin/requests/:id/undo',
    moderationRoute(async (request) => {
      const { id } = uuidParam.parse(request.params);
      return { request: await undoRequest(id, request.admin!.id) };
    }),
  );

  /** Ręczne uruchomienie synchronizacji ze Spotify. */
  app.post('/api/admin/sync', async () => ({ summary: await runSync() }));

  /** Utwory na playliscie bez zatwierdzonej prośby w bazie. */
  app.get('/api/admin/orphans', async () => ({ items: await listOrphanTracks() }));

  app.get('/api/admin/activity', async () => ({ items: await recentActivity(25) }));

  app.get<{ Querystring: unknown }>('/api/admin/dedications', async (request, reply) => {
    const status = (request.query as { status?: string })?.status ?? 'WSZYSTKIE';
    const rows = await listDedications(status);
    return { items: rows };
  });

  app.post<{ Params: unknown }>('/api/admin/dedications/:id/approve', async (request, reply) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await approveDedication(id, request.admin!.id);
    return { ok: true };
  });

  app.post<{ Params: unknown; Body: unknown }>('/api/admin/dedications/:id/reject', async (request, reply) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const body = rejectDedicationSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Podaj powód.' });
    await rejectDedication(id, request.admin!.id, body.data.reason);
    return { ok: true };
  });

  app.post<{ Params: unknown }>('/api/admin/dedications/:id/undo', async (request, reply) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await undoDedication(id);
    return { ok: true };
  });

  /** Lista kont Spotify uprawnionych do logowania do panelu. */
  app.get('/api/admin/admins', async () => ({ items: await listAllowedAdmins() }));

  /** Dodaj konto Spotify do listy administratorów (działa natychmiast). */
  app.post<{ Body: unknown }>('/api/admin/admins', async (request, reply) => {
    const body = z.object({ id: z.string().trim().min(1) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Podaj identyfikator Spotify.' });
    const entry = await addAllowedAdmin(body.data.id, request.admin!.id);
    return { ok: true, entry };
  });

  /** Usuń konto Spotify z listy administratorów. */
  app.delete<{ Body: unknown }>('/api/admin/admins', async (request, reply) => {
    const body = z.object({ id: z.string().trim().min(1) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Podaj identyfikator Spotify.' });
    await removeAllowedAdmin(body.data.id);
    return { ok: true };
  });
}
