/**
 * Closure-aware reminder suppression (SA-M2).
 *
 * Closing a day has no consequence chain: no customer notification, no bulk
 * cancel, and the comms cron keeps firing. Nothing in the comms path reads a
 * closure table, so an owner who shuts for a bank holiday, a funeral or a burst
 * pipe still has every guest texted a reminder for an appointment that is not
 * happening. The guests then arrive at a locked door, which is the same failure
 * §9 uses to describe why none of this is visible in production.
 *
 * This is the missing read. It is deliberately narrow: it answers "did the
 * owner close the venue over this booking's start", and nothing else.
 *
 * ---------------------------------------------------------------------------
 * IT FAILS TOWARDS SENDING, ON PURPOSE.
 *
 * Every other fail-open read in this subsystem is a defect (SA-C3, 49 of them).
 * This one is not, and the asymmetry is worth stating so nobody "fixes" it:
 *
 *   * A reminder sent for a closed day is an embarrassment. The guest rings the
 *     venue and finds out.
 *   * A reminder withheld from a live appointment is a guest who does not turn
 *     up, a practitioner sitting idle, and quite possibly a no-show fee.
 *
 * So a failed read means send. It is still REPORTED, through the same channel
 * as every other fail-open availability read, because "we could not tell" is
 * worth knowing even when the chosen default is the safe one.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityBlock } from '@/types/availability';
import {
  rowsToVenueWideBlocks,
  venueWideBlocksQueryForRange,
} from '@/lib/availability/venue-wide-blocks-fetch';
import { reportAvailabilityReadFailure } from '@/lib/availability/availability-read-failure';
import { venueClosureCoversBookingStart } from '@/lib/calendar/venue-closure-covers-booking';

/**
 * Venue-wide closure blocks covering `dates`, as one query.
 *
 * The comms cron already narrows to one or two civil dates per lane
 * (`bookingCivilDatesForReminderWindow`), so this is a single round trip per
 * venue per lane rather than one per booking.
 *
 * Returns `[]` when the read fails, which means "nothing is closed" and
 * therefore "send". See the header.
 */
export async function fetchVenueClosureBlocksForDates(
  supabase: SupabaseClient,
  venueId: string,
  dates: string[],
): Promise<AvailabilityBlock[]> {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const from = sorted[0]!;
  const to = sorted[sorted.length - 1]!;

  const { data, error } = await venueWideBlocksQueryForRange(supabase, venueId, from, to);

  if (error) {
    reportAvailabilityReadFailure(
      {
        source: 'fetchVenueClosureBlocksForDates',
        table: 'availability_blocks (reminder suppression)',
        assumed: 'the venue has no closures, so reminders send as normal',
        venueId,
        date: from === to ? from : `${from}..${to}`,
      },
      error,
    );
    return [];
  }

  return rowsToVenueWideBlocks(data);
}

/**
 * Should this booking's reminder be withheld because the venue is closed over
 * its start?
 *
 * Thin by design: the decision lives in `venueClosureCoversBookingStart`, which
 * is pure and unit-tested, including the cases it must NOT suppress (staff
 * booking past closing time, per SA-H5).
 */
export function reminderSuppressedByClosure(params: {
  bookingDate: string;
  bookingTime: string;
  blocks: AvailabilityBlock[];
}): boolean {
  if (params.blocks.length === 0) return false;
  return venueClosureCoversBookingStart({
    dateStr: params.bookingDate,
    startHhMm: params.bookingTime,
    blocks: params.blocks,
  });
}
