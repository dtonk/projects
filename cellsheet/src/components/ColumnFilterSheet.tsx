import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ColumnIndex, Row } from '../types';
import type { ColumnFilter } from '../lib/filter';
import { FilterControls } from './FilterControls';

interface Props {
  column: ColumnIndex;
  filter: ColumnFilter | undefined;
  onChange: (filter: ColumnFilter) => void;
  onClear: () => void;
  onClose: () => void;
  activeSort: 'asc' | 'desc' | null;
  onSort: (dir: 'asc' | 'desc') => void;
  onClearSort: () => void;
  rows: Row[];
}

export function ColumnFilterSheet({ column, filter, onChange, onClear, onClose, activeSort, onSort, onClearSort, rows }: Props) {
  const [result, setResult] = useState<{ fn: string; value: string } | null>(null);

  function computeCount() {
    const n = rows.filter((r) => (r[column.name] ?? '') !== '').length;
    setResult({ fn: 'Count', value: n.toLocaleString() });
  }

  function computeCountDistinct() {
    const n = new Set(rows.map((r) => r[column.name] ?? '').filter((v) => v !== '')).size;
    setResult({ fn: 'Count Distinct', value: n.toLocaleString() });
  }

  function computeSum() {
    const total = rows.reduce((acc, r) => {
      const v = Number((r[column.name] ?? '').replace(/,/g, ''));
      return Number.isNaN(v) ? acc : acc + v;
    }, 0);
    setResult({ fn: 'Sum', value: total.toLocaleString() });
  }

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

        <div className="mb-4 flex gap-2">
          {(['asc', 'desc'] as const).map((dir) => {
            const on = activeSort === dir;
            return (
              <button
                key={dir}
                type="button"
                onClick={() => (on ? onClearSort() : onSort(dir))}
                className="flex-1 rounded-xl py-2 text-sm font-medium"
                style={{
                  background: on ? 'var(--accent)' : 'var(--bg-soft)',
                  color: on ? '#fff' : 'var(--label)',
                  border: '1px solid var(--border)',
                }}
              >
                {dir === 'asc' ? '↑ Ascending' : '↓ Descending'}
              </button>
            );
          })}
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={computeCount}
            className="flex-1 rounded-xl py-2 text-xs font-medium"
            style={{ background: 'var(--bg-soft)', color: 'var(--label)', border: '1px solid var(--border)' }}
          >
            Count
          </button>
          <button
            type="button"
            onClick={computeCountDistinct}
            className="flex-1 rounded-xl py-2 text-xs font-medium"
            style={{ background: 'var(--bg-soft)', color: 'var(--label)', border: '1px solid var(--border)' }}
          >
            Count Distinct
          </button>
          {column.type === 'number' && (
            <button
              type="button"
              onClick={computeSum}
              className="flex-1 rounded-xl py-2 text-xs font-medium"
              style={{ background: 'var(--bg-soft)', color: 'var(--label)', border: '1px solid var(--border)' }}
            >
              Sum
            </button>
          )}
        </div>

        <FilterControls column={column} filter={filter} onChange={onChange} />

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl py-3 text-base font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          Done
        </button>
      </motion.div>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center px-6"
            onClick={() => setResult(null)}
          >
            <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.3)' }} />
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 360, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm rounded-3xl p-6"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
              }}
            >
              <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
                {result.fn} · {column.name}
              </p>
              <p className="mt-3 text-5xl font-bold tabular-nums" style={{ color: 'var(--label)' }}>
                {result.value}
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                across {rows.length.toLocaleString()} filtered rows
              </p>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="mt-6 w-full rounded-xl py-3 text-base font-medium text-white"
                style={{ background: 'var(--accent)' }}
              >
                Done
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
