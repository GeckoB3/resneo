import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./collective-venue', () => ({ loadCollectiveAppointmentCatalog: vi.fn() }));
vi.mock('@/lib/availability/appointment-engine', () => ({
  fetchAppointmentInput: vi.fn(async () => ({ services: [{ id: 'src-1', duration_minutes: 30 }], existingBookings: [] })),
  attachVenueClockToAppointmentInput: vi.fn(),
  computeAppointmentAvailability: vi.fn(() => ({
    practitioners: [{ id: 'cal-1', slots: [{ start_time: '10:00', service_id: 'src-1', duration_minutes: 30 }] }],
  })),
}));
vi.mock('@/lib/availability/appointment-month-availability', () => ({ computeAppointmentAvailableDatesInMonth: vi.fn() }));
vi.mock('@/lib/availability/appointment-chain', () => ({ computeChainStartsForPractitioner: vi.fn() }));
vi.mock('@/lib/availability/appointment-chain-server', () => ({ prepareChainSegments: vi.fn() }));
vi.mock('@/lib/venue/service-variants', () => ({ loadActiveVariantForService: vi.fn() }));
vi.mock('@/lib/addons/addon-resolution', () => ({ loadAddonsForBooking: vi.fn() }));
vi.mock('@/lib/addons/addon-selection-validation', () => ({ validateAddonSelections: vi.fn() }));
vi.mock('@/lib/booking/uses-unified-appointment-data', () => ({ venueUsesUnifiedAppointmentServiceData: vi.fn() }));
vi.mock('@/lib/booking/entity-booking-window', () => ({
  loadServiceEntityBookingWindow: vi.fn(),
  isGuestBookingDateAllowed: vi.fn(),
  isStaffWalkInBookingDateAllowed: vi.fn(),
}));

import { loadCollectiveAppointmentCatalog } from './collective-venue';
import { attachVenueClockToAppointmentInput } from '@/lib/availability/appointment-engine';
import {
  isGuestBookingDateAllowed,
  isStaffWalkInBookingDateAllowed,
  loadServiceEntityBookingWindow,
} from '@/lib/booking/entity-booking-window';
import { loadCollectiveDayAvailability, resolveCombinedBookingTarget } from './collective-booking-bridge';

const COL = 'col-1';
const OWNER = 'venue-owner';
const WINDOW = { max_advance_booking_days: 30, min_booking_notice_hours: 4, cancellation_notice_hours: 24, allow_same_day_booking: false };

function catalogue() {
  const offering = { id: 'offering-1', source_service_id: 'src-1', price_pence: 2500, duration_minutes: 30 };
  return {
    practitioners: [
      { id: 'cal-1', name: 'Andrew', owning_venue_id: OWNER, owning_venue_name: 'Owner', services: [offering] },
    ],
    categories: [],
  };
}

function admin() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { timezone: 'Europe/London' }, error: null }) }),
      }),
    }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCollectiveAppointmentCatalog).mockImplementation(async () => catalogue() as never);
  vi.mocked(loadServiceEntityBookingWindow).mockResolvedValue(WINDOW);
  vi.mocked(isGuestBookingDateAllowed).mockReturnValue(true);
  vi.mocked(isStaffWalkInBookingDateAllowed).mockReturnValue(true);
});

describe('resolveCombinedBookingTarget', () => {
  it('routes an offering to its owning venue and real source service', async () => {
    const target = await resolveCombinedBookingTarget(admin(), { collectiveId: COL, offeringId: 'offering-1', calendarId: 'cal-1' });
    expect(target).toEqual({ venueId: OWNER, sourceServiceId: 'src-1', pricePence: 2500, durationMinutes: 30 });
  });

  it("does not resolve a member venue's own service that is not a combined-page offering, staff or not", async () => {
    expect(await resolveCombinedBookingTarget(admin(), { collectiveId: COL, offeringId: 'src-own', calendarId: 'cal-1' })).toBeNull();
    expect(vi.mocked(loadCollectiveAppointmentCatalog)).toHaveBeenLastCalledWith(expect.anything(), COL);
  });
});

describe('loadCollectiveDayAvailability', () => {
  /** The source service's own booking window applies, as on the venue's own day route. */
  it('sizes each calendar with its source service booking window', async () => {
    const result = await loadCollectiveDayAvailability(admin(), {
      collectiveId: COL,
      offeringId: 'offering-1',
      calendarId: 'cal-1',
      anyAvailable: false,
      date: '2026-09-06',
    });
    expect(vi.mocked(loadServiceEntityBookingWindow)).toHaveBeenCalledWith(expect.anything(), OWNER, '', 'src-1');
    expect(vi.mocked(attachVenueClockToAppointmentInput)).toHaveBeenCalledWith(expect.anything(), expect.anything(), WINDOW);
    expect(vi.mocked(isGuestBookingDateAllowed)).toHaveBeenCalledWith('2026-09-06', WINDOW, 'Europe/London');
    expect(result.practitioners[0]?.slots.map((s) => s.start_time)).toEqual(['10:00']);
  });

  it('offers nothing on a date the window rules out, with the staff rule for staff', async () => {
    vi.mocked(isStaffWalkInBookingDateAllowed).mockReturnValue(false);
    const result = await loadCollectiveDayAvailability(admin(), {
      collectiveId: COL,
      offeringId: 'offering-1',
      calendarId: 'cal-1',
      anyAvailable: false,
      date: '2026-09-06',
      audience: 'staff',
    });
    expect(vi.mocked(isStaffWalkInBookingDateAllowed)).toHaveBeenCalledWith('2026-09-06', WINDOW, 'Europe/London');
    expect(vi.mocked(isGuestBookingDateAllowed)).not.toHaveBeenCalled();
    expect(result.practitioners[0]?.slots).toEqual([]);
  });
});
