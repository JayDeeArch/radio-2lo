import { config } from '../config.js';
import { getAdminToken, getAppToken, getValidAdminToken } from './tokens.js';
import {
  PLAYLIST_ITEMS_PATH,
  SPOTIFY_API_BASE,
  SpotifyError,
  type SpotifyPlaylist,
  type SpotifyPlaylistItem,
  type SpotifyProfile,
  type SpotifySearchResult,
  type SpotifyTrack,
} from './types.js';

export { SpotifyError } from './types.js';

type TokenKind = 'app' | 'admin';

// Prosty cache w pamięci procesu - przyspiesza powtarzane wyszukiwania i pobrania utworów.
const TRACK_CACHE = new Map<string, { track: SpotifyTrack; expires: number }>();
const SEARCH_CACHE = new Map<string, { page: SearchPage; expires: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wykonuje zapytanie do Web API z obsługą 429 (od lipca 2026 z polem
 * `error.reason = "QUOTA_EXCEEDED"`) i krótkim wykładnicznym backoffem.
 */
async function apiFetch<T>(
  path: string,
  init: RequestInit & { tokenKind?: TokenKind } = {},
): Promise<T> {
  const { tokenKind = 'app', ...rest } = init;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const token =
      tokenKind === 'admin' ? await getValidAdminToken() : await getAppToken();

    const response = await fetch(`${SPOTIFY_API_BASE}${path}`, {
      ...rest,
      headers: {
        authorization: `Bearer ${token}`,
        ...(rest.body ? { 'content-type': 'application/json' } : {}),
        ...rest.headers,
      },
    });

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }

    const body = await response.json().catch(() => response.text().catch(() => null));
    const errorBody = body as { error?: { message?: string; reason?: string } } | string | null;
    const message =
      (typeof errorBody === 'object' && errorBody?.error?.message) ||
      (typeof errorBody === 'string' ? errorBody : null) ||
      `Spotify zwróciło HTTP ${response.status}`;
    const reason =
      typeof errorBody === 'object' ? errorBody?.error?.reason ?? undefined : undefined;

    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined;

    if (response.status === 429 && attempt < MAX_RETRIES) {
      attempt += 1;
      const waitMs = Number.isFinite(retryAfter)
        ? Math.min(retryAfter! * 1000, 30_000)
        : Math.min(2 ** attempt * 500, 8_000);
      await sleep(waitMs);
      continue;
    }

    throw new SpotifyError(message, response.status, body, reason, retryAfter);
  }
}

// ---------------------------------------------------------------------------
// Katalog (client credentials)
// ---------------------------------------------------------------------------

export interface SearchPage {
  items: SpotifyTrack[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Wyszukiwanie utworów. Od lutego 2026 limit wyników w `/search` to maksymalnie 10
 * (kiedyś 50), dlatego UI paginuje zamiast pobierać wszystko naraz.
 */
export async function searchTracks(query: string, limit: number, offset: number): Promise<SearchPage> {
  const key = `${query}|${limit}|${offset}`;
  const cached = SEARCH_CACHE.get(key);
  if (cached && cached.expires > Date.now()) return cached.page;

  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: String(Math.min(limit, 10)),
    offset: String(offset),
    market: config.spotify.market,
  });

  const data = await apiFetch<SpotifySearchResult>(`/search?${params}`);
  const items = (data.tracks?.items ?? []).filter((t): t is SpotifyTrack => t?.type === 'track');

  const page = {
    items,
    total: data.tracks?.total ?? 0,
    offset: data.tracks?.offset ?? offset,
    limit: data.tracks?.limit ?? limit,
    hasMore: Boolean(data.tracks?.next) && offset + items.length < (data.tracks?.total ?? 0),
  };
  SEARCH_CACHE.set(key, { page, expires: Date.now() + SEARCH_CACHE_TTL_MS });
  return page;
}

/**
 * Pobiera jeden utwór.
 * UWAGA: endpoint `GET /tracks?ids=...` (pobieranie wsadowe) został USUNIĘTY
 * w lutym 2026 - dlatego metadane snapshotujemy pojedynczo, przy zgłoszeniu,
 * i trzymamy je w naszej bazie zamiast odpytywać Spotify wielokrotnie.
 */
