/**
 * Is a booking's start covered by a venue-wide closure the owner actually made?
 *
 * Written for reminder suppression (SA-M2). An owner closes a day, and the
 * comms cron keeps texting guests reminders for appointments that are not
 * happening, because nothing in the comms path reads a closure table.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `resolveVenueWideAllowedMinuteRanges`.
 *
 * That resolver answers "may a guest book here", and returns `closed` for TWO
 * different situations: an explicit closure block, and a weekday whose weekly
 * opening hours have no periods at all. `isWeeklyScheduleClosedForDate` exists
 * in that same file precisely because the distinction has been needed before.
 *
 * For reminders the two are opposites. Staff may deliberately book outside
 * opening hours, and the shipped help article promises exactly that (SA-H5):
 * the 17:15 client when the salon shuts at 17:00, or a Monday appointment at a
 * venue that normally closes Mondays. Those bookings are real, the guest is
 * coming, and suppressing their reminder would be a worse bug than the one
 * being fixed here. Only a closure the owner deliberately created means
 * "this is not happening".
 *
 * So this reads the blocks and never the weekly schedule.
 *
 * ---------------------------------------------------------------------------
 * WHY THE START TIME AND NOT THE WHOLE BOOKING WINDOW.
 *
 * A booking that begins while the venue is open and runs past a closure
 * boundary is the SA-H5 override again, seen from the other end. Testing the
 * whole window for overlap would suppress precisely those. If the venue is
 * open when the guest is due to arrive, the guest gets their reminder.
 */

import { timeToMinutes } from '@/lib/availability';
import type { AvailabilityBlock } from '@/types/availability';

/** `HH:mm` or `HH:mm:ss` (or null) to minutes since midnight, or null. */
function timeStringToMinutes(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const hm = raw.trim().slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(hm)) return null;
  return timeToMinutes(hm);
}

/**
 * True when `startHhMm` on `dateStr` falls inside a venue-wide closure.
 *
 * `blocks` are the venue's `availability_blocks` rows; rows carrying a
 * `service_id` are ignored, matching `blocksForDate`, because a per-service
 * block is not the venue closing.
 *
 * Returns FALSE when it cannot tell. A caller suppressing outbound comms on
 * this answer must fail towards sending: a reminder for a closed day is an
 * embarrassment the guest can resolve with a phone call, while a suppressed
 * reminder for a live appointment is a guest who does not turn up.
 */
export function venueClosureCoversBookingStart(params: {
  dateStr: string;
  /** Booking start, `HH:mm` or `HH:mm:ss`. */
  startHhMm: string;
  blocks: AvailabilityBlock[];
}): boolean {
  const { dateStr, startHhMm, blocks } = params;

  const startMin = timeStringToMinutes(startHhMm);
  if (startMin == null) return false;

  const dayBlocks = blocks.filter(
    (b) =>
      b.service_id == null &&
      typeof b.date_start === 'string' &&
      typeof b.date_end === 'string' &&
      dateStr >= b.date_start &&
      dateStr <= b.date_end,
  );
  if (dayBlocks.length === 0) return false;

  const closedLike = dayBlocks.filter(
    (b) => b.block_type === 'closed' || b.block_type === 'special_event',
  );

  for (const b of closedLike) {
    const ts = timeStringToMinutes(b.time_start);
    const te = timeStringToMinutes(b.time_end);

    // A closure with no times, or with an unusable pair, is the whole day. That
    // matches how the booking engine widens part-day closures (SA-M1): the
    // owner is told in the UI that a closure applies to the whole day, so a
    // reminder must not survive one.
    if (ts == null || te == null || te <= ts) return true;

    if (startMin >= ts && startMin < te) return true;
  }

  /**
   * Amended hours REPLACE the day for this purpose: the owner has stated the
   * window the venue is open, so a start outside it is not happening. Note this
   * is only reached when no closure above already matched.
   *
   * Multiple amended blocks union, matching `unionAmendedPeriods`. An amended
   * block with no usable periods is ignored rather than treated as a closure,
   * because an empty override is a data problem and not a statement that the
   * venue is shut.
   */
  const amendedRanges: Array<{ start: number; end: number }> = [];
  for (const b of dayBlocks) {
    if (b.block_type !== 'amended_hours') continue;
    const periods = Array.isArray(b.override_periods) ? b.override_periods : [];
    for (const p of periods) {
      const open = timeStringToMinutes((p as { open?: string | null })?.open);
      const close = timeStringToMinutes((p as { close?: string | null })?.close);
      if (open != null && close != null && close > open) {
        amendedRanges.push({ start: open, end: close });
      }
    }
  }

  if (amendedRanges.length > 0) {
    return !amendedRanges.some((r) => startMin >= r.start && startMin < r.end);
  }

  return false;
}
