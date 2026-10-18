import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  REQUEST_SORTS,
  SORT_LABEL,
  STATUS_LABEL,
  type RequestDto,
  type RequestSort,
  type RequestStatus,
  type SpotifyConnection,
} from '@radio/shared';
import { ApiError, api, eventStream, loginUrl, type StatusFilter } from '../lib/api.ts';
import { EmptyState, ErrorState, PageHeader } from '../components/Primitives.tsx';
import { QueueCard } from '../components/QueueCard.tsx';
import { EqualizerBars } from '../components/EqualizerBars.tsx';
import { formatCount, formatRelative } from '../lib/format.ts';

const FILTERS: StatusFilter[] = ['WSZYSTKIE', 'OCZEKUJACE', 'ZATWIERDZONE', 'ODRZUCONE'];

/** Komunikaty z błędów logowania OAuth. */
const AUTH_ERRORS: Record<string, string> = {
  denied: 'Logowanie w Spotify zostało anulowane.',
  not_allowed:
    'To konto Spotify nie ma dostępu do panelu. Upewnij się, że jest wpisane w ADMIN_SPOTIFY_IDS.',
  state: 'Sesja logowania wygasła. Spróbuj ponownie.',
  failed: 'Logowanie w Spotify nie powiodło się. Spróbuj ponownie.',
  callback: 'Nieprawidłowe wywołanie zwrotne od Spotify.',
};

