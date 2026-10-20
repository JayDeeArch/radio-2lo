import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  extractTrackId,
  requestQuerySchema,
  stripDiacritics,
  submitRequestSchema,
  submitDedicationSchema,
  suggestQuerySchema,
} from '@radio/shared';
import { registerSubscriber } from '../lib/events.js';
import { clientIp, consume } from '../lib/ratelimit.js';
import { getTrack, searchTracks, SpotifyError } from '../spotify/client.js';
import {
  ensurePlaylistCache,
  getCachedPlaylist,
  PLAYLIST_URL,
} from '../services/playlist.js';
import {
  createRequest,
  getRequestById,
  getRequestHistory,
  getRequestVotes,
  listRequests,
} from '../services/requests.js';
import { createDedication, listDedications } from '../services/dedications.js';

const SUBMIT_LIMIT = 5;
const SUBMIT_WINDOW_MS = 10 * 60 * 1000;

/** Jak długo lokalna kopia playlisty jest uznawana za aktualną. */
const PLAYLIST_CACHE_TTL_MS = 10 * 60 * 1000;

const uuidParam = z.object({ id: z.string().uuid('Nieprawidłowy identyfikator prośby.') });

/** Zamienia surowy utwór ze Spotify na DTO używane przez frontend. */
function trackToDto(track: {
  id: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images: { url: string }[]; release_date: string | null } | null;
  duration_ms: number;
  explicit: boolean;
}) {
  return {
    id: track.id,
    name: track.name,
    artists: track.artists.map((a) => a.name),
    album: track.album?.name ?? null,
    imageUrl: track.album?.images?.[0]?.url ?? null,
    durationMs: track.duration_ms,
    releaseYear: track.album?.release_date
      ? Number.parseInt(track.album.release_date.slice(0, 4), 10) || null
      : null,
    isExplicit: Boolean(track.explicit),
    url: `https://open.spotify.com/track/${track.id}`,
  };
}

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Wyszukiwarka Spotify dla uczniów.
   * Od lutego 2026 `/search` zwraca maksymalnie 10 wyników, więc stronicujemy.
   */
  app.get<{ Querystring: unknown }>('/api/suggest', async (request, reply) => {
    const parsed = suggestQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Podaj frazę wyszukiwania (1-120 znaków).' });
    }

    try {
      const page = await searchTracks(parsed.data.q, parsed.data.limit, parsed.data.offset);
      return {
        items: page.items.map(trackToDto),
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
      };
    } catch (error) {
      if (error instanceof SpotifyError) {
        request.log.warn({ err: error }, 'Spotify search failed');
        return reply.code(error.isRateLimit ? 429 : 502).send({
          error: error.isRateLimit
            ? 'Spotify chwilowo ogranicza zapytania. Spróbuj ponownie za chwilę.'
            : 'Nie udało się wyszukać w Spotify. Spróbuj ponownie.',
        });
      }
      throw error;
    }
  });

  /** Zgłoszenie prośby o utwór. */
  app.post<{ Body: unknown }>('/api/requests', async (request, reply) => {
    const parsed = submitRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.',
        issues: parsed.error.issues,
      });
    }

    const limit = consume(`submit:${clientIp(request)}`, SUBMIT_LIMIT, SUBMIT_WINDOW_MS);
    if (!limit.allowed) {
      return reply
        .code(429)
        .header('retry-after', String(limit.retryAfterSeconds))
        .send({
          error: `Wysłałeś już ${SUBMIT_LIMIT} prośb w ostatnich 10 minutach. Spróbuj ponownie za ${Math.ceil(limit.retryAfterSeconds / 60)} min.`,
        });
    }

    const trackId = extractTrackId(parsed.data.track);
    if (!trackId) {
      return reply
        .code(400)
        .send({ error: 'Nie rozpoznaliśmy linku do utworu. Wklej link z aplikacji Spotify.' });
    }

    let track;
    try {
      track = await getTrack(trackId);
    } catch (error) {
      if (error instanceof SpotifyError && (error.status === 404 || error.status === 400)) {
        return reply.code(404).send({ error: 'Nie znaleźliśmy tego utworu w Spotify.' });
      }
      request.log.error({ err: error }, 'getTrack failed');
      return reply.code(502).send({ error: 'Nie udało się pobrać danych utworu ze Spotify.' });
    }

    const result = await createRequest({
      track,
      class: parsed.data.class,
      note: parsed.data.note || null,
    });

    if (!result.ok) {
      return reply.code(409).send({
        error: 'Ten utwór jest już na playliscie szkolnego radia.',
        existing: result.existing,
      });
    }

    // `request` jest parametrem Fastify - wynik nazywamy inaczej.
    const { request: created, alreadyRequested, alreadyOnPlaylist } = result;

    return reply.code(alreadyRequested || alreadyOnPlaylist ? 200 : 201).send({
      alreadyRequested,
      alreadyOnPlaylist,
      votes: created.votes,
      classCount: created.classCount,
      request: created,
    });
  });

  /** Publiczna tablica statusów. */
  app.get<{ Querystring: unknown }>('/api/requests', async (request, reply) => {
    const parsed = requestQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Nieprawidłowe parametry wyszukiwania.' });
    }
    return listRequests(parsed.data);
  });

  app.get<{ Params: unknown }>('/api/requests/:id', async (request, reply) => {
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

  /**
   * Aktualna zawartość playlisty szkolnego radia.
   *
   * Czyta LOKALNĄ KOPIĘ, więc nie zużywa limitu zapytań Spotify - inaczej każde
   * wejście ucznia na tę stronę pobierałoby 4 strony utworów z API.
   * Kopię odświeża harmonogram synchronizacji (co 15 min) oraz decyzje admina.
   */
  app.get<{ Querystring: unknown }>('/api/playlist', async (request, reply) => {
    const parsed = z
      .object({ q: z.string().trim().max(120).optional().default('') })
      .safeParse(request.query);

    if (!parsed.success) return reply.code(400).send({ error: 'Nieprawidłowe parametry.' });

    try {
      // Pusta kopia lub przeterminowana jest odświeżana - ale tylko wtedy,
      // gdy poprzedni zapis w ogóle istnieje. Dzięki temu tysiące wejść na
      // stronę nie generują tysięcy wywołań do Spotify.
      const snapshot = await ensurePlaylistCache(PLAYLIST_CACHE_TTL_MS);

      // Filtrowanie idzie po bazie (pg_trgm), więc zwracamy tylko pasujące pozycje.
      const filtered = parsed.data.q
        ? await getCachedPlaylist(parsed.data.q)
        : snapshot;

      return {
        count: filtered.count,
        /** Ile pozycji zwrócono po ewentualnym filtrowaniu. */
        matched: filtered.items.length,
        syncedAt: filtered.syncedAt,
        playlistUrl: PLAYLIST_URL,
        items: filtered.items,
      };
    } catch (error) {
      request.log.warn({ err: error }, 'Nie udało się pobrać playlisty');
      return reply.code(502).send({
        error:
          'Playlista nie została jeszcze zsynchronizowana. Zaloguj się w panelu administratora ' +
          'i kliknij „Synchronizuj”, albo poczekaj na automatyczną synchronizację.',
      });
    }
  });

  /**
   * Szybka nawigacja po klasach - używane w filtrach i walidacji formularza.
   * Celowo nie używamy `/api/markets` ani `/api/users/{id}` - oba endpointy
   * zostały usunięte w lutym 2026.
   */
  app.get('/api/classes', async () => ({
    format: /^([1-4])\s*([A-F]{1,2})$/i,
    examples: ['1A', '2B', '3C', '4F'],
    normalizedSearch: stripDiacritics('2A'),
  }));

  /** Zgłoszenie dedykacji utworu. */
  app.post<{ Body: unknown }>('/api/dedications', async (request, reply) => {
    const parsed = submitDedicationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' });
    }

    const limit = consume(`dedication:${clientIp(request)}`, SUBMIT_LIMIT, SUBMIT_WINDOW_MS);
    if (!limit.allowed) {
      return reply.code(429).send({ error: 'Za dużo zgłoszeń. Spróbuj później.' });
    }

    const trackId = extractTrackId(parsed.data.track);
    if (!trackId) {
      return reply.code(400).send({ error: 'Nie rozpoznaliśmy linku do utworu.' });
    }

    let track;
    try {
      track = await getTrack(trackId);
    } catch (error) {
      if (error instanceof SpotifyError && (error.status === 404 || error.status === 400)) {
        return reply.code(404).send({ error: 'Nie znaleźliśmy tego utworu w Spotify.' });
      }
      request.log.error({ err: error }, 'getTrack failed');
      return reply.code(502).send({ error: 'Nie udało się pobrać danych utworu ze Spotify.' });
    }

    const id = await createDedication({
      track,
      recipient: parsed.data.recipient,
      sender: parsed.data.sender || null,
      isAnonymous: parsed.data.anonymous ?? false,
      message: parsed.data.message || null,
      targetDate: parsed.data.targetDate,
    });

    return reply.code(201).send({ ok: true, id });
  });

  /** Lista zatwierdzonych dedykacji (publiczna). */
  app.get('/api/dedications', async () => {
    const rows = await listDedications('ZATWIERDZONE');
    return rows.map((r) => ({
      id: r.id,
      track: {
        id: r.spotifyTrackId,
        name: r.trackName,
        artists: [r.artistName],
        album: r.albumName,
        imageUrl: r.albumImageUrl,
        url: `https://open.spotify.com/track/${r.spotifyTrackId}`,
      },
      recipient: r.recipientName,
      sender: r.isAnonymous ? null : r.senderName,
      anonymous: r.isAnonymous,
      message: r.message,
      targetDate: r.targetDate,
      createdAt: r.createdAt.toISOString(),
    }));
  });

  /** Pływające aktualizacje (SSE) - uczniowie widzą decyzje bez odświeżania. */
  app.get('/api/events', (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': połączono\n\n');

    const cleanup = registerSubscriber(reply);
    request.raw.on('close', cleanup);
  });
}
