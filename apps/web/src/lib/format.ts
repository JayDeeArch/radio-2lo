import type { RequestDto, RequestStatus } from '@radio/shared';
import { STATUS_LABEL } from '@radio/shared';

export function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return '--:--';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** "3 min temu", "wczoraj" - czytelniej niż surowy znacznik czasu. */
export function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 1) return 'przed chwilą';
  if (minutes < 60) return `${minutes} min temu`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} godz. temu`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'wczoraj';
  if (days < 30) return `${days} dni temu`;

  return formatDate(iso);
}

export function formatCount(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  // Polska ma trzy formy: 1, 2-4, 5+.
  const lastTwo = count % 100;
  const last = count % 10;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

/**
 * Ścieżka osadzona odtwarzacza Spotify - działa bez Premium, zużywa 30 s podglądu.
 *
 * Celowo BEZ `theme=0`: wymuszenie jasnego odtwarzacza na ciemnym interfejsie
 * to plam światła. Bez tego parametru osadzenie przejmuje motyw systemowy
 * (`color-scheme: dark` ustawione w CSS), więc na ciemnym sprzęcie jest ciemne.
 */
export function spotifyEmbedUrl(trackId: string): string {
  return `https://open.spotify.com/embed/track/${trackId}?utm_source=generator`;
}

export function spotifyTrackUrl(trackId: string): string {
  return `https://open.spotify.com/track/${trackId}`;
}

type BadgeTone = 'green' | 'amber' | 'rose' | 'slate';

const STATUS_STYLE: Record<RequestStatus, { tone: BadgeTone; dot: string }> = {
  ZATWIERDZONE: { tone: 'green', dot: 'bg-neon-500' },
  OCZEKUJACE: { tone: 'amber', dot: 'bg-amber-glow' },
  ODRZUCONE: { tone: 'rose', dot: 'bg-rose-glow' },
};

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: 'border-neon-500/40 bg-neon-500/12 text-neon-400',
  amber: 'border-amber-glow/40 bg-amber-glow/12 text-amber-glow',
  rose: 'border-rose-glow/40 bg-rose-glow/12 text-rose-glow',
  slate: 'border-white/15 bg-white/6 text-slate-300',
};

export function statusClasses(status: RequestStatus): string {
  return TONE_CLASSES[STATUS_STYLE[status].tone];
}

export function statusDotClass(status: RequestStatus): string {
  return STATUS_STYLE[status].dot;
}

export { STATUS_LABEL };

/** Pula tekstu zastępczego dla okładki, gdy utwór nie ma grafiki. */
export function artPlaceholder(initials: string): string {
  const seed = [...initials].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = seed % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 60) % 360} 70% 25%))`;
}

export function initialsOf(request: RequestDto): string {
  const words = `${request.track.name} ${request.track.artists[0] ?? ''}`.trim();
  return words
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Zwięzły opis liczby głosów: "3 osoby z 2 klas" / "1 osoba z 1 klasy".
 * Za mało miejsca na pełne zdanie, a licznik priorytetu ma być czytelny od razu.
 */
export function formatVotes(votes: number, classCount: number): string {
  if (votes <= 1) return '1 głos';

  const people =
    classCount > 1
      ? `${formatCount(classCount, 'osoba', 'osoby', 'osób')} z ${formatCount(
          classCount,
          'klasy',
          'klas',
          'klas',
        )}`
      : 'z jednej klasy';

  return `${formatCount(votes, 'głos', 'głosy', 'głosów')} ${people}`;
}

/** Lista klas z liczbą głosów, np. "3B ×3, 2A ×1". */
export function formatClassBreakdown(breakdown: string[]): string {
  if (breakdown.length === 0) return '';

  const counts = new Map<string, number>();
  for (const klass of breakdown) counts.set(klass, (counts.get(klass) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'))
    .map(([klass, n]) => (n > 1 ? `${klass} ×${n}` : klass))
    .join(', ');
}

/**
 * Normalizacja tekstu do wyszukiwania w przeglądarce.
 * Zdejmuje polskie znaki i mniejsza litery, więc „zol" znajdzie „Żółw".
 * Odpowiada temu, co serwer robi z `search_blob` przez `stripDiacritics`.
 */
export function normalizeForSearch(input: string): string {
  return input
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) =>
      ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' })[
        c.toLowerCase()
      ] ?? c,
    )
    .toLowerCase()
    .trim();
}

/** Czy wpis pasuje do utworu (tytuł, wykonawca lub album). */
export function matchesTrack(
  track: { name: string; artists: string[]; album: string | null },
  query: string,
): boolean {
  const needle = normalizeForSearch(query);
  if (!needle) return true;

  const haystack = normalizeForSearch(
    `${track.name} ${track.artists.join(' ')} ${track.album ?? ''}`,
  );

  // Dopasowanie słowa w całości + dopuszczenie podciągów, żeby „daft" znalazło
  // „One More Time" tylko gdy faktycznie o tym jest mowa w tekście.
  return (
    haystack.includes(needle) ||
    haystack.split(' ').some((word) => word.startsWith(needle))
  );
}
