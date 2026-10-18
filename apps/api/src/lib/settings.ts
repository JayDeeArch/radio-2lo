import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { settings } from '../db/schema.js';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  if (!rows[0]) return fallback;
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value: JSON.stringify(value), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(value), updatedAt: new Date() },
    });
}

export interface SyncState {
  lastSyncAt: string | null;
  lastSyncError: string | null;
  playlistName: string | null;
  playlistTrackCount: number | null;
}

const SYNC_KEY = 'sync_state';

export const getSyncState = (): Promise<SyncState> =>
  getSetting<SyncState>(SYNC_KEY, {
    lastSyncAt: null,
    lastSyncError: null,
    playlistName: null,
    playlistTrackCount: null,
  });

export const setSyncState = (state: Partial<SyncState>): Promise<void> =>
  setSetting(SYNC_KEY, state);
