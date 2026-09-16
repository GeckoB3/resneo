/**
 * DIARY-02 (D47): two calendars that look like one person warn whoever books second, and only then.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/collective-staff-scope', () => ({
  findStaffCollectiveForVenue: vi.fn(),
  eligibleMemberVenueIds: vi.fn(async () => ['zen', 'bloom']),
}));

import { findStaffCollectiveForVenue } from '@/lib/linked-accounts/collective-staff-scope';
import { findSamePersonClash, normalisePersonName } from './same-person';

interface World {
  otherName?: string;
  otherEmail?: string;
  otherStaff?: string | null;
  otherBooking?: { time: string; end: string | null; status?: string } | null;
}

function world({
  otherName = 'Sam  Smith.',
  otherEmail = 'SAM@x.test',
  otherStaff = 'staff-b',
  otherBooking = { time: '10:00:00', end: '10:30:00' },
}: World = {}): Responder {
  return (call) => {
    if (call.table === 'unified_calendars') {
      const single = call.filters.some((f) => f[0] === 'eq' && f[1] === 'id');
      if (single) return { data: { id: 'cal-a', name: 'Sam Smith', staff_id: 'staff-a', venue_id: 'zen' } };
      return { data: [{ id: 'cal-b', name: otherName, staff_id: otherStaff, venue_id: 'bloom' }] };
    }
    if (call.table === 'staff') {
      return { data: [{ id: 'staff-a', email: 'sam@x.test' }, { id: 'staff-b', email: otherEmail }] };
    }
    if (call.table === 'bookings') {
      return {
        data: otherBooking
          ? [
              {
                id: 'bk-other',
                calendar_id: 'cal-b',
                booking_time: otherBooking.time,
                booking_end_time: otherBooking.end,
                status: otherBooking.status ?? 'Booked',
              },
            ]
          : [],
      };
    }
    if (call.table === 'venues') return { data: [{ id: 'zen', name: 'Zen Studio' }, { id: 'bloom', name: 'Bloom' }] };
    return undefined;
  };
}

const check = async (w: World = {}, when = { start: '10:15:00', end: '10:45:00' }) => {
  const recording = makeRecordingDb(world(w));
  const clash = await findSamePersonClash(recording.db as unknown as SupabaseClient, {
    venueId: 'zen',
    calendarId: 'cal-a',
    date: '2026-10-10',
    startTime: when.start,
    endTime: when.end,
    bookingId: 'bk-new',
  });
  return { clash, calls: recording.calls };
};

beforeEach(() => {
  vi.mocked(findStaffCollectiveForVenue).mockResolvedValue({
    collectiveId: 'c-1',
    name: 'Northside',
    hostVenueId: 'zen',
    memberVenueIds: ['zen', 'bloom'],
  } as never);
});

describe('normalisePersonName', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(normalisePersonName('  Sam  Smith. ')).toBe(normalisePersonName('sam smith'));
  });
});

describe('findSamePersonClash', () => {
  it('warns whoever books second, naming calendars and venues but no guest', async () => {
    const { clash, calls } = await check();
    expect(clash).toEqual({
      code: 'COLLECTIVE_SAME_PERSON',
      message:
        'Sam Smith at Zen Studio looks like the same person as Sam  Smith. at Bloom, who already has a booking at this time.',
    });
    expect(calls.every((c) => c.op === 'select')).toBe(true);
    const bookingsRead = calls.find((c) => c.table === 'bookings')!;
    expect(bookingsRead.columns).not.toMatch(/guest/);
  });

  it('stays quiet when the emails differ, or a calendar has no staff login', async () => {
    expect((await check({ otherEmail: 'other@x.test' })).clash).toBeNull();
    expect((await check({ otherStaff: null })).clash).toBeNull();
  });

  it('stays quiet when the names differ, or the other booking does not overlap', async () => {
    expect((await check({ otherName: 'Sam Jones' })).clash).toBeNull();
    expect((await check({ otherBooking: { time: '11:00:00', end: '11:30:00' } })).clash).toBeNull();
    expect((await check({ otherBooking: null })).clash).toBeNull();
  });

  it('stays quiet outside a live collective', async () => {
    vi.mocked(findStaffCollectiveForVenue).mockResolvedValue(null);
    const { clash, calls } = await check();
    expect(clash).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('never compares calendars at the same venue', async () => {
    const { calls } = await check();
    const candidates = calls.find((c) => c.table === 'unified_calendars' && c.filters.some((f) => f[0] === 'in'))!;
    expect(candidates.filters).toContainEqual(['in', 'venue_id', ['bloom']]);
  });
});
