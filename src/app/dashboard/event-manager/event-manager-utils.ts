export function escapeCsvCell(s: string | number | null | undefined): string {
  const v = s == null ? '' : String(s);
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function downloadCsvFile(filename: string, csvContent: string): void {
  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * `event_date` (and custom-date / weekly material\u00ADisation) limit, mirrored from
 * `lib/scheduling/cde-scheduling-rules.ts`. Kept here so the editor's date-chip
 * preview matches what the POST route will actually create without importing a
 * server module into a client component.
 */
export const MAX_EVENT_OCCURRENCES = 104;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real, well-formed calendar date in `YYYY-MM-DD` form. The old
 * editor accepted anything matching the regex, so `2026-13-40` slipped through
 * to the server. We round-trip through `Date.UTC` and re-serialise to reject
 * impossible months/days (the parser would otherwise roll `2026-13-01` over to
 * `2027-01-01`).
 */
export function isValidIsoDate(value: string): boolean {
  const s = value.trim();
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d
  );
}

/** Today in the browser's local zone as `YYYY-MM-DD` (for past-date rejection in the picker). */
export function localTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Deduplicate + sort ISO dates, keeping only valid (real-calendar) ones. */
export function normaliseEventDates(dates: string[]): string[] {
  const set = new Set<string>();
  for (const raw of dates) {
    const s = raw.trim();
    if (isValidIsoDate(s)) set.add(s);
  }
  return [...set].sort();
}

/**
 * Weekly occurrences from `start` through `until` (inclusive), same weekday as
 * `start`, capped at {@link MAX_EVENT_OCCURRENCES}. Mirrors
 * `expandWeeklyOccurrences` server-side so the "N dates will be created" preview
 * is accurate. Returns `[]` for invalid input or an end before the start.
 */
export function previewWeeklyOccurrences(start: string, until: string): string[] {
  if (!isValidIsoDate(start) || !isValidIsoDate(until)) return [];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [uy, um, ud] = until.split('-').map(Number);
  const startMs = Date.UTC(sy!, sm! - 1, sd!);
  const endMs = Date.UTC(uy!, um! - 1, ud!);
  if (endMs < startMs) return [];
  const out: string[] = [];
  for (let d = new Date(startMs); d.getTime() <= endMs; d.setUTCDate(d.getUTCDate() + 7)) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length >= MAX_EVENT_OCCURRENCES) break;
  }
  return out;
}

export interface EventTierAnalytics {
  ticket_type_id: string | null;
  label: string;
  quantity: number;
  revenue_pence: number;
}

export interface EventAnalytics {
  /** Tickets sold per tier (revenue-bearing rows only \u2014 Cancelled/No-show excluded). */
  tiers: EventTierAnalytics[];
  /** \u03A3 ticket quantities across counted bookings. */
  ticketsSold: number;
  /** \u03A3 (quantity \u00D7 unit_price_pence) across counted bookings. */
  revenuePence: number;
  /** \u03A3 party_size across counted bookings (capacity consumed). */
  seatsTaken: number;
  capacity: number;
  /** 0\u2013100, clamped; null when capacity is 0. */
  fillPercent: number | null;
}

/** Booking statuses that should NOT count toward sold/revenue/fill analytics. */
function isCountedAttendeeStatus(status: string | null | undefined): boolean {
  const s = (status ?? '').toLowerCase();
  return !(s.includes('cancel') || s.includes('no-show') || s.includes('no show') || s.includes('noshow'));
}

/**
 * Per-event analytics from the attendee roster: tickets sold by tier, revenue and
 * fill %. Cancelled / No-show bookings are excluded so the numbers match money
 * actually taken and seats actually held. Tier rows are keyed by the ticket line
 * label (the roster does not expose `ticket_type_id` per line); event-level
 * `tierNames` seeds zero-sale tiers so they still render.
 */
export function computeEventAnalytics(
  attendees: ReadonlyArray<{
    status: string | null;
    party_size: number;
    ticket_lines?: ReadonlyArray<{ label: string; quantity: number; unit_price_pence: number }>;
  }>,
  opts: { capacity: number; tierNames?: ReadonlyArray<string> },
): EventAnalytics {
  const tierMap = new Map<string, EventTierAnalytics>();
  // Seed declared tiers so a tier with no sales still shows as "0 sold".
  for (const name of opts.tierNames ?? []) {
    if (!tierMap.has(name)) {
      tierMap.set(name, { ticket_type_id: null, label: name, quantity: 0, revenue_pence: 0 });
    }
  }

  let ticketsSold = 0;
  let revenuePence = 0;
  let seatsTaken = 0;

  for (const a of attendees) {
    if (!isCountedAttendeeStatus(a.status)) continue;
    seatsTaken += a.party_size ?? 0;
    for (const line of a.ticket_lines ?? []) {
      const label = line.label || 'Ticket';
      const qty = line.quantity ?? 0;
      const rev = qty * (line.unit_price_pence ?? 0);
      ticketsSold += qty;
      revenuePence += rev;
      const existing = tierMap.get(label);
      if (existing) {
        existing.quantity += qty;
        existing.revenue_pence += rev;
      } else {
        tierMap.set(label, { ticket_type_id: null, label, quantity: qty, revenue_pence: rev });
      }
    }
  }

  const tiers = [...tierMap.values()].sort(
    (a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label),
  );
  const fillPercent =
    opts.capacity > 0 ? Math.min(100, Math.round((seatsTaken / opts.capacity) * 100)) : null;

  return { tiers, ticketsSold, revenuePence, seatsTaken, capacity: opts.capacity, fillPercent };
}
