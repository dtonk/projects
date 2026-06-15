import type { ColumnIndex } from '../types';
import type { ColumnFilter } from '../lib/filter';

interface Props {
  column: ColumnIndex;
  filter: ColumnFilter | undefined;
  onChange: (filter: ColumnFilter) => void;
}

/**
 * Type-aware filter inputs for a single column. Distinct values come
 * precomputed from the dataset index, so no rows are needed here.
 * Shared by the filter sheet and onboarding.
 */
export function FilterControls({ column, filter, onChange }: Props) {
  const f: ColumnFilter = filter ?? { type: column.type };
  const useChecklist =
    (column.type === 'text' || column.type === 'boolean') &&
    !column.distinctTruncated &&
    column.distinct.length > 0;

  const toggleValue = (v: string) => {
    const set = new Set(f.values ?? []);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    onChange({ ...f, values: Array.from(set) });
  };

  return (
    <>
      {column.type === 'number' && (
        <div className="flex items-center gap-3">
          <NumberField label="Min" value={f.min} onChange={(v) => onChange({ ...f, min: v })} />
          <NumberField label="Max" value={f.max} onChange={(v) => onChange({ ...f, max: v })} />
        </div>
      )}

      {column.type === 'date' && (
        <div className="flex items-center gap-3">
          <DateField label="After" value={f.after} onChange={(v) => onChange({ ...f, after: v })} />
          <DateField label="Before" value={f.before} onChange={(v) => onChange({ ...f, before: v })} />
        </div>
      )}

      {(column.type === 'text' || column.type === 'boolean') && !useChecklist && (
        <div className="flex flex-col gap-2">
          {column.distinctTruncated && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              This field has more than 200 unique values — use the search box below,
              or try a wildcard like <span className="font-mono">oak*</span> to match
              anything starting with "oak".
            </p>
          )}
          <input
            value={f.contains ?? ''}
            onChange={(e) => onChange({ ...f, contains: e.target.value })}
            placeholder="Contains…"
            autoCapitalize="off"
            className="w-full rounded-xl border px-3 py-3 text-base outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}
          />
        </div>
      )}

      {useChecklist && (
        <ul className="flex flex-col">
          {column.distinct.map((v) => {
            const checked = (f.values ?? []).includes(v);
            return (
              <li key={v}>
                <button
                  type="button"
                  onClick={() => toggleValue(v)}
                  className="flex w-full items-center gap-3 py-2 text-left"
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-white"
                    style={{ background: checked ? 'var(--accent)' : 'var(--bg-soft)', border: '1px solid var(--border)' }}
                  >
                    {checked ? '✓' : ''}
                  </span>
                  <span className="truncate text-base">{v}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className="w-full rounded-xl border px-3 py-3 text-base outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}
      />
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
      <input
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        className="w-full rounded-xl border px-3 py-3 text-base outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}
      />
    </label>
  );
}
