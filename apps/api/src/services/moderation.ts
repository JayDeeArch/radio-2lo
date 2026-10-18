import { asc, desc, eq, sql } from 'drizzle-orm';
import type { RequestDto } from '@radio/shared';
import { db } from '../db/index.js';
import { requestEvents, requests } from '../db/schema.js';
import { broadcast } from '../lib/events.js';
import { addTrackToPlaylist, removeTrackFromPlaylist, SpotifyError } from '../spotify/client.js';
import { findTrackOnPlaylist } from './playlist.js';
import { baseQuery, getRequestByIdOrThrow, logEvent, toRequestDto } from './requests.js';

export type ModerationErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'SPOTIFY_ERROR';

export class ModerationError extends Error {
  constructor(
    readonly code: ModerationErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ModerationError';
  }
}

/**
 * Utwór okazał się już na playliscie. Nie jest to błąd - prośba została właśnie
 * oznaczona jako dodana, a administrator dostaje czytelny komunikat zamiast
 * wyjątku 502 z interfejsu Spotify.
 */
export class AlreadyOnPlaylistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyOnPlaylistError';
  }
}

const notFound = () => new ModerationError('NOT_FOUND', 'Nie znaleziono prośby.', 404);
const conflict = (message: string) => new ModerationError('CONFLICT', message, 409);
const spotifyFailed = (message: string) => new ModerationError('SPOTIFY_ERROR', message, 502);

function describeSpotifyError(error: unknown): string {
  if (error instanceof SpotifyError) {
    if (error.isAuthError) {
      return 'Sesja Spotify wygasła (6 miesięcy od zgody). Zaloguj się ponownie, aby dodawać utwory.';
    }
    if (error.isRateLimit) {
      return 'Spotify chwilowo ogranicza zapytania. Spróbuj ponownie za chwilę.';
    }
    return error.message;
  }
  return 'Nieznany błąd komunikacji ze Spotify.';
}

async function publish(requestId: string): Promise<RequestDto> {
  const updated = await getRequestByIdOrThrow(requestId);
  broadcast({ type: 'request.updated', request: updated });
  return updated;
}

/**
 * Dodaje utwór do playlisty szkolnego radia.
 *
 * Najpierw zapisujemy `spotify_sync = 'PENDING'`, żeby restart kontenera
 * w trakcie operacji nie zgubił wiedzy o tym, że decyzja jest w toku.
 * Harmonogram synchronizacji dociągnie ten stan przy najbliższym przebiegu.
 */
