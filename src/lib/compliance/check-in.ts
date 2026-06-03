/**
 * Reception "check-in / today" grouping (improvement plan Phase 3, gap G5).
 *
 * Pure transform over the dashboard's `missing_for_bookings` rows: keep only
 * today's bookings, group their outstanding required forms by booking, de-dupe by
 * compliance type, and order them so the soonest bookings (and hardest blocks)
 * surface first. Kept side-effect-free so it can be unit-tested directly.
 */

/** A single outstanding required form on a booking (subset of the dashboard row). */
export interface CheckInMissingRow {
  booking_id: string;
  guest_id: string | null;
  guest_name: string;
  booking_date: string;
  booking_time: string | null;
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  state: string;
}

export interface CheckInItem {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  state: string;
}

export interface CheckInGroup {
  booking_id: string;
  guest_id: string | null;
  guest_name: string;
  booking_time: string | null;
  items: CheckInItem[];
}

/** Blocking requirements (can stop the visit) sort ahead of advisory ones. */
function isBlocking(enforcement: string): boolean {
  return enforcement === 'block_online' || enforcement === 'block_all';
}

/**
 * Filter `missing` to bookings on `todayStr` (YYYY-MM-DD) and group by booking.
 * Items are de-duplicated per compliance type (blocking variant wins) and sorted
 * blocking-first then alphabetically; groups are sorted by booking time (nulls last).
 */
export function groupTodaysCheckIns(missing: CheckInMissingRow[], todayStr: string): CheckInGroup[] {
  const byBooking = new Map<string, CheckInGroup>();

  for (const row of missing) {
    if (row.booking_date !== todayStr) continue;

    let group = byBooking.get(row.booking_id);
    if (!group) {
      group = {
        booking_id: row.booking_id,
        guest_id: row.guest_id,
        guest_name: row.guest_name,
        booking_time: row.booking_time,
        items: [],
      };
      byBooking.set(row.booking_id, group);
    }

    const existing = group.items.find((i) => i.compliance_type_id === row.compliance_type_id);
    if (existing) {
      // Same type required twice (e.g. two services) — keep the harder enforcement.
      if (isBlocking(row.enforcement) && !isBlocking(existing.enforcement)) {
        existing.enforcement = row.enforcement;
      }
      continue;
    }
    group.items.push({
      compliance_type_id: row.compliance_type_id,
      compliance_type_name: row.compliance_type_name,
      enforcement: row.enforcement,
      state: row.state,
    });
  }

  const groups = [...byBooking.values()];

  for (const g of groups) {
    g.items.sort((a, b) => {
      const blockDelta = Number(isBlocking(b.enforcement)) - Number(isBlocking(a.enforcement));
      if (blockDelta !== 0) return blockDelta;
      return a.compliance_type_name.localeCompare(b.compliance_type_name);
    });
  }

  groups.sort((a, b) => {
    if (a.booking_time && b.booking_time) return a.booking_time.localeCompare(b.booking_time);
    if (a.booking_time) return -1; // timed bookings before untimed
    if (b.booking_time) return 1;
    return a.guest_name.localeCompare(b.guest_name);
  });

  return groups;
}
