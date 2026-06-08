import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { Dataset } from './types';
import { parseFile, parseUrl } from './lib/parseCsv';
import { addRecent } from './lib/recents';
import { applyFilters, isFilterActive, type ColumnFilter, type Filters } from './lib/filter';
import { OpenScreen } from './components/OpenScreen';
import { Onboarding, type OnboardingConfig } from './components/Onboarding';
import { SearchBar } from './components/SearchBar';
import { TableView } from './components/TableView';
import { RowCard } from './components/RowCard';
import { ColumnFilterSheet } from './components/ColumnFilterSheet';

type Phase = 'onboarding' | 'viewing';

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [phase, setPhase] = useState<Phase>('onboarding');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tableName, setTableName] = useState('');
  const [visibleColumnNames, setVisibleColumnNames] = useState<string[]>([]);
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

  /** A freshly loaded dataset starts in the onboarding wizard. */
  function reset(ds: Dataset) {
    setDataset(ds);
    setPhase('onboarding');
    setTableName('');
    setVisibleColumnNames(ds.columns.map((c) => c.name));
    setSearch('');
    setFilters({});
    setOpenRow(null);
    setFilterColumn(null);
  }

  function completeOnboarding(config: OnboardingConfig) {
    setTableName(config.name);
    setVisibleColumnNames(config.visibleColumns);
    setFilters(config.filters);
    setOpenRow(null);
    setFilterColumn(null);
    setPhase('viewing');
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

  // Only the columns the user chose to keep, in original order.
  const activeColumns = useMemo(() => {
    if (!dataset) return [];
    return dataset.columns.filter((c) => visibleColumnNames.includes(c.name));
  }, [dataset, visibleColumnNames]);

  const filteredRows = useMemo(() => {
    if (!dataset) return [];
    return applyFilters(dataset.rows, activeColumns, filters, search);
  }, [dataset, activeColumns, filters, search]);

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

  if (phase === 'onboarding') {
    return (
      <Onboarding
        dataset={dataset}
        onComplete={completeOnboarding}
        onCancel={() => setDataset(null)}
      />
    );
  }

  const activeColumn = filterColumn
    ? dataset.columns.find((c) => c.name === filterColumn) ?? null
    : null;

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top flex flex-col gap-2 px-4 pb-2 pt-3"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-base font-semibold" title={dataset.sourceName}
            style={{ color: 'var(--label)' }}>
            {tableName || 'Untitled table'}
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
        columns={activeColumns}
        rows={filteredRows}
        activeFilterColumns={activeFilterColumns}
        onRowTap={setOpenRow}
        onColumnTap={setFilterColumn}
      />

      {openRow !== null && filteredRows[openRow] && (
        <RowCard
          columns={activeColumns}
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
