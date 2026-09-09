import { describe, expect, it } from 'vitest';
import {
  visitCommsAnchorIds,
  visitPostVisitAnchorIds,
  visitSiblingIdsOf,
  type VisitCommsAnchorRow,
  type VisitPostVisitRow,
} from '@/lib/cron/visit-comms-anchor';

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

  it('reminds once per DAY for a visit that spans days, and thanks once from the last day', () => {
    // Each service keeps its own date, so a visit split across two days is two
    // appointments to remind about: each day's reminder is timed off that day's
    // earliest service. The thank-you follows the visit's last service only.
    const dayTwoEarly = row({ id: 'day-two', booking_date: '2026-08-26', booking_time: '08:00:00' });
    const dayTwoLate = row({ id: 'day-two-late', booking_date: '2026-08-26', booking_time: '10:00:00' });
    expect([...visitCommsAnchorIds([dayTwoLate, dayTwoEarly, blowDry, foils], 'earliest')].sort()).toEqual([
      'day-two',
      'foils',
    ]);
    expect([...visitCommsAnchorIds([dayTwoLate, dayTwoEarly, blowDry, foils], 'latest')]).toEqual([
      'day-two-late',
    ]);
  });

  it('compares the date before the time when picking the last service', () => {
    const dayTwoEarly = row({ id: 'day-two', booking_date: '2026-08-26', booking_time: '08:00:00' });
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

describe('visitPostVisitAnchorIds', () => {
  const done = (over: Partial<VisitPostVisitRow> & { id: string }): VisitPostVisitRow => ({
    ...row(over),
    status: 'Completed',
    ...over,
  });
  const colour = done({ id: 'colour', booking_time: '09:00:00' });
  const cut = done({ id: 'cut', booking_time: '11:30:00' });

  it('sends from the last service once every service of the visit is Completed', () => {
    const visit = [colour, cut];
    expect([...visitPostVisitAnchorIds(visit, visit)]).toEqual(['cut']);
  });

  it('does not send while a later service is still in progress, however many are Completed', () => {
    // The colour finished and the cut is still on: the window's Completed rows say
    // "colour", the visit says "not over yet".
    const started = { ...cut, status: 'Seated' };
    expect(visitPostVisitAnchorIds([colour], [colour, started]).size).toBe(0);
  });

  it('the first-completed service never sends on its own hour, so the visit cannot send twice', () => {
    // 24h after the colour's start the cut is Completed too, but the colour is not the
    // last service: nothing sends from it. The cut sends at its own hour.
    expect(visitPostVisitAnchorIds([colour], [colour, cut]).size).toBe(0);
    expect([...visitPostVisitAnchorIds([cut], [colour, cut])]).toEqual(['cut']);
  });

  it('a cancelled or no-show service neither holds the visit back nor sends', () => {
    const cancelled = { ...cut, status: 'Cancelled' };
    expect([...visitPostVisitAnchorIds([colour], [colour, cancelled])]).toEqual(['colour']);
    const noShow = { ...cut, status: 'No-Show' };
    expect([...visitPostVisitAnchorIds([colour, noShow], [colour, noShow])]).toEqual(['colour']);
  });

  it('a visit that spans days sends once, from the last day', () => {
    const dayTwo = done({ id: 'day-two', booking_date: '2026-08-26', booking_time: '08:00:00' });
    expect(visitPostVisitAnchorIds([colour, cut], [colour, cut, dayTwo]).size).toBe(0);
    expect([...visitPostVisitAnchorIds([dayTwo], [colour, cut, dayTwo])]).toEqual(['day-two']);
  });

  it('leaves an ordinary single booking as its own anchor', () => {
    const solo = done({ id: 'solo', group_booking_id: null });
    expect([...visitPostVisitAnchorIds([solo], [])]).toEqual(['solo']);
  });

  it('lists every row of the visit for the log check', () => {
    expect(visitSiblingIdsOf(cut, [colour, cut]).sort()).toEqual(['colour', 'cut']);
    expect(visitSiblingIdsOf(done({ id: 'solo', group_booking_id: null }), [])).toEqual(['solo']);
  });
});
