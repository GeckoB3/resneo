import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ExportCell, ExportRange, ExportTable, ExportVenue } from './venue-data-export';

/**
 * The three file types the export offers, all built from the same {@link ExportTable}.
 *
 * - CSV: UTF-8 with a byte-order mark, so Excel opens £ and accented names correctly, CRLF lines.
 * - Spreadsheet (.xlsx): one sheet, a header row, money columns as numbers, sensible widths.
 * - PDF: landscape A4, a title block naming the venue and the range, the table split across
 *   pages sideways as well as downwards so no column is ever dropped, page numbers.
 */

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['csv', 'xlsx', 'pdf'];

export function isExportFormat(value: string | null | undefined): value is ExportFormat {
  return value === 'csv' || value === 'xlsx' || value === 'pdf';
}

export interface ExportFile {
  body: Uint8Array;
  contentType: string;
  filename: string;
}

export interface ExportFileMeta {
  venue: ExportVenue;
  range: ExportRange | null;
  /** When the file was built, for the PDF's title block and the file name. */
  now?: Date;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function escapeCsvCell(value: ExportCell | undefined): string {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function tableToCsv(table: ExportTable): string {
  const lines = [table.headers.map(escapeCsvCell).join(',')];
  for (const row of table.rows) lines.push(row.map(escapeCsvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}`;
}

// ─── Spreadsheet ──────────────────────────────────────────────────────────────

export function tableToXlsx(table: ExportTable): Uint8Array {
  const aoa: ExportCell[][] = [table.headers, ...table.rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // Money as numbers with two decimals; everything else as it came.
  const money = new Set(table.moneyColumns);
  for (let r = 1; r <= table.rows.length; r += 1) {
    for (const c of money) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[ref];
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';
    }
  }
  sheet['!cols'] = table.headers.map((h, c) => {
    let width = h.length;
    for (const row of table.rows.slice(0, 200)) {
      const v = row[c];
      if (v != null) width = Math.max(width, Math.min(60, String(v).length));
    }
    return { wch: Math.max(8, width + 2) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, table.title.slice(0, 31));
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

const NAVY: [number, number, number] = [0, 59, 111];

function rangeSentence(range: ExportRange | null, what: string): string {
  if (!range) return `Every ${what.toLowerCase()} held at the time of export.`;
  return `${range.from} to ${range.to}, both days included.`;
}

export function tableToPdf(table: ExportTable, meta: ExportFileMeta): Uint8Array {
  const now = meta.now ?? new Date();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 32;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...NAVY);
  doc.text(`${meta.venue.name}: ${table.title}`, margin, 40);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  const rowWord = table.rows.length === 1 ? table.title.replace(/s$/, '') : table.title;
  doc.text(
    `${table.rows.length.toLocaleString('en-GB')} ${rowWord.toLowerCase()}. ${rangeSentence(meta.range, table.title)}`,
    margin,
    56,
  );
  doc.text(`Exported from ResNeo on ${now.toISOString().slice(0, 10)}. Times are in ${meta.venue.timeZone}.`, margin, 68);

  if (table.rows.length === 0) {
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    doc.text('Nothing to show for this range.', margin, 100);
  } else {
    autoTable(doc, {
      head: [table.headers],
      body: table.rows.map((row) => row.map((cell) => (cell == null ? '' : typeof cell === 'number' ? formatNumber(cell) : cell))),
      startY: 84,
      margin: { left: margin, right: margin, top: 40, bottom: 36 },
      styles: { fontSize: 6.5, cellPadding: 2.5, overflow: 'linebreak', valign: 'top', textColor: [30, 30, 30] },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: Object.fromEntries(table.headers.map((_, i) => [i, { cellWidth: 'wrap' as const, minCellWidth: 40 }])),
      horizontalPageBreak: true,
      horizontalPageBreakRepeat: 0,
      horizontalPageBreakBehaviour: 'immediately',
      tableWidth: 'auto',
    });
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Page ${p} of ${pages}`, pageWidth - margin, pageHeight - 16, { align: 'right' });
    doc.text(`${meta.venue.name}: ${table.title}`, margin, pageHeight - 16);
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

// ─── Files ────────────────────────────────────────────────────────────────────

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function exportFilename(table: ExportTable, format: ExportFormat, meta: ExportFileMeta): string {
  const now = meta.now ?? new Date();
  const when = meta.range ? `${meta.range.from}-to-${meta.range.to}` : `all-time-${now.toISOString().slice(0, 10)}`;
  return `${slug(meta.venue.name) || 'resneo'}-${slug(table.title)}-${when}.${format}`;
}

export function writeExportFile(table: ExportTable, format: ExportFormat, meta: ExportFileMeta): ExportFile {
  const filename = exportFilename(table, format, meta);
  switch (format) {
    case 'csv':
      return { body: new TextEncoder().encode(tableToCsv(table)), contentType: 'text/csv; charset=utf-8', filename };
    case 'xlsx':
      return {
        body: tableToXlsx(table),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename,
      };
    case 'pdf':
      return { body: tableToPdf(table, meta), contentType: 'application/pdf', filename };
  }
}
