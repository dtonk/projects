import type { Column, ColumnType, Row } from '../types';

export interface ColumnFilter {
  type: ColumnType;
  /** Substring match (text columns). */
  contains?: string;
  /** Discrete selected values (low-cardinality columns). */
  values?: string[];
  /** Numeric range. */
  min?: number;
  max?: number;
  /** Date range (ISO yyyy-mm-dd). */
  after?: string;
  before?: string;
}

export type Filters = Record<string, ColumnFilter>;

export function isFilterActive(f: ColumnFilter | undefined): boolean {
  if (!f) return false;
  return Boolean(
    (f.contains && f.contains.trim() !== '') ||
      (f.values && f.values.length > 0) ||
      f.min != null ||
      f.max != null ||
      (f.after && f.after !== '') ||
      (f.before && f.before !== ''),
  );
}

/** Convert a `*`/`?` wildcard query into a case-insensitive RegExp. */
export function wildcardToRegex(query: string): RegExp {
  const escaped = query
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(escaped, 'i');
}

function matchesSearch(row: Row, columns: Column[], query: string): boolean {
  const q = query.trim();
  if (q === '') return true;

  if (/[*?]/.test(q)) {
    const re = wildcardToRegex(q);
    return columns.some((c) => re.test(row[c.name] ?? ''));
  }

  const lower = q.toLowerCase();
  return columns.some((c) => (row[c.name] ?? '').toLowerCase().includes(lower));
}

function matchesColumnFilter(raw: string, f: ColumnFilter): boolean {
  if (f.values && f.values.length > 0 && !f.values.includes(raw)) return false;

  if (f.contains && f.contains.trim() !== '') {
    if (!raw.toLowerCase().includes(f.contains.toLowerCase())) return false;
  }

  if (f.min != null || f.max != null) {
    const n = Number(raw.replace(/,/g, ''));
    if (Number.isNaN(n)) return false;
    if (f.min != null && n < f.min) return false;
    if (f.max != null && n > f.max) return false;
  }

  if ((f.after && f.after !== '') || (f.before && f.before !== '')) {
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return false;
    if (f.after && t < Date.parse(f.after)) return false;
    // include the whole "before" day by adding ~24h
    if (f.before && t > Date.parse(f.before) + 86_399_000) return false;
  }

  return true;
}

/** True when a row passes every active column filter (no search). */
export function rowMatches(row: Row, filters: Filters): boolean {
  for (const [name, f] of Object.entries(filters)) {
    if (isFilterActive(f) && !matchesColumnFilter(row[name] ?? '', f)) return false;
  }
  return true;
}

export function applyFilters(
  rows: Row[],
  columns: Column[],
  filters: Filters,
  search: string,
): Row[] {
  const active = Object.entries(filters).filter(([, f]) => isFilterActive(f));
  if (active.length === 0 && search.trim() === '') return rows;

  return rows.filter((row) => {
    for (const [name, f] of active) {
      if (!matchesColumnFilter(row[name] ?? '', f)) return false;
    }
    return matchesSearch(row, columns, search);
  });
}

/** Distinct non-empty values for a column, capped for UI use. */
export function distinctValues(rows: Row[], name: string, cap = 200): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[name] ?? '';
    if (v !== '') seen.add(v);
    if (seen.size > cap) break;
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}
