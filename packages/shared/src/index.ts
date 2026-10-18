import { z } from 'zod';

/**
 * Statusy prośby o utwór.
 * OCZEKUJACE  - czeka na decyzję administratora
 * ZATWIERDZONE - dodane do playlisty szkolnego radia
 * ODRZUCONE  - odrzucone (z powodem)
 */
export const REQUEST_STATUSES = ['OCZEKUJACE', 'ZATWIERDZONE', 'ODRZUCONE'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Stan synchronizacji wiersza ze Spotify. */
export const SPOTIFY_SYNC = ['NOT_REQUIRED', 'PENDING', 'OK', 'ERROR'] as const;
export type SpotifySync = (typeof SPOTIFY_SYNC)[number];

/** Polskie nazwy statusów - używane w UI. */
export const STATUS_LABEL: Record<RequestStatus, string> = {
  OCZEKUJACE: 'Oczekujące',
  ZATWIERDZONE: 'W playliscie',
  ODRZUCONE: 'Odrzucone',
};

/** Klasa w polskim znaczeniu: 2A, 3B, 4F, 1C ... (cyfra + 1-2 duże litery). */
export const CLASS_PATTERN = /^([1-8])\s*([A-ZĄĆĘŁŃÓŚŹŻ]{1,2})$/u;

export const classSchema = z
  .string()
  .trim()
  .min(2, 'Klasa musi mieć co najmniej 2 znaki.')
  .max(4, 'Klasa jest za długa.')
  .transform((raw) => raw.toUpperCase().replace(/\s+/g, ''))
  .refine((v) => CLASS_PATTERN.test(v), {
    message: 'Poprawny format klasy to np. 2A, 3B, 4F.',
  });

/** Wyciąga z URI / URL-u Spotify identyfikator utworu. */
const TRACK_ID_IN_URI = /spotify:track:([A-Za-z0-9]{22})/;
const TRACK_ID_IN_URL = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/;
const BARE_TRACK_ID = /^([A-Za-z0-9]{22})$/;

export function extractTrackId(input: string): string | null {
  const value = input.trim();
  return (
    TRACK_ID_IN_URI.exec(value)?.[1] ??
    TRACK_ID_IN_URL.exec(value)?.[1] ??
    BARE_TRACK_ID.exec(value)?.[1] ??
    null
  );
}

/** Uproszczenie polskich znaków - "Żeta" -> "zeta" (do wyszukiwania bez diakrytyków). */
const POLISH_MAP: Record<string, string> = {
  ą: 'a', Ą: 'a', ć: 'c', Ć: 'c', ę: 'e', Ę: 'e', ł: 'l', Ł: 'l',
  ń: 'n', Ń: 'n', ó: 'o', Ó: 'o', ś: 's', Ś: 's', ź: 'z', Ź: 'z', ż: 'z', Ż: 'z',
};

export function stripDiacritics(input: string): string {
  return input
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => POLISH_MAP[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tworzy kolumnę przeszukiwaną - tytuł + artyści + album, bez diakrytyków. */
export function buildSearchBlob(parts: Array<string | null | undefined>): string {
  return stripDiacritics(parts.filter(Boolean).join(' '));
}

export const submitRequestSchema = z.object({
  /** URI, link albo sam ID utworu. */
  track: z.string().trim().min(1, 'Wklej link do utworu ze Spotify.').max(500),
  class: classSchema,
  note: z.string().trim().max(280, 'Notatka może mieć maksymalnie 280 znaków.').optional().default(''),
});
export type SubmitRequestInput = z.infer<typeof submitRequestSchema>;

export const rejectRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Podaj krótki powód odrzucenia (min. 3 znaki).')
    .max(280, 'Powód może mieć maksymalnie 280 znaków.'),
});
export type RejectRequestInput = z.infer<typeof rejectRequestSchema>;

export const REQUEST_SORTS = ['priorytet', 'nowe', 'losowe'] as const;
export type RequestSort = (typeof REQUEST_SORTS)[number];

/** Opis sortowania w polskim interfejsie. */
export const SORT_LABEL: Record<RequestSort, string> = {
  priorytet: 'Priorytet (najwięcej głosów)',
  nowe: 'Najnowsze',
  losowe: 'Losowa kolejność',
};

export const requestQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  status: z.enum(['WSZYSTKIE', ...REQUEST_STATUSES]).optional().default('WSZYSTKIE'),
  class: z.string().trim().max(8).optional().default(''),
  sort: z.enum(REQUEST_SORTS).optional().default('priorytet'),
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(60).optional().default(18),
});
export type RequestQuery = z.infer<typeof requestQuerySchema>;

export const suggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  offset: z.coerce.number().int().min(0).max(500).optional().default(0),
  limit: z.coerce.number().int().min(1).max(10).optional().default(10),
});
export type SuggestQuery = z.infer<typeof suggestQuerySchema>;

/** Uproszczony utwór - snapshot metadanych w chwili zgłoszenia. */
export const trackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  album: z.string().nullable(),
  imageUrl: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  releaseYear: z.number().int().nullable(),
  isExplicit: z.boolean(),
  url: z.string(),
});
export type TrackDto = z.infer<typeof trackSchema>;

