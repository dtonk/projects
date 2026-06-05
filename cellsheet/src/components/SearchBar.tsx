interface Props {
  value: string;
  onChange: (v: string) => void;
  resultCount: number;
  totalCount: number;
}

export function SearchBar({ value, onChange, resultCount, totalCount }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-xl border px-3 py-2"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
        <span aria-hidden style={{ color: 'var(--muted)' }}>⌕</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search all columns…  (use * and ?)"
          className="min-w-0 flex-1 bg-transparent text-base outline-none"
        />
        {value && (
          <button type="button" onClick={() => onChange('')} style={{ color: 'var(--muted)' }}>
            ✕
          </button>
        )}
      </div>
      <p className="px-1 text-xs" style={{ color: 'var(--muted)' }}>
        {resultCount.toLocaleString()}
        {resultCount !== totalCount && ` of ${totalCount.toLocaleString()}`} rows
      </p>
    </div>
  );
}
