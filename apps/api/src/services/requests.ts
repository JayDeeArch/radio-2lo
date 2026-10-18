import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  buildSearchBlob,
  REQUEST_STATUSES,
  stripDiacritics,
  type PaginatedRequests,
  type RequestDto,
  type RequestQuery,
  type RequestSort,
  type RequestStatus,
  type SpotifySync,
} from '@radio/shared';
import { db } from '../db/index.js';
import { admins, requestEvents, requestVotes, requests, type Request } from '../db/schema.js';
import type { SpotifyTrack } from '../spotify/types.js';
import { findTrackOnPlaylist } from './playlist.js';

export interface RequestRowWithDecider {
  request: Request;
  decidedByName: string | null;
  voteCount: number;
  classCount: number;
  classBreakdown: string[] | null;
  /** Postgres zwraca `max()` jako tekst, a nie jako Date - normalizujemy tutaj. */
  lastVoteAt: string | Date | null;
}

const deciderName = sql<string | null>`(
  SELECT display_name FROM admins WHERE admins.id = ${requests.decidedBy}
)`;

/** Liczba głosów na utwór - główna miara priorytetu. */
const voteCount = sql<number>`(
  SELECT count(*) FROM request_votes v WHERE v.request_id = ${requests.id}
)`;

/** Liczba różnych klas - mówi, czy utwór chcą też inne klasy, czy tylko jedna. */
const classCount = sql<number>`(
  SELECT count(DISTINCT v.class) FROM request_votes v WHERE v.request_id = ${requests.id}
)`;

/**
 * Klasy w kolejności malejącej liczby głosów, np. ["3B","3B","2A"].
 *
 * Zliczanie musi dostać się do podzapytania - nie da się zagnieździć `count(*)`
 * wewnątrz `array_agg` (Postgres: "aggregate function calls cannot be nested").
 * `array_agg` bez wierszy zwraca NULL, a w kodzie mapujemy to na pustą tablicę.
 */
const classBreakdown = sql<string[] | null>`(
  SELECT array_agg(t.c ORDER BY t.n DESC, t.c)
  FROM (
    SELECT v.class AS c, count(*) AS n
    FROM request_votes v
    WHERE v.request_id = ${requests.id}
    GROUP BY v.class
  ) AS t
)`;

const lastVoteAt = sql<string | Date | null>`(
  SELECT max(v.created_at) FROM request_votes v WHERE v.request_id = ${requests.id}
)`;

export function baseQuery() {
  return db
    .select({
      request: requests,
      decidedByName: deciderName,
      voteCount,
      classCount,
      classBreakdown,
      lastVoteAt,
    })
    .from(requests)
    .leftJoin(admins, eq(admins.id, requests.decidedBy));
}

/** Bezpieczna konwersja znacznika czasu z bazy na ISO. */
function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toRequestDto(row: RequestRowWithDecider): RequestDto {
  const r = row.request;
  return {
    id: r.id,
    track: {
      id: r.spotifyTrackId,
      name: r.trackName,
      artists: r.artistName ? [r.artistName] : [],
      album: r.albumName,
      imageUrl: r.albumImageUrl,
      durationMs: r.durationMs,
      releaseYear: r.releaseYear,
      isExplicit: r.isExplicit,
      url: `https://open.spotify.com/track/${r.spotifyTrackId}`,
    },
    class: r.class,
    note: r.note,
    votes: Number(row.voteCount ?? 0),
    classCount: Number(row.classCount ?? 0),
    classBreakdown: row.classBreakdown ?? [],
    lastVoteAt: toIso(row.lastVoteAt),
    status: r.status as RequestStatus,
    spotifySync: r.spotifySync as SpotifySync,
    spotifyError: r.spotifyError,
    rejectReason: r.rejectReason,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedByName,
    spotifyAddedAt: r.spotifyAddedAt?.toISOString() ?? null,
  };
}

