import { motion } from 'framer-motion';

interface Props {
  onClose: () => void;
}

const TIPS: { icon: string; title: string; body: string }[] = [
  { icon: '▥', title: 'Tap a column', body: 'Open its filter to narrow the rows.' },
  { icon: '▤', title: 'Tap a row', body: 'See it as a detail card with every field.' },
  { icon: '↔', title: 'Swipe a card', body: 'Move to the next or previous row.' },
];

export function TableHelp({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} />
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm rounded-3xl p-6"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}
      >
        <h2 className="mb-5 text-xl font-semibold" style={{ color: 'var(--label)' }}>
          Getting around
        </h2>

        <ul className="flex flex-col gap-4">
          {TIPS.map((t) => (
            <li key={t.title} className="flex items-start gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-white"
                style={{ background: 'var(--accent)' }}
                aria-hidden
              >
                {t.icon}
              </span>
              <div>
                <p className="text-base font-semibold">{t.title}</p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-xl py-3 text-base font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          Got it
        </button>
      </motion.div>
    </div>
  );
}
