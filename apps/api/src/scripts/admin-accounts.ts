/**
 * Pomocnik: pokazuje konta Spotify powiązane z panelem administratora
 * oraz stan połączenia tokenu.
 *
 * Uruchomienie (na serwerze):
 *   docker compose exec api node apps/api/dist/scripts/admin-accounts.js
 *
 * Po pierwszym udanym zalogowaniu przez /admin Twoje konto pojawi się tutaj.
 * Wartość `account_id` (lub `spotify_id`) wklej do ADMIN_SPOTIFY_IDS w pliku .env,
 * żeby do panelu mógł zalogować się tylko administrator.
 */

import { desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { admins, requests } from '../db/schema.js';
import { closeDatabase, getStoredTokenMeta } from '../spotify/tokens.js';
import { config } from '../config.js';

const REFRESH_TOKEN_MAX_AGE_DAYS = 183;

async function main(): Promise<void> {
  const linked = await db
    .select({
      spotifyId: admins.spotifyId,
      accountId: admins.accountId,
      displayName: admins.displayName,
      lastLoginAt: admins.lastLoginAt,
    })
    .from(admins)
    .orderBy(desc(admins.lastLoginAt));

  const stats = await db
    .select({
      total: sql<number>`count(*)`,
      approved: sql<number>`count(*) filter (where ${requests.status} = 'ZATWIERDZONE')`,
      pending: sql<number>`count(*) filter (where ${requests.status} = 'OCZEKUJACE')`,
    })
    .from(requests);

  const token = await getStoredTokenMeta();
  const allowlist = config.spotify.adminAllowlist;

  console.log('\n\x1b[1m\x1b[35m Szkolne Radio - konta administratora\x1b[0m\n');

  if (linked.length === 0) {
    console.log('  \x1b[33m!\x1b[0m  Nikt jeszcze nie zalogował się przez /admin.');
    console.log('     Wejdź na https://radio.jdkm.cc/admin i zaloguj się kontem Spotify.');
    console.log('     Potem uruchom ten skrypt ponownie, żeby odczytać swój identyfikator.\n');
  } else {
    for (const admin of linked) {
      console.log(`  \x1b[32m✓\x1b[0m ${admin.displayName}`);
      console.log(`     account_id : ${admin.accountId ?? '\x1b[90mbrak\x1b[0m'}`);
      console.log(`     spotify_id : ${admin.spotifyId}`);
      console.log(
        `     ostatnio   : ${admin.lastLoginAt ? admin.lastLoginAt.toISOString() : '\x1b[90mnigdy\x1b[0m'}`,
      );
      console.log();
    }
  }

  console.log('  \x1b[1mLista dostępu (ADMIN_SPOTIFY_IDS)\x1b[0m');
  if (allowlist.length === 0) {
    console.log('     \x1b[33mpusta - do panelu może zalogować się KAŻDE konto Spotify.\x1b[0m');
    console.log('     Wpisz poniżej wartość, żeby zamknąć dostęp tylko na siebie.\n');
  } else {
    for (const id of allowlist) console.log(`     - ${id}`);
    console.log();
  }

  /**
   * Gotowa instrukcja dodania kolejnego administratora. Nowa osoba nie może
   * się zalogować, dopóki jej identyfikator nie znajdzie się na liście -
   * dlatego najprościej poprosić ją o zalogowanie: panel pokaże jej dokładnie
   * ten identyfikator i gotowy wiersz do wklejenia.
   */
  console.log('  \x1b[1mJak dodać kolejnego administratora\x1b[0m');
  console.log('     1. Nowa osoba loguje się na https://radio.jdkm.cc/admin.');
  console.log('     2. Panel odrzuci ją i pokaże jej identyfikator oraz');
  console.log('        gotowy wiersz "ADMIN_SPOTIFY_IDS=..." do przekazania.');
  console.log('     3. Administrator wpisuje ten wiersz w .env i restartuje API:\n');
  console.log('     \x1b[90mcd ~/apps/szkolne-radio\x1b[0m');
  console.log('     \x1b[90mnano .env     # dopisz identyfikator do ADMIN_SPOTIFY_IDS\x1b[0m');
  console.log('     \x1b[90mdocker compose up -d api\x1b[0m\n');
  console.log('     \x1b[90mAlternatywnie, jeśli znasz już ID (link profilu Spotify):\x1b[0m');
  console.log('     \x1b[90mhttps://open.spotify.com/user/<ID>  ->  dopisz <ID> po przecinku.\x1b[0m\n');

  console.log('  \x1b[1mStan połączenia ze Spotify\x1b[0m');
  console.log(`     token zapisany     : ${token.refreshToken ? '\x1b[32mtak\x1b[0m' : '\x1b[33mnie\x1b[0m'}`);
  console.log(`     wymaga ponownego   : ${token.reauthRequired ? '\x1b[31mtak\x1b[0m' : 'nie'}`);

  if (token.grantedAt) {
    const deadline = new Date(
      new Date(token.grantedAt).getTime() + REFRESH_TOKEN_MAX_AGE_DAYS * 86_400_000,
    );
    const days = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
    const colour = days <= 14 ? '\x1b[31m' : days <= 30 ? '\x1b[33m' : '\x1b[32m';
    console.log(
      `     wygasa za          : ${colour}${days} dni\x1b[0m (${deadline.toISOString().slice(0, 10)})`,
    );
    if (days <= 30) {
      console.log('     \x1b[33m→ Zaloguj się ponownie, zanim token wygaśnie.\x1b[0m');
    }
  } else {
    console.log('     data zgody         : \x1b[90mbrak - zgoda nie została jeszcze udzielona\x1b[0m');
  }

  const stat = stats[0];
  console.log('\n  \x1b[1mProśby\x1b[0m');
  console.log(`     łącznie    : ${Number(stat?.total ?? 0)}`);
  console.log(`     zatwierdzone: ${Number(stat?.approved ?? 0)}`);
  console.log(`     oczekujące : ${Number(stat?.pending ?? 0)}`);
  console.log();

  await closeDatabase();
}

main().catch(async (error: unknown) => {
  console.error('[admin-accounts] Błąd:', error);
  await closeDatabase();
  process.exit(1);
});
