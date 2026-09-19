import type { ReportGrain } from '@/lib/reports/report-periods';

/** Shared by the Reports tabs that pick a range with chips (Revenue, New bookings). */

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function formatDayLabel(ymd: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(parseYmd(ymd));
  } catch {
    return ymd;
  }
}

/** The row label for a period, sized to the grain. */
export function periodLabel(start: string, end: string, grain: ReportGrain): string {
  if (grain === 'day') return formatDayLabel(start, { weekday: 'short', day: 'numeric', month: 'short' });
  if (grain === 'month' && start.slice(0, 7) === end.slice(0, 7) && start.endsWith('-01')) {
    const monthEnd = parseYmd(start);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    monthEnd.setUTCDate(0);
    if (monthEnd.toISOString().slice(0, 10) === end) {
      return formatDayLabel(start, { month: 'long', year: 'numeric' });
    }
  }
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const from = formatDayLabel(start, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  const to = formatDayLabel(end, { day: 'numeric', month: 'short', year: 'numeric' });
  return start === end ? to : `${from} to ${to}`;
}

export function shortChartLabel(start: string, grain: ReportGrain): string {
  if (grain === 'month') return formatDayLabel(start, { month: 'short', year: '2-digit' });
  return formatDayLabel(start, { day: 'numeric', month: 'short' });
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const chipClass = (active: boolean) =>
  `rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
    active ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
  }`;
