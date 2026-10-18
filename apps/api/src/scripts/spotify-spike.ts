/**
 * Skrypt weryfikacyjny przed budową aplikacji.
 *
 * Sprawdza cztery rzeczy, których nie da się wywiedzieć z dokumentacji,
 * a które mogą zablokować cały projekt:
 *
 *  1. czy token client-credentials działa,
 *  2. czy `GET /tracks/{id}` zwraca `explicit` (pole usunięte wiele razy przy migracjach),
 *  3. czy konto współwłaściciela może DODAWAĆ utwory do cudzej playlisty
 *     (POST /playlists/{id}/items) - to kluczowe dla panelu administratora,
 *  4. czy playlista jest oznaczona jako `collaborative` (bez tego API nie zwraca jej zawartości).
 *
 * Uruchomienie:  pnpm spike
 * Wymaga: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_PLAYLIST_ID
 *         oraz zalogowania admina przez przeglądarkę (token admina zapisany w bazie).
 */

import { getAdminProfile, getPlaylist, getPlaylistItems, searchTracks, getTrack } from '../spotify/client.js';
import { getAppToken, getStoredTokenMeta } from '../spotify/tokens.js';
import { config } from '../config.js';
import { closeDatabase } from '../spotify/tokens.js';

const ok = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg: string) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);
const fail = (msg: string) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
const section = (msg: string) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

async function main(): Promise<void> {
  console.log('\n\x1b[1m\x1b[35m Szkolne Radio - weryfikacja integracji ze Spotify\x1b[0m');
  console.log(`Playlista: ${config.spotify.playlistId}`);
  console.log(`Rynek: ${config.spotify.market}`);

  // 1. Token aplikacji --------------------------------------------------
  section('1. Client Credentials');
  try {
    const token = await getAppToken();
    ok(`Token aplikacji uzyskany (${token.slice(0, 8)}…)`);
  } catch (error) {
    fail(`Nie udało się pobrać tokenu aplikacji: ${(error as Error).message}`);
    await closeDatabase();
    process.exit(1);
  }

  // 2. Wyszukiwanie ----------------------------------------------------
  section('2. Wyszukiwanie /search');
  try {
    const page = await searchTracks('daft punk', 10, 0);
    ok(`Zwrócono ${page.items.length} z ${page.total} wyników (limit API: 10)`);
    console.log(`    Limit nie może przekroczyć 10 od migracji z lutego 2026.`);
  } catch (error) {
    fail(`Wyszukiwanie nie powiodło się: ${(error as Error).message}`);
  }

  // 3. Pola utworu -----------------------------------------------------
  section('3. Pola utworu (GET /tracks/{id})');
  let probeTrackId: string | null = null;
  try {
    const page = await searchTracks('one more time', 1, 0);
    const track = page.items[0];
    if (track) {
      probeTrackId = track.id;
      const full = await getTrack(track.id);
      ok(`Pobrano "${full.name}" - ${full.artists.map((a) => a.name).join(', ')}`);
      ok(`Pole \`explicit\` obecne: ${full.explicit} (potrzebne do filtrowania treści)`);
      ok(`Pole \`album.images[0]\`: ${full.album?.images?.[0]?.url ? 'obecne' : 'BRAK'}`);
      ok(`Pole \`popularity\`: ${'popularity' in full ? 'obecne' : 'usunięte (oczekiwane)'}`);
      ok(`Pole \`available_markets\`: ${'available_markets' in full ? 'obecne' : 'usunięte (oczekiwane)'}`);
    }
  } catch (error) {
    warn(`Nie udało się pobrać przykładowego utworu: ${(error as Error).message}`);
  }

  // 4. Token administratora -------------------------------------------
  section('4. Sesja administratora');
  const stored = await getStoredTokenMeta();
  if (!stored.refreshToken) {
    fail('Brak tokenu administratora. Uruchom aplikację i zaloguj się przez /admin.');
    warn('Panel administratora wymaga konta będącego współwłaścicielem playlisty.');
    warn('Spotify Dev Mode dopuszcza tylko 5 użytkowników - uczniowie nie logują się, więc to OK.');
    await closeDatabase();
    process.exit(1);
  }
  if (stored.reauthRequired) {
    fail('Token administratora wygasł (6 miesięcy od zgody). Zaloguj się ponownie.');
    await closeDatabase();
    process.exit(1);
  }
  ok('Token administratora obecny.');

  try {
    const profile = await getAdminProfile();
    ok(`Zalogowano jako: ${profile.display_name ?? profile.id}`);
    ok(`Pole \`account_id\`: ${profile.account_id ?? 'brak'}`);
  } catch (error) {
    fail(`Nie udało się pobrać profilu: ${(error as Error).message}`);
  }

  // 5. Playlista -------------------------------------------------------
  section('5. Dostęp do playlisty');
  try {
    const playlist = await getPlaylist();
    ok(`Nazwa: "${playlist.name}"`);
    ok(`Collaborative: ${playlist.collaborative}`);
    if (!playlist.collaborative) {
      fail('Playlista NIE jest współdzielona - API nie zwróci jej zawartości ani nie pozwoli edytować.');
      warn('W Spotify: prawy przycisk na playliscie → Udostępnij → Zezwól na edycję.');
    }

    const items = await getPlaylistItems();
    ok(`Odczytano ${items.length} pozycji.`);
    if (items[0]) {
      const first = items[0].item;
      console.log(`    Pierwsza pozycja używa pola: ${first.item ? 'item' : first.track ? 'track' : 'nieznane'}`);
      if (!first.item && first.track) {
        warn('Odpowiedź używa starego pola `track` zamiast `item` - kod obsługuje oba warianty.');
      }
    }
  } catch (error) {
    fail(`Dostęp do playlisty nie powiódł się: ${(error as Error).message}`);
    warn('Sprawdź, czy konto admina jest współwłaścicielem, a nie tylko obserwatorem.');
  }

  // 6. Test zapisu -----------------------------------------------------
  section('6. Zapis na playlistę (POST /playlists/{id}/items)');
  if (!probeTrackId) {
    warn('Brak utworu testowego - pomijam próbę zapisu.');
  } else {
    console.log(`  \x1b[90mTest polega na dodaniu i natychmiastowym usunięciu utworu ${probeTrackId}.\x1b[0m`);
    console.log(`  \x1b[90mJeśli nie chcesz zmieniać playlisty, przerwij teraz (Ctrl+C).\x1b[0m`);
    await new Promise((r) => setTimeout(r, 5000));

    const { addTrackToPlaylist, removeTrackFromPlaylist } = await import('../spotify/client.js');
    try {
      await addTrackToPlaylist(probeTrackId);
      ok('Dodanie utworu zadziałało - konto współwłaściciela ma prawo zapisu.');
      await removeTrackFromPlaylist(probeTrackId);
      ok('Usunięcie utworu zadziałało. Playlista wróciła do stanu wyjściowego.');
    } catch (error) {
      fail(`Zapis nie powiódł się: ${(error as Error).message}`);
      warn('To blokuje panel administratora. Sprawdź uprawnienia i zakresy OAuth.');
      warn('Wymagane zakresy: playlist-read-private, playlist-modify-private, playlist-modify-public');
    }
  }

  section('Wynik');
  console.log('  Jeśli wszystkie punkty przeszły, aplikacja może być budowana.\n');
  await closeDatabase();
  process.exit(0);
}

main().catch(async (error: unknown) => {
  console.error('\n\x1b[31mWeryfikacja nie powiodła się:\x1b[0m', error);
  await closeDatabase();
  process.exit(1);
});
