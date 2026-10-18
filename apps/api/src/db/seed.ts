/**
 * Dane demonstracyjne do rozwoju i prezentacji.
 * Uruchomienie:  pnpm db:seed
 *
 * Metadane utworów są pobierane NA ŻYWO ze Spotify po ID - dzięki temu
 * tytuł, wykonawca i okładka zawsze odpowiadają rzeczywistości. Wcześniejsza
 * wersja skryptu trzymała je w kodzie i po drodze rozjechała się z katalogiem.
 *
 * NIE uruchamiaj tego na produkcji.
 */

import { buildSearchBlob } from '@radio/shared';
import { closeDatabase } from '../spotify/tokens.js';
import { db } from './index.js';
import { requests } from './schema.js';
import { getTrack, SpotifyError } from '../spotify/client.js';

interface SeedEntry {
  id: string;
  class: string;
  note?: string;
  status: 'OCZEKUJACE' | 'ZATWIERDZONE' | 'ODRZUCONE';
  rejectReason?: string;
}

const SEED: SeedEntry[] = [
  {
    id: '0DiWol3AO6WpXZgp0goxAV',
    class: '3B',
    note: 'Weszła na bal klasowy, koniecznie dodać!',
    status: 'ZATWIERDZONE',
  },
  { id: '6dRJJMO9URXnTJaz401b4Q', class: '2A', status: 'ZATWIERDZONE' },
  { id: '1MsoH4Fz8O9PKbTW5SkXbJ', class: '4A', status: 'OCZEKUJACE' },
  {
    id: '49ZeX1Mfls6dP6dm4OyWQP',
    class: '1C',
    note: 'Każdy na WF to zna.',
    status: 'OCZEKUJACE',
  },
  { id: '5jVMVRFbk57ovUm15hl6zw', class: '4F', status: 'OCZEKUJACE' },
  {
    id: '561jH07mF1jHuk7KlaeF0s',
    class: '3B',
    status: 'ODRZUCONE',
    rejectReason: 'Treść wulgarna - nie na szkolne radio.',
  },
  {
    id: '0DiWol3AO6WpXZgp0goxAV',
    class: '3B',
    status: 'ODRZUCONE',
    rejectReason: 'Utwór jest już na playliscie szkolnego radia.',
  },
];

async function seed(): Promise<void> {
  console.log('[seed] Pobieranie metadanych utworów ze Spotify...');

  let inserted = 0;
  let skipped = 0;

  for (const entry of SEED) {
    let track;
    try {
      track = await getTrack(entry.id);
    } catch (error) {
      if (error instanceof SpotifyError) {
        console.warn(`  [seed] Pominięto ${entry.id}: ${error.message}`);
        skipped += 1;
        continue;
      }
      throw error;
    }

    const artistName = track.artists.map((a) => a.name).join(', ');
    const year = track.album?.release_date
      ? Number.parseInt(track.album.release_date.slice(0, 4), 10) || null
      : null;

    await db
      .insert(requests)
      .values({
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
        class: entry.class,
        note: entry.note ?? null,
        status: entry.status,
        rejectReason: entry.rejectReason ?? null,
        spotifySync: entry.status === 'ZATWIERDZONE' ? 'OK' : 'NOT_REQUIRED',
        decidedAt: entry.status === 'OCZEKUJACE' ? null : new Date(),
        spotifyAddedAt: entry.status === 'ZATWIERDZONE' ? new Date() : null,
      });

    console.log(`  [seed] ${track.name} - ${artistName} [${entry.status}]`);
    inserted += 1;
  }

  console.log(`\n[seed] Dodano ${inserted} prośb${skipped ? `, pominięto ${skipped}` : ''}.`);
  console.log('[seed] To dane demonstracyjne - nie uruchamiaj na produkcji.');

  await closeDatabase();
}

seed().catch(async (error: unknown) => {
  console.error('[seed] Nie powiodło się:', error);
  await closeDatabase();
  process.exit(1);
});
