/**
 * Reception "check-in / today" grouping (improvement plan Phase 3, gap G5).
 *
 * Pure transform over the dashboard's `missing_for_bookings` rows: keep only
 * today's bookings, group their outstanding required forms by client, de-dupe by
 * compliance type, and order them so the soonest arrivals (and hardest blocks)
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
  /** The booking the form is outstanding for: a capture or a link is filed against it. */
  booking_id: string;
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  state: string;
}

export interface CheckInGroup {
  /** One card per client (their guest id), or per booking when it has no client on file. */
  key: string;
  /** The client's earliest booking today with a form outstanding. */
  booking_id: string;
  guest_id: string | null;
  guest_name: string;
  /** When the client arrives: the start of that earliest booking. */
  booking_time: string | null;
  items: CheckInItem[];
}

/** Blocking requirements (can stop the visit) sort ahead of advisory ones. */
function isBlocking(enforcement: string): boolean {
  return enforcement === 'block_online' || enforcement === 'block_all';
}

/** Timed bookings before untimed ones. */
function isEarlier(time: string | null, than: string | null): boolean {
  if (time === null) return false;
  return than === null || time < than;
}

/**
 * Filter `missing` to bookings on `todayStr` (YYYY-MM-DD) and group by client, so a
 * multi-service visit, or a client booked twice today, is one card at their arrival time.
 * Items are de-duplicated per compliance type (blocking variant wins) and sorted
 * blocking-first then alphabetically; groups are sorted by arrival time (nulls last).
 */
export function groupTodaysCheckIns(missing: CheckInMissingRow[], todayStr: string): CheckInGroup[] {
  const byClient = new Map<string, CheckInGroup>();

  for (const row of missing) {
    if (row.booking_date !== todayStr) continue;

    const key = row.guest_id ?? `booking:${row.booking_id}`;
    let group = byClient.get(key);
    if (!group) {
      group = {
        key,
        booking_id: row.booking_id,
        guest_id: row.guest_id,
        guest_name: row.guest_name,
        booking_time: row.booking_time,
        items: [],
      };
      byClient.set(key, group);
    } else if (isEarlier(row.booking_time, group.booking_time)) {
      group.booking_id = row.booking_id;
      group.booking_time = row.booking_time;
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
      booking_id: row.booking_id,
      compliance_type_id: row.compliance_type_id,
      compliance_type_name: row.compliance_type_name,
      enforcement: row.enforcement,
      state: row.state,
    });
  }

  const groups = [...byClient.values()];

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
