/**
 * DIARY-03 (D46 revised 2026-09-16): staff move a booking to a calendar at another venue of the
 * collective. Who may, that the time is free there, the client's record at the new venue, one
 * database write, one message to the client, and the refusals in words.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

type Row = Record<string, unknown>;

vi.mock('@/lib/booking/staff-booking-access', () => ({
  loadStaffAccessibleBooking: vi.fn(),
  resolveLinkedStaffCreateScope: vi.fn(async () => ({ ok: true, venueId: 'member', linked: null })),
}));
vi.mock('@/lib/linked-accounts/collective-staff-scope', () => ({ findStaffCollectiveForVenue: vi.fn() }));
vi.mock('@/lib/booking/validate-appointment-modification', () => ({
  validateAppointmentModificationInterval: vi.fn(async () => ({ ok: true, outsideHours: false })),
}));
vi.mock('@/lib/guests', () => ({ findOrCreateGuest: vi.fn(async () => ({ guest: { id: 'guest-at-member' }, created: false })) }));
vi.mock('@/lib/linked-accounts/audit', () => ({ recordCollectiveBookingAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/booking/send-booking-modification-guest-notification', () => ({
  executeBookingModificationGuestNotification: vi.fn(async () => ({ emailSent: true, smsSent: false, skipped: false })),
}));

import { loadStaffAccessibleBooking, resolveLinkedStaffCreateScope } from '@/lib/booking/staff-booking-access';
import { findStaffCollectiveForVenue } from '@/lib/linked-accounts/collective-staff-scope';
import { validateAppointmentModificationInterval } from '@/lib/booking/validate-appointment-modification';
import { findOrCreateGuest } from '@/lib/guests';
import { recordCollectiveBookingAudit } from '@/lib/linked-accounts/audit';
import { executeBookingModificationGuestNotification } from '@/lib/booking/send-booking-modification-guest-notification';
import { moveBookingToCollectiveVenue, moveRefusalWords } from './move-booking';

const staff = { id: 'staff-1', venue_id: 'host', email: 's@x.test', role: 'staff', db: {} } as never;

const booking = {
  id: 'b-1',
  venue_id: 'host',
  guest_id: 'guest-at-host',
  service_item_id: 'master-cut',
  collective_service_item_id: 'offer-cut',
  service_variant_id: null,
  booking_time: '10:00:00',
  booking_end_time: '10:45:00',
  processing_time_blocks: null,
  guest_first_name: 'Sam',
  guest_last_name: 'Guest',
  guest_email: 'sam@x.test',
  guest_phone: null,
};

function world(extra: Responder = () => undefined) {
  return makeRecordingDb((call) => {
    const injected = extra(call);
    if (injected) return injected;
    if (call.table === 'unified_calendars') return { data: { id: 'cal-zen', name: 'Ada', venue_id: 'member', is_active: true } };
    if (call.table === 'venues') {
      return { data: [{ id: 'member', name: 'Zen Studio', timezone: 'Europe/London' }, { id: 'host', name: 'Host Venue' }] };
    }
    if (call.table === 'venue_collectives') return { data: { service_model: 'replicas' } };
    if (call.table === 'collective_service_items') return { data: { id: 'offer-cut', master_service_id: 'master-cut', status: 'active' } };
    if (call.table === 'collective_service_replicas') return { data: { replica_service_id: 'replica-cut' } };
    if (call.table === 'guests') return { data: { first_name: 'Sam', last_name: 'Guest', email: 'sam@x.test', phone: '+447700900000' } };
    if (call.table === 'rpc:collective_move_booking') return { data: 'b-new' };
    return undefined;
  });
}

const move = (recording = world(), over: Partial<{ calendarId: string; bookingDate: string }> = {}) =>
  moveBookingToCollectiveVenue(recording.db as unknown as SupabaseClient, staff, 'user-1', {
    bookingId: 'b-1',
    calendarId: over.calendarId ?? 'cal-zen',
    bookingDate: over.bookingDate ?? '2031-03-04',
    bookingTime: '14:00',
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadStaffAccessibleBooking).mockResolvedValue({
    ok: true,
    ctx: { booking, ownerVenueId: 'host', isOwnVenue: true, linkedGrant: null, linkId: null },
  } as never);
  vi.mocked(findStaffCollectiveForVenue).mockResolvedValue({
    collectiveId: 'col-1',
    name: 'Northside',
    hostVenueId: 'host',
    memberVenueIds: ['host', 'member'],
  } as never);
});

describe('moveBookingToCollectiveVenue', () => {
  it('moves the booking in one write, to the member service and client, and tells the client once', async () => {
    const recording = world();
    const result = await move(recording);
    expect(result).toEqual({ ok: true, bookingId: 'b-new', venueId: 'member', venueName: 'Zen Studio', guestNotified: true });

    // The time is checked at the new venue, on its service, for the same length.
    expect(vi.mocked(validateAppointmentModificationInterval).mock.calls[0]![0]).toMatchObject({
      venueId: 'member',
      practId: 'cal-zen',
      svcId: 'replica-cut',
      newDate: '2031-03-04',
      timeStr: '14:00',
      bookingEndTime: '14:45',
    });
    expect(vi.mocked(findOrCreateGuest)).toHaveBeenCalledWith(
      expect.anything(),
      'member',
      { first_name: 'Sam', last_name: 'Guest', email: 'sam@x.test', phone: '+447700900000' },
      { silentAuthSignup: true },
    );
    expect(recording.calls.filter((c) => c.table === 'rpc:collective_move_booking').map((c) => c.payload)).toEqual([
      {
        p_booking_id: 'b-1',
        p_target_calendar_id: 'cal-zen',
        p_booking_date: '2031-03-04',
        p_booking_time: '14:00:00',
        p_target_guest_id: 'guest-at-member',
        p_actor_venue_id: 'host',
        p_actor_staff_id: 'staff-1',
      },
    ]);
    // No other booking write: the database function is the only one.
    expect(recording.calls.some((c) => c.table === 'bookings' && c.op !== 'select')).toBe(false);
    expect(vi.mocked(executeBookingModificationGuestNotification)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeBookingModificationGuestNotification)).toHaveBeenCalledWith(expect.anything(), 'member', 'b-new', {
      changeSummary: 'Your appointment is now with Ada at Zen Studio.',
    });
    expect(vi.mocked(recordCollectiveBookingAudit).mock.calls.map((c) => [c[0].owningVenueId, c[0].actionType])).toEqual([
      ['member', 'created_booking'],
      ['host', 'cancelled_booking'],
    ]);
  });

  it('says when the new venue does not send change messages', async () => {
    vi.mocked(executeBookingModificationGuestNotification).mockResolvedValueOnce({
      emailSent: false,
      smsSent: false,
      skipped: true,
    } as never);
    expect(await move()).toMatchObject({ ok: true, guestNotified: false });
  });

  it('refuses a partner booking the link does not allow cancelling', async () => {
    vi.mocked(loadStaffAccessibleBooking).mockResolvedValue({
      ok: true,
      ctx: { booking, ownerVenueId: 'member', isOwnVenue: false, linkedGrant: { act: 'edit_existing' }, linkId: 'l-1' },
    } as never);
    expect(await move()).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses venues outside the collective, and a calendar at the same venue', async () => {
    vi.mocked(findStaffCollectiveForVenue).mockResolvedValue(null);
    expect(await move()).toMatchObject({ ok: false, status: 409, code: 'COLLECTIVE_MOVE_NOT_ALLOWED' });

    vi.mocked(findStaffCollectiveForVenue).mockResolvedValue({
      collectiveId: 'col-1',
      name: 'Northside',
      hostVenueId: 'host',
      memberVenueIds: ['host', 'member'],
    } as never);
    const sameVenue = world((call) =>
      call.table === 'unified_calendars' ? { data: { id: 'cal-host', name: 'Bo', venue_id: 'host', is_active: true } } : undefined,
    );
    expect(await move(sameVenue, { calendarId: 'cal-host' })).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses without a create right at the new venue, a past date, or a taken time, writing nothing', async () => {
    vi.mocked(resolveLinkedStaffCreateScope).mockResolvedValueOnce({ ok: false, status: 403, error: 'No link' } as never);
    expect(await move()).toMatchObject({ ok: false, status: 403, error: 'No link' });

    expect(await move(world(), { bookingDate: '2020-01-01' })).toMatchObject({ ok: false, status: 400 });

    vi.mocked(validateAppointmentModificationInterval).mockResolvedValueOnce({ ok: false, reason: 'Ada is busy then.' } as never);
    const recording = world();
    expect(await move(recording)).toMatchObject({ ok: false, status: 409, error: 'Ada is busy then.' });
    expect(recording.calls.some((c) => c.table === 'rpc:collective_move_booking')).toBe(false);
    expect(vi.mocked(executeBookingModificationGuestNotification)).not.toHaveBeenCalled();
  });

  it('refuses a service the new venue does not have', async () => {
    const noReplica = world((call) => (call.table === 'collective_service_replicas' ? { data: null } : undefined));
    expect(await move(noReplica)).toMatchObject({ ok: false, status: 409, code: 'COLLECTIVE_MOVE_SERVICE' });
  });

  it("passes on the database's refusal in words, and tells nobody", async () => {
    const attached = world((call) =>
      call.table === 'rpc:collective_move_booking'
        ? { data: null, error: { code: 'P0001', message: 'COLLECTIVE_MOVE_ATTACHED: payment' } }
        : undefined,
    );
    const result = await move(attached);
    expect(result).toMatchObject({ ok: false, status: 409, code: 'COLLECTIVE_MOVE_ATTACHED' });
    expect((result as { error: string }).error).toMatch(/deposit, card hold or payment/);
    expect(vi.mocked(executeBookingModificationGuestNotification)).not.toHaveBeenCalled();
  });
});

describe('moveBookingToCollectiveVenue on the older model (found on staging)', () => {
  /** Plus 1's Beard Trim at the host; Light 3's own copy, provided by John on the page. */
  const legacy = (providers: Row[]) =>
    world((call) => {
      if (call.table === 'venue_collectives') return { data: { service_model: 'legacy_copies' } };
      if (call.table === 'collective_service_items') return { data: [{ id: 'offer-live' }] };
      if (call.table === 'collective_service_providers') {
        const venue = call.filters.find((f) => f[1] === 'venue_id')?.[2];
        if (venue === 'host') return { data: [{ item_id: 'offer-live' }] };
        return { data: providers };
      }
      if (call.table === 'service_items') return { data: { id: 'zen-beard', is_active: true } };
      if (call.table === 'calendar_service_assignments') return { data: { calendar_id: 'cal-zen' } };
      return undefined;
    });

  it("finds the member's own copy the calendar provides, and checks the time on it", async () => {
    const result = await move(legacy([{ id: 'p-1', source_service_id: 'zen-beard', practitioner_id: 'cal-zen' }]));
    expect(result).toMatchObject({ ok: true, bookingId: 'b-new' });
    expect(vi.mocked(validateAppointmentModificationInterval).mock.calls[0]![0]).toMatchObject({
      venueId: 'member',
      practId: 'cal-zen',
      svcId: 'zen-beard',
    });
  });

  it('accepts a venue-wide provider when the calendar offers the copy', async () => {
    expect(await move(legacy([{ id: 'p-1', source_service_id: 'zen-beard', practitioner_id: null }]))).toMatchObject({ ok: true });
  });

  it("refuses when no provider at the venue is that calendar's", async () => {
    const result = await move(legacy([{ id: 'p-1', source_service_id: 'zen-beard', practitioner_id: 'cal-other' }]));
    expect(result).toMatchObject({ ok: false, status: 409, code: 'COLLECTIVE_MOVE_SERVICE' });
  });
});

describe('moveRefusalWords', () => {
  it('words each reason', () => {
    expect(moveRefusalWords('COLLECTIVE_MOVE_ATTACHED: forms', 'Zen Studio')?.error).toMatch(/completed forms/);
    expect(moveRefusalWords('COLLECTIVE_MOVE_ATTACHED: visit', 'Zen Studio')?.error).toBe(
      'This booking is part of a visit or group, so it cannot be moved to Zen Studio on its own.',
    );
    expect(moveRefusalWords('COLLECTIVE_MOVE_SERVICE: nope', 'Zen Studio')?.code).toBe('COLLECTIVE_MOVE_SERVICE');
    expect(moveRefusalWords('something else', 'Zen Studio')).toBeNull();
  });
});
