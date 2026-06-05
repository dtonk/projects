import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { Dataset } from './types';
import { parseFile, parseUrl } from './lib/parseCsv';
import { addRecent } from './lib/recents';
import { applyFilters, isFilterActive, type ColumnFilter, type Filters } from './lib/filter';
import { OpenScreen } from './components/OpenScreen';
import { SearchBar } from './components/SearchBar';
import { TableView } from './components/TableView';
import { RowCard } from './components/RowCard';
import { ColumnFilterSheet } from './components/ColumnFilterSheet';

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [filterColumn, setFilterColumn] = useState<string | null>(null);

  async function openUrl(url: string) {
    setLoading(true);
    setError(null);
    try {
      const ds = await parseUrl(url);
      addRecent(url);
      reset(ds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that URL.');
    } finally {
      setLoading(false);
    }
  }

  async function openFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      reset(await parseFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setLoading(false);
    }
  }

  function reset(ds: Dataset) {
    setDataset(ds);
    setSearch('');
    setFilters({});
    setOpenRow(null);
    setFilterColumn(null);
  }

  // Auto-open ?url= so shared links open straight into the data.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('url');
    // Intentional load-on-mount; defer so the state update isn't synchronous.
    if (param) queueMicrotask(() => openUrl(param));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android PWA "Open with": receive CSV files launched from the OS.
  useEffect(() => {
    const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    if (!queue) return;
    queue.setConsumer(async (params) => {
      const handle = params.files?.[0];
      if (handle) openFile(await handle.getFile());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredRows = useMemo(() => {
    if (!dataset) return [];
    return applyFilters(dataset.rows, dataset.columns, filters, search);
  }, [dataset, filters, search]);

  const activeFilterColumns = useMemo(() => {
    const set = new Set<string>();
    for (const [name, f] of Object.entries(filters)) {
      if (isFilterActive(f)) set.add(name);
    }
    return set;
  }, [filters]);

  if (!dataset) {
    return (
      <OpenScreen onOpenUrl={openUrl} onOpenFile={openFile} loading={loading} error={error} />
    );
  }

  const sourceLabel = dataset.sourceType === 'file'
    ? dataset.sourceName
    : dataset.sourceName.replace(/^https?:\/\//, '');
  const activeColumn = filterColumn
    ? dataset.columns.find((c) => c.name === filterColumn) ?? null
    : null;

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top flex flex-col gap-2 px-4 pb-2 pt-3"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium" title={dataset.sourceName}>
            {sourceLabel}
          </span>
          <button type="button" onClick={() => setDataset(null)}
            className="shrink-0 text-sm" style={{ color: 'var(--accent)' }}>
            Open another
          </button>
        </div>
        <SearchBar
          value={search}
          onChange={setSearch}
          resultCount={filteredRows.length}
          totalCount={dataset.rows.length}
        />
      </header>

      <TableView
        columns={dataset.columns}
        rows={filteredRows}
        activeFilterColumns={activeFilterColumns}
        onRowTap={setOpenRow}
        onColumnTap={setFilterColumn}
      />

      {openRow !== null && filteredRows[openRow] && (
        <RowCard
          columns={dataset.columns}
          rows={filteredRows}
          index={openRow}
          onIndexChange={setOpenRow}
          onClose={() => setOpenRow(null)}
        />
      )}

      <AnimatePresence>
        {activeColumn && (
          <ColumnFilterSheet
            key={activeColumn.name}
            column={activeColumn}
            rows={dataset.rows}
            filter={filters[activeColumn.name]}
            onChange={(f: ColumnFilter) =>
              setFilters((prev) => ({ ...prev, [activeColumn.name]: f }))
            }
            onClear={() =>
              setFilters((prev) => {
                const next = { ...prev };
                delete next[activeColumn.name];
                return next;
              })
            }
            onClose={() => setFilterColumn(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
