import Papa, { type ParseResult, type Parser } from 'papaparse';
import type { ColumnIndex, ColumnType, DatasetIndex, MaterializedData, Row, Source } from '../types';
import { rowMatches, type Filters } from './filter';

const SAMPLE_SIZE = 200;
const DISTINCT_CAP = 50;

const DATE_RE =
  /^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?|^\d{1,2}\/\d{1,2}\/\d{2,4}/;

function isNumeric(v: string): boolean {
  if (v.trim() === '') return false;
  return Number.isFinite(Number(v.replace(/,/g, '')));
}

function isBooleanish(v: string): boolean {
  return /^(true|false|yes|no)$/i.test(v.trim());
}

function isDateish(v: string): boolean {
  if (!DATE_RE.test(v.trim())) return false;
  return !Number.isNaN(Date.parse(v));
}

/** Per-column running tallies accumulated during the streaming scan. */
interface ColAccumulator {
  sampled: number;
  nums: number;
  bools: number;
  dates: number;
  distinct: Set<string>;
  truncated: boolean;
}

function newAccumulator(): ColAccumulator {
  return { sampled: 0, nums: 0, bools: 0, dates: 0, distinct: new Set(), truncated: false };
}

function decideType(a: ColAccumulator): ColumnType {
  if (a.sampled === 0) return 'text';
  if (a.bools === a.sampled) return 'boolean';
  if (a.nums === a.sampled) return 'number';
  if (a.dates >= a.sampled * 0.9) return 'date';
  return 'text';
}

interface ScanResult {
  fields: string[];
  accs: Map<string, ColAccumulator>;
  rowCount: number;
}

/**
 * Stream the whole input once (in a worker) building only a lightweight index:
 * column types, capped distinct values, and a row count. No rows are kept.
 */
function runScan(
  input: File | string,
  totalBytes: number,
  onProgress?: (fraction: number) => void,
): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    let fields: string[] = [];
    const accs = new Map<string, ColAccumulator>();
    let rowCount = 0;

    Papa.parse<Row>(input as string, {
      header: true,
      skipEmptyLines: 'greedy',
      worker: true,
      chunk: (results: ParseResult<Row>) => {
        if (fields.length === 0 && results.meta.fields) {
          fields = results.meta.fields;
          for (const name of fields) accs.set(name, newAccumulator());
        }
        for (const row of results.data) {
          rowCount++;
          for (const name of fields) {
            const v = row[name] ?? '';
            if (v === '') continue;
            const acc = accs.get(name)!;
            if (acc.sampled < SAMPLE_SIZE) {
              acc.sampled++;
              if (isBooleanish(v)) acc.bools++;
              else if (isNumeric(v)) acc.nums++;
              else if (isDateish(v)) acc.dates++;
            }
            if (!acc.truncated) {
              acc.distinct.add(v);
              if (acc.distinct.size > DISTINCT_CAP) {
                acc.truncated = true;
                acc.distinct.clear(); // past the cap we use a "contains" filter
              }
            }
          }
        }
        if (onProgress && totalBytes > 0) {
          onProgress(Math.min(results.meta.cursor / totalBytes, 1));
        }
      },
      complete: () => resolve({ fields, accs, rowCount }),
      error: (err: Error) => reject(err),
    });
  });
}

function buildIndex(scan: ScanResult, sourceName: string, sourceType: 'url' | 'file'): DatasetIndex {
  const columns: ColumnIndex[] = scan.fields.map((name, index) => {
    const acc = scan.accs.get(name) ?? newAccumulator();
    return {
      name,
      index,
      type: decideType(acc),
      distinct: acc.truncated ? [] : Array.from(acc.distinct).sort((a, b) => a.localeCompare(b)),
      distinctTruncated: acc.truncated,
    };
  });
  return { columns, rowCount: scan.rowCount, sourceName, sourceType };
}

export interface Scanned {
  index: DatasetIndex;
  source: Source;
}

export async function scanFile(file: File, onProgress?: (f: number) => void): Promise<Scanned> {
  const scan = await runScan(file, file.size, onProgress);
  if (scan.fields.length === 0) throw new Error('No columns found — is this a CSV file?');
  return { index: buildIndex(scan, file.name, 'file'), source: { kind: 'file', file } };
}

export async function scanUrl(url: string, onProgress?: (f: number) => void): Promise<Scanned> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Could not reach that URL (network or CORS).');
  }
  if (!res.ok) throw new Error(`Could not fetch that URL (HTTP ${res.status}).`);
  const text = await res.text();
  const scan = await runScan(text, text.length, onProgress);
  if (scan.fields.length === 0) throw new Error('No columns found — is this a CSV URL?');
  return { index: buildIndex(scan, url, 'url'), source: { kind: 'url', text } };
}

/**
 * Second pass: stream the source again, keeping only the selected columns and
 * rows that pass the filters, up to `cap` rows.
 */
export function materialize(
  source: Source,
  index: DatasetIndex,
  selectedColumns: string[],
  filters: Filters,
  cap: number,
  onProgress?: (fraction: number) => void,
): Promise<MaterializedData> {
  const input: File | string = source.kind === 'file' ? source.file : source.text;
  const totalBytes = source.kind === 'file' ? source.file.size : source.text.length;

  return new Promise((resolve, reject) => {
    const rows: Row[] = [];
    let capped = false;
    let stopped = false;

    Papa.parse<Row>(input as string, {
      header: true,
      skipEmptyLines: 'greedy',
      worker: true,
      chunk: (results: ParseResult<Row>, parser: Parser) => {
        if (stopped) return;
        for (const row of results.data) {
          if (!rowMatches(row, filters)) continue;
          const projected: Row = {};
          for (const name of selectedColumns) projected[name] = row[name] ?? '';
          rows.push(projected);
          if (rows.length >= cap) {
            capped = true;
            stopped = true;
            parser.abort();
            break;
          }
        }
        if (onProgress && totalBytes > 0) {
          onProgress(Math.min(results.meta.cursor / totalBytes, 1));
        }
      },
      complete: () => resolve({ rows, totalRows: index.rowCount, capped, loadedAt: Date.now() }),
      error: (err: Error) => reject(err),
    });
  });
}