export async function getRequestById(id: string): Promise<RequestDto | null> {
  const rows = await baseQuery().where(eq(requests.id, id)).limit(1);
  return rows[0] ? toRequestDto(rows[0]) : null;
}

/** Wariant wymuszający obecność rekordu - dla ścieżek, gdzie 404 obsługuje warstwa HTTP. */
export async function getRequestByIdOrThrow(id: string): Promise<RequestDto> {
  const dto = await getRequestById(id);
  if (!dto) throw new NotFoundError('Nie znaleziono prośby.');
  return dto;
}

export class NotFoundError extends Error {}

async function countByStatus(): Promise<PaginatedRequests['counts']> {
  const rows = await db
    .select({ status: requests.status, total: count() })
    .from(requests)
    .groupBy(requests.status);

  const counts: Record<'WSZYSTKIE' | RequestStatus, number> = {
    WSZYSTKIE: 0,
    OCZEKUJACE: 0,
    ZATWIERDZONE: 0,
    ODRZUCONE: 0,
  };

  for (const row of rows) {
    const key = row.status as RequestStatus;
    if (key in counts) counts[key] = Number(row.total);
  }

  return {
    WSZYSTKIE: counts.OCZEKUJACE + counts.ZATWIERDZONE + counts.ODRZUCONE,
    OCZEKUJACE: counts.OCZEKUJACE,
    ZATWIERDZONE: counts.ZATWIERDZONE,
    ODRZUCONE: counts.ODRZUCONE,
  };
}