export async function approveRequest(requestId: string, adminId: string): Promise<RequestDto> {
  const dto = await getRequestByIdOrThrow(requestId).catch(() => {
    throw notFound();
  });

  if (dto.status !== 'OCZEKUJACE') {
    throw conflict('Ta prośba została już rozpatrzona.');
  }

  // Ostatnia linia obrony przed duplikatem na playliscie.
  // Kopia playlisty może być chwilę nieaktualna (odświeża się co 15 minut),
  // więc sprawdzamy tu, zanim cokolwiek wyślemy do Spotify. Bez tego uczeń mógłby
  // zatwierdzić utwór, który ktoś właśnie dodał ręcznie w aplikacji Spotify.
  const onPlaylist = await findTrackOnPlaylist(dto.track.id);
  if (onPlaylist.onPlaylist) {
    await db
      .update(requests)
      .set({
        status: 'ZATWIERDZONE',
        decidedAt: new Date(),
        decidedBy: adminId,
        spotifySync: 'OK',
        spotifyError: null,
        spotifyAddedAt: onPlaylist.addedAt ?? new Date(),
        spotifyPosition: onPlaylist.position,
        updatedAt: new Date(),
      })
      .where(eq(requests.id, requestId));

    await logEvent(requestId, adminId, 'ALREADY_ON_PLAYLIST', 'OCZEKUJACE', 'ZATWIERDZONE');
    await publish(requestId);

    throw new AlreadyOnPlaylistError(
      `„${dto.track.name}” jest już na playliscie (pozycja ${(onPlaylist.position ?? 0) + 1}). ` +
        'Oznaczono jako dodany - nic nie zostało powielone.',
    );
  }

  await db
    .update(requests)
    .set({ spotifySync: 'PENDING', spotifyError: null, updatedAt: new Date() })
    .where(eq(requests.id, requestId));

  try {
    await addTrackToPlaylist(dto.track.id);
  } catch (error) {
    const message = describeSpotifyError(error);
    await db
      .update(requests)
      .set({ spotifySync: 'ERROR', spotifyError: message, updatedAt: new Date() })
      .where(eq(requests.id, requestId));

    await logEvent(requestId, adminId, 'APPROVE_FAILED', 'OCZEKUJACE', 'OCZEKUJACE', message);
    throw spotifyFailed(message);
  }

  await db
    .update(requests)
    .set({
      status: 'ZATWIERDZONE',
      rejectReason: null,
      decidedAt: new Date(),
      decidedBy: adminId,
      spotifySync: 'OK',
      spotifyError: null,
      spotifyAddedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(requests.id, requestId));

  await logEvent(requestId, adminId, 'APPROVED', 'OCZEKUJACE', 'ZATWIERDZONE');
  return publish(requestId);
}

/** Odrzucenie. Jeśli utwór był już dodany, najpierw zdejmujemy go z playlisty. */
export async function rejectRequest(
  requestId: string,
  adminId: string,
  reason: string,
): Promise<RequestDto> {
  const dto = await getRequestByIdOrThrow(requestId).catch(() => {
    throw notFound();
  });

  if (dto.status === 'ODRZUCONE') throw conflict('Ta prośba jest już odrzucona.');

  if (dto.status === 'ZATWIERDZONE') {
    try {
      await removeTrackFromPlaylist(dto.track.id);
    } catch (error) {
      throw spotifyFailed(
        `Nie można odrzucić, bo utwór jest już na playliscie: ${describeSpotifyError(error)}`,
      );
    }
  }

  await db
    .update(requests)
    .set({
      status: 'ODRZUCONE',
      rejectReason: reason,
      decidedAt: new Date(),
      decidedBy: adminId,
      spotifySync: 'NOT_REQUIRED',
      spotifyError: null,
      spotifyAddedAt: null,
      spotifyPosition: null,
      updatedAt: new Date(),
    })
    .where(eq(requests.id, requestId));

  await logEvent(requestId, adminId, 'REJECTED', dto.status, 'ODRZUCONE', reason);
  return publish(requestId);
}

/** Przywraca prośbę do kolejki i zdejmuje utwór z playlisty. */
export async function undoRequest(requestId: string, adminId: string): Promise<RequestDto> {
  const dto = await getRequestByIdOrThrow(requestId).catch(() => {
    throw notFound();
  });

  if (dto.status === 'OCZEKUJACE') throw conflict('Ta prośba już czeka w kolejce.');

  if (dto.status === 'ZATWIERDZONE') {
    try {
      await removeTrackFromPlaylist(dto.track.id);
    } catch (error) {
      throw spotifyFailed(`Nie udało się zdjąć utworu z playlisty: ${describeSpotifyError(error)}`);
    }
  }

  await db
    .update(requests)
    .set({
      status: 'OCZEKUJACE',
      rejectReason: null,
      decidedAt: null,
      decidedBy: null,
      spotifySync: 'NOT_REQUIRED',
      spotifyError: null,
      spotifyAddedAt: null,
      spotifyPosition: null,
      updatedAt: new Date(),
    })
    .where(eq(requests.id, requestId));

  await logEvent(requestId, adminId, 'UNDONE', dto.status, 'OCZEKUJACE');
  return publish(requestId);
}

/** Kolejka panelu administratora - najstarsze oczekujące na górze. */
export async function pendingQueue(limit = 50, offset = 0): Promise<RequestDto[]> {
  const rows = await baseQuery()
    .where(eq(requests.status, 'OCZEKUJACE'))
    .orderBy(asc(requests.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(toRequestDto);
}

/** Ostatnie decyzje - podsumowanie w panelu. */
export async function recentActivity(limit = 25) {
  const rows = await db
    .select({
      id: requestEvents.id,
      requestId: requestEvents.requestId,
      action: requestEvents.action,
      fromStatus: requestEvents.fromStatus,
      toStatus: requestEvents.toStatus,
      detail: requestEvents.detail,
      createdAt: requestEvents.createdAt,
      trackName: requests.trackName,
      artistName: requests.artistName,
      adminName: sql<string | null>`(SELECT display_name FROM admins WHERE admins.id = ${requestEvents.adminId})`,
    })
    .from(requestEvents)
    .innerJoin(requests, eq(requests.id, requestEvents.requestId))
    .orderBy(desc(requestEvents.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    requestId: r.requestId,
    action: r.action,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    detail: r.detail,
    trackName: r.trackName,
    artistName: r.artistName,
    adminName: r.adminName,
    createdAt: r.createdAt.toISOString(),
  }));
}
