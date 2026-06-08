import { motion } from 'framer-motion';
import type { Column, Row } from '../types';
import type { ColumnFilter } from '../lib/filter';
import { FilterControls } from './FilterControls';

interface Props {
  column: Column;
  rows: Row[];
  filter: ColumnFilter | undefined;
  onChange: (filter: ColumnFilter) => void;
  onClear: () => void;
  onClose: () => void;
}

export function ColumnFilterSheet({ column, rows, filter, onChange, onClear, onClose }: Props) {
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

        <FilterControls column={column} rows={rows} filter={filter} onChange={onChange} />

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
