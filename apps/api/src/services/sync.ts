import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { requests } from '../db/schema.js';
import { broadcast } from '../lib/events.js';
import { getSyncState, setSyncState } from '../lib/settings.js';
import {
  addTrackToPlaylist,
  getPlaylist,
  getPlaylistItems,
  trackFromPlaylistItem,
  SpotifyError,
} from '../spotify/client.js';
import { refreshPlaylistCache } from './playlist.js';
import { getRequestById, logEvent } from './requests.js';

const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_SYNC_DELAY_MS = 20_000;

const REAUTH_MARKER = 'Połączenie konta administratora ze Spotify wygasło - zaloguj się ponownie.';

let timer: NodeJS.Timeout | null = null;
let running = false;

export interface SyncSummary {
  ok: boolean;
  /** Utwory dołączone do playlisty przez synchronizację (zatwierdzone, ale nieobecne). */
  addedToSpotify: string[];
  /** Prośby cofnięte do kolejki, bo ktoś usunął utwór z playlisty w Spotify. */
  recovered: string[];
  /** Utwory obecne na playliscie, których nie znamy jako zatwierdzone. */
  orphans: string[];
  /** Prośby przeniesione z kolejki na playlistę, bo utwór był już na niej. */
  promotedToPlaylist: string[];
  playlistName: string | null;
  playlistTrackCount: number | null;
  error?: string;
}

async function emitUpdate(requestId: string): Promise<void> {
  const dto = await getRequestById(requestId);
  if (dto) broadcast({ type: 'request.updated', request: dto });
}

/**
 * Dwukierunkowa synchronizacja bazy z prawdziwą playlistą.
 *
 * 1. Zatwierdzona prośba, której utwór zniknął z playlisty  -> wraca do kolejki (OCZEKUJACE).
 * 2. Zatwierdzona prośba z błędem synchronizacji           -> ponawiamy dodanie.
 * 3. Utwór na playliscie bez zatwierdzonej prośby          -> raportujemy jako rozbieżność,
 *    ale NICzego nie usuwamy (ktoś mógł dodać go ręcznie w aplikacji Spotify).
 */
