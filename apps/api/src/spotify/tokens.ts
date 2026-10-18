import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, sql } from '../db/index.js';
import { settings } from '../db/schema.js';
import {
  SPOTIFY_ACCOUNTS_URL,
  SpotifyError,
  type SpotifyTokenResponse,
} from './types.js';

interface StoredToken {
  accessToken: string;
  refreshToken: string | null;
  /** Kiedy token admina wygasa (refresh token ma 6-miesięczny cykl od pierwotnej zgody). */
  grantedAt: string | null;
  expiresAt: string | null;
  scope: string | null;
  /** Odwiedziny wymuszające ponowne logowanie - po 6 miesiącach od zgody. */
  reauthRequired: boolean;
}

const SETTINGS_KEY = 'spotify_admin_token';

const EMPTY: StoredToken = {
  accessToken: '',
  refreshToken: null,
  grantedAt: null,
  expiresAt: null,
  scope: null,
  reauthRequired: false,
};

/** Jak długo refresh token Spotify pozostaje ważny od pierwotnej zgody użytkownika. */
const REFRESH_TOKEN_MAX_AGE_DAYS = 183;

async function readTokenRow(): Promise<StoredToken> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SETTINGS_KEY))
    .limit(1);

  const row = rows[0];
  if (!row) return EMPTY;

  try {
    return { ...EMPTY, ...(JSON.parse(row.value) as Partial<StoredToken>) };
  } catch {
    return EMPTY;
  }
}

async function writeTokenRow(token: StoredToken): Promise<void> {
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(token), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(token), updatedAt: new Date() },
    });
}

// ---------------------------------------------------------------------------
// Client Credentials - do publicznego wyszukiwania i pobierania metadanych.
// Nie wymaga logowania użytkownika i nie zużywa limitu refresh tokenów.
// ---------------------------------------------------------------------------

let appToken: { token: string; expiresAt: number } | null = null;
let appTokenInFlight: Promise<string> | null = null;

async function requestAppToken(): Promise<string> {
  const basic = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64');

  const response = await fetch(SPOTIFY_ACCOUNTS_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new SpotifyError(
      'Nie udało się pobrać tokenu aplikacji ze Spotify.',
      response.status,
      await response.text().catch(() => null),
    );
  }

  const data = (await response.json()) as SpotifyTokenResponse;
  appToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 - 60_000 };
  return data.access_token;
}

export async function getAppToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now()) return appToken.token;
  if (!appTokenInFlight) {
    appTokenInFlight = requestAppToken().finally(() => {
      appTokenInFlight = null;
    });
  }
  return appTokenInFlight;
}

// ---------------------------------------------------------------------------
// Authorization Code - konto administratora. Wymagane do zapisu na playliscie.
// ---------------------------------------------------------------------------

export async function getAdminToken(): Promise<StoredToken | null> {
  const stored = await readTokenRow();
  if (!stored.refreshToken) return stored.accessToken ? stored : null;
  return stored;
}

let refreshInFlight: Promise<StoredToken> | null = null;

/**
 * Odświeża access token. UWAGA: od czerwca/lipca 2026 Spotify nadaje refresh tokenom
 * 6-miesięczny cykl życia liczony od pierwotnej zgody - odświeżenie go NIE resetuje.
 * Dlatego pilnujemy `grantedAt` i wymuszamy ponowne logowanie po 6 miesiącach.
 */
