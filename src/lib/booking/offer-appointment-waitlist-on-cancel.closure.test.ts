import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SA-H6. Cancelling a day's bookings in order to close the day fired one
 * waitlist offer per cancellation, because this path checked only whether
 * somebody else had taken the slot and never whether the venue was open.
 * Waitlisted guests were texted offers for a closed day.
 */

const findAppointmentWaitlistAvailability = vi.hoisted(() => vi.fn());
const notifyAppointmentWaitlistOfferForEntry = vi.hoisted(() => vi.fn());
const offerWaitlistEntryInOrder = vi.hoisted(() => vi.fn());
const recordWaitlistSlotOpportunity = vi.hoisted(() => vi.fn());
const hasActiveWaitlistOfferForSlot = vi.hoisted(() => vi.fn(async () => false));

vi.mock('@/lib/booking/waitlist-offer-availability', () => ({
  findAppointmentWaitlistAvailability,
}));
vi.mock('@/lib/booking/notify-appointment-waitlist-offer', () => ({
  notifyAppointmentWaitlistOfferForEntry,
}));
vi.mock('@/lib/booking/waitlist-offer-in-order', () => ({
  offerWaitlistEntryInOrder,
  hasActiveWaitlistOfferForSlot,
}));
vi.mock('@/lib/booking/record-waitlist-slot-opportunity', () => ({
  recordWaitlistSlotOpportunity,
}));
vi.mock('@/lib/booking/waitlist-slot-opportunity-service', () => ({
  markWaitlistOpportunitiesFilledForSlot: vi.fn(),
}));
vi.mock('@/lib/booking/is-waitlist-freed-slot-unbooked', () => ({
  isWaitlistFreedSlotStillUnbooked: vi.fn(async () => true),
}));

import { offerAppointmentWaitlistOnCancel } from '@/lib/booking/offer-appointment-waitlist-on-cancel';

const CANCELLED_BOOKING = {
  id: 'b1',
  venue_id: 'v1',
  booking_date: '2026-09-14',
  booking_time: '14:30:00',
  practitioner_id: 'prac-1',
  calendar_id: null,
  appointment_service_id: 'svc-1',
  service_item_id: null,
};

const WAITING_ROW = {
  id: 'w1',
  desired_date: '2026-09-14',
  desired_time: '14:30:00',
  desired_time_end: null,
  practitioner_id: null,
  appointment_service_id: 'svc-1',
  service_item_id: null,
  guest_first_name: 'Alex',
  guest_last_name: 'Smith',
  guest_email: 'alex@example.com',
  guest_phone: '+447700900123',
  created_at: '2026-09-01T10:00:00Z',
};

/** Minimal admin double: the venue row, then the waiting waitlist rows. */
function adminDouble() {
  return {
    from(table: string) {
      if (table === 'venues') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  name: 'Salon',
                  phone: '+447700900000',
                  slug: 'salon',
                  feature_flags: { waitlist_v2: true },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'waitlist_entries') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: async () => ({ data: [WAITING_ROW], error: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe('offerAppointmentWaitlistOnCancel closure gate (SA-H6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasActiveWaitlistOfferForSlot.mockResolvedValue(false);
    offerWaitlistEntryInOrder.mockResolvedValue({ ok: true, offerId: 'o1' });
    recordWaitlistSlotOpportunity.mockResolvedValue({ created: true, opportunityId: 'op1' });
  });

  it('notifies nobody when the freed slot is not bookable', async () => {
    // What a closure looks like from here: the day has no availability, even
    // though the slot is unbooked because we just cancelled it.
    findAppointmentWaitlistAvailability.mockResolvedValue({
      available: false,
      sampleSlotStartHm: null,
      sampleCalendarId: null,
      reason: 'no_slots',
    });

    const result = await offerAppointmentWaitlistOnCancel(adminDouble(), CANCELLED_BOOKING);

    if (result.offered) throw new Error('expected the offer to be withheld');
    expect(result.reason).toBe('slot_not_bookable:no_slots');
    expect(notifyAppointmentWaitlistOfferForEntry).not.toHaveBeenCalled();
    expect(offerWaitlistEntryInOrder).not.toHaveBeenCalled();
  });

  it('records no staff opportunity for a slot nobody can book', async () => {
    // `staff_choose` does not text a guest, but an alert about an unbookable
    // slot is noise rather than an opportunity.
    findAppointmentWaitlistAvailability.mockResolvedValue({
      available: false,
      sampleSlotStartHm: null,
      sampleCalendarId: null,
      reason: 'date_not_bookable',
    });

    const result = await offerAppointmentWaitlistOnCancel(adminDouble(), CANCELLED_BOOKING);

    expect(result.offered).toBe(false);
    expect(recordWaitlistSlotOpportunity).not.toHaveBeenCalled();
  });

  it('still offers the slot on an ordinary cancellation', async () => {
    // The gate must not swallow the feature: an open day still offers.
    findAppointmentWaitlistAvailability.mockResolvedValue({
      available: true,
      sampleSlotStartHm: '14:30',
      sampleCalendarId: 'prac-1',
    });

    const result = await offerAppointmentWaitlistOnCancel(adminDouble(), CANCELLED_BOOKING);

    expect(offerWaitlistEntryInOrder).toHaveBeenCalledTimes(1);
    expect(result.offered).toBe(true);
  });

  it('asks about the freed slot exactly, not the whole day', async () => {
    findAppointmentWaitlistAvailability.mockResolvedValue({
      available: true,
      sampleSlotStartHm: '14:30',
      sampleCalendarId: 'prac-1',
    });

    await offerAppointmentWaitlistOnCancel(adminDouble(), CANCELLED_BOOKING);

    expect(findAppointmentWaitlistAvailability).toHaveBeenCalledWith(
      expect.anything(),
      'v1',
      expect.objectContaining({
        desired_date: '2026-09-14',
        desired_time: '14:30',
        desired_time_end: null,
        appointment_service_id: 'svc-1',
      }),
    );
  });
});