export const requestSchema = z.object({
  id: z.string().uuid(),
  track: trackSchema,
  /** Klasa pierwszego zgłaszającego (zachowana dla zgodności i szybkiego podglądu). */
  class: z.string(),
  note: z.string().nullable(),
  /** Liczba osób, które zgłosiły prośbę o ten utwór. To główna miara priorytetu. */
  votes: z.number().int().nonnegative(),
  /** Liczba RÓŻNYCH klas proszących o utwór. */
  classCount: z.number().int().nonnegative(),
  /** Kolejność klas wg liczby głosów, malejąco, np. ["3B","3B","2A","1C"]. */
  classBreakdown: z.array(z.string()),
  /** Ostatni głos - pokazuje, kiedy utwór cieszył się największym zainteresowaniem. */
  lastVoteAt: z.string().nullable(),
  status: z.enum(REQUEST_STATUSES),
  spotifySync: z.enum(SPOTIFY_SYNC),
  spotifyError: z.string().nullable(),
  rejectReason: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  spotifyAddedAt: z.string().nullable(),
});
export type RequestDto = z.infer<typeof requestSchema>;

export const submitResponseSchema = z.object({
  /** True gdy utwór był już zgłoszony i dodano kolejny głos. */
  alreadyRequested: z.boolean(),
  /**
   * True gdy utwór jest już na playliscie. Prośba zostaje wtedy od razu
   * zapisana jako zatwierdzona - uczeń dostaje natychmiastową odpowiedź,
   * a utwór nie trafi drugi raz na playlistę.
   */
  alreadyOnPlaylist: z.boolean(),
  votes: z.number().int().nonnegative(),
  classCount: z.number().int().nonnegative(),
  request: requestSchema,
});
export type SubmitResponseDto = z.infer<typeof submitResponseSchema>;

export const paginatedRequestsSchema = z.object({
  items: z.array(requestSchema),
  total: z.number().int(),
  page: z.number().int(),
  perPage: z.number().int(),
  totalPages: z.number().int(),
  counts: z.object({
    WSZYSTKIE: z.number().int(),
    OCZEKUJACE: z.number().int(),
    ZATWIERDZONE: z.number().int(),
    ODRZUCONE: z.number().int(),
  }),
});
export type PaginatedRequests = z.infer<typeof paginatedRequestsSchema>;

export const adminSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  spotifyId: z.string(),
});
export type AdminDto = z.infer<typeof adminSchema>;

/** Status połączenia konta administratora ze Spotify (token ważny 6 mies. od zgody). */
export const spotifyConnectionSchema = z.object({
  connected: z.boolean(),
  /** ISO - kiedy token admina wygasa (refresh token ma 6-miesięczny żywot). */
  grantedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  /** Dni do wygaśnięcia; null gdy nieznane. */
  daysLeft: z.number().int().nullable(),
  needsReauth: z.boolean(),
  lastSyncAt: z.string().nullable(),
  lastSyncError: z.string().nullable(),
  playlistName: z.string().nullable(),
  playlistTrackCount: z.number().int().nullable(),
});
export type SpotifyConnection = z.infer<typeof spotifyConnectionSchema>;

export const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('request.created'), request: requestSchema }),
  z.object({ type: z.literal('request.updated'), request: requestSchema }),
  z.object({ type: z.literal('sync.completed'), at: z.string(), trackCount: z.number().int() }),
]);
export type ServerEvent = z.infer<typeof eventSchema>;

export const DEDICATION_STATUSES = ['OCZEKUJACE', 'ZATWIERDZONE', 'ODRZUCONE'] as const;
export type DedicationStatus = (typeof DEDICATION_STATUSES)[number];

export const submitDedicationSchema = z.object({
  track: z.string().trim().min(1).max(500),
  recipient: z.string().trim().min(1).max(60),
  sender: z.string().trim().max(60).optional().default(''),
  anonymous: z.preprocess((v) => v === true || v === 'true' || v === '1' || v === 'on', z.boolean()).optional().default(false),
  message: z.string().trim().max(280).optional().default(''),
  targetDate: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const sep = v.includes('/') ? '/' : v.includes('.') ? '.' : null;
    if (sep) {
      const [d, mm, y] = v.split(sep);
      if (y && mm && d) return `${y}-${mm.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return v.trim();
  }, z.string().date()),
});
export type SubmitDedicationInput = z.infer<typeof submitDedicationSchema>;

export const dedicationSchema = z.object({
  id: z.string().uuid(),
  track: trackSchema,
  recipient: z.string(),
  sender: z.string().nullable(),
  anonymous: z.boolean(),
  message: z.string().nullable(),
  targetDate: z.string(),
  status: z.enum(DEDICATION_STATUSES),
  rejectReason: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type DedicationDto = z.infer<typeof dedicationSchema>;

export const dedicationQuerySchema = z.object({
  status: z.enum(['WSZYSTKIE', ...DEDICATION_STATUSES]).optional().default('WSZYSTKIE'),
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(60).optional().default(18),
});
export type DedicationQuery = z.infer<typeof dedicationQuerySchema>;

export const rejectDedicationSchema = z.object({
  reason: z.string().trim().min(3).max(280),
});
export type RejectDedicationInput = z.infer<typeof rejectDedicationSchema>;

export const REJECT_REASON_PRESETS = [
  'Utwór jest już na playliście szkolnego radia.',
  'Nie odpowiadamy na prośby o utwory o treści wulgarnych lub seksualnych.',
  'Utwór nie jest dostępny w serwisie Spotify.',
  'Za dużo podobnych utworów od tego samego wykonawcy.',
  'Prośba dotyczy utworu, który nie jest w katalogu szkolnego radia.',
] as const;