async function refreshStoredToken(stored: StoredToken): Promise<StoredToken> {
  if (!stored.refreshToken) return stored;

  const grantedAt = stored.grantedAt ? new Date(stored.grantedAt) : new Date();
  const maxAgeReached =
    Date.now() - grantedAt.getTime() > REFRESH_TOKEN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  if (maxAgeReached) {
    const expired: StoredToken = { ...stored, reauthRequired: true, accessToken: '' };
    await writeTokenRow(expired);
    return expired;
  }

  const response = await fetch(SPOTIFY_ACCOUNTS_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(
        `${config.spotify.clientId}:${config.spotify.clientSecret}`,
      ).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => null);
    // 400 "invalid_grant" = refresh token wygasł lub został unieważniony.
    if (response.status === 400 || response.status === 401) {
      const expired: StoredToken = { ...stored, reauthRequired: true, accessToken: '' };
      await writeTokenRow(expired);
      return expired;
    }
    throw new SpotifyError('Odświeżenie tokenu Spotify nie powiodło się.', response.status, body);
  }

  const data = (await response.json()) as SpotifyTokenResponse;
  const next: StoredToken = {
    accessToken: data.access_token,
    // Spotify nie zawsze zwraca nowy refresh token - zachowujemy poprzedni.
    refreshToken: data.refresh_token ?? stored.refreshToken,
    grantedAt: grantedAt.toISOString(),
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope ?? stored.scope,
    reauthRequired: false,
  };

  await writeTokenRow(next);
  return next;
}

export async function getValidAdminToken(): Promise<string> {
  const stored = await readTokenRow();

  if (stored.reauthRequired) {
    throw new SpotifyError(
      'Połączenie konta administratora ze Spotify wygasło. Zaloguj się ponownie.',
      401,
      null,
    );
  }

  const stillValid =
    stored.accessToken && stored.expiresAt && new Date(stored.expiresAt).getTime() > Date.now() + 60_000;

  if (stillValid) return stored.accessToken;

  if (!refreshInFlight) {
    refreshInFlight = refreshStoredToken(stored).finally(() => {
      refreshInFlight = null;
    });
  }

  const refreshed = await refreshInFlight;
  if (!refreshed.accessToken) {
    throw new SpotifyError(
      'Połączenie konta administratora ze Spotify wygasło. Zaloguj się ponownie.',
      401,
      null,
    );
  }
  return refreshed.accessToken;
}

export async function saveAdminToken(data: SpotifyTokenResponse): Promise<void> {
  const next: StoredToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    // Cykl 6-miesięczny liczymy od teraz (moment udzielenia zgody).
    grantedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope ?? null,
    reauthRequired: false,
  };
  await writeTokenRow(next);
}

export async function clearAdminToken(): Promise<void> {
  await db.delete(settings).where(eq(settings.key, SETTINGS_KEY));
}

export async function getStoredTokenMeta(): Promise<StoredToken> {
  return readTokenRow();
}

/** Zamyka pulę połączeń z bazą przy zamykaniu aplikacji. */
// ---------------------------------------------------------------------------
// PKCE - Authorization Code z dowodem w posiadaniu kodu.
// ---------------------------------------------------------------------------

const PENDING_STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map<string, { verifier: string; createdAt: number }>();

export function createAuthorizationState(): { state: string; verifier: string } {
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(64).toString('base64url');
  pendingStates.set(state, { verifier, createdAt: Date.now() });

  // Sprzątanie starych stanów.
  const cutoff = Date.now() - PENDING_STATE_TTL_MS;
  for (const [key, value] of pendingStates) {
    if (value.createdAt < cutoff) pendingStates.delete(key);
  }

  return { state, verifier };
}

export function consumeAuthorizationState(state: string): string | null {
  const entry = pendingStates.get(state);
  pendingStates.delete(state);
  if (!entry || Date.now() - entry.createdAt > PENDING_STATE_TTL_MS) return null;
  return entry.verifier;
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function exchangeCodeForToken(code: string, verifier: string): Promise<SpotifyTokenResponse> {
  const response = await fetch(SPOTIFY_ACCOUNTS_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(
        `${config.spotify.clientId}:${config.spotify.clientSecret}`,
      ).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.spotify.redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new SpotifyError(
      'Spotify odrzuciło kod autoryzacji.',
      response.status,
      await response.text().catch(() => null),
    );
  }

  return (await response.json()) as SpotifyTokenResponse;
}

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}
