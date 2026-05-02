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
