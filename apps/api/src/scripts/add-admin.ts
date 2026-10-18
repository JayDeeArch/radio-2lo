import { closeDatabase } from '../spotify/tokens.js';
import { addAllowedAdmin } from '../services/admins.js';

const id = process.argv[2];
if (!id) {
  console.error('Użycie: add-admin <spotify_id lub account_id>');
  process.exit(1);
}

addAllowedAdmin(id)
  .then((entry) => {
    console.log(entry ? `Dodano: ${id}` : `Już istniał: ${id}`);
  })
  .catch((err) => {
    console.error('[add-admin] Błąd:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });