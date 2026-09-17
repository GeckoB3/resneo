/**
 * The day a collective notice or banner names, as a UK venue reads it: "15 October". Shared by the
 * notices the cron sends and the pages that show the same dates, so the two never disagree.
 */
export function noticeDate(iso: string | null | undefined): string {
  if (!iso) return 'soon';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' });
}
