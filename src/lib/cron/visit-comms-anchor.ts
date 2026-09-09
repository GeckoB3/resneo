/**
 * One scheduled email per visit, not one per service.
 *
 * A multi-service visit is several `bookings` rows sharing a `group_booking_id` and one
 * guest. The cron comms loops walk rows, and the dedupe log is keyed on booking id, so a
 * two-service visit sent the guest two reminders, hours apart, each listing both services
 * (the email itself lists every sibling, see `enrichBookingEmailForAppointment`).
 *
 * These helpers pick the single row each group sends from, so the send lands once, at the
 * right moment: the earliest row for a reminder (the visit STARTS then) and the latest for
 * a post-visit thank-you (the visit ENDS then).
 *
 * Grouped by guest as well as by group, because that is exactly the set the email lists.
 * A group booking made for several people shares one guest today, but keying on the guest
 * means a group that ever spans guests still reminds each of them rather than silently
 * dropping all but one.
 *
 * A reminder is also keyed on the DAY. Each service of a visit keeps its own date
 * (Docs/visit-services-independent-plan.md), so a visit whose colour is on Tuesday and
 * whose cut is on Thursday is two appointments to remind about: one reminder per day,
 * timed off that day's earliest service. The thank-you stays one per visit, from its
 * last service.
 *
 * Appointments only. A CDE group (a class cart, say) can span sessions on different days
 * and its email names only its own session, so those still send per row.
 */

export interface VisitCommsAnchorRow {
  id: string;
  guest_id?: string | null;
  group_booking_id?: string | null;
  booking_date: string;
  booking_time: string | null;
}

/** Sortable start key, with the id as a stable tiebreak for services starting together. */
function startKey(row: VisitCommsAnchorRow): string {
  return `${row.booking_date}T${(row.booking_time ?? '').slice(0, 8)}#${row.id}`;
}

function groupKey(row: VisitCommsAnchorRow, pick: 'earliest' | 'latest'): string | null {
  if (!row.group_booking_id) return null;
  const day = pick === 'earliest' ? `::${row.booking_date}` : '';
  return `${row.group_booking_id}::${row.guest_id ?? ''}${day}`;
}

/**
 * The ids that should send, one per group. `pick` chooses which row of a group carries it:
 * 'earliest' for a reminder (one per group AND day), 'latest' for a post-visit message
 * (one per group).
 *
 * A row with no `group_booking_id` is its own group and is always included, so an ordinary
 * single-service booking is unaffected.
 */
export function visitCommsAnchorIds(
  rows: readonly VisitCommsAnchorRow[],
  pick: 'earliest' | 'latest',
): Set<string> {
  const chosen = new Map<string, { id: string; key: string }>();
  for (const row of rows) {
    const group = groupKey(row, pick);
    if (group === null) continue;
    const key = startKey(row);
    const current = chosen.get(group);
    const wins =
      current === undefined || (pick === 'earliest' ? key < current.key : key > current.key);
    if (wins) chosen.set(group, { id: row.id, key });
  }

  const anchors = new Set<string>();
  for (const row of rows) {
    const group = groupKey(row, pick);
    if (group === null || chosen.get(group)?.id === row.id) anchors.add(row.id);
  }
  return anchors;
}

/** Outcomes that take a service out of the visit for good. */
const TERMINAL_STATUSES = new Set(['Cancelled', 'No-Show']);

export interface VisitPostVisitRow extends VisitCommsAnchorRow {
  status: string;
}

/**
 * The rows that should send a post-visit thank-you, one per visit, and only once
 * the WHOLE visit is over.
 *
 * Services are completed one at a time now (Docs/visit-services-independent-plan.md),
 * so at the thank-you's hour the cron may find the colour Completed while the cut is
 * still Started. Anchoring on "the latest Completed row" sent the thank-you then, and
 * again once the cut was completed and became the latest Completed row on its own
 * later hour. This looks at every live service of the visit instead:
 *
 *  - a visit sends only when every live service is Completed (cancelled and no-show
 *    services do not hold it back);
 *  - the row that sends is the visit's LAST live service, whose own time the hour is
 *    counted from;
 *  - a row with no group is its own visit, as before.
 *
 * `candidates` are the Completed rows the cron found in its window; `visitRows` are
 * every row of those candidates' groups, whatever their status or date.
 */
export function visitPostVisitAnchorIds(
  candidates: readonly VisitCommsAnchorRow[],
  visitRows: readonly VisitPostVisitRow[],
): Set<string> {
  const byGroup = new Map<string, VisitPostVisitRow[]>();
  for (const row of visitRows) {
    const group = groupKey(row, 'latest');
    if (group === null) continue;
    const list = byGroup.get(group) ?? [];
    list.push(row);
    byGroup.set(group, list);
  }
  const anchors = new Set<string>();
  for (const row of candidates) {
    const group = groupKey(row, 'latest');
    if (group === null) {
      anchors.add(row.id);
      continue;
    }
    const live = (byGroup.get(group) ?? []).filter((r) => !TERMINAL_STATUSES.has(r.status));
    if (live.length === 0 || live.some((r) => r.status !== 'Completed')) continue;
    const last = live.reduce((best, r) => (startKey(r) > startKey(best) ? r : best));
    if (last.id === row.id) anchors.add(row.id);
  }
  return anchors;
}

/** Every row id of the visit a candidate belongs to, so one send can be checked against all of them. */
export function visitSiblingIdsOf(
  row: VisitCommsAnchorRow,
  visitRows: readonly VisitPostVisitRow[],
): string[] {
  const group = groupKey(row, 'latest');
  if (group === null) return [row.id];
  const ids = visitRows.filter((r) => groupKey(r, 'latest') === group).map((r) => r.id);
  return ids.includes(row.id) ? ids : [...ids, row.id];
}