export async function listRequests(query: RequestQuery): Promise<PaginatedRequests> {
  const conditions = [];

  if (query.status !== 'WSZYSTKIE') {
    conditions.push(eq(requests.status, query.status));
  }

  if (query.class) {
    // Filtr po klasie ma dotyczyć KAŻDEGO głosu, nie tylko pierwszego zgłoszenia.
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM request_votes fv
        WHERE fv.request_id = ${requests.id} AND fv.class = ${query.class.toUpperCase()}
      )`,
    );
  }

  if (query.q) {
    // Wyszukiwanie odporne na wielkość liter i polskie znaki.
    // `search_blob` jest zapisany znormalizowany (bez diakrytyków), więc "zeta"
    // znajdzie "Żeta" i odwrotnie.
    const needle = query.q.toLowerCase();
    const withoutDiacritics = stripDiacritics(query.q);

    // `word_similarity` porównuje zapytanie z najbardziej podobnym SŁOWEM w tekście.
    // Zwykły `similarity` liczyłby podobieństwo całego napisu i nigdy nie doszedłby
    // progu - a to ono odpowiada za odnajdywanie literówek typu "Kotelk" -> "Koteluk".
    //
    // Próg 0.5 odsiewa fałszywe trafienia: zapytanie "daft" daje 1.000 dla
    // "One More Time", ale 0.400 dla "Murder On The Dancefloor", więc przy
    // niższym progu wyszukiwarka zwracałaby niepowiązane utwory.
    const conditions2 = [
      ilike(requests.searchBlob, `%${needle}%`),
      sql`word_similarity(${needle}, ${requests.searchBlob}) > 0.5`,
      ilike(requests.trackName, `%${query.q}%`),
      ilike(requests.artistName, `%${query.q}%`),
      ilike(requests.albumName, `%${query.q}%`),
      // Wariant z oryginalnymi znakami diakrytycznymi z wpisanej frazy.
      ilike(requests.trackName, `%${withoutDiacritics}%`),
      ilike(requests.artistName, `%${withoutDiacritics}%`),
    ];
    conditions.push(or(...conditions2)!);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totalRows = await db.select({ total: count() }).from(requests).where(where);
  const total = Number(totalRows[0]?.total ?? 0);

  // Oczekujące zawsze na górze, potem wg wybranego kryterium.
  // Odrzucone odsuwamy na koniec, żeby nie zaśmiecały kolejki.
  const statusFirst = sql`CASE ${requests.status} WHEN 'OCZEKUJACE' THEN 0 ELSE 1 END`;

  const orderBy = (() => {
    switch (query.sort as RequestSort) {
      case 'nowe':
        return [statusFirst, desc(requests.createdAt)];
      case 'losowe':
        return [statusFirst, sql`random()`];
      case 'priorytet':
      default:
        // Priorytet: liczba głosów malejąco. Przy remisie najstarsze prośby pierwsze,
        // bo utwór czeka już od dawna. Głosy spoza kolejki (oczekujące) liczą się
        // tak samo, bo każdy głos zwiększa szansę na wybór.
        return [statusFirst, desc(voteCount), asc(requests.createdAt)];
    }
  })();

  const rows = await baseQuery()
    .where(where)
    .orderBy(...orderBy)
    .limit(query.perPage)
    .offset((query.page - 1) * query.perPage);

  return {
    items: rows.map(toRequestDto),
    total,
    page: query.page,
    perPage: query.perPage,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
    counts: await countByStatus(),
  };
}

export interface NewRequestData {
  track: SpotifyTrack;
  class: string;
  note: string | null;
}

export type CreateResult =
  | {
      ok: true;
      request: RequestDto;
      alreadyRequested: boolean;
      /** Utwór był już na playliscie - zapisujemy prośbę jako zatwierdzoną. */
      alreadyOnPlaylist: boolean;
    }
  | { ok: false; reason: 'ALREADY_ON_PLAYLIST'; existing: RequestDto };

/**
 * Zgłoszenie prośby LUB dodanie głosu.
 *
 * Trzy przypadki:
 *  1. Utwór jest już na playliscie  -> zapisujemy prośbę jako ZATWIERDZONĄ.
 *     Nie dodajemy go drugi raz, ale uczeń dostaje natychmiastową odpowiedź,
 *     a wpis pojawia się w zakładce „W playliscie”.
 *  2. Utwór już czeka w kolejce    -> dopisujemy głos (priorytet rośnie).
 *  3. Nowy utwór                    -> tworzymy prośbę i pierwszy głos.
 */
export async function createRequest(data: NewRequestData): Promise<CreateResult> {
  const { track } = data;
  const artistName = track.artists.map((a) => a.name).join(', ');

  // Prawdą o obecności na playliscie jest sama playlista, nie status prośby.
  const onPlaylist = await findTrackOnPlaylist(track.id);

  const existingRows = await baseQuery()
    .where(
      and(
        eq(requests.spotifyTrackId, track.id),
        or(eq(requests.status, 'OCZEKUJACE'), eq(requests.status, 'ZATWIERDZONE')),
      ),
    )
    .limit(1);

  const existing = existingRows[0];

  if (existing) {
    // Utwór już ma prośbę - dopisujemy głos, żeby zwiększyć priorytet.
    await db
      .insert(requestVotes)
      .values({ requestId: existing.request.id, class: data.class, note: data.note });

    const searchBlob = await appendClassesToSearchBlob(
      existing.request.id,
      existing.request.trackName,
      existing.request.artistName,
      existing.request.albumName,
    );

    // Utwór jest na playliscie, a prośba wciąż czeka - synchronizujemy status,
    // żeby kolejka nie pokazywała utworu, który już gramy.
    if (onPlaylist.onPlaylist && existing.request.status !== 'ZATWIERDZONE') {
      await db
        .update(requests)
        .set({
          status: 'ZATWIERDZONE',
          rejectReason: null,
          decidedAt: new Date(),
          spotifySync: 'OK',
          spotifyError: null,
          spotifyAddedAt: onPlaylist.addedAt ?? new Date(),
          spotifyPosition: onPlaylist.position,
          searchBlob,
          updatedAt: new Date(),
        })
        .where(eq(requests.id, existing.request.id));

      await logEvent(
        existing.request.id,
        null,
        'ALREADY_ON_PLAYLIST',
        existing.request.status,
        'ZATWIERDZONE',
        'Utwór był już na playliscie, gdy nadeszła prośba.',
      );
    } else {
      await db
        .update(requests)
        .set({ searchBlob, updatedAt: new Date() })
        .where(eq(requests.id, existing.request.id));
    }

    return {
      ok: true,
      request: await getRequestByIdOrThrow(existing.request.id),
      alreadyRequested: true,
      alreadyOnPlaylist: onPlaylist.onPlaylist,
    };
  }

  const year = track.album?.release_date
    ? Number.parseInt(track.album.release_date.slice(0, 4), 10) || null
    : null;

  // Utwór jest już na playliscie, ale nikt go nie zgłaszał - zapisujemy prośbę
  // od razu jako zatwierdzoną, żeby nie trafiła do kolejki.
  const status = onPlaylist.onPlaylist ? 'ZATWIERDZONE' : 'OCZEKUJACE';

  const inserted = await db
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
      class: data.class,
      note: data.note,
      status,
      decidedAt: onPlaylist.onPlaylist ? new Date() : null,
      spotifySync: onPlaylist.onPlaylist ? 'OK' : 'NOT_REQUIRED',
      spotifyAddedAt: onPlaylist.addedAt ?? (onPlaylist.onPlaylist ? new Date() : null),
      spotifyPosition: onPlaylist.position,
    })
    .returning({ id: requests.id });

  const created = inserted[0]!;

  // Pierwszy głos tworzy wiersz w requests, więc dopisujemy go też w votes,
  // żeby liczniki od razu były spójne.
  await db
    .insert(requestVotes)
    .values({ requestId: created.id, class: data.class, note: data.note });

  await logEvent(
    created.id,
    null,
    onPlaylist.onPlaylist ? 'SUBMITTED_ALREADY_ON_PLAYLIST' : 'SUBMITTED',
    null,
    status,
  );

  return {
    ok: true,
    request: await getRequestByIdOrThrow(created.id),
    alreadyRequested: false,
    alreadyOnPlaylist: onPlaylist.onPlaylist,
  };
}

/** Dopisuje klasy głosujących do search_blob, żeby dało się szukać po numerze klasy. */
async function appendClassesToSearchBlob(
  requestId: string,
  trackName: string,
  artistName: string,
  albumName: string | null,
): Promise<string> {
  const votes = await db
    .select({ class: requestVotes.class })
    .from(requestVotes)
    .where(eq(requestVotes.requestId, requestId));

  return buildSearchBlob([trackName, artistName, albumName, ...votes.map((v) => v.class)]);
}

export async function logEvent(
  requestId: string,
  adminId: string | null,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  detail?: string,
): Promise<void> {
  await db.insert(requestEvents).values({
    requestId,
    adminId,
    action,
    fromStatus,
    toStatus,
    detail: detail ?? null,
  });
}

export async function getRequestHistory(requestId: string) {
  const rows = await db
    .select({
      action: requestEvents.action,
      fromStatus: requestEvents.fromStatus,
      toStatus: requestEvents.toStatus,
      detail: requestEvents.detail,
      createdAt: requestEvents.createdAt,
      adminName: sql<string | null>`(SELECT display_name FROM admins WHERE admins.id = ${requestEvents.adminId})`,
    })
    .from(requestEvents)
    .where(eq(requestEvents.requestId, requestId))
    .orderBy(desc(requestEvents.createdAt));

  return rows.map((r) => ({
    action: r.action,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    detail: r.detail,
    adminName: r.adminName,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Głosy na wskazany utwór - rozwinięcie licznika w panelu administratora. */
export async function getRequestVotes(requestId: string) {
  const rows = await db
    .select({
      id: requestVotes.id,
      class: requestVotes.class,
      note: requestVotes.note,
      createdAt: requestVotes.createdAt,
    })
    .from(requestVotes)
    .where(eq(requestVotes.requestId, requestId))
    .orderBy(desc(requestVotes.createdAt));

  return rows.map((r) => ({
    id: r.id,
    class: r.class,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

export const ALL_STATUSES = REQUEST_STATUSES;
