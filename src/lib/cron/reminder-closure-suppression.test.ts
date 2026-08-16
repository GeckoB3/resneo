import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reminderSuppressedByClosure } from './reminder-closure-suppression';
import type { AvailabilityBlock } from '@/types/availability';

function closure(over: Partial<AvailabilityBlock> = {}): AvailabilityBlock {
  return {
    id: 'b1',
    venue_id: 'v1',
    service_id: null,
    block_type: 'closed',
    date_start: '2026-09-10',
    date_end: '2026-09-10',
    time_start: null,
    time_end: null,
    override_max_covers: null,
    reason: null,
    ...over,
  };
}

describe('reminderSuppressedByClosure', () => {
  it('suppresses a booking inside a closure', () => {
    expect(
      reminderSuppressedByClosure({
        bookingDate: '2026-09-10',
        bookingTime: '09:30:00',
        blocks: [closure()],
      }),
    ).toBe(true);
  });

  it('sends when there are no blocks at all', () => {
    expect(
      reminderSuppressedByClosure({
        bookingDate: '2026-09-10',
        bookingTime: '09:30:00',
        blocks: [],
      }),
    ).toBe(false);
  });

  /**
   * The failed-read path. `fetchVenueClosureBlocksForDates` returns `[]` when
   * the query errors, which lands here and must mean SEND. A missed reminder
   * for a live appointment is a guest who does not turn up; a needless one is a
   * phone call. This is the one fail-open in the subsystem that is deliberate.
   */
  it('sends when the closure read failed, since that also arrives as an empty list', () => {
    expect(
      reminderSuppressedByClosure({
        bookingDate: '2026-09-10',
        bookingTime: '09:30:00',
        blocks: [],
      }),
    ).toBe(false);
  });
});

/**
 * The rule above is unit-tested thoroughly in
 * `venue-closure-covers-booking.test.ts`. These assertions prove something
 * different and, on this project's recent evidence, more valuable: that the
 * three reminder loops actually APPLY it.
 *
 * SA-H3 and SA-H5 both shipped a correct rule that changed nothing a user could
 * do, because the layer that enforces never called it. A source guard is a
 * blunt instrument, but the alternative here is a full fake of the Supabase
 * query builder plus the policy, short-link, enrichment and delivery modules
 * that `runLaneReminder` pulls in, which would cost far more than it proves.
 * The same trade-off, and the same reasoning, as the bypass guard in
 * `occupying-blocks.test.ts`.
 */
describe('the reminder crons apply the rule (SA-M2)', () => {
  const UNIFIED = 'src/lib/cron/unified-scheduling-comms.ts';
  const ROUTE = 'src/app/api/cron/send-communications/route.ts';

  function read(rel: string): string {
    return readFileSync(path.join(process.cwd(), rel), 'utf8');
  }

  it('calls the check in all three reminder loops', () => {
    const unified = read(UNIFIED);
    const route = read(ROUTE);
    const calls =
      (unified.match(/reminderSuppressedByClosure\(\{/g) ?? []).length +
      (route.match(/reminderSuppressedByClosure\(\{/g) ?? []).length;
    // runLaneReminder (unified + cde share it), plus the table venues'
    // confirm/cancel and pre-visit lanes.
    expect(calls).toBe(3);
  });

  it('loads the blocks once per lane rather than once per booking', () => {
    const unified = read(UNIFIED);
    const route = read(ROUTE);
    const loads =
      (unified.match(/fetchVenueClosureBlocksForDates\(/g) ?? []).length +
      (route.match(/fetchVenueClosureBlocksForDates\(/g) ?? []).length;
    expect(loads).toBe(3);

    // A load inside the per-booking loop would be one query per booking. The
    // loads sit above `for (const`, so assert they precede the first one.
    for (const source of [unified, route]) {
      const firstLoad = source.indexOf('fetchVenueClosureBlocksForDates(');
      const firstCall = source.indexOf('reminderSuppressedByClosure({');
      expect(firstLoad).toBeGreaterThan(-1);
      expect(firstLoad).toBeLessThan(firstCall);
    }
  });

  /**
   * The subtle one, and the reason suppression is a `continue` rather than a
   * flag passed into the sender.
   *
   * The comms dedupe is keyed on `(booking_id, message_type,
   * communication_lane)` and a row marked `sent` is never retried. If the
   * suppression ran inside or after `sendPolicyMessage`, it would write that
   * row and burn the slot permanently: deleting the closure while the reminder
   * window was still open would then send nothing, silently and forever.
   *
   * Skipping before the send leaves the booking eligible, so the next cron beat
   * sends normally once the closure is gone.
   */
  it('checks before the send, so a suppressed reminder does not consume the dedupe slot', () => {
    for (const rel of [UNIFIED, ROUTE]) {
      const source = read(rel);
      let searchFrom = 0;
      let checked = 0;
      for (;;) {
        const callAt = source.indexOf('reminderSuppressedByClosure({', searchFrom);
        if (callAt === -1) break;
        const nextSendAt = source.indexOf('sendPolicyMessage(', callAt);
        expect(nextSendAt).toBeGreaterThan(callAt);
        checked++;
        searchFrom = callAt + 1;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  /**
   * Placement the other way round: the check must come AFTER the reminder
   * window match, so the query only runs for bookings actually about to be
   * reminded rather than for every row the date filter returned.
   */
  it('checks after the reminder window match', () => {
    for (const rel of [UNIFIED, ROUTE]) {
      const source = read(rel);
      let searchFrom = 0;
      let checked = 0;
      for (;;) {
        const callAt = source.indexOf('reminderSuppressedByClosure({', searchFrom);
        if (callAt === -1) break;
        // `delta` is the window match's own input and is a stable anchor; the
        // comparison itself is written differently in the two files.
        const precedingDelta = source.lastIndexOf('msUntilBookingStartUtc(', callAt);
        expect(precedingDelta).toBeGreaterThan(-1);
        checked++;
        searchFrom = callAt + 1;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });
});
