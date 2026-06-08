import { useMemo } from 'react';
import type { Column, Row } from '../types';
import { distinctValues, type ColumnFilter } from '../lib/filter';

const SET_THRESHOLD = 50;

interface Props {
  column: Column;
  rows: Row[];
  filter: ColumnFilter | undefined;
  onChange: (filter: ColumnFilter) => void;
}

/** Type-aware filter inputs for a single column. Shared by the filter sheet and onboarding. */
export function FilterControls({ column, rows, filter, onChange }: Props) {
  const f: ColumnFilter = filter ?? { type: column.type };

  const distinct = useMemo(
    () => (column.type === 'text' || column.type === 'boolean'
      ? distinctValues(rows, column.name, SET_THRESHOLD + 1)
      : []),
    [rows, column.name, column.type],
  );
  const useChecklist = distinct.length > 0 && distinct.length <= SET_THRESHOLD;

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
        <input
          value={f.contains ?? ''}
          onChange={(e) => onChange({ ...f, contains: e.target.value })}
          placeholder="Contains…"
          autoCapitalize="off"
          className="w-full rounded-xl border px-3 py-3 text-base outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}
        />
      )}

      {(column.type === 'text' || column.type === 'boolean') && useChecklist && (
        <ul className="flex flex-col">
          {distinct.map((v) => {
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
