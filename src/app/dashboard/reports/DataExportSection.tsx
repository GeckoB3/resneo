'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { chipClass } from './report-format';

/**
 * Export your data (Settings → Reports → Overview, at the bottom).
 *
 * Three choices and one button: what to export (appointments, clients or services), which
 * dates, and which file type (CSV, Excel spreadsheet or PDF). The page counts what the choice
 * covers before anyone downloads, so the button always says what it will give you, and a range
 * with nothing in it says so instead of producing an empty file.
 *
 * The files come from `GET /api/venue/export` and carry every detail ResNeo holds for each row,
 * so a business can move to another system or keep a full backup.
 */

export type ExportKind = 'bookings' | 'contacts' | 'services';
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export type ExportRangePreset = 'all' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom';

export interface DataExportSectionProps {
  /** Shown after a download starts or when the export is refused (an API error, say). */
  onExportFlash?: (variant: 'success' | 'notice', message: string) => void;
  /** Model B: tailor copy to appointments / clients. */
  isAppointment?: boolean;
  clientLabel?: string;
  bookingWord?: string;
}

const PRESETS: Array<{ id: ExportRangePreset; label: string }> = [
  { id: 'all', label: 'All time' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
  { id: 'last_year', label: 'Last year' },
  { id: 'custom', label: 'Custom dates' },
];

const FORMATS: Array<{ id: ExportFormat; label: string; hint: string }> = [
  { id: 'csv', label: 'CSV', hint: 'Opens in Excel, Numbers and Google Sheets, and imports into most other systems.' },
  { id: 'xlsx', label: 'Excel spreadsheet', hint: 'A formatted .xlsx workbook with money as numbers, ready to sort and filter.' },
  { id: 'pdf', label: 'PDF', hint: 'For reading or printing. To move your data somewhere else, use CSV or Excel.' },
];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The dates a preset covers, on the local calendar, both ends included. Null means all time. */
export function presetRange(preset: ExportRangePreset, today = new Date()): { from: string; to: string } | null {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case 'this_month':
      return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
    case 'last_month':
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case 'this_year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'last_year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return null;
  }
}

