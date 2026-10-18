import { readdir, readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { config } from '../config.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  return Promise.all(
    files.map(async (name) => {
      const contents = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
      return {
        name,
        sql: contents,
        checksum: createHash('sha256').update(contents).digest('hex').slice(0, 16),
      };
    }),
  );
}

export async function runMigrations(log: (msg: string) => void = console.log): Promise<void> {
  const sql = postgres(config.databaseUrl, { max: 1, onnotice: () => {} });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS __migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const applied: { name: string; checksum: string }[] = await sql`
      SELECT name, checksum FROM __migrations
    `;
    const appliedMap = new Map(applied.map((r) => [r.name, r.checksum]));

    const migrations = await loadMigrations();
    let count = 0;

    for (const migration of migrations) {
      const previous = appliedMap.get(migration.name);

      if (previous) {
        if (previous !== migration.checksum) {
          throw new Error(
            `Migracja "${migration.name}" została zmieniona po zastosowaniu ` +
              `(suma kontrolna ${previous} -> ${migration.checksum}). ` +
              'Usuń wiersz z tabeli __migrations tylko jeśli wiesz, co robisz.',
          );
        }
        continue;
      }

      log(`  → migracja ${migration.name}`);
      await sql.begin(async (tx: postgres.TransactionSql) => {
        await tx.unsafe(migration.sql);
        await tx`INSERT INTO __migrations (name, checksum) VALUES (${migration.name}, ${migration.checksum})`;
      });
      count += 1;
    }

    log(count > 0 ? `[db] Zastosowano ${count} migrację/migracji.` : '[db] Baza jest aktualna.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Uruchomienie bezpośrednie: `pnpm db:migrate`
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runMigrations().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error('[db] Migracja nie powiodła się:', err);
      process.exit(1);
    },
  );
}
