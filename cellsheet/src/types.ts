export type ColumnType = 'number' | 'date' | 'boolean' | 'text';

export interface Column {
  name: string;
  index: number;
  type: ColumnType;
}

export interface ColumnIndex extends Column {
  /** Distinct non-empty values, capped. Empty when distinctTruncated is true. */
  distinct: string[];
  /** True when the column has more distinct values than the checklist cap. */
  distinctTruncated: boolean;
}

/** A row keyed by column name. Values are kept as raw strings from the CSV. */
export type Row = Record<string, string>;

/**
 * A lightweight index built by streaming the whole file once without keeping
 * any rows. Drives the onboarding wizard (columns, types, filter values).
 */
export interface DatasetIndex {
  columns: ColumnIndex[];
  rowCount: number;
  sourceName: string;
  sourceType: 'url' | 'file';
}

/** The source kept around so the second (materialize) pass can re-read it. */
export type Source =
  | { kind: 'file'; file: File }
  | { kind: 'url'; text: string };

/** Rows materialized for viewing: selected columns, filtered, and capped. */
export interface MaterializedData {
  rows: Row[];
  /** Total rows in the source file (from the index). */
  totalRows: number;
  /** True when rows were truncated at the cap. */
  capped: boolean;
  loadedAt: number;
}
