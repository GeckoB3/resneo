/**
 * AI reshape stage: turn a messy, report-shaped export into a clean rectangular
 * table that the normal mapping/extract pipeline can consume.
 *
 * Handles the "date is a section header, times listed beneath it" layout
 * (plus repeated headers and "Page N" noise) by forward-filling the active date
 * and staff onto every appointment row. Only invoked when `detect-irregular`
 * flags a file, so clean exports never reach it. Returns null on any failure so
 * the caller keeps the deterministic ingest result.
 */

import Papa from 'papaparse';
import { disambiguateHeaders } from '@/lib/import/parse-storage-csv';
import { runImportAiJson, importReshapeModel } from '@/lib/import/openai-client';

/** Input rows per AI call. Larger = fewer sequential calls (less latency) but bigger prompts. */
const CHUNK_ROWS = 200;
const MAX_OUTPUT_TOKENS = 16_000;

export interface ReshapedTable {
  headers: string[];
  rows: Record<string, string>[];
  csvText: string;
  /** Assumptions the model made, e.g. an inferred first date. Surfaced to the user. */
  notes: string[];
  model: string;
}

type ReshapeChunkResult = {
  columns: string[];
  rows: string[][];
  carry_state: { current_date: string | null; current_staff: string | null };
  notes: string[];
};

