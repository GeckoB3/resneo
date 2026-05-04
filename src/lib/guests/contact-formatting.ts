import { formatDistanceToNowStrict, parseISO } from 'date-fns';

export function formatRelativeVisitDate(isoDate: string | null): string {
  if (!isoDate) return '—';
  try {
    const d = parseISO(`${isoDate}T12:00:00`);
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return isoDate;
  }
}

/** Short label for an upcoming booking date/time (e.g. Today 14:30). */
export function formatNextBookingSummary(
  date: string | null | undefined,
  time: string | null | undefined,
): string | null {
  if (!date) return null;
  try {
    const d = new Date(`${date}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    let dayStr: string;
    if (d.toDateString() === today.toDateString()) {
      dayStr = 'Today';
    } else if (d.toDateString() === tomorrow.toDateString()) {
      dayStr = 'Tomorrow';
    } else {
      dayStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    }
    const timeStr = time ? time.slice(0, 5) : null;
    return timeStr ? `${dayStr} ${timeStr}` : dayStr;
  } catch {
    return null;
  }
}

export function formatCalendarDayShort(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
