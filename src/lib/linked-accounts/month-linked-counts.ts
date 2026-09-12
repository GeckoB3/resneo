/** Month-grid linked booking counts (§8.2) — kept pure for tests. */

export interface MonthLinkedCountColumn {
  venueId: string;
  practitionerId: string;
}

export interface MonthLinkedCountVenue {
  venueId: string;
  bookings: Array<{
    practitionerId: string | null;
    bookingDate: string;
    status: string;
    /** Shared by the services of one visit, or the people of one party (with `personLabel`). */
    groupBookingId?: string | null;
    personLabel?: string | null;
    classInstanceId?: string | null;
  }>;
}

/**
 * Count linked bookings per ISO date for visible linked columns only.
 * Never merged into native month totals — surfaced as a separate marker.
 *
 * A multi-service visit counts once per day, even when its services sit on two visible
 * columns, as native appointments do (R36). A party's people and a class cart's sessions
 * still count one by one.
 */
export function linkedBookingCountByDate(
  visibleColumns: MonthLinkedCountColumn[],
  venues: MonthLinkedCountVenue[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const countedVisits = new Set<string>();
  for (const col of visibleColumns) {
    const venue = venues.find((v) => v.venueId === col.venueId);
    if (!venue) continue;
    for (const b of venue.bookings) {
      if (!b.practitionerId || b.practitionerId !== col.practitionerId) continue;
      if (b.status === 'Cancelled') continue;
      const groupId = b.groupBookingId?.trim();
      if (groupId && !b.personLabel?.trim() && !b.classInstanceId) {
        const visitKey = `${venue.venueId}|${groupId}|${b.bookingDate}`;
        if (countedVisits.has(visitKey)) continue;
        countedVisits.add(visitKey);
      }
      out[b.bookingDate] = (out[b.bookingDate] ?? 0) + 1;
    }
  }
  return out;
}
