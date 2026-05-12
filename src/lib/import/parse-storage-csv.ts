import Papa from 'papaparse';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ParsedCsvFile {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  duplicateHeaders: string[];
}

/**
 * Disambiguates duplicate CSV headers (e.g. two `Notes` columns) by suffixing later
 * occurrences with `_2`, `_3`, …. Without this, `Papa.parse({ header: true })` silently
 * overwrites the earlier column on every row, losing data.
 */
export function disambiguateHeaders(headers: string[]): {
  unique: string[];
  duplicates: string[];
} {
  const counts = new Map<string, number>();
  const unique: string[] = [];
  const duplicates: string[] = [];
  for (const raw of headers) {
    const trimmed = raw.trim();
    if (!trimmed) {
      unique.push(trimmed);
      continue;
    }
    const seen = counts.get(trimmed) ?? 0;
    counts.set(trimmed, seen + 1);
    if (seen === 0) {
      unique.push(trimmed);
    } else {
      if (seen === 1) duplicates.push(trimmed);
      unique.push(`${trimmed}_${seen + 1}`);
    }
  }
  return { unique, duplicates };
}

export async function downloadAndParseCsv(
  admin: SupabaseClient,
  storagePath: string,
): Promise<ParsedCsvFile> {
  const { data, error } = await admin.storage.from('imports').download(storagePath);
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to download import file');
  }
  const text = await data.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: false,
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors.length) {
    console.warn('[parse csv] warnings', parsed.errors.slice(0, 3));
  }
  const allRows = (parsed.data ?? []) as unknown as string[][];
  const rawHeaders = (allRows[0] ?? []).map((h) => (typeof h === 'string' ? h : String(h ?? '')));
  const { unique: headers, duplicates: duplicateHeaders } = disambiguateHeaders(rawHeaders);
  if (duplicateHeaders.length > 0) {
    console.warn(
      '[parse csv] duplicate headers detected, second/later occurrences suffixed:',
      duplicateHeaders,
    );
  }
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < allRows.length; i += 1) {
    const arr = allRows[i] ?? [];
    const out: Record<string, string> = {};
    for (let j = 0; j < headers.length; j += 1) {
      const key = headers[j];
      if (!key) continue;
      const cell = arr[j];
      out[key] = cell != null ? String(cell) : '';
    }
    rows.push(out);
  }
  return {
    headers,
    rows,
    rowCount: rows.length,
    duplicateHeaders,
  };
}
