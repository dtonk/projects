interface Props {
  title: string;
  subtitle?: string;
  /** 0–1, or null for an indeterminate state (e.g. while downloading). */
  progress: number | null;
}

export function ProgressScreen({ title, subtitle, progress }: Props) {
  const pct = progress == null ? null : Math.round(progress * 100);

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-8"
      style={{ background: 'linear-gradient(180deg, rgba(30,64,175,0.08), transparent 320px)' }}
    >
      <h1 className="mb-1 text-xl font-semibold" style={{ color: 'var(--label)' }}>
        {title}
      </h1>
      {subtitle && (
        <p className="mb-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
          {subtitle}
        </p>
      )}

      <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-soft)' }}>
        <div
          className="h-full rounded-full transition-[width] duration-150 ease-out"
          style={{
            background: 'var(--accent)',
            width: pct == null ? '40%' : `${pct}%`,
            // indeterminate: a gentle pulse when we don't know the fraction yet
            animation: pct == null ? 'cs-pulse 1.1s ease-in-out infinite' : undefined,
          }}
        />
      </div>
      <p className="mt-3 text-sm tabular-nums" style={{ color: 'var(--muted)' }}>
        {pct == null ? 'Working…' : `${pct}%`}
      </p>

      <style>{`@keyframes cs-pulse { 0%,100% { opacity: .4 } 50% { opacity: 1 } }`}</style>
    </div>
  );
}
