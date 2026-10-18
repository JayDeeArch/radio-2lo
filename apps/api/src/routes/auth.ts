import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { admins } from '../db/schema.js';
import { clearCookieOptions, createSession, sessionCookieOptions, toAdminDto } from '../lib/session.js';
import { getAdminProfile } from '../spotify/client.js';
import {
  clearAdminToken,
  consumeAuthorizationState,
  createAuthorizationState,
  exchangeCodeForToken,
  getStoredTokenMeta,
  pkceChallenge,
  saveAdminToken,
} from '../spotify/tokens.js';
import { OAUTH_SCOPES } from '../spotify/types.js';
import { getLastSyncState } from '../services/sync.js';
import type { SpotifyConnection } from '@radio/shared';

const REFRESH_TOKEN_MAX_AGE_DAYS = 183;

import { isAdminAllowed } from '../services/admins.js';

/** Konto może zalogować się tylko wtedy, gdy jest na liście albo lista jest pusta. */
async function isAllowed(spotifyId: string, accountId: string | undefined): Promise<boolean> {
  return isAdminAllowed(spotifyId, accountId);
}

const callbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  error: z.string().optional(),
});

function redirectToApp(reply: FastifyReply, path: string): FastifyReply {
  return reply.redirect(`${config.publicBaseUrl}${path}`, 302);
}

function connectionMeta(grantedAt: string | null, expiresAt: string | null, reauthRequired: boolean) {
  const granted = grantedAt ? new Date(grantedAt) : null;
  const deadline = granted ? new Date(granted.getTime() + REFRESH_TOKEN_MAX_AGE_DAYS * 86_400_000) : null;
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / 86_400_000) : null;

  return { grantedAt, expiresAt, daysLeft, needsReauth: reauthRequired };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/spotify/login', async (_request, reply) => {
    const { state, verifier } = createAuthorizationState();

    const params = new URLSearchParams({
      client_id: config.spotify.clientId,
      response_type: 'code',
      redirect_uri: config.spotify.redirectUri,
      scope: OAUTH_SCOPES,
      state,
      code_challenge_method: 'S256',
      code_challenge: pkceChallenge(verifier),
    });

    return reply.redirect(`https://accounts.spotify.com/authorize?${params}`, 302);
  });

  app.get<{ Querystring: unknown }>('/api/auth/spotify/callback', async (request, reply) => {
    const parsed = callbackQuery.safeParse(request.query);

    if (!parsed.success) {
      return reply.redirect(`${config.publicBaseUrl}/admin?error=callback`, 302);
    }
    if (parsed.data.error) {
      return reply.redirect(`${config.publicBaseUrl}/admin?error=denied`, 302);
    }

    const verifier = consumeAuthorizationState(parsed.data.state);
    if (!verifier) {
      return reply.redirect(`${config.publicBaseUrl}/admin?error=state`, 302);
    }

    try {
      const token = await exchangeCodeForToken(parsed.data.code, verifier);
      await saveAdminToken(token);

      // Połączenie zapisane - teraz możemy odczytać profil, żeby ustalić, kim jest admin.
      const profile = await getAdminProfile();

      if (!(await isAllowed(profile.id, profile.account_id))) {
        await clearAdminToken();

        // Podajemy identyfikatory, które Spotify nam zwrócił, oraz aktualną
        // listę dozwolonych. Dzięki temu osoba, która próbuje się zalogować
        // po raz pierwszy, dostaje gotowy do wklejenia wiersz konfiguracyjny -
        // bez potrzeby tymczasowego otwierania listy (co byłoby ryzykiem,
        // bo aplikacja jest wystawiona w internecie).
        const detected = profile.account_id ?? profile.id;
        const existing = config.spotify.adminAllowlist;

        request.log.warn(
          { spotifyId: profile.id, accountId: profile.account_id },
          'Logowanie odrzucone - konto spoza listy dozwolonych',
        );

        const params = new URLSearchParams({
          error: 'not_allowed',
          detected,
          existing: existing.join(','),
        });

        return reply.redirect(`${config.publicBaseUrl}/admin?${params}`, 302);
      }

      const existing = await db
        .select({ id: admins.id })
        .from(admins)
        .where(eq(admins.spotifyId, profile.id))
        .limit(1);

      const avatar = profile.images?.[0]?.url ?? null;
      const displayName = profile.display_name ?? profile.id;

      let adminId = existing[0]?.id;
      if (adminId) {
        await db
          .update(admins)
          .set({ displayName, avatarUrl: avatar, accountId: profile.account_id ?? null, lastLoginAt: new Date() })
          .where(eq(admins.id, adminId));
      } else {
        const inserted = await db
          .insert(admins)
          .values({
            spotifyId: profile.id,
            accountId: profile.account_id ?? null,
            displayName,
            avatarUrl: avatar,
          })
          .returning({ id: admins.id });
        adminId = inserted[0]!.id;
      }

      const sessionToken = await createSession(adminId);
      void reply.setCookie(config.session.cookieName, sessionToken, sessionCookieOptions());

      return redirectToApp(reply, '/admin');
    } catch (error) {
      request.log.error({ err: error }, 'Logowanie przez Spotify nie powiodło się');
      return reply.redirect(`${config.publicBaseUrl}/admin?error=failed`, 302);
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies?.[config.session.cookieName];
    if (token) void reply.clearCookie(config.session.cookieName, clearCookieOptions());
    return { ok: true };
  });

  app.get('/api/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.admin) return reply.code(401).send({ error: 'Nie zalogowano.' });

    const stored = await getStoredTokenMeta();
    const sync = await getLastSyncState();

    const connection: SpotifyConnection = {
      connected: Boolean(stored.accessToken || stored.refreshToken) && !stored.reauthRequired,
      ...connectionMeta(stored.grantedAt, stored.expiresAt, stored.reauthRequired),
      lastSyncAt: sync.lastSyncAt,
      lastSyncError: sync.lastSyncError,
      playlistName: sync.playlistName,
      playlistTrackCount: sync.playlistTrackCount,
    };

      return { admin: toAdminDto(request.admin), spotify: connection };
    });
}
