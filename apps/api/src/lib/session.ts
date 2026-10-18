import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { admins, sessions, type Admin } from '../db/schema.js';
import type { AdminDto } from '@radio/shared';

export const SESSION_MAX_AGE_SECONDS = config.session.ttlDays * 24 * 60 * 60;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function createSession(adminId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await db
    .insert(sessions)
    .values({ tokenHash: hashToken(token), adminId, expiresAt });

  // Sprzątanie wygasłych sesji przy okazji.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function findAdminBySession(token: string | undefined): Promise<Admin | null> {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const rows = await db
    .select({ admin: admins, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(admins, eq(admins.id, sessions.adminId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return rows[0]?.admin ?? null;
}

export function toAdminDto(admin: Admin): AdminDto {
  return {
    id: admin.id,
    displayName: admin.displayName,
    avatarUrl: admin.avatarUrl,
    spotifyId: admin.spotifyId,
  };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function clearCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction,
    path: '/',
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: Admin;
  }
}

/**
 * Podpięcie administratora do żądania (opcjonalne - nie blokuje tras publicznych).
 * Jeden argument i async - jednoznacznie interpretowane przez Fastify jako hook
 * obietnicowy, niezależnie od tego, co zwróci.
 */
export async function attachAdmin(request: FastifyRequest): Promise<void> {
  const token = request.cookies?.[config.session.cookieName];
  if (token) {
    request.admin = (await findAdminBySession(token)) ?? undefined;
  }
}

/**
 * Ochrona tras administratora.
 *
 * Hook MUSI być asynchroniczny i mieć jeden argument. Funkcja synchroniczna
 * z dwoma argumentami jest przez Fastify interpretowana w stylu callbackowym
 * (`(request, done)`) - Fastify czeka wtedy na wywołanie `done`, którego nigdy
 * nie dostajemy, i żądanie wisi w nieskończoność (aż do timeoutu klienta).
 * Rzucanie błędu z `statusCode` jest bezpieczne: globalny errorHandler
 * zamienia go na `{ error: ... }` z właściwym kodem HTTP.
 */
export async function requireAdmin(request: FastifyRequest): Promise<void> {
  if (request.admin) return;

  const error = new Error('Musisz zalogować się kontem administratora.') as Error & {
    statusCode: number;
  };
  error.statusCode = 401;
  throw error;
}