export async function getTrack(trackId: string): Promise<SpotifyTrack> {
  const cached = TRACK_CACHE.get(trackId);
  if (cached && cached.expires > Date.now()) return cached.track;

  const params = new URLSearchParams({ market: config.spotify.market });
  const data = await apiFetch<SpotifyTrack>(`/tracks/${trackId}?${params}`);

  if (!data?.id) {
    throw new SpotifyError('Nie znaleziono utworu o takim identyfikatorze.', 404, null);
  }
  TRACK_CACHE.set(trackId, { track: data, expires: Date.now() + CACHE_TTL_MS });
  return data;
}

/** Kontekst admina (client credentials nie wystarczy do odczytu prywatnej playlisty). */
export async function getAdminProfile(): Promise<SpotifyProfile> {
  if (!(await getAdminToken())) {
    throw new SpotifyError('Brak połączenia konta administratora ze Spotify.', 401, null);
  }
  return apiFetch<SpotifyProfile>('/me', { tokenKind: 'admin' });
}

// ---------------------------------------------------------------------------
// Playlista (wymaga tokenu admina)
// ---------------------------------------------------------------------------

export async function getPlaylist(playlistId = config.spotify.playlistId): Promise<SpotifyPlaylist> {
  const params = new URLSearchParams({ market: config.spotify.market });
  return apiFetch<SpotifyPlaylist>(`/playlists/${playlistId}?${params}`, { tokenKind: 'admin' });
}

/** Wszystkie pozycje playlisty (paginated - playlista może mieć tysiące utworów). */
export async function getPlaylistItems(
  playlistId = config.spotify.playlistId,
): Promise<Array<{ item: SpotifyPlaylistItem; position: number; addedAt: string | null }>> {
  const results: Array<{ item: SpotifyPlaylistItem; position: number; addedAt: string | null }> = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const params = new URLSearchParams({
      limit: '100',
      offset: String(offset),
    });
    const page = await apiFetch<{
      items: SpotifyPlaylistItem[];
      total: number;
      offset: number;
    }>(`${PLAYLIST_ITEMS_PATH(playlistId)}?${params}`, { tokenKind: 'admin' });

    const items = page.items ?? [];
    total = page.total ?? 0;
    results.push(
      ...items.map((item, index) => ({
        item,
        position: (page.offset ?? offset) + index,
        addedAt: item.added_at ?? null,
      })),
    );
    offset += items.length;

    if (items.length === 0) break;
  }

  return results;
}

/** Wyciąga utwór z pozycji playlisty (od lutego 2026 pole `item`, wcześniej `track`). */
export function trackFromPlaylistItem(item: SpotifyPlaylistItem): SpotifyTrack | null {
  const candidate = item.item ?? item.track ?? null;
  return candidate && candidate.type === 'track' ? candidate : null;
}

/** Dodaje utwór na koniec playlisty. */
export async function addTrackToPlaylist(
  trackId: string,
  playlistId = config.spotify.playlistId,
): Promise<{ snapshot_id?: string }> {
  return apiFetch<{ snapshot_id?: string }>(PLAYLIST_ITEMS_PATH(playlistId), {
    method: 'POST',
    tokenKind: 'admin',
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  });
}

/**
 * Usuwa wszystkie wystąpienia utworu z playlisty.
 *
 * UWAGA na kształt ciała żądania: po migracji z lutego 2026 endpoint
 * `DELETE /playlists/{id}/items` przyjmuje klucz `items`, a nie `tracks`
 * jak w usuniętej wersji `/tracks`. Użycie `tracks` daje HTTP 400
 * "No uris provided".
 */
export async function removeTrackFromPlaylist(
  trackId: string,
  playlistId = config.spotify.playlistId,
): Promise<{ snapshot_id?: string }> {
  return apiFetch<{ snapshot_id?: string }>(PLAYLIST_ITEMS_PATH(playlistId), {
    method: 'DELETE',
    tokenKind: 'admin',
    body: JSON.stringify({ items: [{ uri: `spotify:track:${trackId}` }] }),
  });
}

/** Lista playlist użytkownika - pomocnicza przy konfiguracji (diagnostyka). */
export async function listMyPlaylists(limit = 20): Promise<SpotifyPlaylist[]> {
  const params = new URLSearchParams({ limit: String(Math.min(limit, 50)) });
  const data = await apiFetch<{ items: SpotifyPlaylist[] }>(`/me/playlists?${params}`, {
    tokenKind: 'admin',
  });
  return data.items ?? [];
}
