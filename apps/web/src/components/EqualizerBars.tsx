/** Trzy słupki - tylko w stanie „gra”. W druku to pionowa kreska, nie ikona neonowa. */
export function EqualizerBars({ className = '' }: { className?: string }) {
  return (
    <span className={`flex h-3 items-end gap-[2px] ${className}`} aria-hidden="true">
      <span className="animate-eq h-full w-[2px] origin-bottom bg-current" />
      <span className="animate-eq h-full w-[2px] origin-bottom bg-current [animation-delay:0.15s]" />
      <span className="animate-eq h-full w-[2px] origin-bottom bg-current [animation-delay:0.3s]" />
    </span>
  );
}
