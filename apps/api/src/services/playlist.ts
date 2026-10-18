import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';
import { buildSearchBlob, stripDiacritics, type TrackDto } from '@radio/shared';
import { db } from '../db/index.js';
import { playlistItems } from '../db/schema.js';
import { config } from '../config.js';
import { getPlaylistItems, trackFromPlaylistItem } from '../spotify/client.js';

export interface PlaylistEntry extends TrackDto {
  position: number;
  addedAt: string | null;
}

export interface PlaylistSnapshot {
  items: PlaylistEntry[];
  count: number;
  syncedAt: string | null;
  /** Czy kopia jest aktualna - false gdy nigdy nie zsynchronizowano. */
  populated: boolean;
}

/**
 * Zapisuje aktualną zawartość playlisty do lokalnej tabeli.
 *
 * Wywoływane przez harmonogram synchronizacji oraz ręcznie z panelu admina,
 * a także po każdej decyzji, która zmienia playlistę (dodanie / odrzucenie /
 * cofnięcie) - dzięki temu strona playlista nie czeka 15 minut na odświeżenie.
 */
export async function refreshPlaylistCache(): Promise<number> {
  const items = await getPlaylistItems();

  const rows = items.flatMap(({ item, position, addedAt }) => {
    const track = trackFromPlaylistItem(item);
    if (!track) return [];

    const artistName = track.artists.map((a) => a.name).join(', ');
    const year = track.album?.release_date
      ? Number.parseInt(track.album.release_date.slice(0, 4), 10) || null
      : null;

    return [
      {
        position,
        spotifyTrackId: track.id,
        trackName: track.name,
        artistName,
        albumName: track.album?.name ?? null,
        albumImageUrl: track.album?.images?.[0]?.url ?? null,
        durationMs: track.duration_ms ?? null,
        releaseYear: year,
        isExplicit: Boolean(track.explicit),
        externalUrl: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
        addedAt: addedAt ? new Date(addedAt) : null,
        searchBlob: buildSearchBlob([track.name, artistName, track.album?.name]),
        syncedAt: new Date(),
      },
    ];
  });

  // Pełne nadpisanie: pozycje powyżej `rows.length` muszą zniknąć, bo właśnie
  // je ktoś usunął z playlisty. `delete + insert` jest tu najprostsze i przy
  // kilkuset wierszach trwa ułamek milisekundy.
  await db.transaction(async (tx) => {
    await tx.delete(playlistItems);
    if (rows.length > 0) await tx.insert(playlistItems).values(rows);
  });

  return rows.length;
}

function toEntry(row: typeof playlistItems.$inferSelect): PlaylistEntry {
  return {
    id: row.spotifyTrackId,
    name: row.trackName,
    artists: row.artistName ? [row.artistName] : [],
    album: row.albumName,
    imageUrl: row.albumImageUrl,
    durationMs: row.durationMs,
    releaseYear: row.releaseYear,
    isExplicit: row.isExplicit,
    url: row.externalUrl,
    position: row.position,
    addedAt: row.addedAt?.toISOString() ?? null,
  };
}

/**
 * Czyta playlistę z lokalnej kopii - bez jednego zapytania do Spotify.
 * Przy pustym `q` zwraca całość, w przeciwnym razie filtruje po fragmencie.
 */
