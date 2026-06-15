import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import type { Column, Row } from '../types';

interface Props {
  columns: Column[];
  rows: Row[];
  index: number;
  tableName: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const SWIPE_THRESHOLD = 80;

const variants = {
  enter: (dir: number) => ({ x: dir > 0 ? '110%' : '-110%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? '-110%' : '110%', opacity: 0 }),
};

export function RowCard({ columns, rows, index, tableName, onIndexChange, onClose }: Props) {
  const [dir, setDir] = useState(0);
  const row = rows[index];

  function handleShare() {
    const text = columns.map((c) => `${c.name}: ${row[c.name] || '—'}`).join('\n');
    navigator.share({ title: `${tableName} · Row ${index + 1}`, text }).catch(() => {});
  }

  const paginate = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= rows.length) return;
    setDir(delta);
    onIndexChange(next);
  };

  const onDragEnd = (_e: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_THRESHOLD) paginate(1);
    else if (info.offset.x > SWIPE_THRESHOLD) paginate(-1);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-stretch justify-center">
      {/* Dimmed backdrop — the table shows through behind the card */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />

      {/* Edge chevrons (desktop / tap); on touch you just swipe */}
      {index > 0 && (
        <ChevronButton side="left" onClick={() => paginate(-1)} />
      )}
      {index < rows.length - 1 && (
        <ChevronButton side="right" onClick={() => paginate(1)} />
      )}

      <div
        className="relative w-full max-w-md"
        style={{
          padding: 16,
          paddingTop: 'calc(16px + env(safe-area-inset-top))',
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
        }}
      >
        <div className="relative h-full">
          <AnimatePresence custom={dir} initial={false}>
            <motion.div
              key={index}
              custom={dir}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 360, damping: 34 }}
              drag="x"
              dragSnapToOrigin
              dragElastic={0.16}
              dragDirectionLock
              onDragEnd={onDragEnd}
              className="absolute inset-0 flex flex-col overflow-hidden rounded-3xl"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
              }}
            >
              {/* Card header */}
              <div
                className="flex items-center justify-between px-5 py-3"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <span className="text-sm uppercase tracking-wide" style={{ color: 'var(--text)' }}>
                  <span className="font-bold">Row</span> {index + 1}{' '}
                  <span className="font-bold">of</span> {rows.length}
                </span>
                <div className="flex items-center gap-3">
                  {'share' in navigator && (
                    <button type="button" onClick={handleShare} className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                      Share
                    </button>
                  )}
                  <button type="button" onClick={onClose} className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                    Done
                  </button>
                </div>
              </div>

              {/* Inline fields: "Label: value", label bold */}
              <div className="flex-1 overflow-y-auto px-5 py-1">
                {columns.map((c) => {
                  const value = row[c.name] ?? '';
                  return (
                    <div
                      key={c.name}
                      className="py-2 text-[15px] leading-snug"
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
                      <span className="font-semibold" style={{ color: 'var(--label)' }}>{c.name}: </span>
                      <span
                        className="break-words"
                        style={{ color: value === '' ? 'var(--muted)' : 'var(--text)' }}
                      >
                        {value === '' ? '—' : value}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ChevronButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous row' : 'Next row'}
      className="absolute top-1/2 z-40 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-xl text-white"
      style={{
        background: 'rgba(0,0,0,0.5)',
        [side]: '6px',
      }}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  );
}
