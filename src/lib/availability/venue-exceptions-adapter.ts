import type { AvailabilityBlock } from '@/types/availability';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';

/**
 * Legacy `venues.venue_opening_exceptions` JSON, converted INTO `availability_blocks` rows.
 *
 * This adapter used to run the other way, turning blocks into the exception shape so the
 * appointment engine could keep its own minute-range logic. That direction was lossy in
 * both of the ways the resolver plan calls defects: it discarded `time_start`/`time_end` on
 * a closure, so a part-day closure removed the whole appointment day, and it dropped an
 * amended row with no periods, so the same row meant "open" to appointments and "shut" to
 * everything else.
 *
 * Now every consumer resolves through `resolveVenueWideAllowedMinuteRanges`, so the legacy
 * JSON is converted up to the canonical shape instead. Q9 (2026-08-17) found no venue
 * carrying any, but `PATCH /api/venue/venue-opening-exceptions` can still write one, so the
 * escape hatch stays until §1.3 tier 1's prerequisites are met.
 */
export function venueOpeningExceptionsToBlocks(
  exceptions: VenueOpeningException[] | null | undefined,
  venueId: string,
): AvailabilityBlock[] {
  if (!Array.isArray(exceptions) || exceptions.length === 0) return [];
  return exceptions.map((ex, i) => ({
    id: ex.id ?? `legacy-${i}`,
    venue_id: venueId,
    service_id: null,
    block_type: ex.closed ? 'closed' : 'amended_hours',
    date_start: ex.date_start,
    date_end: ex.date_end,
    // The legacy shape has no part-day closure concept: `closed` always meant the whole day.
    time_start: null,
    time_end: null,
    override_max_covers: null,
    reason: ex.reason ?? null,
    yield_overrides: null,
    override_periods: ex.closed ? null : (ex.periods ?? null),
  })) as unknown as AvailabilityBlock[];
}