export async function runSync(): Promise<SyncSummary> {
  if (running) {
    return {
      ok: false,
      addedToSpotify: [],
      recovered: [],
      orphans: [],
      promotedToPlaylist: [],
      playlistTrackCount: null,
      playlistName: null,
      error: 'Synchronizacja już trwa.',
    };
  }
  running = true;

  const summary: SyncSummary = {
    ok: true,
    addedToSpotify: [],
    recovered: [],
    orphans: [],
    promotedToPlaylist: [],
    playlistTrackCount: null,
    playlistName: null,
  };

  try {
    const [playlist, items] = await Promise.all([getPlaylist(), getPlaylistItems()]);

    summary.playlistName = playlist.name;
    summary.playlistTrackCount = items.length;

    const positionByTrackId = new Map<string, number>();
    for (const { item, position } of items) {
      const track = trackFromPlaylistItem(item);
      if (track) positionByTrackId.set(track.id, position);
    }

    // --- 1 + 2. Zatwierdzone prośby -------------------------------------
    const approved = await db
      .select({
        id: requests.id,
        spotifyTrackId: requests.spotifyTrackId,
        spotifySync: requests.spotifySync,
        spotifyPosition: requests.spotifyPosition,
      })
      .from(requests)
      .where(eq(requests.status, 'ZATWIERDZONE'));

    for (const row of approved) {
      const position = positionByTrackId.get(row.spotifyTrackId);

      if (position === undefined) {
        if (row.spotifySync === 'OK') {
          // Faktycznie zniknął - cofamy do kolejki zamiast udawać, że jest dodany.
          await db
            .update(requests)
            .set({
              status: 'OCZEKUJACE',
              spotifySync: 'PENDING',
              spotifyError: 'Utwór został usunięty z playlisty Spotify.',
              spotifyAddedAt: null,
              spotifyPosition: null,
              decidedAt: null,
              decidedBy: null,
              rejectReason: null,
              updatedAt: new Date(),
            })
            .where(eq(requests.id, row.id));

          await logEvent(row.id, null, 'SYNC_RECOVERED', 'ZATWIERDZONE', 'OCZEKUJACE');
          summary.recovered.push(row.spotifyTrackId);
          await emitUpdate(row.id);
        }
        continue;
      }

      if (row.spotifySync !== 'OK' || row.spotifyPosition !== position) {
        await db
          .update(requests)
          .set({ spotifySync: 'OK', spotifyError: null, spotifyPosition: position, updatedAt: new Date() })
          .where(eq(requests.id, row.id));
      }
    }

    // Prośby zatwierdzone, których dodanie się nie powiodło.
    const failed = await db
      .select({ id: requests.id, spotifyTrackId: requests.spotifyTrackId })
      .from(requests)
      .where(
        and(
          eq(requests.status, 'ZATWIERDZONE'),
          ne(requests.spotifySync, 'OK'),
          isNotNull(requests.spotifySync),
        ),
      );

    for (const row of failed) {
      if (positionByTrackId.has(row.spotifyTrackId)) continue;
      try {
        await addTrackToPlaylist(row.spotifyTrackId, config.spotify.playlistId);
        await db
          .update(requests)
          .set({
            spotifySync: 'OK',
            spotifyError: null,
            spotifyAddedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(requests.id, row.id));

        await logEvent(row.id, null, 'SYNC_ADDED', 'ZATWIERDZONE', 'ZATWIERDZONE');
        summary.addedToSpotify.push(row.spotifyTrackId);
        await emitUpdate(row.id);
      } catch (error) {
        summary.ok = false;
        const message = error instanceof SpotifyError ? error.message : 'Nieznany błąd Spotify.';
        await db
          .update(requests)
          .set({ spotifySync: 'ERROR', spotifyError: message, updatedAt: new Date() })
          .where(eq(requests.id, row.id));
      }
    }

    // --- 3. Rozbieżności --------------------------------------------------
    const approvedTrackIds = new Set(approved.map((r) => r.spotifyTrackId));
    summary.orphans = [...positionByTrackId.keys()].filter((id) => !approvedTrackIds.has(id));

    // --- 4. Prośby czekające, których utwór jest już na playliscie --------
    // Ktoś mógł dodać utwór ręcznie w aplikacji Spotify, a prośba wciąż
    // czeka. Bez wyrównania administrator dodałby ten utwór drugi raz.
    const pending = await db
      .select({ id: requests.id, spotifyTrackId: requests.spotifyTrackId })
      .from(requests)
      .where(eq(requests.status, 'OCZEKUJACE'));

    for (const row of pending) {
      const position = positionByTrackId.get(row.spotifyTrackId);
      if (position === undefined) continue;

      const addedAt = items.find(
        ({ item }) => trackFromPlaylistItem(item)?.id === row.spotifyTrackId,
      )?.addedAt;

      await db
        .update(requests)
        .set({
          status: 'ZATWIERDZONE',
          decidedAt: new Date(),
          spotifySync: 'OK',
          spotifyError: null,
          spotifyAddedAt: addedAt ? new Date(addedAt) : new Date(),
          spotifyPosition: position,
          rejectReason: null,
          updatedAt: new Date(),
        })
        .where(eq(requests.id, row.id));

      await logEvent(row.id, null, 'ALREADY_ON_PLAYLIST', 'OCZEKUJACE', 'ZATWIERDZONE');
      summary.promotedToPlaylist.push(row.spotifyTrackId);
      await emitUpdate(row.id);
    }

    // Lokalna kopia dla publicznego endpointu - dzieje się to raz na 15 minut,
    // a nie przy każdym wejściu ucznia na stronę.
    await refreshPlaylistCache();

    await setSyncState({
      lastSyncAt: new Date().toISOString(),
      lastSyncError: null,
      playlistName: playlist.name,
      playlistTrackCount: items.length,
    });
  } catch (error) {
    const isAuthError = error instanceof SpotifyError && error.isAuthError;
    const message = isAuthError
      ? REAUTH_MARKER
      : error instanceof SpotifyError
        ? error.message
        : 'Nieznany błąd podczas synchronizacji.';

    summary.ok = false;
    summary.error = message;
    await setSyncState({ lastSyncAt: new Date().toISOString(), lastSyncError: message });
  } finally {
    running = false;
  }

  broadcast({
    type: 'sync.completed',
    at: new Date().toISOString(),
    trackCount: summary.playlistTrackCount ?? 0,
  });

  return summary;
}

/** Utwory będące w playliscie, których nie ma w bazie jako zatwierdzone. */
export async function listOrphanTracks(): Promise<Array<{ trackId: string; name: string; artists: string }>> {
  try {
    const items = await getPlaylistItems();
    const approved = await db
      .select({ trackId: requests.spotifyTrackId })
      .from(requests)
      .where(
        and(
          eq(requests.status, 'ZATWIERDZONE'),
          inArray(
            requests.spotifyTrackId,
            items
              .map(({ item }) => trackFromPlaylistItem(item)?.id)
              .filter((id): id is string => Boolean(id))
              .slice(0, 1000),
          ),
        ),
      );

    const known = new Set(approved.map((r) => r.trackId));
    return items
      .map(({ item }) => trackFromPlaylistItem(item))
      .filter((track): track is NonNullable<typeof track> => Boolean(track) && !known.has(track!.id))
      .map((track) => ({
        trackId: track!.id,
        name: track!.name,
        artists: track!.artists.map((a) => a.name).join(', '),
      }));
  } catch {
    return [];
  }
}

export function startSyncScheduler(): void {
  if (timer) return;

  const tick = () => {
    void runSync().catch((error: unknown) => console.error('[sync] Nieoczekiwany błąd:', error));
  };

  timer = setTimeout(() => {
    tick();
    timer = setInterval(tick, SYNC_INTERVAL_MS);
  }, FIRST_SYNC_DELAY_MS);

  console.log(`[sync] Harmonogram synchronizacji co ${SYNC_INTERVAL_MS / 60000} min.`);
}

export function stopSyncScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
}

export const getLastSyncState = getSyncState;
