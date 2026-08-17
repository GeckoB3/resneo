/**
 * Load venue-wide `availability_blocks` rows (closures / amended hours / special_event)
 * for intersection with a date or inclusive date range.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import { reportAvailabilityReadFailure } from '@/lib/availability/availability-read-failure';

export const VENUE_WIDE_BLOCK_SELECT =
  'id, venue_id, service_id, block_type, date_start, date_end, time_start, time_end, override_max_covers, reason, yield_overrides, override_periods';

/** Venue-wide blocks overlapping `date` (inclusive). */
export function venueWideBlocksQueryForDate(
  supabase: SupabaseClient,
  venueId: string,
  date: string,
) {
  return supabase
    .from('availability_blocks')
    .select(VENUE_WIDE_BLOCK_SELECT)
    .eq('venue_id', venueId)
    .is('service_id', null)
    .in('block_type', ['closed', 'amended_hours', 'special_event'])
    .lte('date_start', date)
    .gte('date_end', date);
}

/** Venue-wide blocks overlapping `[fromDate, toDate]` (inclusive). */
export function venueWideBlocksQueryForRange(
  supabase: SupabaseClient,
  venueId: string,
  fromDate: string,
  toDate: string,
) {
  return supabase
    .from('availability_blocks')
    .select(VENUE_WIDE_BLOCK_SELECT)
    .eq('venue_id', venueId)
    .is('service_id', null)
    .in('block_type', ['closed', 'amended_hours', 'special_event'])
    .lte('date_start', toDate)
    .gte('date_end', fromDate);
}

export function rowsToVenueWideBlocks(rows: unknown): AvailabilityBlock[] {
  return (rows ?? []) as AvailabilityBlock[];
}

/** Opening hours plus venue-wide blocks overlapping `date` (for server-side booking guards). */
export async function fetchVenueOpeningHoursAndWideBlocksForDate(
  supabase: SupabaseClient,
  venueId: string,
  date: string,
): Promise<{ openingHours: OpeningHours | null; blocks: AvailabilityBlock[] }> {
  const [{ data: venueRow, error: venueErr }, { data: blockRows, error: blockErr }] = await Promise.all([
    supabase.from('venues').select('opening_hours').eq('id', venueId).maybeSingle(),
    venueWideBlocksQueryForDate(supabase, venueId, date),
  ]);
  // This is the fetcher behind booking/create's venue gate, so a silent failure here
  // does not merely widen a listing: it lets a booking through on a closed day.
  if (venueErr) {
    reportAvailabilityReadFailure(
      {
        source: 'fetchVenueOpeningHoursAndWideBlocksForDate',
        table: 'venues',
        assumed: 'the venue has no weekly opening hours, so no weekly boundary applies',
        venueId,
        date,
      },
      venueErr,
    );
  }
  if (blockErr) {
    reportAvailabilityReadFailure(
      {
        source: 'fetchVenueOpeningHoursAndWideBlocksForDate',
        table: 'availability_blocks',
        assumed: 'the venue has no closures or amended hours on this date, so the window is accepted',
        venueId,
        date,
      },
      blockErr,
    );
  }
  return {
    openingHours: (venueRow?.opening_hours as OpeningHours | null) ?? null,
    blocks: rowsToVenueWideBlocks(blockRows),
  };
}
