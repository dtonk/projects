import Papa from 'papaparse';
import type { Column, ColumnType, Dataset, Row } from '../types';

const SAMPLE_SIZE = 200;

const DATE_RE =
  /^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?|^\d{1,2}\/\d{1,2}\/\d{2,4}/;

function isNumeric(v: string): boolean {
  if (v.trim() === '') return false;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n);
}

function isBooleanish(v: string): boolean {
  return /^(true|false|yes|no)$/i.test(v.trim());
}

function isDateish(v: string): boolean {
  if (!DATE_RE.test(v.trim())) return false;
  return !Number.isNaN(Date.parse(v));
}

function detectType(values: string[]): ColumnType {
  const sample = values.filter((v) => v != null && v !== '').slice(0, SAMPLE_SIZE);
  if (sample.length === 0) return 'text';

  let nums = 0;
  let bools = 0;
  let dates = 0;
  for (const v of sample) {
    if (isBooleanish(v)) bools++;
    else if (isNumeric(v)) nums++;
    else if (isDateish(v)) dates++;
  }

  const n = sample.length;
  if (bools === n) return 'boolean';
  if (nums === n) return 'number';
  if (dates >= n * 0.9) return 'date';
  return 'text';
}

function buildDataset(
  data: Row[],
  fields: string[],
  sourceName: string,
  sourceType: 'url' | 'file',
): Dataset {
  // Drop fully-empty trailing rows that some exports include.
  const rows = data.filter((r) => fields.some((f) => (r[f] ?? '').trim() !== ''));

  const columns: Column[] = fields.map((name, index) => ({
    name,
    index,
    type: detectType(rows.map((r) => r[name] ?? '')),
  }));

  return { columns, rows, sourceName, sourceType, loadedAt: Date.now() };
}

export function parseFile(file: File): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      worker: false,
      complete: (res) =>
        resolve(buildDataset(res.data, res.meta.fields ?? [], file.name, 'file')),
      error: (err) => reject(err),
    });
  });
}

export function parseUrl(url: string): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(url, {
      download: true,
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        if (!res.meta.fields || res.meta.fields.length === 0) {
          reject(new Error('No columns found — is this a CSV URL?'));
          return;
        }
        resolve(buildDataset(res.data, res.meta.fields, url, 'url'));
      },
      error: (err) => reject(err),
    });
  });
}
