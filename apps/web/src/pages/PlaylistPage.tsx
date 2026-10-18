import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { Art, EmptyState, ErrorState, PageHeader } from '../components/Primitives.tsx';
import { Length } from '../components/TrackCard.tsx';
import { formatCount, formatRelative, matchesTrack, spotifyTrackUrl } from '../lib/format.ts';

export function PlaylistPage() {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * Cała playlista pobierana jest raz i trzymana w pamięci przeglądarki.
   * Serwer czyta lokalną kopię, więc to zapytanie nie dotyka Spotify,
   * a filtrowanie po każdym naciśnięciu klawisza dzieje się u klienta.
   */
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['playlist'],
    queryFn: ({ signal }) => api.playlist('', signal),
    staleTime: 5 * 60_000,
  });

  const deferred = useDeferredValue(query);
  const filtering = query !== deferred;

  const visible = useMemo(() => {
    const items = data?.items ?? [];
    const trimmed = deferred.trim();
    if (!trimmed) return items;
    return items.filter((track) => matchesTrack(track, trimmed));
  }, [data?.items, deferred]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <PageHeader
        eyebrow="Playlista szkolnego radia"
        title="Co już gramy"
        description="Aktualna zawartość playlisty szkolnego radia."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="szukaj-playlisty" className="meta block">
            Szukaj na playliscie
          </label>
          <input
            ref={searchRef}
            id="szukaj-playlisty"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tytuł, wykonawca, album"
            autoComplete="off"
            spellCheck={false}
            className="field mt-2"
          />
        </div>

        {data?.playlistUrl && (
          <a
            href={data.playlistUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-ghost"
          >
            Otwórz w Spotify ↗
          </a>
        )}
      </div>

      {data && (
        <div className="rule mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t pt-3">
          <p className="meta tabnum">
            {query.trim() ? (
              <>
                znaleziono {visible.length} z {data.count}
              </>
            ) : (
              <>
                {formatCount(data.count, 'utwór', 'utwory', 'utworów')}
              </>
            )}
          </p>
          {filtering ? (
            <p className="meta">filtruję…</p>
          ) : (
            data.syncedAt && <p className="meta">stan z {formatRelative(data.syncedAt)}</p>
          )}
        </div>
      )}

      <div className="mt-2">
        {isError ? (
          <ErrorState
            message={
              error instanceof Error
                ? error.message
                : 'Nie udało się pobrać playlisty.'
            }
            onRetry={() => void refetch()}
          />
        ) : isPending ? (
          <ul>
            {Array.from({ length: 10 }).map((_, i) => (
              <li key={i} className="flex items-center gap-4 border-b border-rule-soft py-3">
                <span className="meta tabnum w-6 text-right">{i + 1}</span>
                <div className="h-10 w-10 animate-pulse bg-rule-soft" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 animate-pulse bg-rule-soft" />
                  <div className="h-3 w-1/5 animate-pulse bg-rule-soft" />
                </div>
              </li>
            ))}
          </ul>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="Playlista nie została jeszcze zsynchronizowana"
            description="Dane pojawią się, gdy administrator zsynchronizuje playlistę ze Spotify — albo automatycznie co 15 minut."
            action={
              <a href="/" className="btn-primary">
                Zaproponuj pierwszy utwór
              </a>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`Nic nie znaleziono dla „${query.trim()}”`}
            description="Spróbuj innej frazy. Możesz pominąć polskie znaki — „zol” znajdzie „Żółw”."
            action={
              <button type="button" onClick={() => setQuery('')} className="btn-ghost">
                Wyczyść wyszukiwanie
              </button>
            }
          />
        ) : (
          <ol>
            {visible.map((track) => (
              <li key={`${track.id}-${track.position}`}>
                <a
                  href={spotifyTrackUrl(track.id)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-center gap-4 border-b border-rule-soft py-2.5 transition-colors hover:bg-accent-soft/40"
                >
                  <span className="meta tabnum w-6 shrink-0 text-right">
                    {track.position + 1}
                  </span>
                  <Art track={track} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold tracking-tight group-hover:underline">
                      {track.name}
                    </p>
                    <p className="truncate text-xs text-ink-soft">
                      {track.artists.join(', ')}
                    </p>
                  </div>
                  <Length ms={track.durationMs} />
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
