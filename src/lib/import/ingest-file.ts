/**
 * Import ingestion: accept whatever spreadsheet-ish file the user has and
 * normalise it to clean CSV datasets before anything else sees it.
 *
 * - .xlsx / .xls workbooks: every non-empty sheet becomes its own dataset.
 * - .csv / .tsv / .txt: encoding detected (UTF-8 / UTF-16 BOMs, Windows-1252
 *   fallback) so "O'Neill", "Siân" and "£" survive Windows Excel exports.
 * - Header row detected (title/metadata rows above the real header are
 *   dropped) and duplicate headers disambiguated.
 * - Output is re-serialised as canonical UTF-8 comma CSV, so the stored file
 *   always round-trips through the existing storage parser unchanged.
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { disambiguateHeaders } from '@/lib/import/parse-storage-csv';

export const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
export const IMPORT_MAX_SHEETS = 10;

export interface IngestedDataset {
  /** Display label: the filename, plus the sheet name for multi-sheet workbooks. */
  label: string;
  /** Sheet name for workbooks; null for CSV input. */
  sheetName: string | null;
  /** Canonical CSV text (UTF-8, comma-delimited, header row first). */
  csvText: string;
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  /** 0-based index of the detected header row in the original grid. */
  headerRowIndex: number;
  duplicateHeaders: string[];
  /**
   * Content rows of the source grid (fully-empty rows removed) BEFORE header
   * detection collapses them — i.e. still including any section-header rows,
   * page markers, and repeated headers. The irregularity detector and AI
   * reshape stage work off this.
   */
  rawGrid: string[][];
}

export interface IngestResult {
  datasets: IngestedDataset[];
  warnings: string[];
}

const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls'];
const TEXT_EXTENSIONS = ['.csv', '.tsv', '.txt'];

export function importFileExtensionAllowed(filename: string): boolean {
  const lower = filename.toLowerCase();
  return [...SPREADSHEET_EXTENSIONS, ...TEXT_EXTENSIONS].some((ext) => lower.endsWith(ext));
}

/** Decode an uploaded text file: BOM-aware, strict UTF-8 first, Windows-1252 fallback. */
export function decodeUploadText(buf: Buffer): { text: string; encoding: string } {
  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(buf), encoding: 'utf-16le' };
    }
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      return { text: new TextDecoder('utf-16be').decode(buf), encoding: 'utf-16be' };
    }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text: text.replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'windows-1252' };
  }
}

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return String(v);
}

/**
 * Find the real header row within the first rows of a raw grid. Report exports
 * often put a title, date range, or blank rows above the header. Heuristic: a
 * header row is mostly filled, mostly unique, mostly non-numeric text, and is
 * followed by at least one data row.
 */
export function detectHeaderRow(grid: string[][]): number {
  const limit = Math.min(grid.length - 1, 10);
  const width = Math.max(...grid.slice(0, limit + 1).map((r) => r.length), 0);
  if (width === 0) return 0;

  for (let i = 0; i <= limit; i += 1) {
    const cells = (grid[i] ?? []).map((c) => c.trim());
    const nonEmpty = cells.filter(Boolean);
    if (nonEmpty.length < 2) continue;
    if (nonEmpty.length / width < 0.5) continue;
    const distinct = new Set(nonEmpty.map((c) => c.toLowerCase()));
    if (distinct.size / nonEmpty.length < 0.9) continue;
    const texty = nonEmpty.filter(
      (c) => !/^-?[\d.,/:\s£$€%]+$/.test(c), // not purely numeric/date/currency-shaped
    );
    if (texty.length / nonEmpty.length < 0.7) continue;
    const next = grid[i + 1] ?? [];
    if (!next.some((c) => c.trim())) continue;
    return i;
  }
  return 0;
}

function gridToDataset(
  grid: string[][],
  label: string,
  sheetName: string | null,
  warnings: string[],
): IngestedDataset | null {
  const trimmed = grid.filter((row) => row.some((c) => c.trim() !== ''));
  if (trimmed.length < 2) return null; // needs a header and at least one data row

  const headerRowIndex = detectHeaderRow(trimmed);
  if (headerRowIndex > 0) {
    warnings.push(
      `${label}: skipped ${headerRowIndex} row${headerRowIndex === 1 ? '' : 's'} above the column headings.`,
    );
  }
  const rawHeaders = (trimmed[headerRowIndex] ?? []).map((h) => h.trim());
  const { unique: headers, duplicates } = disambiguateHeaders(rawHeaders);
  if (duplicates.length > 0) {
    warnings.push(
      `${label}: duplicate column heading${duplicates.length === 1 ? '' : 's'} (${duplicates.join(', ')}) — later copies were renamed with _2, _3, …`,
    );
  }

  const dataGrid = trimmed.slice(headerRowIndex + 1);
  const rows: Record<string, string>[] = dataGrid.map((arr) => {
    const out: Record<string, string> = {};
    for (let j = 0; j < headers.length; j += 1) {
      const key = headers[j];
      if (!key) continue;
      out[key] = cellToString(arr[j]);
    }
    return out;
  });

  const csvText = Papa.unparse(
    { fields: headers.filter(Boolean), data: dataGrid.map((arr) => headers.map((_, j) => cellToString(arr[j]))) },
    { newline: '\n' },
  );

  return {
    label,
    sheetName,
    csvText,
    headers,
    rows,
    rowCount: rows.length,
    headerRowIndex,
    duplicateHeaders: duplicates,
    rawGrid: trimmed,
  };
}

/**
 * Parse an uploaded file (workbook or delimited text) into one or more clean
 * CSV datasets. Throws with a user-facing message for unusable files.
 */
export function ingestUploadedFile(filename: string, buf: Buffer): IngestResult {
  const lower = filename.toLowerCase();
  const warnings: string[] = [];
  const datasets: IngestedDataset[] = [];

  if (SPREADSHEET_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
    const sheetNames = wb.SheetNames.slice(0, IMPORT_MAX_SHEETS);
    if (wb.SheetNames.length > IMPORT_MAX_SHEETS) {
      warnings.push(`Only the first ${IMPORT_MAX_SHEETS} sheets were read.`);
    }
    const multiSheet =
      sheetNames.filter((n) => {
        const ws = wb.Sheets[n];
        return ws && ws['!ref'];
      }).length > 1;
    for (const name of sheetNames) {
      const ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) continue;
      const grid = (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][])
        .map((row) => row.map(cellToString));
      const label = multiSheet ? `${filename} — ${name}` : filename;
      const ds = gridToDataset(grid, label, name, warnings);
      if (ds) datasets.push(ds);
    }
    if (datasets.length === 0) {
      throw new Error('No data found in this spreadsheet — every sheet looks empty.');
    }
    return { datasets, warnings };
  }

  const { text, encoding } = decodeUploadText(buf);
  if (encoding === 'windows-1252') {
    warnings.push('This file was not UTF-8; accents and symbols were decoded as Windows-1252.');
  }
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy' });
  const grid = (parsed.data ?? []).map((row) => (Array.isArray(row) ? row.map(cellToString) : []));
  const ds = gridToDataset(grid, filename, null, warnings);
  if (!ds) {
    throw new Error('No data found in this file — it needs a heading row plus at least one data row.');
  }
  datasets.push(ds);
  return { datasets, warnings };
}
