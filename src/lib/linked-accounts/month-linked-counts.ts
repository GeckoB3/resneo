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
  }>;
}

/**
 * Count linked bookings per ISO date for visible linked columns only.
 * Never merged into native month totals — surfaced as a separate marker.
 */
export function linkedBookingCountByDate(
  visibleColumns: MonthLinkedCountColumn[],
  venues: MonthLinkedCountVenue[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const col of visibleColumns) {
    const venue = venues.find((v) => v.venueId === col.venueId);
    if (!venue) continue;
    for (const b of venue.bookings) {
      if (!b.practitionerId || b.practitionerId !== col.practitionerId) continue;
      if (b.status === 'Cancelled') continue;
      out[b.bookingDate] = (out[b.bookingDate] ?? 0) + 1;
    }
  }
  return out;
}
