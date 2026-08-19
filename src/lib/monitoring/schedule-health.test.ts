import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkScheduleHealth, computeMirrorDrift, type LeaveRowForHealth } from '@/lib/monitoring/schedule-health';

/**
 * The invariant this check exists to run, tested exhaustively without a database.
 *
 * It is the thing being trusted: if it reports healthy while the tables have drifted, the
 * monitoring is worse than none, because it converts an unknown into a false assurance.
 */

const CALS = new Set(['v1:cal-1', 'v1:cal-2']);

function leave(partial: Partial<LeaveRowForHealth> & { id: string }): LeaveRowForHealth {
  return {
    venue_id: 'v1',
    practitioner_id: 'cal-1',
    unavailable_start_time: null,
    unavailable_end_time: null,
    ...partial,
  };
}

describe('computeMirrorDrift', () => {
  it('is healthy when every leave row has a mirror row', () => {
    const r = computeMirrorDrift({
      leaveRows: [leave({ id: 'l1' }), leave({ id: 'l2' })],
      mirrorSourceLeaveIds: ['l1', 'l2'],
      calendarKeys: CALS,
    });

    expect(r.healthy).toBe(true);
    expect(r.leaveWithoutMirror).toEqual([]);
    expect(r.orphanMirrorRows).toEqual([]);
  });

  it('is healthy with nothing at all', () => {
    expect(computeMirrorDrift({ leaveRows: [], mirrorSourceLeaveIds: [], calendarKeys: CALS }).healthy).toBe(true);
  });

  /** The `[R3-82]` case: a row created in the seam between backfill and dual-write. */
  it('reports a leave row with no mirror row', () => {
    const r = computeMirrorDrift({
      leaveRows: [leave({ id: 'l1' }), leave({ id: 'l2' })],
      mirrorSourceLeaveIds: ['l1'],
      calendarKeys: CALS,
    });

    expect(r.healthy).toBe(false);
    expect(r.leaveWithoutMirror).toEqual(['l2']);
  });

  it('reports a mirror row whose leave row is gone, which means a delete did not propagate', () => {
    const r = computeMirrorDrift({
      leaveRows: [leave({ id: 'l1' })],
      mirrorSourceLeaveIds: ['l1', 'l-deleted'],
      calendarKeys: CALS,
    });

    expect(r.healthy).toBe(false);
    expect(r.orphanMirrorRows).toEqual(['l-deleted']);
  });

  /**
   * EQUAL COUNTS, BROKEN SYSTEM. This is why the check compares ids rather than sizes:
   * one row never mirrored and one mirror left orphaned net to the same totals.
   */
  it('catches drift that leaves the row counts identical', () => {
    const r = computeMirrorDrift({
      leaveRows: [leave({ id: 'l1' }), leave({ id: 'l2' })],
      mirrorSourceLeaveIds: ['l1', 'l-deleted'],
      calendarKeys: CALS,
    });

    expect(r.leaveRows).toBe(r.mirrorRows);
    expect(r.healthy).toBe(false);
    expect(r.leaveWithoutMirror).toEqual(['l2']);
    expect(r.orphanMirrorRows).toEqual(['l-deleted']);
  });

  describe('rows that cannot be mirrored are reported, not alerted on', () => {
    it('treats a leave row whose calendar does not exist as unmirrorable', () => {
      const r = computeMirrorDrift({
        leaveRows: [leave({ id: 'l1', practitioner_id: 'cal-missing' })],
        mirrorSourceLeaveIds: [],
        calendarKeys: CALS,
      });

      expect(r.healthy).toBe(true);
      expect(r.leaveWithoutMirror).toEqual([]);
      expect(r.unmirrorable).toEqual([{ id: 'l1', reason: 'no-calendar' }]);
    });

    it('treats a null calendar as unmirrorable', () => {
      const r = computeMirrorDrift({
        leaveRows: [leave({ id: 'l1', practitioner_id: null })],
        mirrorSourceLeaveIds: [],
        calendarKeys: CALS,
      });

      expect(r.healthy).toBe(true);
      expect(r.unmirrorable).toEqual([{ id: 'l1', reason: 'no-calendar' }]);
    });

    it('matches the calendar on venue AND id, as the migration join does', () => {
      const r = computeMirrorDrift({
        // Right calendar id, wrong venue.
        leaveRows: [leave({ id: 'l1', venue_id: 'v2', practitioner_id: 'cal-1' })],
        mirrorSourceLeaveIds: [],
        calendarKeys: CALS,
      });

      expect(r.unmirrorable).toEqual([{ id: 'l1', reason: 'no-calendar' }]);
    });

    it('treats an inverted time pair as unmirrorable, matching the backfill predicate', () => {
      const r = computeMirrorDrift({
        leaveRows: [leave({ id: 'l1', unavailable_start_time: '15:00', unavailable_end_time: '13:00' })],
        mirrorSourceLeaveIds: [],
        calendarKeys: CALS,
      });

      expect(r.healthy).toBe(true);
      expect(r.unmirrorable).toEqual([{ id: 'l1', reason: 'invalid-time-pair' }]);
    });

    it('treats an equal time pair as unmirrorable, since the CHECK requires end > start', () => {
      const r = computeMirrorDrift({
        leaveRows: [leave({ id: 'l1', unavailable_start_time: '13:00', unavailable_end_time: '13:00' })],
        mirrorSourceLeaveIds: [],
        calendarKeys: CALS,
      });

      expect(r.unmirrorable).toEqual([{ id: 'l1', reason: 'invalid-time-pair' }]);
    });

    it('treats a half-set time pair as unmirrorable', () => {
      const r = computeMirrorDrift({
        leaveRows: [leave({ id: 'l1', unavailable_start_time: '13:00', unavailable_end_time: null })],
        mirrorSourceLeaveIds: [],
        calendarKeys: CALS,
      });

      expect(r.unmirrorable).toEqual([{ id: 'l1', reason: 'invalid-time-pair' }]);
    });

    /** A valid partial-day window is perfectly mirrorable and must still be required. */
    it('still requires a mirror for a valid partial-day window', () => {
      const r = computeMirrorDrift({
        leaveRows: [leave({ id: 'l1', unavailable_start_time: '13:00', unavailable_end_time: '15:00' })],
        mirrorSourceLeaveIds: [],
        calendarKeys: CALS,
      });

      expect(r.healthy).toBe(false);
      expect(r.leaveWithoutMirror).toEqual(['l1']);
    });

    /** An unmirrorable row that somehow HAS a mirror is fine, not an orphan. */
    it('does not flag an unmirrorable row that was mirrored anyway', () => {
      const r = computeMirrorDrift({
        leaveRows: [leave({ id: 'l1', practitioner_id: 'cal-missing' })],
        mirrorSourceLeaveIds: ['l1'],
        calendarKeys: CALS,
      });

      expect(r.healthy).toBe(true);
      expect(r.unmirrorable).toEqual([]);
    });
  });
});