export async function getCachedPlaylist(query = ''): Promise<PlaylistSnapshot> {
  const totalRows = await db.select({ total: count() }).from(playlistItems);
  const total = Number(totalRows[0]?.total ?? 0);

  const syncedAtRows = await db
    .select({ syncedAt: playlistItems.syncedAt })
    .from(playlistItems)
    .orderBy(asc(playlistItems.syncedAt))
    .limit(1);

  const syncedAt = syncedAtRows[0]?.syncedAt?.toISOString() ?? null;

  if (total === 0) {
    return { items: [], count: 0, syncedAt, populated: false };
  }

  let rows: (typeof playlistItems.$inferSelect)[];

  if (query) {
    const needle = query.toLowerCase();
    const withoutDiacritics = stripDiacritics(query);

    // Bez polskich znaków (search_blob trzymane jest znormalizowane), więc
    // "zol" znajdzie "Żółw", a `word_similarity` (próg 0.5) złapie literówki typu
    // "Kotelk" -> "Koteluk".
    rows = await db
      .select()
      .from(playlistItems)
      .where(
        or(
          ilike(playlistItems.searchBlob, `%${needle}%`),
          sql`word_similarity(${needle}, ${playlistItems.searchBlob}) > 0.5`,
          ilike(playlistItems.trackName, `%${query}%`),
          ilike(playlistItems.artistName, `%${query}%`),
          ilike(playlistItems.albumName, `%${query}%`),
          ilike(playlistItems.trackName, `%${withoutDiacritics}%`),
          ilike(playlistItems.artistName, `%${withoutDiacritics}%`),
        )!,
      )
      .orderBy(asc(playlistItems.position))
      .limit(500);
  } else {
    rows = await db
      .select()
      .from(playlistItems)
      .orderBy(asc(playlistItems.position))
      .limit(2000);
  }

  return { items: rows.map(toEntry), count: total, syncedAt, populated: true };
}

/** Czy lokalna kopia jest starsza niż podany czas (w milisekundach). */
export async function isCacheStale(maxAgeMs: number): Promise<boolean> {
  const rows = await db
    .select({ syncedAt: playlistItems.syncedAt })
    .from(playlistItems)
    .orderBy(asc(playlistItems.syncedAt))
    .limit(1);

  const syncedAt = rows[0]?.syncedAt;
  if (!syncedAt) return true;
  return Date.now() - syncedAt.getTime() > maxAgeMs;
}

/** Jak długo po nieudanym odświeżeniu nie próbujemy ponownie. */
const REFRESH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Ostatnia nieudana próba odświeżenia. Bez tego pamięci, przy wygasłym tokenie
 * administratora KAŻDE wejście na stronę próbowałoby pobrać playlistę ze
 * Spotify, zakończyłoby się błędem i zużyło zapytania - czyli dokładnie ten
 * problem, który cache ma rozwiązać.
 */
let lastFailureAt = 0;

/** Odświeża kopię tylko wtedy, gdy jest pusta, przeterminowana i poza okresem karencji. */
export async function ensurePlaylistCache(maxAgeMs = 10 * 60 * 1000): Promise<PlaylistSnapshot> {
  const snapshot = await getCachedPlaylist();

  if (snapshot.populated && !(await isCacheStale(maxAgeMs))) return snapshot;

  if (Date.now() - lastFailureAt < REFRESH_FAILURE_COOLDOWN_MS) {
    if (snapshot.populated) return snapshot;
    throw new Error('Playlista nie została jeszcze zsynchronizowana ze Spotify.');
  }

  try {
    await refreshPlaylistCache();
    lastFailureAt = 0;
  } catch (error) {
    lastFailureAt = Date.now();
    // Nie tracimy tego, co mamy - lepsza lekko nieaktualna playlista niż błąd.
    if (snapshot.populated) return snapshot;
    throw error;
  }

  return getCachedPlaylist();
}

/**
 * Czy utwór jest już na playliscie szkolnego radia.
 *
 * Pytamy o LOKALNĄ KOPIĘ, a nie o status prośby, bo prośba i playlista potrafią
 * się rozjechać: ktoś może dodać utwór ręcznie w aplikacji Spotify (wtedy nie ma
 * żadnej prośby), albo usunąć go z playlisty zostawiając prośbę zatwierdzoną.
 * Kopia jest odświeżana co 15 minut i po każdej decyzji, więc jest dla nas
 * najbliższym dostępnym źródłem prawdy.
 */
export async function findTrackOnPlaylist(trackId: string): Promise<{
  onPlaylist: boolean;
  position: number | null;
  addedAt: Date | null;
}> {
  const rows = await db
    .select({ position: playlistItems.position, addedAt: playlistItems.addedAt })
    .from(playlistItems)
    .where(eq(playlistItems.spotifyTrackId, trackId))
    .orderBy(asc(playlistItems.position))
    .limit(1);

  const row = rows[0];
  return { onPlaylist: Boolean(row), position: row?.position ?? null, addedAt: row?.addedAt ?? null };
}

export const PLAYLIST_URL = `https://open.spotify.com/playlist/${config.spotify.playlistId}`;