/** The name the server gave the file, from Content-Disposition, or a fallback. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match?.[1] ? decodeURIComponent(match[1]) : fallback;
}

const fetchCount = async (url: string): Promise<{ count: number }> => {
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as { count?: number; error?: string };
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not count the records.');
  return { count: typeof body.count === 'number' ? body.count : 0 };
};

export function DataExportSection({
  onExportFlash,
  isAppointment = false,
  clientLabel = 'Guest',
  bookingWord = 'Booking',
}: DataExportSectionProps) {
  const [kind, setKind] = useState<ExportKind>('bookings');
  const [preset, setPreset] = useState<ExportRangePreset>('all');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [downloading, setDownloading] = useState(false);

  const bookingsPlural = `${bookingWord}s`;
  const clientsPlural = `${clientLabel}s`;

  const kinds: Array<{ id: ExportKind; label: string; hint: string; rangeHint: string }> = [
    {
      id: 'bookings',
      label: bookingsPlural,
      hint: `Every ${bookingWord.toLowerCase()} with its date and time, service, calendar and staff, ${clientLabel.toLowerCase()} details, price, payments and deposit, notes, and who booked or cancelled it.`,
      rangeHint: `${bookingsPlural} are chosen by their ${bookingWord.toLowerCase()} date.`,
    },
    {
      id: 'contacts',
      label: clientsPlural,
      hint: `Every ${clientLabel.toLowerCase()} with their contact details and address, tags, marketing consent, notes, visit history and deposits paid, plus any custom fields you have added.`,
      rangeHint: `${clientsPlural} are chosen by the day they were added to your contacts.`,
    },
    {
      id: 'services',
      label: 'Services',
      hint: 'Every service with its category, duration, price and deposit, options, add-ons, which calendars offer it, booking rules and instructions.',
      rangeHint: 'Services are chosen by the day they were added.',
    },
  ];
  const kindMeta = kinds.find((k) => k.id === kind) ?? kinds[0]!;

  const range = useMemo(() => {
    if (preset !== 'custom') return presetRange(preset);
    if (!custom.from || !custom.to) return undefined;
    if (custom.from > custom.to) return undefined;
    return custom;
  }, [preset, custom]);
  const customInvalid = preset === 'custom' && custom.from !== '' && custom.to !== '' && custom.from > custom.to;

  const query = useMemo(() => {
    if (range === undefined) return null;
    const params = new URLSearchParams({ type: kind });
    if (range) {
      params.set('from', range.from);
      params.set('to', range.to);
    }
    return params;
  }, [kind, range]);

  const { data: counted, error: countError, isLoading: counting } = useSWR(
    query ? `/api/venue/export?${query.toString()}&count=1` : null,
    fetchCount,
    { revalidateOnFocus: false },
  );
  const count = counted?.count;

  const noun = kindMeta.label.toLowerCase();
  const singular = noun.replace(/s$/, '');
  const countLine =
    query === null
      ? preset === 'custom' && customInvalid
        ? 'The From date must be on or before the To date.'
        : 'Choose a From and a To date.'
      : counting
        ? 'Counting...'
        : countError
          ? 'Could not count the records. You can still download.'
          : count === 0
            ? `No ${noun} ${range ? 'in these dates' : 'yet'}.`
            : count === 1
              ? `1 ${singular} ${range ? 'in these dates' : 'in total'}.`
              : `${(count ?? 0).toLocaleString('en-GB')} ${noun} ${range ? 'in these dates' : 'in total'}.`;

  const formatLabel = FORMATS.find((f) => f.id === format)?.label ?? 'CSV';
  const canDownload = query !== null && !downloading && count !== 0;

  async function handleDownload() {
    if (!query) return;
    setDownloading(true);
    try {
      const params = new URLSearchParams(query);
      params.set('format', format);
      const res = await fetch(`/api/venue/export?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = typeof body.error === 'string' ? body.error : 'Export failed. Please try again.';
        if (onExportFlash) onExportFlash('notice', msg);
        else alert(msg);
        return;
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(
        res.headers.get('Content-Disposition'),
        `${noun}-${new Date().toISOString().slice(0, 10)}.${format}`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onExportFlash?.('success', `Your ${noun} ${formatLabel} is downloading. Check your downloads folder.`);
    } catch {
      const msg = 'Export failed. Please check your connection and try again.';
      if (onExportFlash) onExportFlash('notice', msg);
      else alert(msg);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Data"
        title="Export your data"
        description={
          isAppointment ? (
            <>
              Take a copy of everything ResNeo holds for your venue: your {bookingsPlural.toLowerCase()}, your{' '}
              {clientsPlural.toLowerCase()} and your services. Choose what to export, which dates, and the file type.
              Every file includes the full details, so you can move to another system or keep a backup at any time.
            </>
          ) : (
            <>
              Take a copy of everything ResNeo holds for your venue: your bookings, your guests and your services.
              Choose what to export, which dates, and the file type. Every file includes the full details, so you can
              move to another system or keep a backup at any time.
            </>
          )
        }
      />
      <SectionCard.Body className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">1. What to export</legend>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="What to export">
            {kinds.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={kind === k.id}
                className={chipClass(kind === k.id)}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">{kindMeta.hint}</p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">2. Which dates</legend>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Which dates">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={preset === p.id}
                className={chipClass(preset === p.id)}
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' ? (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-600">From</span>
                <input
                  type="date"
                  value={custom.from}
                  max={custom.to || undefined}
                  onChange={(e) => setCustom((r) => ({ ...r, from: e.target.value }))}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-600">To</span>
                <input
                  type="date"
                  value={custom.to}
                  min={custom.from || undefined}
                  onChange={(e) => setCustom((r) => ({ ...r, to: e.target.value }))}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm"
                />
              </label>
            </div>
          ) : null}
          <p className="text-xs text-slate-500">
            {kindMeta.rangeHint} {preset === 'all' ? 'All time gives you everything.' : ''}
          </p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">3. File type</legend>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="File type">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={format === f.id}
                className={chipClass(format === f.id)}
                onClick={() => setFormat(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">{FORMATS.find((f) => f.id === format)?.hint}</p>
        </fieldset>
      </SectionCard.Body>
      <SectionCard.Footer>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600" aria-live="polite" data-testid="export-count">
            {countLine}
          </p>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={!canDownload}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {downloading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
            ) : (
              <DownloadIcon className="h-4 w-4" />
            )}
            {downloading ? 'Preparing your file...' : `Download ${noun} as ${formatLabel}`}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Files are built from your venue&apos;s data at the moment you click. Times are shown in your venue&apos;s time
          zone. Admins only.
        </p>
      </SectionCard.Footer>
    </SectionCard>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}
