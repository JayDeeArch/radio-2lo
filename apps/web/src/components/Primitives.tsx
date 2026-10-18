import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { STATUS_LABEL, type RequestStatus } from '@radio/shared';

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="mb-8"
    >
      {eyebrow && <p className="meta mb-3">{eyebrow}</p>}
      <h1 className="text-4xl leading-[1.05] font-extrabold tracking-[-0.03em] text-balance sm:text-5xl">
        {title}
      </h1>
      {description && (
        <p className="mt-4 max-w-2xl text-[0.95rem] leading-relaxed text-ink-soft">{description}</p>
      )}
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------
   Status: kolor ma znaczenie informacyjne, nigdy dekoracyjne.
   Podpis w wersalikach + mono, wypełnienie zamiast poświaty.
------------------------------------------------------------------*/

const STATUS_TONE: Record<RequestStatus, { box: string; dot: string }> = {
  ZATWIERDZONE: { box: 'bg-live-soft text-live', dot: 'bg-live' },
  OCZEKUJACE: { box: 'bg-wait-soft text-wait', dot: 'bg-wait' },
  ODRZUCONE: { box: 'bg-drop-soft text-drop', dot: 'bg-drop' },
};

export function StatusBadge({
  status,
  className = '',
}: {
  status: RequestStatus;
  className?: string;
}) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={`meta inline-flex items-center gap-1.5 px-2 py-1 ${tone.box} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Licznik priorytetu. Wyróżnia się rozmiarem, nie poświatą. */
export function VoteBadge({
  votes,
  className = '',
}: {
  votes: number;
  classCount?: number;
  classBreakdown?: string[];
  className?: string;
}) {
  const hot = votes >= 5;
  return (
    <span
      className={`meta inline-flex items-baseline gap-1 px-2 py-1 ${
        hot ? 'bg-ink text-paper' : 'bg-rule-soft text-ink-soft'
      } ${className}`}
      title="Liczba osób, które zgłosiły prośbę o ten utwór"
    >
      <span className="tabnum text-sm font-semibold leading-none">{votes}</span>
      <span>{votes === 1 ? 'głos' : 'głosów'}</span>
    </span>
  );
}

/** Rozkład głosów po klasach: „2A ×3 · 3B ×1”. */
export function ClassBreakdown({ breakdown }: { breakdown: string[] }) {
  if (breakdown.length === 0) return null;

  const counts = new Map<string, number>();
  for (const klass of breakdown) counts.set(klass, (counts.get(klass) ?? 0) + 1);

  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'),
  );

  return (
    <span className="meta inline-flex flex-wrap items-center gap-x-1.5">
      {sorted.map(([klass, n], i) => (
        <span key={klass}>
          {i > 0 && <span className="mr-1.5 text-rule">·</span>}
          <span className={n > 1 ? 'font-semibold text-ink' : ''}>{klass}</span>
          {n > 1 && <span className="tabnum"> ×{n}</span>}
        </span>
      ))}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rule border-t py-16 text-center">
      <h3 className="text-lg font-bold tracking-tight">{title}</h3>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{description}</p>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="border border-drop/30 bg-drop-soft/50 px-5 py-6 text-center">
      <p className="text-sm font-medium text-drop">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-ghost mt-4">
          Spróbuj ponownie
        </button>
      )}
    </div>
  );
}

/** Okładka z proporcjonalnym placeholderem zamiast dziur w siatce. */
export function Art({
  track,
  size = 48,
}: {
  track: { name: string; artists: string[]; imageUrl: string | null };
  size?: number;
}) {
  // Spotify potrafi zwrócić 404 dla okładki - wtedy pokazujemy inicjały,
  // a nie zepsutą ikonę pliku.
  const [failed, setFailed] = useState(false);
  const letters = track.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  if (track.imageUrl && !failed) {
    return (
      <img
        src={track.imageUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
        className="shrink-0 bg-rule-soft object-cover"
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center bg-rule-soft text-xs font-bold text-ink-faint"
      aria-hidden="true"
    >
      {letters || '♪'}
    </div>
  );
}
