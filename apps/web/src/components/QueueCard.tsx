import { useState } from 'react';
import { motion } from 'motion/react';
import { REJECT_REASON_PRESETS, type RequestDto } from '@radio/shared';
import { Art, ClassBreakdown, StatusBadge, VoteBadge } from './Primitives.tsx';
import { Length, PlayToggle, Player, PlayerSlot } from './TrackCard.tsx';
import { formatRelative } from '../lib/format.ts';

export interface QueueCardProps {
  request: RequestDto;
  index: number;
  selected: boolean;
  busy: boolean;
  onFocus: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onUndo: () => void;
}

export function QueueCard({
  request,
  index,
  selected,
  busy,
  onFocus,
  onApprove,
  onReject,
  onUndo,
}: QueueCardProps) {
  const [playing, setPlaying] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<string>(REJECT_REASON_PRESETS[0]);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onClick={onFocus}
      className={`border-b py-4 transition-colors ${
        selected ? 'border-accent bg-accent-soft/40 -mx-4 px-4' : 'border-rule-soft'
      }`}
    >
      <div className="flex gap-4">
        <div className="relative shrink-0">
          <Art track={request.track} size={56} />
          <span className="meta tabnum absolute -top-1.5 -left-1.5 grid h-5 w-5 place-items-center bg-ink text-[0.6rem] text-paper">
            {index + 1}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
            <div className="min-w-0">
              <h3 className="truncate text-[0.95rem] font-semibold tracking-tight">
                {request.track.name}
              </h3>
              <p className="truncate text-sm text-ink-soft">{request.track.artists.join(', ')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <VoteBadge votes={request.votes} />
              <StatusBadge status={request.status} />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="meta">klasa {request.class}</span>
            <span className="meta tabnum">{formatRelative(request.createdAt)}</span>
            {request.track.album && (
              <span className="meta truncate">{request.track.album}</span>
            )}
            <Length ms={request.track.durationMs} />
            {request.classCount > 1 && <ClassBreakdown breakdown={request.classBreakdown} />}
          </div>

          {request.note && (
            <blockquote className="mt-3 border-l-2 border-accent/40 pl-3 text-sm leading-relaxed text-ink-soft italic">
              „{request.note}”
            </blockquote>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PlayToggle
              playing={playing}
              onToggle={() => setPlaying((v) => !v)}
              label={request.track.name}
              size="sm"
            />

            {request.status === 'OCZEKUJACE' ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onApprove();
                  }}
                  disabled={busy}
                  className="btn-approve !px-3 !py-1.5 !text-xs"
                >
                  Dodaj do playlisty
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRejecting((v) => !v);
                  }}
                  disabled={busy}
                  className="btn-danger !px-3 !py-1.5 !text-xs"
                >
                  Odrzuć
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUndo();
                }}
                disabled={busy}
                className="btn-ghost !px-3 !py-1.5 !text-xs"
              >
                ↺ Przywróć do kolejki
              </button>
            )}
          </div>

          <PlayerSlot open={playing}>
            <Player trackId={request.track.id} />
          </PlayerSlot>

          {rejecting && (
            <div
              className="mt-4 border border-drop/30 bg-drop-soft/30 p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="meta mb-3 text-drop">
                Powód odrzucenia — uczeń zobaczy tę wiadomość
              </p>

              <div className="mb-3 flex flex-wrap gap-1.5">
                {REJECT_REASON_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setReason(preset)}
                    className={`meta max-w-full whitespace-normal px-2 py-1 text-left normal-case tracking-normal ${
                      reason === preset
                        ? 'bg-drop text-paper'
                        : 'border border-rule text-ink-soft hover:border-ink hover:text-ink'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={280}
                className="field resize-none text-sm"
              />

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onReject(reason)}
                  disabled={busy || reason.trim().length < 3}
                  className="btn-danger !px-3 !py-1.5 !text-xs"
                >
                  Potwierdź odrzucenie
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  className="btn-ghost !px-3 !py-1.5 !text-xs"
                >
                  Anuluj
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.li>
  );
}
