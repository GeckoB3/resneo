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

function groupKey(row: VisitCommsAnchorRow): string | null {
  if (!row.group_booking_id) return null;
  return `${row.group_booking_id}::${row.guest_id ?? ''}`;
}

/**
 * The ids that should send, one per group. `pick` chooses which row of a group carries it:
 * 'earliest' for a reminder, 'latest' for a post-visit message.
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
    const group = groupKey(row);
    if (group === null) continue;
    const key = startKey(row);
    const current = chosen.get(group);
    const wins =
      current === undefined || (pick === 'earliest' ? key < current.key : key > current.key);
    if (wins) chosen.set(group, { id: row.id, key });
  }

  const anchors = new Set<string>();
  for (const row of rows) {
    const group = groupKey(row);
    if (group === null || chosen.get(group)?.id === row.id) anchors.add(row.id);
  }
  return anchors;
}