describe('checkScheduleHealth refuses to answer rather than answering wrongly', () => {
  function client(results: Record<string, { data: unknown[] | null; error: { message: string } | null }>) {
    return {
      from(table: string) {
        const res = results[table] ?? { data: [], error: null };
        const chain = {
          select: () => chain,
          not: () => chain,
          then: (resolve: (v: unknown) => unknown) => Promise.resolve(res).then(resolve),
        };
        return chain;
      },
    } as unknown as SupabaseClient;
  }

  const OK = { data: [], error: null };

  /**
   * The property that makes this monitoring rather than decoration. A failed read would
   * otherwise substitute an empty set, and an empty set looks exactly like a clean system:
   * "I could not read the leave table" would be reported as "nothing has drifted". That is
   * the same fail-open shape SA-C3 describes for the availability engine, and it is worse
   * here, because the whole point of the check is to be believed.
   */
  it('reports null drift and the failing table when a read fails', async () => {
    const res = await checkScheduleHealth(
      client({
        practitioner_leave_periods: { data: null, error: { message: 'timeout' } },
        calendar_date_overrides: OK,
        unified_calendars: OK,
      }),
    );

    expect(res.drift).toBeNull();
    expect(res.readErrors).toEqual(['practitioner_leave_periods: timeout']);
  });

  it('names every failing table, not just the first', async () => {
    const res = await checkScheduleHealth(
      client({
        practitioner_leave_periods: { data: null, error: { message: 'a' } },
        calendar_date_overrides: { data: null, error: { message: 'b' } },
        unified_calendars: OK,
      }),
    );

    expect(res.readErrors).toHaveLength(2);
    expect(res.drift).toBeNull();
  });

  it('computes drift normally when every read succeeds', async () => {
    const res = await checkScheduleHealth(
      client({
        practitioner_leave_periods: {
          data: [{ id: 'l1', venue_id: 'v1', practitioner_id: 'cal-1', unavailable_start_time: null, unavailable_end_time: null }],
          error: null,
        },
        calendar_date_overrides: { data: [{ source_leave_id: 'l1' }], error: null },
        unified_calendars: { data: [{ id: 'cal-1', venue_id: 'v1' }], error: null },
      }),
    );

    expect(res.readErrors).toEqual([]);
    expect(res.drift?.healthy).toBe(true);
    expect(res.drift?.leaveRows).toBe(1);
  });
});