const RESHAPE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['columns', 'rows', 'carry_state', 'notes'],
  properties: {
    columns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Output column names, in order. Same set for every chunk.',
    },
    rows: {
      type: 'array',
      items: { type: 'array', items: { type: 'string' } },
      description: 'One cleaned row per appointment; same length/order as columns.',
    },
    carry_state: {
      type: 'object',
      additionalProperties: false,
      required: ['current_date', 'current_staff'],
      properties: {
        current_date: { type: ['string', 'null'], description: 'ISO date (yyyy-MM-dd) in effect at the END of this chunk.' },
        current_staff: { type: ['string', 'null'], description: 'Staff/person in effect at the END of this chunk.' },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `You restructure messy, report-style booking/appointment exports into one clean rectangular table.
You ONLY reorganise and forward-fill values that are already present in the input — you never invent appointments, names, dates, or times.`;

function chunkRows<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function buildUserPrompt(params: {
  chunk: string[][];
  chunkIndex: number;
  totalChunks: number;
  fixedColumns: string[] | null;
  carry: { current_date: string | null; current_staff: string | null };
  fileTypeHint?: string;
  detectedPlatform?: string | null;
}): string {
  const { chunk, chunkIndex, totalChunks, fixedColumns, carry, fileTypeHint, detectedPlatform } = params;
  const columnsRule = fixedColumns
    ? `Use EXACTLY these columns, with these names, in this order (do not rename, add, drop, or reorder any): ${JSON.stringify(fixedColumns)}.`
    : `Choose clear column names that capture every piece of data present, e.g. ["Appointment Date","Appointment Time","Staff","Client Name","Service Name"]. Always include an "Appointment Date" column (ISO yyyy-MM-dd) and the staff/person, plus the time and any client/service/contact columns you see.`;

  return `This is chunk ${chunkIndex + 1} of ${totalChunks} from one report-style export${
    detectedPlatform ? ` (believed to be from ${detectedPlatform})` : ''
  }${fileTypeHint && fileTypeHint !== 'unknown' ? `, holding ${fileTypeHint} data` : ''}.

Each input row is an array of cell strings:
${JSON.stringify(chunk)}

How to read this layout:
- Some rows are SECTION HEADERS, not data: a DATE on its own (e.g. "12-May-26", "14/05/2026"), or a STAFF/person name on its own. These apply to all the appointment rows BELOW them until the next such header.
- Forward-fill: every output appointment row must carry the most recent date and staff seen above it.
- DROP noise rows entirely: page markers (e.g. "Page 1"), blank rows, totals/footers, and repeated column-header rows (e.g. a row that just says "Start Time, Client Name, Service Name").
- Output ONE row per appointment.

At the START of this chunk, the active date is ${carry.current_date ? `"${carry.current_date}"` : 'unknown'} and the active staff is ${carry.current_staff ? `"${carry.current_staff}"` : 'unknown'}.
${
  carry.current_date
    ? ''
    : 'If the active date is unknown and the first appointment rows have no date header above them, infer that block\'s date as the day BEFORE the first labelled date that appears later, and record this assumption in "notes".'
}

Rules:
- ${columnsRule}
- Convert all dates to ISO format yyyy-MM-dd. Dates like "12-May-26" mean 2026-05-12.
- Keep times as written (e.g. "09:30").
- Do not invent rows. If a value is genuinely absent, leave that cell "".
- "carry_state" must report the date and staff in effect at the END of this chunk (so the next chunk continues correctly).
- "notes": list any assumptions (especially an inferred first date). Empty array if none.`;
}

const normCol = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Re-key a chunk's rows to the fixed column order. Across chunks the model can
 * drift a column's name (e.g. "Service Name" -> "Service") even though it was
 * told to reuse them, which would otherwise silently drop that column's data for
 * later chunks (the bug where later, future-dated rows lost their service). Match
 * tolerantly: exact -> normalized/substring name -> positional (when the counts
 * agree, since the model keeps column order). Unresolvable columns become empty.
 */
export function rekeyRows(columns: string[], rows: string[][], fixed: string[]): string[][] {
  if (columns.length === fixed.length && columns.every((c, i) => c === fixed[i])) return rows;

  const colNorm = columns.map(normCol);
  const fixedNorm = fixed.map(normCol);
  const sameCount = columns.length === fixed.length;

  const idxForFixed = fixed.map((_, fi) => {
    const fn = fixedNorm[fi]!;
    if (!fn) return -1;
    const exact = colNorm.indexOf(fn);
    if (exact >= 0) return exact;
    // Tolerate name drift across chunks ("Service Name" vs "Service").
    return colNorm.findIndex((n) => n.length > 0 && (n.includes(fn) || fn.includes(n)));
  });

  return rows.map((r) =>
    idxForFixed.map((idx, fi) => {
      if (idx >= 0) return r[idx] ?? '';
      // No name match — trust column order when the counts agree.
      if (sameCount) return r[fi] ?? '';
      return '';
    }),
  );
}

export async function aiReshapeDataset(params: {
  rawGrid: string[][];
  fileTypeHint?: 'clients' | 'bookings' | 'staff' | 'unknown';
  detectedPlatform?: string | null;
}): Promise<ReshapedTable | null> {
  const contentRows = params.rawGrid.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
  if (contentRows.length < 2) return null;

  const chunks = chunkRows(contentRows, CHUNK_ROWS);
  const model = importReshapeModel();

  let fixedColumns: string[] | null = null;
  let carry: { current_date: string | null; current_staff: string | null } = {
    current_date: null,
    current_staff: null,
  };
  const allRows: string[][] = [];
  const notes: string[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const result = await runImportAiJson<ReshapeChunkResult>({
      callSite: 'ai-reshape',
      system: SYSTEM,
      user: buildUserPrompt({
        chunk: chunks[i]!,
        chunkIndex: i,
        totalChunks: chunks.length,
        fixedColumns,
        carry,
        fileTypeHint: params.fileTypeHint,
        detectedPlatform: params.detectedPlatform,
      }),
      schemaName: 'reshaped_table',
      schema: RESHAPE_SCHEMA,
      model,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });

    if (!result) return null; // any failure → fall back to the original file

    const data: ReshapeChunkResult = result.data;
    const cols: string[] = Array.isArray(data.columns) ? data.columns.map((c: string) => String(c)) : [];
    if (!fixedColumns) {
      if (cols.length === 0) return null;
      fixedColumns = cols;
    }
    const activeColumns: string[] = fixedColumns;
    const chunkCols: string[] = cols.length > 0 ? cols : activeColumns;
    const chunkRowsOut: string[][] = Array.isArray(data.rows)
      ? data.rows.map((r: string[]) => r.map((c: string) => String(c ?? '')))
      : [];
    allRows.push(...rekeyRows(chunkCols, chunkRowsOut, activeColumns));

    if (data.carry_state) {
      carry = {
        current_date: data.carry_state.current_date ?? carry.current_date,
        current_staff: data.carry_state.current_staff ?? carry.current_staff,
      };
    }
    if (Array.isArray(data.notes)) {
      for (const n of data.notes) if (n?.trim()) notes.push(n.trim());
    }
  }

  if (!fixedColumns || allRows.length === 0) return null;
  // Sanity: a reshape should never produce more rows than the input had.
  if (allRows.length > contentRows.length) return null;

  const { unique: headers } = disambiguateHeaders(fixedColumns.map((h) => h.trim()));
  const rows: Record<string, string>[] = allRows.map((arr) => {
    const out: Record<string, string> = {};
    headers.forEach((h, j) => {
      if (h) out[h] = arr[j] ?? '';
    });
    return out;
  });
  const csvText = Papa.unparse(
    { fields: headers.filter(Boolean), data: allRows.map((arr) => headers.map((_, j) => arr[j] ?? '')) },
    { newline: '\n' },
  );

  return { headers, rows, csvText, notes, model };
}
