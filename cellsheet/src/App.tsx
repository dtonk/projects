import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { Column, DatasetIndex, MaterializedData, Row, Source } from './types';
import { scanFile, scanUrl, materialize, type ProgressInfo } from './lib/parseCsv';
import { addRecent } from './lib/recents';
import { applyFilters, isFilterActive, type ColumnFilter, type Filters } from './lib/filter';
import { OpenScreen } from './components/OpenScreen';
import { Onboarding, type OnboardingConfig } from './components/Onboarding';
import { ProgressScreen } from './components/ProgressScreen';
import { SearchBar } from './components/SearchBar';
import { TableView } from './components/TableView';
import { RowCard } from './components/RowCard';
import { ColumnFilterSheet } from './components/ColumnFilterSheet';
import { TableHelp } from './components/TableHelp';

type Phase = 'idle' | 'scanning' | 'onboarding' | 'materializing' | 'viewing';

const SEEN_HELP_KEY = 'cellsheet:seenTableHelp';
const ROW_CAP = 50_000;

type SortState = { name: string; dir: 'asc' | 'desc' } | null;

function sortRows(rows: Row[], col: Column, dir: 'asc' | 'desc'): Row[] {
  return [...rows].sort((a, b) => {
    const av = a[col.name] ?? '';
    const bv = b[col.name] ?? '';
    let cmp: number;
    if (col.type === 'number') {
      const an = Number(av.replace(/,/g, ''));
      const bn = Number(bv.replace(/,/g, ''));
      cmp = (Number.isNaN(an) ? Infinity : an) - (Number.isNaN(bn) ? Infinity : bn);
    } else if (col.type === 'date') {
      const at = Date.parse(av);
      const bt = Date.parse(bv);
      cmp = (Number.isNaN(at) ? Infinity : at) - (Number.isNaN(bt) ? Infinity : bt);
    } else {
      cmp = av.localeCompare(bv);
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

function exportToCsv(columns: Column[], rows: Row[], name: string) {
  const escape = (v: string) => (/[,"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    columns.map((c) => escape(c.name)).join(','),
    ...rows.map((row) => columns.map((c) => escape(row[c.name] ?? '')).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name || 'export'}.csv` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** A live "seconds per 10k rows" estimate once we have enough signal. */
function estimateRate(startMs: number, rows: number): string | null {
  const elapsed = (Date.now() - startMs) / 1000;
  if (rows < 2000 || elapsed < 0.25) return null;
  const per10k = (elapsed / rows) * 10000;
  const s = per10k < 1 ? per10k.toFixed(1) : Math.round(per10k).toString();
  return `Each 10,000 rows takes about ${s}s · ${rows.toLocaleString()} scanned`;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [progressDetail, setProgressDetail] = useState<string | null>(null);
  const [progressStage, setProgressStage] = useState<'download' | 'scan'>('download');
  const scanStartRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const [index, setIndex] = useState<DatasetIndex | null>(null);
  const [dataset, setDataset] = useState<MaterializedData | null>(null);
  const sourceRef = useRef<Source | null>(null);

  const [tableName, setTableName] = useState('');
  const [visibleColumnNames, setVisibleColumnNames] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [showHelp, setShowHelp] = useState(false);

  function handleScanProgress(p: ProgressInfo) {
    setProgress(p.fraction);
    setProgressStage(p.stage);
    if (p.stage === 'scan') {
      if (scanStartRef.current === 0) scanStartRef.current = Date.now();
      setProgressDetail(estimateRate(scanStartRef.current, p.rows));
    } else {
      setProgressDetail(null);
    }
  }

  async function openUrl(url: string) {
    setError(null);
    setProgress(null);
    setProgressDetail(null);
    setProgressStage('download');
    scanStartRef.current = 0;
    setPhase('scanning');
    try {
      const scanned = await scanUrl(url, handleScanProgress);
      addRecent(url);
      sourceRef.current = scanned.source;
      setIndex(scanned.index);
      setPhase('onboarding');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that URL.');
      setPhase('idle');
    }
  }

  async function openFile(file: File) {
    setError(null);
    setProgress(0);
    setProgressDetail(null);
    setProgressStage('scan');
    scanStartRef.current = 0;
    setPhase('scanning');
    try {
      const scanned = await scanFile(file, handleScanProgress);
      sourceRef.current = scanned.source;
      setIndex(scanned.index);
      setPhase('onboarding');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
      setPhase('idle');
    }
  }

  async function completeOnboarding(config: OnboardingConfig) {
    if (!index || !sourceRef.current) return;
    setTableName(config.name);
    setVisibleColumnNames(config.visibleColumns);
    // The view starts unfiltered; the onboarding filters are baked into the
    // loaded rows during materialize, so they shape what's in memory.
    setSearch('');
    setFilters({});
    setOpenRow(null);
    setFilterColumn(null);
    setSort(null);
    setProgress(0);
    setProgressDetail(null);
    setPhase('materializing');
    try {
      const data = await materialize(
        sourceRef.current,
        index,
        config.visibleColumns,
        config.filters,
        ROW_CAP,
        (p) => setProgress(p.fraction),
      );
      setDataset(data);
      setPhase('viewing');
      if (!localStorage.getItem(SEEN_HELP_KEY)) setShowHelp(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the table.');
      setPhase('onboarding');
    }
  }

  function backToOpen() {
    setPhase('idle');
    setIndex(null);
    setDataset(null);
    sourceRef.current = null;
    setError(null);
    setSearch('');
    setFilters({});
    setOpenRow(null);
    setFilterColumn(null);
    setSort(null);
    setShowHelp(false);
  }

  function dismissHelp() {
    try {
      localStorage.setItem(SEEN_HELP_KEY, '1');
    } catch {
      /* ignore private-mode quota errors */
    }
    setShowHelp(false);
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
    if (!index) return [];
    return index.columns.filter((c) => visibleColumnNames.includes(c.name));
  }, [index, visibleColumnNames]);

  const filteredRows = useMemo(() => {
    if (!dataset) return [];
    return applyFilters(dataset.rows, activeColumns, filters, search);
  }, [dataset, activeColumns, filters, search]);

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const col = activeColumns.find((c) => c.name === sort.name);
    if (!col) return filteredRows;
    return sortRows(filteredRows, col, sort.dir);
  }, [filteredRows, sort, activeColumns]);

  const activeFilterColumns = useMemo(() => {
    const set = new Set<string>();
    for (const [name, f] of Object.entries(filters)) {
      if (isFilterActive(f)) set.add(name);
    }
    return set;
  }, [filters]);

  if (phase === 'scanning') {
    const downloading = progressStage === 'download';
    return (
      <ProgressScreen
        title={downloading ? 'Downloading your CSV…' : 'Reading your CSV…'}
        subtitle={
          downloading
            ? 'Fetching the file from the URL. Very large datasets can take a while to arrive from the server.'
            : "We are scanning your CSV to understand what's in it. That will allow us to filter it down to a manageable size."
        }
        progress={progress}
        detail={progressDetail}
      />
    );
  }

  if (phase === 'onboarding' && index) {
    return <Onboarding index={index} onComplete={completeOnboarding} onCancel={backToOpen} />;
  }

  if (phase === 'materializing') {
    return <ProgressScreen title="Preparing your table…" progress={progress} />;
  }

  if (phase === 'viewing' && dataset && index) {
    const activeColumn = filterColumn
      ? index.columns.find((c) => c.name === filterColumn) ?? null
      : null;

    return (
      <div className="flex h-full flex-col">
        <header className="safe-top flex flex-col gap-2 px-4 pb-2 pt-3"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-base font-semibold" style={{ color: 'var(--label)' }}>
              {tableName || 'Untitled table'}
            </span>
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setShowHelp(true)}
                aria-label="How to use this table"
                className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
              >
                ?
              </button>
              <button
                type="button"
                onClick={() => exportToCsv(activeColumns, sortedRows, tableName)}
                className="text-sm"
                style={{ color: 'var(--accent)' }}
              >
                Export
              </button>
              <button type="button" onClick={backToOpen}
                className="text-sm" style={{ color: 'var(--accent)' }}>
                Open another
              </button>
            </div>
          </div>
          <SearchBar
            value={search}
            onChange={setSearch}
            resultCount={filteredRows.length}
            totalCount={dataset.rows.length}
          />
          {dataset.capped && (
            <p className="text-xs" style={{ color: 'var(--accent)' }}>
              Showing the first {dataset.rows.length.toLocaleString()} of{' '}
              {dataset.totalRows.toLocaleString()} rows — add a filter to narrow.
            </p>
          )}
        </header>

        <TableView
          columns={activeColumns}
          rows={sortedRows}
          activeFilterColumns={activeFilterColumns}
          sortColumn={sort}
          onRowTap={setOpenRow}
          onColumnTap={setFilterColumn}
        />

        {openRow !== null && sortedRows[openRow] && (
          <RowCard
            columns={activeColumns}
            rows={sortedRows}
            index={openRow}
            tableName={tableName}
            onIndexChange={setOpenRow}
            onClose={() => setOpenRow(null)}
          />
        )}

        <AnimatePresence>
          {activeColumn && (
            <ColumnFilterSheet
              key={activeColumn.name}
              column={activeColumn}
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
              activeSort={sort?.name === activeColumn.name ? sort.dir : null}
              onSort={(dir) => setSort({ name: activeColumn.name, dir })}
              onClearSort={() => setSort(null)}
              rows={sortedRows}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showHelp && <TableHelp onClose={dismissHelp} />}
        </AnimatePresence>
      </div>
    );
  }

  // idle (and the error/loading landing)
  return <OpenScreen onOpenUrl={openUrl} onOpenFile={openFile} loading={false} error={error} />;
}
