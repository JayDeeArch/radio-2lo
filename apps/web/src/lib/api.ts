import type {
  AdminDto,
  PaginatedRequests,
  RequestDto,
  RequestSort,
  RequestStatus,
  ServerEvent,
  SpotifyConnection,
  TrackDto,
} from '@radio/shared';

const BASE = import.meta.env['VITE_API_BASE'] ?? '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError('Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.', 0);
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      `Błąd serwera (${response.status}). Spróbuj ponownie za chwilę.`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

// --- Typy pomocnicze ------------------------------------------------------

export type StatusFilter = 'WSZYSTKIE' | RequestStatus;

export interface SuggestResponse {
  items: TrackDto[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface SubmitResponse {
  /** True gdy utwór był już zgłoszony i dodano kolejny głos. */
  alreadyRequested: boolean;
  /** True gdy utwór jest już na playliscie - prośba zapisana jako zatwierdzona. */
  alreadyOnPlaylist: boolean;
  votes: number;
  classCount: number;
  request: RequestDto;
}

export interface PlaylistEntry extends TrackDto {
  position: number;
  addedAt: string | null;
}

export interface PlaylistResponse {
  /** Łączna liczba pozycji na playliscie (niezależnie od filtra). */
  count: number;
  /** Ile pozycji zwrócono po ewentualnym filtrowaniu. */
  matched: number;
  /** Kiedy lokalna kopia playlisty była ostatnio odświeżona. */
  syncedAt: string | null;
  playlistUrl: string;
  items: PlaylistEntry[];
}

export interface MeResponse {
  admin: AdminDto;
  spotify: SpotifyConnection;
}

export interface HistoryEntry {
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  detail: string | null;
  adminName: string | null;
  createdAt: string;
}

/** Jeden głos - jedna klasa zgłaszająca prośbę o utwór. */
export interface VoteEntry {
  id: string;
  class: string;
  note: string | null;
  createdAt: string;
}

export interface SyncSummaryDto {
  ok: boolean;
  addedToSpotify: string[];
  recovered: string[];
  orphans: string[];
  /** Prośby przeniesione z kolejki na playlistę, bo utwór był już na niej. */
  promotedToPlaylist: string[];
  playlistName: string | null;
  playlistTrackCount: number | null;
  error?: string;
}

export interface ActivityEntry {
  id: string;
  requestId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  detail: string | null;
  trackName: string;
  artistName: string;
  adminName: string | null;
  createdAt: string;
}

export interface OrphanEntry {
  trackId: string;
  name: string;
  artists: string;
}

// --- Endpointy publiczne --------------------------------------------------

export function buildRequestQuery(params: {
  q?: string;
  status?: StatusFilter;
  klass?: string;
  sort?: RequestSort;
  page?: number;
  perPage?: number;
}): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status && params.status !== 'WSZYSTKIE') search.set('status', params.status);
  if (params.klass) search.set('class', params.klass);
  if (params.sort && params.sort !== 'priorytet') search.set('sort', params.sort);
  if (params.page && params.page > 1) search.set('page', String(params.page));
  if (params.perPage) search.set('perPage', String(params.perPage));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  suggest: (q: string, offset = 0, limit = 10, signal?: AbortSignal) =>
    request<SuggestResponse>(`/suggest?q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`, {
      signal,
    }),

  submit: (body: { track: string; class: string; note?: string }) =>
    request<SubmitResponse>('/requests', { method: 'POST', body: JSON.stringify(body) }),

  submitDedication: (body: {
    track: string;
    recipient: string;
    sender?: string;
    anonymous?: boolean;
    message?: string;
    targetDate: string;
  }) => request<{ ok: true; id: string }>('/dedications', { method: 'POST', body: JSON.stringify(body) }),

  dedications: (signal?: AbortSignal) =>
    request<
      Array<{
        id: string;
        track: TrackDto;
        recipient: string;
        sender: string | null;
        anonymous: boolean;
        message: string | null;
        targetDate: string;
        createdAt: string;
      }>
    >('/dedications', { signal }),

  requests: (query: Parameters<typeof buildRequestQuery>[0], signal?: AbortSignal) =>
    request<PaginatedRequests>(`/requests${buildRequestQuery(query)}`, { signal }),

