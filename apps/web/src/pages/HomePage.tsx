import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { classSchema, type TrackDto } from '@radio/shared';
import { ApiError, api } from '../lib/api.ts';
import { Art, PageHeader, StatusBadge, VoteBadge } from '../components/Primitives.tsx';
import { EqualizerBars } from '../components/EqualizerBars.tsx';
import {
  Length,
  PlayToggle,
  Player,
  PlayerSlot,
  TrackMeta,
  TrackTitle,
} from '../components/TrackCard.tsx';
import { formatCount, formatRelative } from '../lib/format.ts';

const CLASS_HINT = '2A';

/** Wyszukiwarka z debouncingiem - nie odpytujemy API na każde naciśnięcie. */
function useTrackSearch(query: string) {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const result = useQuery({
    queryKey: ['suggest', debounced],
    queryFn: ({ signal }) => api.suggest(debounced, 0, 10, signal),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
    retry: false,
  });

  return { query: debounced, ...result };
}

export function HomePage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TrackDto | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [klass, setKlass] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [success, setSuccess] = useState<{
    track: TrackDto;
    votes: number;
    alreadyRequested: boolean;
    alreadyOnPlaylist: boolean;
  } | null>(null);

  const search = useTrackSearch(query);
  const classValid = useMemo(() => classSchema.safeParse(klass).success, [klass]);

  const { data: requestsData } = useQuery({
    queryKey: ['requests', { status: 'WSZYSTKIE', perPage: 60 }],
    queryFn: ({ signal }) => api.requests({ status: 'WSZYSTKIE', perPage: 60 }, signal),
    staleTime: 30_000,
  });

  const { data: playlistData } = useQuery({
    queryKey: ['playlist'],
    queryFn: ({ signal }) => api.playlist('', signal),
    staleTime: 5 * 60_000,
  });

  /**
   * Dlaczego utwór nie warto zgłaszać od nowa.
   * Playlista ma pierwszeństwo - nawet jeśli prośba wisi w kolejce,
   * utwór z playlisty już gramy i nie wolno dodać go drugi raz.
   */
  const known = useMemo(() => {
    const map = new Map<string, 'OCZEKUJACE' | 'ZATWIERDZONE'>();
    for (const item of requestsData?.items ?? []) {
      if (item.status === 'OCZEKUJACE' || item.status === 'ZATWIERDZONE') {
        map.set(item.track.id, item.status);
      }
    }
    for (const track of playlistData?.items ?? []) map.set(track.id, 'ZATWIERDZONE');
    return map;
  }, [requestsData, playlistData]);

  useEffect(() => {
    setPreviewId(null);
  }, [search.query]);

  const submit = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Najpierw wybierz utwór.');
      return api.submit({
        track: selected.id,
        class: klass.trim().toUpperCase(),
        note: note.trim() || undefined,
      });
    },
    onSuccess: (data) => {
      setSuccess({
        track: data.request.track,
        votes: data.votes,
        alreadyRequested: data.alreadyRequested,
        alreadyOnPlaylist: data.alreadyOnPlaylist,
      });
      setQuery('');
      setSelected(null);
      setPreviewId(null);
      setNote('');
      setTouched(false);
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });

  const errorMessage =
    submit.error instanceof ApiError || submit.error instanceof Error
      ? submit.error.message
      : '';

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <PageHeader
        eyebrow="Zgłoszenia uczniów"
        title="Zaproponuj utwór na naszą playlistę"
        description="Wyszukaj utwór, odsłuchaj fragment i zgłoś prośbę o dodanie go do playlisty szkolnego radia."
      />

      <AnimatePresence mode="wait">
        {success ? (
          <motion.section
            key="success"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="border border-ink bg-card p-8"
          >
            <p className="meta mb-4">
              {success.alreadyOnPlaylist
                ? 'Ta piosenka już jest na playliscie'
                : 'Zgłoszenie przyjęte'}
            </p>

            <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
              <Art track={success.track} size={72} />
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl leading-tight font-bold tracking-tight">
                  {success.track.name}
                </h2>
                <p className="mt-1 text-ink-soft">{success.track.artists.join(', ')}</p>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {success.alreadyOnPlaylist ? (
                    <StatusBadge status="ZATWIERDZONE" />
                  ) : (
                    <VoteBadge votes={success.votes} />
                  )}
                  <p className="max-w-md text-sm leading-relaxed text-ink-soft">
                    {success.alreadyOnPlaylist
                      ? 'Nie dodamy go drugi raz. Twój głos zapisaliśmy, żeby było widać, że utwór się podoba.'
                      : success.alreadyRequested
                        ? 'Utwór już czeka w kolejce. Każdy kolejny głos podnosi go wyżej.'
                        : 'Utwór czeka na decyzję administratora. Status sprawdzisz w zakładce Status.'}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <a href="/status" className="btn-primary">
                  Sprawdź status
                </a>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setSuccess(null);
                    document.getElementById('szukaj')?.focus();
                  }}
                >
                  Dodaj kolejny
                </button>
              </div>
            </div>
          </motion.section>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
            className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.85fr)]"
          >
            {/* --- Wyszukiwarka i wyniki --- */}
            <section>
              <div className="flex items-baseline justify-between gap-4">
                <label htmlFor="szukaj" className="meta">
                  01 / Znajdź utwór
                </label>
                {search.isFetching && (
                  <span className="text-accent">
                    <EqualizerBars className="h-2.5" />
                  </span>
                )}
              </div>

              <input
                id="szukaj"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tytuł utworu albo wykonawca"
                autoComplete="off"
                spellCheck={false}
                className="field mt-2 text-lg tracking-tight"
              />

              <div className="mt-6">
                {query.trim().length < 2 && <HowItWorks />}

                {query.trim().length >= 2 && search.data?.items.length === 0 && !search.isFetching && (
                  <p className="py-8 text-sm text-ink-soft">
                    Brak wyników dla „{query.trim()}”.
                  </p>
                )}

                {search.isError && (
                  <p className="py-8 text-sm text-drop">
                    Nie udało się wyszukać w Spotify. Spróbuj ponownie za chwilę.
                  </p>
                )}

                {search.data && search.data.items.length > 0 && (
                  <>
                    <div className="rule flex items-baseline justify-between border-b pt-2 pb-1.5">
                      <span className="meta">
                        {search.data.total.toLocaleString('pl-PL')} wyników w katalogu
                      </span>
                      <span className="meta">10 na stronę</span>
                    </div>

                    <ul>
                      <AnimatePresence initial={false}>
                        {search.data.items.map((track) => {
                          const state = known.get(track.id);
                          const isSelected = selected?.id === track.id;
                          const isPlaying = previewId === track.id;

                          return (
                            <motion.li
                              key={track.id}
                              layout
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="border-b border-rule-soft"
                            >
                              <div
                                className={`flex items-center gap-3 py-3 ${
                                  isSelected ? 'bg-accent-soft/60 -mx-3 px-3' : ''
                                }`}
                              >
                                <Art track={track} size={44} />

                                <button
                                  type="button"
                                  onClick={() => setSelected(track)}
                                  className="min-w-0 flex-1 cursor-pointer text-left"
                                >
                                  <TrackTitle track={track} />
                                  <TrackMeta track={track} />
                                </button>

                                <Length ms={track.durationMs} />

                                {state ? (
                                  <span
                                    className={`meta hidden px-2 py-1 sm:inline-block ${
                                      state === 'ZATWIERDZONE'
                                        ? 'bg-live-soft text-live'
                                        : 'bg-wait-soft text-wait'
                                    }`}
                                  >
                                    {state === 'ZATWIERDZONE' ? 'Na playliscie' : 'W kolejce'}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setSelected(track)}
                                    aria-pressed={isSelected}
                                    aria-label={`${isSelected ? 'Wybrano' : 'Wybierz'}: ${track.name}`}
                                    className={`hidden h-7 w-7 shrink-0 cursor-pointer place-items-center border text-xs transition-colors sm:grid ${
                                      isSelected
                                        ? 'border-accent bg-accent text-paper'
                                        : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
                                    }`}
                                  >
                                    {isSelected ? '✓' : '+'}
                                  </button>
                                )}

                                <PlayToggle
                                  playing={isPlaying}
                                  onToggle={() =>
                                    setPreviewId((prev) => (prev === track.id ? null : track.id))
                                  }
                                  label={track.name}
                                />
                              </div>

                              <PlayerSlot open={isPlaying}>
                                <Player trackId={track.id} />
                              </PlayerSlot>
                            </motion.li>
                          );
                        })}
                      </AnimatePresence>
                    </ul>
                  </>
                )}
              </div>
            </section>

            {/* --- Formularz zgłoszenia --- */}
            <section>
              <div className="lg:sticky lg:top-24">
                <p className="meta whitespace-nowrap">02 / Zgłoszenie</p>

                <div className="mt-4 space-y-6">
                  <div>
                    <span className="meta">Wybrany utwór</span>
                    {selected ? (
                      <div className="mt-2 border border-ink bg-card">
                        <div className="flex items-center gap-3 p-3">
                          <Art track={selected} size={48} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold tracking-tight">
                              {selected.name}
                            </p>
                            <p className="truncate text-xs text-ink-soft">
                              {selected.artists.join(', ')}
                            </p>
                          </div>

                          <PlayToggle
                            playing={previewId === selected.id}
                            onToggle={() =>
                              setPreviewId((prev) =>
                                prev === selected.id ? null : selected.id,
                              )
                            }
                            label={selected.name}
                            size="sm"
                          />

                          <button
                            type="button"
                            onClick={() => setSelected(null)}
                            aria-label="Usuń wybór"
                            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center text-ink-faint transition-colors hover:text-ink"
                          >
                            ×
                          </button>
                        </div>

                        <PlayerSlot open={previewId === selected.id}>
                          <div className="px-3 pb-3">
                            <Player trackId={selected.id} />
                          </div>
                        </PlayerSlot>
                      </div>
                    ) : (
                      <p className="mt-2 border border-dashed border-rule px-4 py-6 text-center text-sm text-ink-faint">
                        Najpierw wybierz utwór z wyników wyszukiwania.
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="klasa" className="meta block">
                      Twoja klasa
                    </label>
                    <input
                      id="klasa"
                      value={klass}
                      onChange={(e) => setKlass(e.target.value)}
                      onBlur={() => setTouched(true)}
                      placeholder={CLASS_HINT}
                      maxLength={4}
                      autoComplete="off"
                      aria-invalid={touched && !classValid}
                      aria-describedby="klasa-pomoc"
                      className={`field tabnum mt-2 text-2xl font-bold tracking-[0.12em] uppercase ${
                        touched && !classValid
                          ? 'field-invalid'
                          : klass && classValid
                            ? 'border-accent'
                            : ''
                      }`}
                    />
                    <p
                      id="klasa-pomoc"
                      className={`meta mt-1.5 normal-case tracking-normal ${
                        touched && !classValid ? 'text-drop' : ''
                      }`}
                    >
                      {touched && !classValid
                        ? 'Podaj klasę jako liczbę i literę, np. 2A.'
                        : 'Format: 2A, 3B, 4F'}
                    </p>
                  </div>

                  <div>
                    <label htmlFor="notatka" className="meta block">
                      Wiadomość (opcjonalnie)
                    </label>
                    <textarea
                      id="notatka"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={4}
                      maxLength={280}
                      placeholder="np. Bardzo lubię tę piosenkę!"
                      className="field mt-2 resize-none"
                    />
                    <p className="meta tabnum mt-1 text-right normal-case tracking-normal">
                      {note.length}/280
                    </p>
                  </div>

                  {errorMessage && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="border border-drop/30 bg-drop-soft/50 px-3.5 py-2.5 text-sm text-drop"
                    >
                      {errorMessage}
                    </motion.p>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setTouched(true);
                      if (!selected || !classValid) return;
                      submit.mutate();
                    }}
                    disabled={submit.isPending || !selected || !classValid}
                    className="btn-primary w-full"
                  >
                    {submit.isPending ? (
                      <>
                        <EqualizerBars className="h-3" /> Wysyłanie
                      </>
                    ) : selected && known.has(selected.id) ? (
                      'Dolicz mój głos'
                    ) : (
                      'Wyślij prośbę'
                    )}
                  </button>

                  <p className="text-xs leading-relaxed text-ink-soft">
                    Limit 5 zgłoszeń co 10 minut. Jeśli utwór już czeka w kolejce,
                    Twój wybór <strong className="text-ink">doliczy głos</strong> — kolejka
                    jest ułożona według liczby głosów, więc najpopularniejsze utwory trafiają
                    na playlistę pierwsze.
                  </p>
                </div>
              </div>
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      {!success && <RecentRequests />}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    'Wyszukaj utwór w katalogu Spotify.',
    'Odsłuchaj fragment przyciskiem ▶.',
    'Podaj swoją klasę, np. 2A.',
    'Wyślij — administrator zdecyduje, czy utwór trafi na playlistę.',
  ];

  return (
    <ol className="rule border-t pt-4">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-4 border-b border-rule-soft py-3">
          <span className="meta tabnum shrink-0">{String(i + 1).padStart(2, '0')}</span>
          <span className="text-sm leading-relaxed text-ink-soft">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function RecentRequests() {
  const { data } = useQuery({
    queryKey: ['requests', { status: 'ZATWIERDZONE', perPage: 4 }],
    queryFn: ({ signal }) => api.requests({ status: 'ZATWIERDZONE', perPage: 4 }, signal),
  });

  if (!data?.items.length) return null;

  return (
    <section className="mt-20">
      <div className="rule flex items-baseline justify-between border-t pt-4">
        <h2 className="text-xl font-bold tracking-tight">Ostatnio dodane</h2>
        <a href="/status" className="meta underline underline-offset-4 hover:text-ink">
          Wszystkie
        </a>
      </div>

      <ul className="mt-2">
        {data.items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 border-b border-rule-soft py-3"
          >
            <Art track={item.track} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-tight">{item.track.name}</p>
              <p className="truncate text-xs text-ink-soft">{item.track.artists.join(', ')}</p>
            </div>
            {item.votes > 1 && (
              <span className="meta tabnum hidden sm:inline">
                {formatCount(item.votes, 'głos', 'głosy', 'głosów')}
              </span>
            )}
            <span className="meta tabnum whitespace-nowrap">
              {formatRelative(item.spotifyAddedAt ?? item.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
