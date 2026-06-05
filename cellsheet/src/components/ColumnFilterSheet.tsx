import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Column, Row } from '../types';
import { distinctValues, type ColumnFilter } from '../lib/filter';

interface Props {
  column: Column;
  rows: Row[];
  filter: ColumnFilter | undefined;
  onChange: (filter: ColumnFilter) => void;
  onClear: () => void;
  onClose: () => void;
}

const SET_THRESHOLD = 50;

export function ColumnFilterSheet({ column, rows, filter, onChange, onClear, onClose }: Props) {
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
    <div className="fixed inset-0 z-40 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.4)' }} />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 360, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
        className="safe-bottom relative max-h-[75vh] overflow-y-auto rounded-t-2xl px-5 pb-4 pt-3"
        style={{ background: 'var(--bg)' }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: 'var(--border)' }} />
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{column.name}</h2>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {column.type} column
            </span>
          </div>
          <button type="button" onClick={onClear} className="text-sm" style={{ color: 'var(--accent)' }}>
            Clear
          </button>
        </div>

        {column.type === 'number' && (
          <div className="flex items-center gap-3">
            <NumberField label="Min" value={f.min}
              onChange={(v) => onChange({ ...f, min: v })} />
            <NumberField label="Max" value={f.max}
              onChange={(v) => onChange({ ...f, max: v })} />
          </div>
        )}

        {column.type === 'date' && (
          <div className="flex items-center gap-3">
            <DateField label="After" value={f.after}
              onChange={(v) => onChange({ ...f, after: v })} />
            <DateField label="Before" value={f.before}
              onChange={(v) => onChange({ ...f, before: v })} />
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

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl py-3 text-base font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          Done
        </button>
      </motion.div>
    </div>
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
