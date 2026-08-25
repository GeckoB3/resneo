import { describe, expect, it } from 'vitest';
import { visitCommsAnchorIds, type VisitCommsAnchorRow } from '@/lib/cron/visit-comms-anchor';

/**
 * A two-service visit used to get two reminders, hours apart, each listing both services:
 * the cron loops walk booking rows and the dedupe log is keyed on booking id. These pick
 * the one row per visit that sends.
 */

const row = (over: Partial<VisitCommsAnchorRow> & { id: string }): VisitCommsAnchorRow => ({
  guest_id: 'g1',
  group_booking_id: 'visit-1',
  booking_date: '2026-08-25',
  booking_time: '09:00:00',
  ...over,
});

const foils = row({ id: 'foils', booking_time: '09:00:00' });
const blowDry = row({ id: 'blow-dry', booking_time: '11:30:00' });

describe('visitCommsAnchorIds', () => {
  it('reminds from the first service, so the reminder is timed off the visit start', () => {
    expect([...visitCommsAnchorIds([foils, blowDry], 'earliest')]).toEqual(['foils']);
  });

  it('thanks from the last service, so the thank-you follows the visit end', () => {
    expect([...visitCommsAnchorIds([foils, blowDry], 'latest')]).toEqual(['blow-dry']);
  });

  it('does not depend on the order the rows arrive in', () => {
    expect([...visitCommsAnchorIds([blowDry, foils], 'earliest')]).toEqual(['foils']);
    expect([...visitCommsAnchorIds([blowDry, foils], 'latest')]).toEqual(['blow-dry']);
  });

  it('leaves an ordinary single booking as its own anchor', () => {
    const solo = row({ id: 'solo', group_booking_id: null });
    expect([...visitCommsAnchorIds([solo], 'earliest')]).toEqual(['solo']);
    expect([...visitCommsAnchorIds([solo], 'latest')]).toEqual(['solo']);
  });

  it('keeps every ungrouped booking, and one row from each group', () => {
    const otherVisit = row({ id: 'other-a', group_booking_id: 'visit-2', booking_time: '14:00:00' });
    const otherVisitLater = row({ id: 'other-b', group_booking_id: 'visit-2', booking_time: '15:00:00' });
    const solo = row({ id: 'solo', group_booking_id: null, booking_time: '08:00:00' });
    const anchors = visitCommsAnchorIds([foils, blowDry, otherVisit, otherVisitLater, solo], 'earliest');
    expect([...anchors].sort()).toEqual(['foils', 'other-a', 'solo']);
  });

  it('compares the date before the time, for a group that spans days', () => {
    const dayTwoEarly = row({ id: 'day-two', booking_date: '2026-08-26', booking_time: '08:00:00' });
    expect([...visitCommsAnchorIds([dayTwoEarly, blowDry], 'earliest')]).toEqual(['blow-dry']);
    expect([...visitCommsAnchorIds([dayTwoEarly, blowDry], 'latest')]).toEqual(['day-two']);
  });

  it('reminds each guest of a group that spans guests, rather than dropping all but one', () => {
    // Group bookings share one guest today. Keying on the guest as well means that if one
    // ever did span guests, the second guest still gets their own reminder.
    const other = row({ id: 'other-guest', guest_id: 'g2', booking_time: '11:30:00' });
    expect([...visitCommsAnchorIds([foils, other], 'earliest')].sort()).toEqual(['foils', 'other-guest']);
  });

  it('picks one row deterministically when two services start at the same minute', () => {
    const parallel = row({ id: 'aaa', booking_time: '09:00:00' });
    const anchors = visitCommsAnchorIds([foils, parallel], 'earliest');
    expect(anchors.size).toBe(1);
    expect([...visitCommsAnchorIds([parallel, foils], 'earliest')]).toEqual([...anchors]);
  });

  it('tolerates a missing time rather than throwing', () => {
    const noTime = row({ id: 'no-time', booking_time: null });
    expect([...visitCommsAnchorIds([noTime, blowDry], 'earliest')]).toEqual(['no-time']);
  });

  it('returns nothing for no rows', () => {
    expect(visitCommsAnchorIds([], 'earliest').size).toBe(0);
  });
});
