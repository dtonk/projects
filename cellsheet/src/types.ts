export type ColumnType = 'number' | 'date' | 'boolean' | 'text';

export interface Column {
  name: string;
  index: number;
  type: ColumnType;
}

/** A row keyed by column name. Values are kept as raw strings from the CSV. */
export type Row = Record<string, string>;

export interface Dataset {
  columns: Column[];
  rows: Row[];
  /** Filename or URL the data came from. */
  sourceName: string;
  sourceType: 'url' | 'file';
  loadedAt: number;
}
