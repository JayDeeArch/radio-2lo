import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  REQUEST_SORTS,
  SORT_LABEL,
  STATUS_LABEL,
  type RequestStatus,
  type RequestSort,
} from '@radio/shared';
import { api, eventStream, type StatusFilter } from '../lib/api.ts';
import { Art, ClassBreakdown, EmptyState, ErrorState, PageHeader, StatusBadge, VoteBadge } from '../components/Primitives.tsx';
import { formatCount, formatRelative } from '../lib/format.ts';

const FILTERS: StatusFilter[] = ['WSZYSTKIE', 'OCZEKUJACE', 'ZATWIERDZONE', 'ODRZUCONE'];

export function StatusPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('WSZYSTKIE');
  const [sort, setSort] = useState<RequestSort>('priorytet');
  const [page, setPage] = useState(1);
  const [live, setLive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const params = useMemo(
    () => ({ q: debouncedQuery, status, sort, page, perPage: 15 }),
    [debouncedQuery, status, sort, page],
  );

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['requests', params],
    queryFn: ({ signal }) => api.requests(params, signal),
    placeholderData: (previous) => previous,
  });

  useEffect(
    () =>
      eventStream.subscribe((event) => {
        setLive(true);
        if (event.type === 'request.created' || event.type === 'request.updated') {
          void queryClient.invalidateQueries({ queryKey: ['requests'] });
        }
      }),
    [queryClient],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const counts = data?.counts;

  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <PageHeader
        eyebrow="Tablica statusów"
        title="Co się dzieje z prośbą"
        description="Przeszukaj wszystkie zgłoszenia i sprawdź, co zostało dodane. Polskie znaki możesz pisać albo pominąć — „zol” znajdzie „Żółw”."
      >
        <p className="meta mt-4">
          {isPending
            ? 'Ładowanie…'
            : live
              ? 'Połączono · aktualizacje na żywo'
              : 'Połączono z serwerem'}
        </p>
      </PageHeader>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label htmlFor="szukaj-status" className="sr-only">
            Szukaj zgłoszeń
          </label>
          <input
            ref={searchRef}
            id="szukaj-status"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj utworu, wykonawcy lub albumu — klawisz /"
            className="field"
          />
        </div>

        <label htmlFor="sortowanie" className="sr-only">
          Kolejność
        </label>
        <select
          id="sortowanie"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as RequestSort);
            setPage(1);
          }}
          className="field w-full cursor-pointer sm:w-auto"
        >
          {REQUEST_SORTS.map((option) => (
            <option key={option} value={option}>
              {SORT_LABEL[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:px-0">
        {FILTERS.map((filter) => {
          const active = status === filter;
          const count = counts?.[filter as keyof typeof counts];
          const label = filter === 'WSZYSTKIE' ? 'Wszystkie' : STATUS_LABEL[filter as RequestStatus];

          return (
            <button
              key={filter}
              type="button"
              onClick={() => {
                setStatus(filter);
                setPage(1);
              }}
              aria-pressed={active}
              className={`meta shrink-0 border px-3 py-1.5 transition-colors ${
                active
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
              }`}
            >
              {label}
              {count !== undefined && <span className="tabnum ml-1.5 opacity-60">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-8">
        {isError ? (
          <ErrorState
            message={error instanceof Error ? error.message : 'Nie udało się wczytać prośb.'}
            onRetry={() => void refetch()}
          />
        ) : isPending ? (
          <ul>
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 border-b border-rule-soft py-3">
                <div className="h-12 w-12 animate-pulse bg-rule-soft" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 animate-pulse bg-rule-soft" />
                  <div className="h-3 w-1/5 animate-pulse bg-rule-soft" />
                </div>
              </li>
            ))}
          </ul>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="Nic nie znaleziono"
            description={
              debouncedQuery
                ? `Dla „${debouncedQuery}” nie ma prośb w tej kategorii.`
                : 'Nikt jeszcze nie zgłosił utworu w tej kategorii.'
            }
            action={
              <a href="/" className="btn-primary">
                Zaproponuj utwór
              </a>
            }
          />
        ) : (
          <>
            <ul>
              <AnimatePresence mode="popLayout">
                {data.items.map((item) => (
                  <motion.li
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    className="border-b border-rule-soft py-4"
                  >
                    <div className="flex gap-4">
                      <Art track={item.track} size={56} />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                          <div className="min-w-0">
                            <a
                              href={item.track.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="truncate text-[0.95rem] font-semibold tracking-tight hover:underline"
                            >
                              {item.track.name}
                            </a>
                            <p className="truncate text-sm text-ink-soft">
                              {item.track.artists.join(', ')}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <VoteBadge votes={item.votes} />
                            <StatusBadge status={item.status} />
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="meta">klasa {item.class}</span>
                          <span className="meta tabnum">
                            {formatRelative(item.decidedAt ?? item.createdAt)}
                          </span>
                          {item.classCount > 1 && <ClassBreakdown breakdown={item.classBreakdown} />}
                          {item.decidedBy && (
                            <span className="meta normal-case tracking-normal">
                              decyzja: {item.decidedBy}
                            </span>
                          )}
                        </div>

                        {item.note && (
                          <blockquote className="mt-2.5 border-l-2 border-rule pl-3 text-sm leading-relaxed text-ink-soft italic">
                            „{item.note}”
                          </blockquote>
                        )}

                        {item.status === 'ODRZUCONE' && item.rejectReason && (
                          <p className="mt-2.5 border border-drop/25 bg-drop-soft/40 px-3 py-2 text-xs leading-relaxed text-drop">
                            <span className="font-semibold">Powód odrzucenia:</span>{' '}
                            {item.rejectReason}
                          </p>
                        )}

                        {item.spotifySync === 'ERROR' && item.spotifyError && (
                          <p className="mt-2.5 border border-wait/25 bg-wait-soft/40 px-3 py-2 text-xs text-wait">
                            Problem z synchronizacją ze Spotify: {item.spotifyError}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>

            {data.totalPages > 1 && (
              <nav className="mt-8 flex items-center justify-between">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Poprzednia
                </button>
                <span className="meta tabnum">
                  {data.page} / {data.totalPages}
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                >
                  Następna →
                </button>
              </nav>
            )}

            <p className="meta mt-6 text-center normal-case tracking-normal">
              {formatCount(data.total, 'prośba', 'prośby', 'prośb')} w bazie
            </p>
          </>
        )}
      </div>
    </div>
  );
}
