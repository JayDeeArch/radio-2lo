import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { adminAllowlist } from '../db/schema.js';
import { config } from '../config.js';

/** Sprawdza, czy konto (spotify_id lub account_id) jest na liście dozwolonych. */
export async function isAdminAllowed(spotifyId: string, accountId: string | undefined): Promise<boolean> {
  const allow = config.spotify.adminAllowlist;
  if (allow.includes(spotifyId) || (accountId && allow.includes(accountId))) return true;

  const rows = await db
    .select({ id: adminAllowlist.id })
    .from(adminAllowlist)
    .where(eq(adminAllowlist.spotifyId, spotifyId))
    .limit(1);
  if (rows.length > 0) return true;
  if (accountId) {
    const rows2 = await db
      .select({ id: adminAllowlist.id })
      .from(adminAllowlist)
      .where(eq(adminAllowlist.spotifyId, accountId))
      .limit(1);
    if (rows2.length > 0) return true;
  }
  // Jeśli lista (env + db) jest pusta, każdy może się zalogować (tryb otwarty).
  const dbCount = await db.select({ id: adminAllowlist.id }).from(adminAllowlist).limit(1);
  if (allow.length === 0 && dbCount.length === 0) return true;
  return false;
}

export async function listAllowedAdmins() {
  return db.select().from(adminAllowlist).orderBy(adminAllowlist.createdAt);
}

export async function addAllowedAdmin(spotifyId: string, addedBy?: string) {
  const trimmed = spotifyId.trim();
  if (!trimmed) throw new Error('Podaj identyfikator Spotify.');
  const inserted = await db
    .insert(adminAllowlist)
    .values({ spotifyId: trimmed, addedBy: addedBy ?? null })
    .onConflictDoNothing()
    .returning();
  return inserted[0] ?? null;
}

export async function removeAllowedAdmin(spotifyId: string) {
  await db.delete(adminAllowlist).where(eq(adminAllowlist.spotifyId, spotifyId.trim()));
}