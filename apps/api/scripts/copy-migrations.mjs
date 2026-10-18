/**
 * `tsc` kopiuje tylko pliki .ts, więc migracje .sql trzeba przenieść do dist ręcznie.
 * Bez tego krok migracji w kontenerze nie znajdzie plików.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const from = join(process.cwd(), 'src', 'db', 'migrations');
const to = join(process.cwd(), 'dist', 'db', 'migrations');

if (!existsSync(from)) {
  console.error(`[build] Nie znaleziono katalogu migracji: ${from}`);
  process.exit(1);
}

mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`[build] Skopiowano migracje do ${to}`);
