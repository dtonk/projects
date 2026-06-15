import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Column, Row } from '../types';

interface Props {
  columns: Column[];
  rows: Row[];
  activeFilterColumns: Set<string>;
  sortColumn: { name: string; dir: 'asc' | 'desc' } | null;
  onRowTap: (index: number) => void;
  onColumnTap: (name: string) => void;
}

const COL_W = 160;
const ROW_H = 44;
const HEADER_H = 40;

export function TableView({
  columns,
  rows,
  activeFilterColumns,
  sortColumn,
  onRowTap,
  onColumnTap,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  const totalWidth = columns.length * COL_W;

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm"
        style={{ color: 'var(--muted)' }}>
        No rows match your filters or search.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto">
      <div style={{ width: totalWidth, position: 'relative' }}>
        {/* Sticky header — scrolls horizontally with the body, pinned vertically */}
        <div
          className="sticky top-0 z-10 flex"
          style={{ height: HEADER_H, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
        >
          {columns.map((c) => {
            const active = activeFilterColumns.has(c.name);
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => onColumnTap(c.name)}
                className="flex items-center gap-1 truncate px-3 text-left text-xs font-semibold"
                style={{ width: COL_W, color: active ? 'var(--accent)' : 'var(--text)' }}
                title={c.name}
              >
                <span className="truncate">{c.name}</span>
                <span style={{ color: 'var(--muted)' }}>
                  {sortColumn?.name === c.name
                    ? sortColumn.dir === 'asc' ? '↑' : '↓'
                    : active ? '●' : '⌄'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Virtualized rows */}
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index];
            return (
              <button
                key={vRow.key}
                type="button"
                onClick={() => onRowTap(vRow.index)}
                className="absolute left-0 flex items-stretch text-left active:opacity-60"
                style={{
                  top: 0,
                  height: ROW_H,
                  width: totalWidth,
                  transform: `translateY(${vRow.start}px)`,
                  borderBottom: '1px solid var(--border)',
                  background: vRow.index % 2 ? 'var(--bg-soft)' : 'var(--bg)',
                }}
              >
                {columns.map((c) => (
                  <span
                    key={c.name}
                    className="flex items-center truncate px-3 text-sm"
                    style={{ width: COL_W }}
                  >
                    {row[c.name]}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