  playlist: (q = '', signal?: AbortSignal) =>
    request<PlaylistResponse>(`/playlist${q ? `?q=${encodeURIComponent(q)}` : ''}`, { signal }),

  // --- administrator ---
  me: (signal?: AbortSignal) => request<MeResponse>('/auth/me', { signal }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  queue: (sort: RequestSort, klass = '', signal?: AbortSignal) =>
    request<PaginatedRequests>(
      `/admin/queue?limit=100&sort=${sort}${klass ? `&class=${encodeURIComponent(klass)}` : ''}`,
      { signal },
    ),

  adminRequests: (query: Parameters<typeof buildRequestQuery>[0], signal?: AbortSignal) =>
    request<PaginatedRequests>(`/admin/requests${buildRequestQuery(query)}`, { signal }),

  approve: (id: string) =>
    request<{ request: RequestDto }>(`/admin/requests/${id}/approve`, { method: 'POST' }),

  reject: (id: string, reason: string) =>
    request<{ request: RequestDto }>(`/admin/requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  undo: (id: string) =>
    request<{ request: RequestDto }>(`/admin/requests/${id}/undo`, { method: 'POST' }),

  sync: () => request<{ summary: SyncSummaryDto }>('/admin/sync', { method: 'POST' }),

  orphans: (signal?: AbortSignal) =>
    request<{ items: OrphanEntry[] }>('/admin/orphans', { signal }),

  activity: (signal?: AbortSignal) =>
    request<{ items: ActivityEntry[] }>('/admin/activity', { signal }),

  adminDedications: (status = 'WSZYSTKIE', signal?: AbortSignal) =>
    request<{ items: any[] }>(`/admin/dedications?status=${status}`, { signal }),

  approveDedication: (id: string) =>
    request<{ ok: true }>(`/admin/dedications/${id}/approve`, { method: 'POST' }),

  rejectDedication: (id: string, reason: string) =>
    request<{ ok: true }>(`/admin/dedications/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  undoDedication: (id: string) =>
    request<{ ok: true }>(`/admin/dedications/${id}/undo`, { method: 'POST' }),

  hideDedication: (id: string, hidden = true) =>
    request<{ ok: true }>(`/admin/dedications/${id}/hide`, {
      method: 'POST',
      body: JSON.stringify({ hidden }),
    }),

  history: (id: string, signal?: AbortSignal) =>
    request<{ request: RequestDto; history: HistoryEntry[]; votes: VoteEntry[] }>(
      `/admin/requests/${id}`,
      { signal },
    ),
};

export const loginUrl = `${BASE}/auth/spotify/login`;

// --- Pływające aktualizacje (SSE) ----------------------------------------

type Listener = (event: ServerEvent) => void;

/**
 * Jedno połączenie SSE na całą kartę przeglądarki.
 * Wiele komponentów (tablica statusów, panel admina) słucha tego samego strumienia.
 */
class EventStream {
  private source: EventSource | null = null;
  private listeners = new Set<Listener>();
  private refCount = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.refCount += 1;
    this.ensureConnected();

    return () => {
      this.listeners.delete(listener);
      this.refCount -= 1;
      if (this.refCount <= 0) this.disconnect();
    };
  }

  private ensureConnected(): void {
    if (this.source) return;

    this.source = new EventSource(`${BASE}/events`, { withCredentials: true });

    for (const type of ['request.created', 'request.updated', 'sync.completed'] as const) {
      this.source.addEventListener(type, (raw) => {
        try {
          const event = JSON.parse((raw as MessageEvent<string>).data) as ServerEvent;
          for (const listener of this.listeners) listener(event);
        } catch {
          // Uszkodzona ramka - pomijamy, nie zaburzamy strumienia.
        }
      });
    }

    // Przeglądarki nie zawsze same się podłączają ponownie (proxy, uśpienie laptopa).
    this.source.onerror = () => {
      this.source?.close();
      this.source = null;
      if (this.refCount > 0) {
        window.setTimeout(() => this.ensureConnected(), 5000);
      }
    };
  }

  private disconnect(): void {
    this.source?.close();
    this.source = null;
  }
}

export const eventStream = new EventStream();
