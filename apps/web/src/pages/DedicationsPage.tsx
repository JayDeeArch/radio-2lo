import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TrackDto } from '@radio/shared';
import { ApiError, api } from '../lib/api.ts';
import { EmptyState, ErrorState, PageHeader } from '../components/Primitives.tsx';

export function DedicationsPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TrackDto[]>([]);
  const [selected, setSelected] = useState<TrackDto | null>(null);
  const [recipient, setRecipient] = useState('');
  const [sender, setSender] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [message, setMessage] = useState('');
  const [targetDate, setTargetDate] = useState(new Date().toISOString().slice(0, 10));
  const [toast, setToast] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['dedications'],
    queryFn: ({ signal }) => api.dedications(signal),
  });

  const search = async () => {
    if (q.trim().length < 2) return;
    try {
      const res = await api.suggest(q.trim(), 0, 10);
      setResults(res.items);
    } catch {
      setResults([]);
    }
  };

  const submit = useMutation({
    mutationFn: () =>
      api.submitDedication({
        track: selected!.id,
        recipient: recipient.trim(),
        sender: anonymous ? '' : sender.trim(),
        anonymous,
        message: message.trim(),
        targetDate,
      }),
    onSuccess: () => {
      setToast('Dedykacja wysłana. Czeka na zatwierdzenie administratora.');
      setSelected(null);
      setRecipient('');
      setSender('');
      setMessage('');
      setResults([]);
      setQ('');
      void queryClient.invalidateQueries({ queryKey: ['dedications'] });
    },
    onError: (e) => {
      setToast(e instanceof ApiError ? e.message : 'Nie udało się wysłać dedykacji.');
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Dedykacje"
        title="Dedykuj utwór"
        description="Wybierz utwór, wpisz dla kogo i od kogo. Może być anonimowo."
      />

      <div className="border border-rule bg-card p-5">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search();
            }}
            placeholder="Szukaj utworu..."
            className="field flex-1 px-3 py-2 text-sm"
          />
          <button type="button" onClick={search} className="btn-ghost !px-4 !py-2 !text-xs">
            Szukaj
          </button>
        </div>

        {results.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {results.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelected(t)}
                  className={`w-full border px-3 py-2 text-left text-sm ${
                    selected?.id === t.id ? 'border-ink bg-paper' : 'border-rule hover:border-ink'
                  }`}
                >
                  {t.name} — {t.artists.join(', ')}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-semibold">
              Wybrano: {selected.name} — {selected.artists.join(', ')}
            </p>

            <label className="block text-xs font-semibold">Dla kogo</label>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="field w-full px-3 py-2 text-sm"
            />

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              Anonimowo
            </label>

            {!anonymous && (
              <>
                <label className="block text-xs font-semibold">Od kogo</label>
                <input
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                  className="field w-full px-3 py-2 text-sm"
                />
              </>
            )}

            <label className="block text-xs font-semibold">Wiadomość (opcjonalnie)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={280}
              className="field w-full px-3 py-2 text-sm"
            />

            <label className="block text-xs font-semibold">Dzień</label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="field px-3 py-2 text-sm"
            />

            <button
              type="button"
              disabled={!recipient.trim() || submit.isPending}
              onClick={() => submit.mutate()}
              className="btn-primary mt-2"
            >
              Wyślij dedykację
            </button>
          </div>
        )}
      </div>

      {toast && <p className="mt-4 text-sm text-ink-soft">{toast}</p>}

      <h2 className="mt-10 text-lg font-bold">Zatwierdzone dedykacje</h2>
      {list.isPending ? (
        <p className="mt-3 text-sm text-ink-soft">Ładowanie…</p>
      ) : list.isError ? (
        <ErrorState message="Błąd wczytywania." />
      ) : list.data && list.data.length === 0 ? (
        <EmptyState title="Brak dedykacji" description="Bądź pierwszy." />
      ) : (
        <ul className="mt-3 space-y-3">
          {list.data?.map((d) => (
            <li key={d.id} className="border border-rule bg-card p-4">
              <p className="text-sm font-semibold">
                {d.track.name} — {d.track.artists.join(', ')}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                Dla: {d.recipient} · Od: {d.anonymous ? 'Anonimowo' : (d.sender ?? '—')}
              </p>
              {d.message && <p className="mt-1 text-sm">{d.message}</p>}
              <p className="mt-1 text-xs text-ink-faint">Dzień: {d.targetDate}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}