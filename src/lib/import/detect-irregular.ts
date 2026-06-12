/**
 * Deterministic detector for "report-shaped" import files that need AI reshaping
 * before the normal mapping pipeline can use them.
 *
 * A clean rectangular export (Fresha/Phorest/etc.) fires NONE of these signals,
 * so it never reaches the (slower, paid) AI reshape stage. The detector targets
 * paginated PDF-style exports where the date/staff are section-header rows with
 * times listed beneath them, plus "Page N" noise and repeated column headers.
 */

import { TIME_RE, ISO_DATE_RE, NUMERIC_DATE_RE, DASH_MONTH_DATE_RE } from '@/lib/import/column-profile';

export interface IrregularitySignals {
  isIrregular: boolean;
  /** 0..1 rough confidence, for logging/telemetry. */
  score: number;
  /** Human-readable reasons, surfaced as upload warnings. */
  reasons: string[];
  signals: {
    contentRows: number;
    modalWidth: number;
    raggedRowFraction: number;
    repeatedHeaderRowCount: number;
    pageNoiseRowCount: number;
    sectionHeaderRowFraction: number;
    dateOnlyRowCount: number;
    timeColumnDominant: boolean;
  };
}

const PAGE_NOISE_RE = /^page\s*\d+/i;
const MONTH_NAME_DATE_RE =
  /^(\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4}|[A-Za-z]{3,}\s+\d{1,2},?\s+\d{2,4})$/;

function isDateLike(v: string): boolean {
  const t = v.trim();
  return (
    ISO_DATE_RE.test(t) ||
    NUMERIC_DATE_RE.test(t) ||
    DASH_MONTH_DATE_RE.test(t) ||
    MONTH_NAME_DATE_RE.test(t)
  );
}

function normalizeRow(cells: string[]): string {
  return cells.map((c) => c.trim().toLowerCase()).filter(Boolean).join('|');
}

function isTextyHeaderRow(nonEmpty: string[]): boolean {
  if (nonEmpty.length < 2) return false;
  // Header cells are words, not numbers/dates/times/currency.
  const texty = nonEmpty.filter((c) => !/^-?[\d.,/:\s£$€%-]+$/.test(c) && !isDateLike(c));
  return texty.length / nonEmpty.length >= 0.7;
}

export function detectIrregularGrid(
  grid: string[][],
  _opts: { fileTypeHint?: 'clients' | 'bookings' | 'staff' | 'unknown' } = {},
): IrregularitySignals {
  const rows = grid.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
  const contentRows = rows.length;

  const empty: IrregularitySignals = {
    isIrregular: false,
    score: 0,
    reasons: [],
    signals: {
      contentRows,
      modalWidth: 0,
      raggedRowFraction: 0,
      repeatedHeaderRowCount: 0,
      pageNoiseRowCount: 0,
      sectionHeaderRowFraction: 0,
      dateOnlyRowCount: 0,
      timeColumnDominant: false,
    },
  };
  if (contentRows < 4) return empty;

  const nonEmptyByRow = rows.map((r) => r.map((c) => (c ?? '').trim()).filter(Boolean));

  // Modal width across rows with at least 2 filled cells (the "table body" shape).
  const widthFreq = new Map<number, number>();
  for (const ne of nonEmptyByRow) {
    if (ne.length >= 2) widthFreq.set(ne.length, (widthFreq.get(ne.length) ?? 0) + 1);
  }
  let modalWidth = 0;
  let modalCount = 0;
  for (const [w, c] of widthFreq) {
    if (c > modalCount) {
      modalCount = c;
      modalWidth = w;
    }
  }
  if (modalWidth < 2) return empty;

  let ragged = 0;
  let pageNoise = 0;
  let sectionHeaders = 0;
  let dateOnly = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const ne = nonEmptyByRow[i]!;
    if (ne.length === 0) continue;
    if (ne.length !== modalWidth) ragged += 1;
    if (rows[i]!.some((c) => PAGE_NOISE_RE.test((c ?? '').trim()))) pageNoise += 1;
    if (ne.length === 1) {
      sectionHeaders += 1;
      if (isDateLike(ne[0]!)) dateOnly += 1;
    }
  }

  // Repeated header rows: the same texty header line appears more than once.
  const headerCounts = new Map<string, number>();
  for (const ne of nonEmptyByRow) {
    if (ne.length === modalWidth && isTextyHeaderRow(ne)) {
      const key = normalizeRow(ne);
      headerCounts.set(key, (headerCounts.get(key) ?? 0) + 1);
    }
  }
  let repeatedHeaderRowCount = 0;
  for (const c of headerCounts.values()) if (c >= 2) repeatedHeaderRowCount += c - 1;

  // Is some column position mostly bare times? Use modal-width rows only.
  const modalRows = rows.filter((r) => r.map((c) => (c ?? '').trim()).filter(Boolean).length === modalWidth);
  let timeColumnDominant = false;
  if (modalRows.length >= 3) {
    for (let col = 0; col < modalWidth; col += 1) {
      let times = 0;
      let filled = 0;
      for (const r of modalRows) {
        // Re-derive the col-th non-empty cell to tolerate leading blank columns.
        const ne = r.map((c) => (c ?? '').trim()).filter(Boolean);
        const v = ne[col];
        if (!v) continue;
        filled += 1;
        if (TIME_RE.test(v)) times += 1;
      }
      if (filled >= 3 && times / filled >= 0.6) {
        timeColumnDominant = true;
        break;
      }
    }
  }

  const raggedRowFraction = ragged / contentRows;
  const sectionHeaderRowFraction = sectionHeaders / contentRows;

  const reasons: string[] = [];
  let score = 0;

  if (repeatedHeaderRowCount >= 2) {
    reasons.push('the column-heading row repeats on each page');
    score += 0.5;
  }
  if (pageNoise >= 1 && sectionHeaderRowFraction > 0.05) {
    reasons.push('it contains page markers and section-header rows');
    score += 0.3;
  }
  if (raggedRowFraction > 0.25 && sectionHeaderRowFraction > 0.1) {
    reasons.push('rows have inconsistent column counts with interleaved headings');
    score += 0.3;
  }
  if (dateOnly >= 2 && timeColumnDominant) {
    reasons.push('dates appear as section headings with times listed beneath them');
    score += 0.5;
  }

  const isIrregular = reasons.length > 0 && score >= 0.4;

  return {
    isIrregular,
    score: Math.min(1, score),
    reasons,
    signals: {
      contentRows,
      modalWidth,
      raggedRowFraction: Math.round(raggedRowFraction * 100) / 100,
      repeatedHeaderRowCount,
      pageNoiseRowCount: pageNoise,
      sectionHeaderRowFraction: Math.round(sectionHeaderRowFraction * 100) / 100,
      dateOnlyRowCount: dateOnly,
      timeColumnDominant,
    },
  };
}