/** Banner ostrzegający przed 6-miesięcznym cyklem życia refresh tokenu. */
function ConnectionBanner({ spotify }: { spotify: SpotifyConnection }) {
  if (!spotify.connected || spotify.needsReauth) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 border border-drop/30 bg-drop-soft/40 p-5"
      >
        <p className="text-base font-bold tracking-tight text-drop">
          Połączenie ze Spotify wygasło
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          Od czerwca 2026 Spotify przyznaje tokenom dostęp tylko na 6 miesięcy od momentu
          udzielenia zgody, a odświeżenie tokenu nie resetuje tego terminu. Zaloguj się ponownie,
          aby móc dodawać i usuwać utwory.
        </p>
        <a href={loginUrl} className="btn-danger mt-3.5">
          Zaloguj się ponownie kontem Spotify
        </a>
      </motion.div>
    );
  }

  const days = spotify.daysLeft;
  if (days === null || days > 30) return null;

  const urgent = days <= 14;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mb-6 border p-5 ${
        urgent ? 'border-wait/40 bg-wait-soft/50' : 'border-rule bg-card'
      }`}
    >
      <p className={`text-base font-bold tracking-tight ${urgent ? 'text-wait' : ''}`}>
        {urgent
          ? `Zostało ${formatCount(days, 'dzień', 'dni', 'dni')} do wygaśnięcia połączenia ze Spotify`
          : `Połączenie ze Spotify wygasa za ${formatCount(days, 'dzień', 'dni', 'dni')}`}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
        Spotify wymaga ponownej zgody co 6 miesięcy od pierwszego logowania. Zrób to teraz, żeby
        nie przerwać pracy w ferworze.
      </p>
      <a href={loginUrl} className="btn-ghost mt-3.5">
        Odśwież połączenie
      </a>
    </motion.div>
  );
}

export function AdminPage() {
  const queryClient = useQueryClient();
  const [authError, setAuthError] = useState<string | null>(null);
  /**
   * Konto próbujące się zalogować, ale spoza listy dozwolonych.
   * Dostajemy od serwera gotowy wiersz konfiguracyjny do wklejenia.
   */
  const [pendingAdmin, setPendingAdmin] = useState<{ detected: string; line: string } | null>(
    null,
  );
  const [filter, setFilter] = useState<StatusFilter>('OCZEKUJACE');
  // Domyślnie kolejność według liczby głosów - to sedno priorytetów.
  const [sort, setSort] = useState<RequestSort>('priorytet');
  // Filtr klasy dopasowuje każdego głosującego, nie tylko pierwszego zgłaszającego.
  const [classFilter, setClassFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Błąd z powrotu po OAuth w URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const detected = params.get('detected');
    const existing = params.get('existing');

    if (error === 'not_allowed' && detected) {
      // Odtwarzamy pełną listę dozwolonych, żeby nowa osoba wiedziała, że ma
      // DOPISAĆ swój identyfikator, a nie zastąpić listę.
      const merged = existing ? `${existing},${detected}` : detected;
      setPendingAdmin({ detected, line: `ADMIN_SPOTIFY_IDS=${merged}` });
    } else if (error) {
      setAuthError(AUTH_ERRORS[error] ?? 'Logowanie nie powiodło się.');
    }

    if (error) window.history.replaceState({}, '', '/admin');
  }, []);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => api.me(signal),
    retry: false,
    staleTime: 30_000,
  });

  const queue = useQuery({
    queryKey: ['queue', sort, classFilter],
    queryFn: ({ signal }) => api.queue(sort, classFilter, signal),
    enabled: me.isSuccess,
    // Kolejka odświeża się przez SSE po każdej decyzji.
    staleTime: 15_000,
  });

  const history = useQuery({
    queryKey: ['admin-requests', filter, sort, classFilter],
    queryFn: ({ signal }) =>
      api.adminRequests(
        { status: filter, sort, klass: classFilter, perPage: filter === 'OCZEKUJACE' ? 50 : 18 },
        signal,
      ),
    enabled: me.isSuccess,
    placeholderData: (previous) => previous,
  });

  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: ({ signal }) => api.activity(signal),
    enabled: me.isSuccess,
  });

  const orphans = useQuery({
    queryKey: ['orphans'],
    queryFn: ({ signal }) => api.orphans(signal),
    enabled: me.isSuccess,
  });

  const adminDedications = useQuery({
    queryKey: ['admin-dedications'],
    queryFn: ({ signal }) => api.adminDedications('OCZEKUJACE', signal),
    enabled: me.isSuccess,
  });

  useEffect(
    () =>
      eventStream.subscribe((event) => {
        if (event.type === 'request.created' || event.type === 'request.updated') {
          void queryClient.invalidateQueries({ queryKey: ['queue'] });
          void queryClient.invalidateQueries({ queryKey: ['admin-requests'] });
          void queryClient.invalidateQueries({ queryKey: ['activity'] });
        }
      }),
    [queryClient],
  );

  // Auto-odświeżanie metryk tokenu, żeby banner wygaśnięcia był aktualny.
  useEffect(() => {
    if (!me.isSuccess) return;
    const timer = window.setInterval(() => void queryClient.invalidateQueries({ queryKey: ['me'] }), 300_000);
    return () => window.clearInterval(timer);
  }, [me.isSuccess, queryClient]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visible = history.data?.items ?? queue.data?.items ?? [];

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  const afterMutation = useCallback(
    async (message: string, tone: 'ok' | 'err' = 'ok') => {
      setToast({ text: message, tone });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['queue'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['requests'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
    },
    [queryClient],
  );

  const moderate = useMutation({
    mutationFn: async ({
      request,
      action,
      reason,
    }: {
      request: RequestDto;
      action: 'approve' | 'reject' | 'undo';
      reason?: string;
    }) => {
      if (action === 'approve') return api.approve(request.id);
      if (action === 'reject') return api.reject(request.id, reason ?? '');
      return api.undo(request.id);
    },
    onSuccess: (data, variables) => {
      const name = data.request.track.name;
      const messages = {
        approve: `„${name}” dodany do playlisty.`,
        reject: `„${name}” odrzucony.`,
        undo: `„${name}” wrócił do kolejki.`,
      } as const;
      void afterMutation(messages[variables.action]);
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : 'Nie udało się wykonać operacji.';
      void afterMutation(message, 'err');
    },
  });

  const sync = useMutation({
    mutationFn: () => api.sync(),
    onSuccess: async ({ summary }) => {
      const parts: string[] = [];
      if (summary.addedToSpotify.length) {
        parts.push(`dodano ${summary.addedToSpotify.length} brakujących utworów`);
      }
      if (summary.recovered.length) {
        parts.push(`przywrócono do kolejki ${summary.recovered.length}`);
      }
      if (summary.promotedToPlaylist?.length) {
        parts.push(`${summary.promotedToPlaylist.length} z kolejki było już na playliscie`);
      }
      if (summary.orphans.length) {
        parts.push(`${summary.orphans.length} na playliscie bez prośby w bazie`);
      }
      await afterMutation(
        summary.ok
          ? `Synchronizacja zakończona${parts.length ? `: ${parts.join(', ')}.` : ' - wszystko zgodne.'}`
          : (summary.error ?? 'Synchronizacja nie powiodła się.'),
        summary.ok ? 'ok' : 'err',
      );
      void queryClient.invalidateQueries({ queryKey: ['orphans'] });
    },
  });

  // Skróty klawiszowe: A - dodaj, R - odrzuć, J/K lub strzałki - nawigacja.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const current = visible[selectedIndex];
      if (!current) return;

      const key = e.key.toLowerCase();
      if (key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, visible.length - 1));
      } else if (key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (key === 'a' && current.status === 'OCZEKUJACE') {
        e.preventDefault();
        moderate.mutate({ request: current, action: 'approve' });
      } else if (key === 'r' && current.status === 'OCZEKUJACE') {
        e.preventDefault();
        document.getElementById(`reason-${current.id}`)?.focus();
      } else if (key === 'u' && current.status !== 'OCZEKUJACE') {
        e.preventDefault();
        moderate.mutate({ request: current, action: 'undo' });
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selectedIndex, moderate]);

  // Przewijanie do zaznaczonej karty.
  useEffect(() => {
    const node = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex]);

  // --- Logowanie ----------------------------------------------------------
  if (me.isPending) {
    return (
      <div className="mx-auto grid min-h-[50vh] max-w-md place-items-center px-4">
        <span className="text-accent">
          <EqualizerBars className="h-5" />
        </span>
      </div>
    );
  }

  if (me.isError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="border border-ink bg-card p-8">
          <p className="meta mb-4">Dostęp dla administratora</p>

          <h1 className="text-3xl font-extrabold tracking-[-0.03em]">Panel administratora</h1>

          {pendingAdmin && (
            <div className="mt-5 border border-wait/40 bg-wait-soft/40 p-4 text-left">
              <p className="meta text-wait">Brak dostępu do panelu</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                Twoje konto Spotify nie jest jeszcze na liście administratorów. Wyślij
                administratorowi szkoły poniższą linię - po jej dopisaniu do pliku{' '}
                <code className="font-mono">.env</code> i restarcie serwera uzyskasz dostęp.
              </p>

              <p className="mt-3 text-sm font-semibold text-ink">
                Ten identyfikator jest jednoznacznie Twój:
              </p>
              <code className="mt-1 block break-all font-mono text-sm text-accent">
                {pendingAdmin.detected}
              </code>

              <p className="mt-3 text-sm font-semibold text-ink">Linia do przekazania:</p>
              <code className="mt-1 block break-all border border-rule bg-paper px-2.5 py-2 font-mono text-xs text-ink">
                {pendingAdmin.line}
              </code>
            </div>
          )}

          {authError && (
            <pre className="mt-5 border border-drop/30 bg-drop-soft/40 px-3.5 py-2.5 text-left text-sm break-words whitespace-pre-wrap text-drop">
              {authError}
            </pre>
          )}

          <a href={loginUrl} className="btn-primary mt-6 w-full">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
              <path d="M12 0a12 12 0 100 24 12 12 0 000-24zm5.5 17.32a.75.75 0 01-1.03.25c-2.82-1.73-6.36-2.12-10.54-1.16a.75.75 0 11-.33-1.46c4.57-1.05 8.5-.59 11.65 1.34.35.22.46.68.25 1.03zm1.47-3.27a.94.94 0 01-1.29.31c-3.23-1.98-8.16-2.56-11.98-1.4a.94.94 0 11-.55-1.8c4.36-1.32 9.79-.68 13.5 1.58.44.27.58.85.32 1.31zm.13-3.4C15.24 8.35 8.84 8.12 5.1 9.26a1.13 1.13 0 11-.65-2.15C8.77 5.82 15.79 6.1 20.3 8.68a1.13 1.13 0 01-1.2 1.97z" />
            </svg>
            Zaloguj się przez Spotify
          </a>
        </div>
      </div>
    );
  }

  // --- Panel --------------------------------------------------------------
  const spotify = me.data.spotify;
  const pendingCount = queue.data?.items.length ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <PageHeader
        eyebrow="Panel administratora"
        title="Kolejka prośb"
        description="Odsłuchaj, dodaj albo odrzuć. Każda decyzja od razu trafia na playlistę w Spotify i jest widoczna dla uczniów."
      >
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {me.data.admin.avatarUrl && (
            <img src={me.data.admin.avatarUrl} alt="" className="h-8 w-8 object-cover" />
          )}
          <div className="text-sm">
            <p className="font-semibold tracking-tight">{me.data.admin.displayName}</p>
            <p className="text-xs text-ink-soft">
              {spotify.playlistName
                ? `„${spotify.playlistName}”${spotify.playlistTrackCount !== null ? ` · ${spotify.playlistTrackCount} utworów` : ''}`
                : 'Playlista szkolnego radia'}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="btn-ghost !px-3.5 !py-2 !text-xs"
              title="Pobierz aktualny stan playlisty ze Spotify i porównaj z bazą"
            >
              {sync.isPending ? <EqualizerBars className="h-3" /> : '↻'} Synchronizuj
            </button>

            <button
              type="button"
              onClick={() => {
                void api.logout().then(() => window.location.reload());
              }}
              className="btn-ghost !px-3.5 !py-2 !text-xs"
            >
              Wyloguj
            </button>
          </div>
        </div>

        {spotify.lastSyncAt && (
          <p className="meta mt-2 normal-case tracking-normal">
            Ostatnia synchronizacja: {formatRelative(spotify.lastSyncAt)}
          </p>
        )}
      </PageHeader>

      <ConnectionBanner spotify={spotify} />

      {spotify.lastSyncError && (
        <p className="mb-6 border border-wait/30 bg-wait-soft/40 px-4 py-3 text-sm text-wait">
          {spotify.lastSyncError}
        </p>
      )}

      {/* Metryki */}
      <div className="rule mb-6 grid grid-cols-2 sm:grid-cols-4">
        {[
          { label: 'Czeka', value: queue.data?.items.length ?? 0 },
          { label: 'Na playliscie', value: history.data?.counts.ZATWIERDZONE ?? 0 },
          { label: 'Odrzucone', value: history.data?.counts.ODRZUCONE ?? 0 },
          { label: 'Razem', value: history.data?.counts.WSZYSTKIE ?? 0 },
        ].map((metric, i) => (
          <div
            key={metric.label}
            className={`border-rule py-4 ${i % 2 === 1 ? 'border-l pl-4' : ''} ${
              i >= 2 ? 'border-t sm:border-t-0 sm:border-l sm:pl-4' : ''
            } ${i === 0 ? 'sm:border-l-0 sm:pl-0' : ''}`}
          >
            <p className="meta">{metric.label}</p>
            <p className="tabnum mt-1 text-3xl font-extrabold tracking-[-0.03em]">
              {metric.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filtry + kolejność */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`meta ${
              filter === f
                ? 'border-ink bg-ink text-paper'
                : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
            }`}
          >
            {f === 'WSZYSTKIE' ? 'Wszystkie' : STATUS_LABEL[f as RequestStatus]}
            {f === 'OCZEKUJACE' && pendingCount > 0 && (
              <span className="tabnum ml-1.5 opacity-60">{pendingCount}</span>
            )}
          </button>
        ))}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label htmlFor="filtr-klasy" className="meta">
            Klasa:
          </label>
          <input
            id="filtr-klasy"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="np. 3B"
            aria-label="Filtruj po klasie"
            className="field tabnum w-20 px-2.5 py-1.5 text-sm font-bold tracking-[0.1em] uppercase placeholder:font-normal placeholder:tracking-normal"
          />
          {classFilter && (
            <button
              type="button"
              onClick={() => setClassFilter('')}
              className="meta hover:text-ink"
            >
              wyczyść
            </button>
          )}

          <label htmlFor="sortowanie" className="meta ml-2">
            Kolejność:
          </label>
          <select
            id="sortowanie"
            value={sort}
            onChange={(e) => setSort(e.target.value as RequestSort)}
            className="field cursor-pointer px-3 py-1.5 text-sm"
          >
            {REQUEST_SORTS.map((option) => (
              <option key={option} value={option}>
                {SORT_LABEL[option]}
              </option>
            ))}
          </select>
        </div>

        <p className="meta hidden lg:block">
          Skróty: <kbd className="border border-rule px-1 py-0.5">J</kbd>/
          <kbd className="border border-rule px-1 py-0.5">K</kbd> nawigacja,{' '}
          <kbd className="border border-rule px-1 py-0.5">A</kbd> dodaj,{' '}
          <kbd className="border border-rule px-1 py-0.5">R</kbd> odrzuć,{' '}
          <kbd className="border border-rule px-1 py-0.5">U</kbd> cofnij
        </p>
      </div>

      {/* Lista */}
      {filter === 'OCZEKUJACE' && queue.isPending ? (
        <ul className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="border-b border-rule-soft py-4">
              <div className="flex gap-4">
                <div className="h-16 w-16 animate-pulse bg-rule-soft" />
                <div className="flex-1 space-y-2.5">
                  <div className="h-4 w-2/5 animate-pulse bg-rule-soft" />
                  <div className="h-3 w-1/4 animate-pulse bg-rule-soft" />
                  <div className="h-8 w-32 animate-pulse bg-rule-soft" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : history.isError ? (
        <ErrorState
          message={history.error instanceof Error ? history.error.message : 'Błąd wczytywania.'}
          onRetry={() => void history.refetch()}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={
            filter === 'OCZEKUJACE' ? 'Kolejka jest pusta' : 'Brak prośb w tej kategorii'
          }
          description={
            filter === 'OCZEKUJACE'
              ? 'Wszystkie prośby rozpatrzone. Uczniowie mogą dalej zgłaszać utwory.'
              : 'Zmień filtr, żeby zobaczyć inne prośby.'
          }
        />
      ) : (
        <ul ref={listRef} className="space-y-3">
          <AnimatePresence mode="popLayout">
            {visible.map((request, index) => (
              <QueueCard
                key={request.id}
                request={request}
                index={index}
                selected={index === selectedIndex}
                busy={moderate.isPending}
                onFocus={() => setSelectedIndex(index)}
                onApprove={() => moderate.mutate({ request, action: 'approve' })}
                onReject={(reason) => moderate.mutate({ request, action: 'reject', reason })}
                onUndo={() => moderate.mutate({ request, action: 'undo' })}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {/* Rozbieżności i ostatnia aktywność */}
      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        {orphans.data && orphans.data.items.length > 0 && (
          <section className="border border-rule bg-card p-5">
            <h2 className="text-sm font-bold tracking-tight">
              Na playliscie, ale bez prośby w bazie ({orphans.data.items.length})
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              Te utwory dodał ktoś bezpośrednio w aplikacji Spotify. Aplikacja ich nie rusza,
              ale warto wiedzieć, że istnieją.
            </p>
            <ul className="mt-3 space-y-1.5">
              {orphans.data.items.slice(0, 6).map((orphan) => (
                <li key={orphan.trackId} className="text-sm">
                  <span className="text-ink-faint">{orphan.artists} —</span> {orphan.name}
                </li>
              ))}
            </ul>
          </section>
        )}

        {activity.data && activity.data.items.length > 0 && (
          <section className="border border-rule bg-card p-5">
            <h2 className="text-sm font-bold tracking-tight">Ostatnie zdarzenia</h2>
            <ul className="mt-3 space-y-2.5">
              {activity.data.items.slice(0, 8).map((entry) => {
                const label: Record<string, string> = {
                  SUBMITTED: 'zgłoszono',
                  APPROVED: 'dodano',
                  REJECTED: 'odrzucono',
                  UNDONE: 'przywrócono',
                  APPROVE_FAILED: 'błąd dodawania',
                  SYNC_ADDED: 'dodano przez synchronizację',
                  SYNC_RECOVERED: 'przywrócono przez synchronizację',
                };
                return (
                  <li key={entry.id} className="flex items-start gap-2.5 text-xs">
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                        entry.action === 'APPROVED' || entry.action === 'SYNC_ADDED'
                          ? 'bg-live'
                          : entry.action === 'REJECTED'
                            ? 'bg-drop'
                            : entry.action === 'SUBMITTED'
                              ? 'bg-ink-faint'
                              : 'bg-wait'
                      }`}
                    />
                    <span className="text-ink-soft">
                      <span className="font-semibold text-ink">
                        {label[entry.action] ?? entry.action}
                      </span>{' '}
                      {entry.trackName} · {formatRelative(entry.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {/* Dedykacje oczekujące */}
      {adminDedications.data && adminDedications.data.items.length > 0 && (
        <section className="mt-12 border border-rule bg-card p-5">
          <h2 className="text-sm font-bold tracking-tight">
            Dedykacje oczekujące ({adminDedications.data.items.length})
          </h2>
          <ul className="mt-3 space-y-2.5">
            {adminDedications.data.items.map((d: any) => (
              <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {d.trackName} — {d.artistName} · dla {d.recipientName}
                  {d.isAnonymous ? ' (anonimowo)' : ` od ${d.senderName}`} · Dzień: {d.targetDate}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      api.approveDedication(d.id).then(() => {
                        void queryClient.invalidateQueries({ queryKey: ['admin-dedications'] });
                      })
                    }
                    className="btn-ghost !px-3 !py-1 !text-xs"
                  >
                    Zatwierdź
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const reason = window.prompt('Powód odrzucenia:') ?? '';
                      if (reason.trim().length >= 3) {
                        void api.rejectDedication(d.id, reason).then(() => {
                          void queryClient.invalidateQueries({ queryKey: ['admin-dedications'] });
                        });
                      }
                    }}
                    className="btn-ghost !px-3 !py-1 !text-xs"
                  >
                    Odrzuć
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void api.hideDedication(d.id, true).then(() => {
                        void queryClient.invalidateQueries({ queryKey: ['admin-dedications'] });
                      })
                    }
                    className="btn-ghost !px-3 !py-1 !text-xs"
                  >
                    Ukryj
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Komunikaty */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            role="status"
            className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 border px-5 py-3 text-sm font-semibold shadow-lg ${
              toast.tone === 'ok'
                ? 'border-ink bg-ink text-paper'
                : 'border-drop bg-drop text-paper'
            }`}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
