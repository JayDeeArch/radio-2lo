import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dedications, requests } from '../db/schema.js';
import { getTrack } from '../spotify/client.js';
import { createRequest } from './requests.js';
import type { SpotifyTrack } from '../spotify/types.js';
import { buildSearchBlob } from '@radio/shared';

export interface NewDedicationData {
  track: SpotifyTrack;
  recipient: string;
  sender: string | null;
  isAnonymous: boolean;
  message: string | null;
  targetDate: string;
}

function trackSnapshot(track: SpotifyTrack) {
  const artistName = track.artists.map((a) => a.name).join(', ');
  const year = track.album?.release_date
    ? Number.parseInt(track.album.release_date.slice(0, 4), 10) || null
    : null;
  return {
    spotifyTrackId: track.id,
    uri: track.uri,
    trackName: track.name,
    artistName,
    albumName: track.album?.name ?? null,
    albumImageUrl: track.album?.images?.[0]?.url ?? null,
    durationMs: track.duration_ms ?? null,
    releaseYear: year,
    isExplicit: Boolean(track.explicit),
    searchBlob: buildSearchBlob([track.name, artistName, track.album?.name]),
  };
}

export async function createDedication(data: NewDedicationData) {
  const snap = trackSnapshot(data.track);

  // Automatycznie zgłoś utwór jako prośbę, żeby trafił do kolejki.
  const reqResult = await createRequest({
    track: data.track,
    class: 'DEDYKACJA',
    note: data.message,
  });
  const requestId = reqResult.ok ? reqResult.request.id : null;

  const inserted = await db
    .insert(dedications)
    .values({
      ...snap,
      recipientName: data.recipient,
      senderName: data.isAnonymous ? null : data.sender,
      isAnonymous: data.isAnonymous,
      message: data.message,
      targetDate: data.targetDate,
      requestId,
      status: 'OCZEKUJACE',
    })
    .returning({ id: dedications.id });

  return inserted[0]!.id;
}

export async function listDedications(status?: string, includeHidden = false) {
  const conditions = [];
  if (status && status !== 'WSZYSTKIE') conditions.push(eq(dedications.status, status));
  if (!includeHidden) conditions.push(eq(dedications.hidden, false));
  const rows = await db
    .select({
      dedication: dedications,
      requestStatus: requests.status,
    })
    .from(dedications)
    .leftJoin(requests, eq(requests.id, dedications.requestId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(dedications.targetDate, dedications.createdAt);
  return rows.map((r) => ({ ...r.dedication, requestStatus: r.requestStatus }));
}

export async function setDedicationHidden(id: string, hidden: boolean) {
  await db.update(dedications).set({ hidden, updatedAt: new Date() }).where(eq(dedications.id, id));
}

export async function getDedication(id: string) {
  const rows = await db.select().from(dedications).where(eq(dedications.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function approveDedication(id: string, adminId: string) {
  await db
    .update(dedications)
    .set({ status: 'ZATWIERDZONE', decidedBy: adminId, decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(dedications.id, id));
}

export async function rejectDedication(id: string, adminId: string, reason: string) {
  await db
    .update(dedications)
    .set({ status: 'ODRZUCONE', rejectReason: reason, decidedBy: adminId, decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(dedications.id, id));
}

export async function undoDedication(id: string) {
  await db
    .update(dedications)
    .set({ status: 'OCZEKUJACE', rejectReason: null, decidedBy: null, decidedAt: null, updatedAt: new Date() })
    .where(eq(dedications.id, id));
}