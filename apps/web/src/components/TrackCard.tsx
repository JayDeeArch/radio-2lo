import { AnimatePresence, motion } from 'motion/react';
import type { TrackDto } from '@radio/shared';
import { Art } from './Primitives.tsx';
import { EqualizerBars } from './EqualizerBars.tsx';
import { formatDuration, spotifyEmbedUrl, spotifyTrackUrl } from '../lib/format.ts';

/** Odtwarzacz Spotify w IFrame - 30 s podglądu, Premium niepotrzebne. */
export function Player({ trackId, height = 152 }: { trackId: string; height?: number }) {
  return (
    <iframe
      title="Podgląd utworu"
      src={`${spotifyEmbedUrl(trackId)}&autoplay=1`}
      width="100%"
      height={height}
      frameBorder="0"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      className="block w-full border-0"
    />
  );
}

export function PlayToggle({
  playing,
  onToggle,
  label,
  size = 'md',
}: {
  playing: boolean;
  onToggle: () => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={playing}
      aria-label={`${playing ? 'Zatrzymaj' : 'Odsłuchaj'}: ${label}`}
      title={playing ? 'Zatrzymaj' : 'Odsłuchaj fragment'}
      className={`grid shrink-0 cursor-pointer place-items-center border transition-colors duration-100 ${
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
      } ${
        playing
          ? 'border-ink bg-ink text-paper'
          : 'border-rule bg-card text-ink-soft hover:border-ink hover:text-ink'
      }`}
    >
      {playing ? <EqualizerBars className="h-2.5" /> : <span className="text-[0.65rem]">▶</span>}
    </button>
  );
}

export function TrackTitle({ track }: { track: TrackDto }) {
  return (
    <a
      href={spotifyTrackUrl(track.id)}
      target="_blank"
      rel="noreferrer noopener"
      className="group inline-flex max-w-full items-baseline gap-1.5"
    >
      <span className="truncate font-semibold tracking-tight text-ink group-hover:underline">
        {track.name}
      </span>
      {track.isExplicit && (
        <span
          title="Utwór oznaczony jako eksplicytny"
          className="shrink-0 border border-rule px-1 font-mono text-[0.6rem] leading-4 text-ink-faint"
        >
          E
        </span>
      )}
    </a>
  );
}

export function TrackMeta({ track }: { track: TrackDto }) {
  return (
    <p className="truncate text-[0.8rem] text-ink-soft">
      {track.artists.join(', ')}
      {track.album && <span className="text-ink-faint"> · {track.album}</span>}
    </p>
  );
}

/** Rozwijany blok odtwarzacza - wspólny dla wszystkich widoków. */
export function PlayerSlot({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="pt-3">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { Art };

/** Długość utworu w mono - jak w spisie numerów. */
export function Length({ ms }: { ms: number | null }) {
  return <span className="meta tabnum">{formatDuration(ms)}</span>;
}
