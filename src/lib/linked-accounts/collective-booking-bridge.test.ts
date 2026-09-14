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
import { attachVenueClockToAppointmentInput, computeAppointmentAvailability } from '@/lib/availability/appointment-engine';
import { computeAppointmentAvailableDatesInMonth } from '@/lib/availability/appointment-month-availability';
import { prepareChainSegments } from '@/lib/availability/appointment-chain-server';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import {
  isGuestBookingDateAllowed,
  isStaffWalkInBookingDateAllowed,
  loadServiceEntityBookingWindow,
} from '@/lib/booking/entity-booking-window';
import {
  loadCollectiveChainDayAvailability,
  loadCollectiveDayAvailability,
  loadCollectiveMonthAvailableDates,
  resolveCombinedBookingTarget,
} from './collective-booking-bridge';

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

/** CB-08: the chosen option's buffer and processing reach the engine, not just its length. */
describe('collective availability applies the whole option (CB-08)', () => {
  const variant = {
    id: 'var-1',
    name: 'Long',
    duration_minutes: 45,
    buffer_minutes: 15,
    price_pence: 3000,
    deposit_pence: null,
    processing_time_blocks: [{ start_minute: 15, duration_minutes: 15 }],
    is_active: true,
  };

  beforeEach(() => {
    vi.mocked(loadActiveVariantForService).mockResolvedValue(variant as never);
  });

  it('day: the engine sees the option length, buffer and processing, and slots carry its price', async () => {
    vi.mocked(computeAppointmentAvailability).mockImplementationOnce(
      () => ({ practitioners: [{ id: 'cal-1', slots: [{ start_time: '10:00', service_id: 'src-1', duration_minutes: 45, price_pence: 3000 }] }] }) as never,
    );
    const result = await loadCollectiveDayAvailability(admin(), {
      collectiveId: COL,
      offeringId: 'offering-1',
      calendarId: 'cal-1',
      anyAvailable: false,
      date: '2026-09-06',
      variantId: 'var-1',
    });
    const input = vi.mocked(computeAppointmentAvailability).mock.calls[0]![0] as unknown as {
      services: Array<{ duration_minutes: number; buffer_minutes: number; processing_time_blocks: unknown }>;
    };
    expect(input.services[0]).toMatchObject({
      duration_minutes: 45,
      buffer_minutes: 15,
      processing_time_blocks: [{ start_minute: 15, duration_minutes: 15 }],
    });
    expect(result.practitioners[0]?.slots[0]).toMatchObject({ duration_minutes: 45, price_pence: 3000 });
  });

  it('day: a calendar whose service has no such option offers nothing', async () => {
    vi.mocked(loadActiveVariantForService).mockResolvedValue(null);
    const result = await loadCollectiveDayAvailability(admin(), {
      collectiveId: COL,
      offeringId: 'offering-1',
      calendarId: 'cal-1',
      anyAvailable: false,
      date: '2026-09-06',
      variantId: 'var-other',
    });
    expect(result.practitioners[0]?.slots).toEqual([]);
    expect(vi.mocked(computeAppointmentAvailability)).not.toHaveBeenCalled();
  });

  it("month: passes the option row as the venue's own month route does, not a bare length", async () => {
    vi.mocked(computeAppointmentAvailableDatesInMonth).mockResolvedValue(['2026-09-07']);
    const out = await loadCollectiveMonthAvailableDates(admin(), {
      collectiveId: COL,
      offeringId: 'offering-1',
      calendarId: 'cal-1',
      anyAvailable: false,
      year: 2026,
      month: 9,
      variantId: 'var-1',
    });
    expect(vi.mocked(computeAppointmentAvailableDatesInMonth)).toHaveBeenCalledWith(
      expect.anything(), OWNER, 'cal-1', 'src-1', 2026, 9,
      expect.objectContaining({ variantOverride: variant, additionalAddonMinutes: 0, customDurationMinutes: null }),
    );
    expect(out.available_dates).toEqual(['2026-09-07']);
  });
});

/** CB-09: a combined-page visit keeps each service's own booking window. */
describe('loadCollectiveChainDayAvailability booking windows (CB-09)', () => {
  it('asks for the per-service window and sends no collective length override', async () => {
    vi.mocked(prepareChainSegments).mockResolvedValue({ ok: false, kind: 'not_offered' });
    await loadCollectiveChainDayAvailability(admin(), {
      collectiveId: COL,
      chain: [{ service_id: 'offering-1' }] as never,
      calendarId: 'cal-1',
      anyAvailable: false,
      date: '2026-09-06',
    });
    const call = vi.mocked(prepareChainSegments).mock.calls[0]![0];
    expect(call.bookingModel).toBe('unified_scheduling');
    expect(call.segments).toEqual([{ serviceId: 'src-1', variantId: null, addonIds: [], customDurationMinutes: null }]);
  });
});
