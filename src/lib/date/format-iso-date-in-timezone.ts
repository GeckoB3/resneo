/**
 * Calendar date string yyyy-mm-dd for `instant` in IANA `timeZone`.
 * Uses Intl so SSR (Node) and the browser agree for the same inputs.
 */
export function formatIsoDateInTimeZone(instant: Date, timeZone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = dtf.formatToParts(instant);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fall through */
  }
  return instant.toISOString().slice(0, 10);
}
