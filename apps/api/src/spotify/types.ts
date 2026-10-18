import { config } from '../config.js';

export const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

/**
 * Od lutego 2026 Spotify zastąpiło `/playlists/{id}/tracks` endpointem `/items`
 * (m.in. dlatego, że playlista może zawierać także podcasty).
 * Stare ścieżki zostały usunięte - nie używamy ich.
 */
export const PLAYLIST_ITEMS_PATH = (id: string) => `/playlists/${id}/items`;

export const OAUTH_SCOPES = [
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images: SpotifyImage[];
  release_date: string | null;
  uri: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  external_urls: { spotify?: string };
  duration_ms: number;
  explicit: boolean;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  is_playable?: boolean;
  linked_from?: { id: string; uri: string } | null;
  type: 'track' | 'episode';
}

export interface SpotifyPlaylistItem {
  added_at: string | null;
  added_by?: { id: string; uri: string } | null;
  is_playable?: boolean;
  /** Po zmianach z lutego 2026 pole `track` ma różne nazwy w zależności od typu zasobu. */
  item?: SpotifyTrack;
  track?: SpotifyTrack | null;
  episode?: unknown;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  collaborative: boolean;
  public: boolean | null;
  snapshot_id: string;
  owner: { id: string; display_name: string | null };
  external_urls: { spotify?: string };
  images: SpotifyImage[];
}

export interface SpotifySearchResult {
  tracks: {
    items: Array<SpotifyTrack | null>;
    total: number;
    offset: number;
    limit: number;
    next: string | null;
  };
}

export interface SpotifyProfile {
  id: string;
  account_id?: string;
  display_name: string | null;
  images: SpotifyImage[];
  uri: string;
  product?: string;
}

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  scope?: string;
  expires_in: number;
  refresh_token?: string;
}

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    /** `QUOTA_EXCEEDED` po zmianach z lipca 2026. */
    readonly reason?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'SpotifyError';
  }

  /** Czy to sygnał, że refresh token wygasł (6 miesięcy od pierwotnej zgody)? */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  /** Np. "Ta playlista nie istnieje lub nie masz do niej dostępu." */
  get isForbidden(): boolean {
    return this.status === 403 || this.status === 404;
  }
}

export const spotifyPlaylistUrl = (id: string) => `https://open.spotify.com/playlist/${id}`;
export const spotifyTrackUrl = (id: string) => `https://open.spotify.com/track/${id}`;

export function isPlaylistConfigured(): boolean {
  return Boolean(config.spotify.clientId && config.spotify.clientSecret && config.spotify.playlistId);
}
