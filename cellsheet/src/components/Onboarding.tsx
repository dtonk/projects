import { useMemo, useState } from 'react';
import type { Column, Dataset } from '../types';
import { isFilterActive, type Filters } from '../lib/filter';
import { FilterControls } from './FilterControls';

export interface OnboardingConfig {
  name: string;
  visibleColumns: string[];
  filters: Filters;
}

interface Props {
  dataset: Dataset;
  onComplete: (config: OnboardingConfig) => void;
  onCancel: () => void;
}

type Step = 'name' | 'columns' | 'askFilter' | 'pickColumn' | 'criteria';

function defaultName(dataset: Dataset): string {
  if (dataset.sourceType === 'file') {
    return dataset.sourceName.replace(/\.[^.]+$/, '');
  }
  try {
    const path = new URL(dataset.sourceName).pathname.split('/').filter(Boolean).pop();
    if (path) return decodeURIComponent(path).replace(/\.[^.]+$/, '');
  } catch {
    /* fall through */
  }
  return 'Untitled table';
}

export function Onboarding({ dataset, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState(() => defaultName(dataset));
  const [visible, setVisible] = useState<string[]>(() => dataset.columns.map((c) => c.name));
  const [filterColName, setFilterColName] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});

  const allColumns = dataset.columns;
  const allSelected = visible.length === allColumns.length;
  const activeFilterCount = Object.values(filters).filter(isFilterActive).length;
  const filterColumn: Column | undefined = useMemo(
    () => allColumns.find((c) => c.name === filterColName),
    [allColumns, filterColName],
  );

  function finish() {
    onComplete({
      name: name.trim() || defaultName(dataset),
      visibleColumns: visible.length > 0 ? visible : allColumns.map((c) => c.name),
      filters,
    });
  }

  function toggleColumn(colName: string) {
    setVisible((prev) =>
      prev.includes(colName) ? prev.filter((n) => n !== colName) : [...prev, colName],
    );
  }

  function back() {
    if (step === 'name') onCancel();
    else if (step === 'columns') setStep('name');
    else if (step === 'askFilter') setStep('columns');
    else if (step === 'pickColumn') setStep('askFilter');
    else if (step === 'criteria') setStep('pickColumn');
  }

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-md flex-col px-5 pb-6"
      style={{
        background: 'linear-gradient(180deg, rgba(30,64,175,0.08), transparent 320px)',
        paddingTop: 'calc(20px + env(safe-area-inset-top))',
      }}
    >
      {/* Top bar: back + table name */}
      <div className="mb-6 flex items-center justify-between">
        <button type="button" onClick={back} className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
          ‹ Back
        </button>
        <span className="truncate px-3 text-xs" style={{ color: 'var(--muted)' }}>
          {name || 'New table'}
        </span>
        <span className="w-10" />
      </div>

      {step === 'name' && (
        <Section
          title="What should we call this table?"
          subtitle="This name shows at the top instead of the file or URL."
          primaryLabel="Next"
          onPrimary={() => setStep('columns')}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Street Trees"
            autoFocus
            className="w-full rounded-xl border px-3 py-3 text-base outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}
          />
        </Section>
      )}

      {step === 'columns' && (
        <Section
          title="Which columns do you want to look at?"
          subtitle="Hide the ones you don't need to keep the table light."
          primaryLabel="Next"
          primaryDisabled={visible.length === 0}
          onPrimary={() => setStep('askFilter')}
        >
          <button
            type="button"
            onClick={() => setVisible(allSelected ? [] : allColumns.map((c) => c.name))}
            className="mb-2 flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold"
            style={{ background: 'var(--bg-soft)', color: 'var(--label)' }}
          >
            <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
            <span style={{ color: 'var(--muted)' }}>
              {visible.length} of {allColumns.length}
            </span>
          </button>
          <ul className="flex flex-col">
            {allColumns.map((c) => {
              const checked = visible.includes(c.name);
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => toggleColumn(c.name)}
                    className="flex w-full items-center gap-3 py-2 text-left"
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-white"
                      style={{ background: checked ? 'var(--accent)' : 'var(--bg-soft)', border: '1px solid var(--border)' }}
                    >
                      {checked ? '✓' : ''}
                    </span>
                    <span className="truncate text-base">{c.name}</span>
                    <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>{c.type}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {step === 'askFilter' && (
        <Section title="Do you want to filter the rows?" subtitle="Narrow down to just the rows you care about.">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setStep('pickColumn')}
              className="w-full rounded-xl py-3 text-base font-medium text-white"
              style={{ background: 'var(--accent)' }}
            >
              Yes, filter rows
            </button>
            <button
              type="button"
              onClick={finish}
              className="w-full rounded-xl border py-3 text-base font-medium"
              style={{ borderColor: 'var(--border)' }}
            >
              No, show all rows
            </button>
          </div>
        </Section>
      )}

      {step === 'pickColumn' && (
        <Section
          title="Filter on which column?"
          subtitle={
            activeFilterCount > 0
              ? `${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} set — pick another column, or show the table.`
              : 'Pick the column whose values you want to narrow.'
          }
          primaryLabel={activeFilterCount > 0 ? 'Show table' : undefined}
          onPrimary={activeFilterCount > 0 ? finish : undefined}
        >
          <ul className="flex flex-col">
            {allColumns.map((c) => {
              const active = isFilterActive(filters[c.name]);
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterColName(c.name);
                      setStep('criteria');
                    }}
                    className="flex w-full items-center gap-3 border-b py-3 text-left"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="truncate text-base">{c.name}</span>
                    <span
                      className="ml-auto text-xs font-medium"
                      style={{ color: active ? 'var(--accent)' : 'var(--muted)' }}
                    >
                      {active ? 'filtering ›' : `${c.type} ›`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {step === 'criteria' && filterColumn && (
        <Section title={`Filter "${filterColumn.name}"`} subtitle="Set the criteria for this column.">
          <FilterControls
            column={filterColumn}
            rows={dataset.rows}
            filter={filters[filterColumn.name]}
            onChange={(f) => setFilters((prev) => ({ ...prev, [filterColumn.name]: f }))}
          />
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                setFilterColName(null);
                setStep('pickColumn');
              }}
              className="w-full rounded-xl border py-3.5 text-base font-medium"
              style={{ borderColor: 'var(--border)' }}
            >
              Apply another filter
            </button>
            <button
              type="button"
              onClick={finish}
              className="w-full rounded-xl py-3.5 text-base font-medium text-white"
              style={{ background: 'var(--accent)' }}
            >
              Show table
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
  primaryLabel,
  primaryDisabled,
  onPrimary,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  primaryLabel?: string;
  primaryDisabled?: boolean;
  onPrimary?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--label)' }}>
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 mb-5 text-sm" style={{ color: 'var(--muted)' }}>
          {subtitle}
        </p>
      )}
      <div className={subtitle ? '' : 'mt-5'}>{children}</div>

      {primaryLabel && onPrimary && (
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="mt-auto w-full rounded-xl py-3.5 text-base font-medium text-white disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          {primaryLabel}
        </button>
      )}
    </div>
  );
}
