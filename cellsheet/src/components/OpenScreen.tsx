import { useRef, useState } from 'react';
import { getRecents } from '../lib/recents';

interface Props {
  onOpenUrl: (url: string) => void;
  onOpenFile: (file: File) => void;
  loading: boolean;
  error: string | null;
}

const EXAMPLE = 'https://data.sfgov.org/resource/n9pm-xkyq.csv';

export function OpenScreen({ onOpenUrl, onOpenFile, loading, error }: Props) {
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const recents = getRecents();

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6 px-5 pb-10"
      style={{
        background: 'linear-gradient(180deg, rgba(30,64,175,0.08), transparent 320px)',
        paddingTop: 'calc(68px + env(safe-area-inset-top))',
      }}
    >
      <header className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--label)' }}>Cellsheet</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          An easy way to open up a CSV on your phone.
        </p>
      </header>

      <section className="mt-11 flex flex-col gap-2">
        <label className="text-center text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--label)' }}>
          Load from URL
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) onOpenUrl(url.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://…/data.csv"
            className="min-w-0 flex-1 rounded-xl border px-3 py-3 text-base outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="shrink-0 rounded-xl px-4 py-3 text-base font-medium text-white disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            Open
          </button>
        </form>
        <button
          type="button"
          onClick={() => setUrl(EXAMPLE)}
          className="self-start text-xs underline"
          style={{ color: 'var(--muted)' }}
        >
          Try an example (SF open data)
        </button>
      </section>

      <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--label)' }}>
        <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
        or
        <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
      </div>

      <section>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onOpenFile(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="w-full rounded-xl border-2 border-dashed py-6 text-base font-medium disabled:opacity-40"
          style={{ borderColor: 'var(--border)' }}
        >
          Choose a file…
          <span className="mt-1 block text-xs font-normal" style={{ color: 'var(--muted)' }}>
            Browse your phone, iCloud, Drive, or Downloads
          </span>
        </button>
      </section>

      {loading && (
        <p className="text-center text-sm" style={{ color: 'var(--muted)' }}>
          Loading…
        </p>
      )}
      {error && (
        <p
          className="rounded-xl px-3 py-2 text-center text-sm"
          style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}
        >
          {error}
        </p>
      )}

      {recents.length > 0 && (
        <section className="flex flex-col gap-2">
          <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Recent links
          </label>
          <ul className="flex flex-col gap-1">
            {recents.map((r) => (
              <li key={r.url}>
                <button
                  type="button"
                  onClick={() => onOpenUrl(r.url)}
                  className="w-full truncate rounded-lg px-3 py-2 text-left text-sm"
                  style={{ background: 'var(--bg-soft)' }}
                >
                  {r.url}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
