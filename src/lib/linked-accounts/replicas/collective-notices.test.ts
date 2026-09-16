/**
 * Telling venues what the host did (UX spec §4, notices N8, N11, N14, N32).
 *
 * The guards are about what a venue reads and what it must never read: its own calendars named in
 * its own notice, the bookings a removal leaves behind counted honestly, and not one client detail
 * in the notice the host gets about a member's booking (D34).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

const notifyVenue = vi.fn(async () => ({ emailFailures: 0 }));
vi.mock('@/lib/linked-accounts/notifications', () => ({ notifyVenue: (...args: unknown[]) => notifyVenue(...(args as [])) }));

import {
  notifyServiceOffered,
  notifyHostCalendarChange,
  notifyCalendarValuesChanged,
  notifyCollectivePageBooking,
  describeCalendarValue,
  joinNames,
  noticeNames,
} from './collective-notices';

const COLLECTIVE = 'collective-1';
const HOST = 'venue-host';
const MEMBER = 'venue-member';

beforeEach(() => {
  notifyVenue.mockClear();
});

describe('notifyServiceOffered (N8)', () => {
  it('rings every member and never the host, with no email', async () => {
    const recording = makeRecordingDb();
    await notifyServiceOffered(recording.db as unknown as SupabaseClient, {
      memberVenueIds: [MEMBER, 'venue-other', HOST],
      collectiveId: COLLECTIVE,
      collectiveName: 'Northside',
      hostVenueId: HOST,
      hostVenueName: 'Host Venue',
      serviceName: 'Facial',
    });
    const bells = recording.calls.filter((c) => c.table === 'account_link_notifications');
    expect(bells.map((c) => (c.payload as { venue_id: string }).venue_id)).toEqual([MEMBER, 'venue-other']);
    expect((bells[0].payload as { payload: { title: string } }).payload.title).toBe(
      'Host Venue added Facial to Northside',
    );
    expect(notifyVenue).not.toHaveBeenCalled();
  });
});

describe('notifyHostCalendarChange (N11)', () => {
  it('names the calendars in one notice, not one notice each', async () => {
    const recording = makeRecordingDb();
    await notifyHostCalendarChange(recording.db as unknown as SupabaseClient, {
      memberVenueId: MEMBER,
      collectiveId: COLLECTIVE,
      collectiveName: 'Northside',
      hostVenueName: 'Host Venue',
      serviceName: 'Facial',
      calendarNames: ['Chair 2', 'Room 1'],
      action: 'assign',
    });
    expect(notifyVenue).toHaveBeenCalledTimes(1);
    const [, venueId, subject] = notifyVenue.mock.calls[0] as unknown as [unknown, string, string];
    expect(venueId).toBe(MEMBER);
    expect(subject).toBe('Host Venue added Chair 2 and Room 1 to Facial');
  });

  it('says how many bookings a removal leaves behind', async () => {
    const recording = makeRecordingDb();
    await notifyHostCalendarChange(recording.db as unknown as SupabaseClient, {
      memberVenueId: MEMBER,
      collectiveId: COLLECTIVE,
      collectiveName: 'Northside',
      hostVenueName: 'Host Venue',
      serviceName: 'Facial',
      calendarNames: ['Chair 2'],
      action: 'unassign',
      keptBookings: 3,
    });
    const [, , subject, params] = notifyVenue.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      { paragraphs: string[] },
    ];
    expect(subject).toBe('Host Venue took Chair 2 off Facial');
    expect(params.paragraphs[0]).toContain('3 upcoming bookings stay as they are');
  });

  it('says nothing when no calendar changed', async () => {
    const recording = makeRecordingDb();
    await notifyHostCalendarChange(recording.db as unknown as SupabaseClient, {
      memberVenueId: MEMBER,
      collectiveId: COLLECTIVE,
      collectiveName: 'Northside',
      hostVenueName: 'Host Venue',
      serviceName: 'Facial',
      calendarNames: [],
      action: 'assign',
    });
    expect(notifyVenue).not.toHaveBeenCalled();
  });
});

describe('notifyCalendarValuesChanged (N14)', () => {
  it("names the calendar's own new values", async () => {
    const recording = makeRecordingDb();
    await notifyCalendarValuesChanged(recording.db as unknown as SupabaseClient, {
      memberVenueId: MEMBER,
      collectiveId: COLLECTIVE,
      hostVenueName: 'Host Venue',
      calendarName: 'Chair 2',
      serviceName: 'Facial',
      fields: ['price'],
      value: '£70.00',
    });
    const [, , subject, params] = notifyVenue.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      { paragraphs: string[] },
    ];
    expect(subject).toBe("Host Venue changed Chair 2's price for Facial");
    expect(params.paragraphs[0]).toBe('Chair 2 now uses £70.00 for Facial.');
  });
});

describe('describeCalendarValue', () => {
  it('reads money as money, minutes as minutes, and a cleared value as the standard one', () => {
    expect(describeCalendarValue('custom_price_pence', 7000, '£')).toBe('£70.00');
    expect(describeCalendarValue('custom_deposit_pence', 500, '€')).toBe('€5.00');
    expect(describeCalendarValue('custom_duration_minutes', 45, '£')).toBe('45 min');
    expect(describeCalendarValue('custom_price_pence', null, '£')).toBe('the standard value');
  });
});

describe('notifyCollectivePageBooking (N32)', () => {
  it('tells the host a booking happened and nothing about the client', async () => {
    const recording = makeRecordingDb();
    await notifyCollectivePageBooking(recording.db as unknown as SupabaseClient, {
      hostVenueId: HOST,
      collectiveId: COLLECTIVE,
      memberVenueId: MEMBER,
      memberVenueName: 'Zen Studio',
      collectiveName: 'Northside',
      serviceName: 'Facial',
      calendarName: 'Chair 2',
      date: '12 June',
    });
    const bell = recording.calls.find((c) => c.table === 'account_link_notifications');
    const payload = bell?.payload as { venue_id: string; payload: { title: string; body: string } };
    expect(payload.venue_id).toBe(HOST);
    expect(payload.payload.title).toBe('New booking with Zen Studio on the Northside page');
    expect(payload.payload.body).toBe(
      "A guest booked Facial with Chair 2 at Zen Studio for 12 June. Zen Studio holds the booking and the client's details.",
    );
    // A bell, never an email: a busy page would otherwise email the host all day.
    expect(notifyVenue).not.toHaveBeenCalled();
  });
});

describe('noticeNames', () => {
  it('reads the service name from the offering and the calendars by id', async () => {
    const recording = makeRecordingDb((call) => {
      if (call.table === 'collective_service_items') {
        return { data: { master_service_id: 'svc-1', service_items: { name: 'Facial' } } };
      }
      if (call.table === 'unified_calendars') return { data: [{ id: 'cal-1', name: 'Chair 2' }] };
      return undefined;
    });
    const names = await noticeNames(recording.db as unknown as SupabaseClient, {
      itemId: 'item-1',
      calendarIds: ['cal-1'],
    });
    expect(names.serviceName).toBe('Facial');
    expect(names.calendarName('cal-1')).toBe('Chair 2');
    expect(names.calendarName('cal-missing')).toBe('A calendar');
  });
});

describe('joinNames', () => {
  it('reads as a sentence', () => {
    expect(joinNames(['Chair 2'])).toBe('Chair 2');
    expect(joinNames(['Chair 2', 'Room 1'])).toBe('Chair 2 and Room 1');
    expect(joinNames(['Chair 2', 'Room 1', 'Studio'])).toBe('Chair 2, Room 1 and Studio');
  });
});
