import { describe, expect, it } from 'vitest';
import { buildUnifiedCalendarMonthServices } from './appointment-month-availability';
import { getOfferedAppointmentServicesForPractitioner, serviceItemRowToEngineService } from './appointment-engine';
import type { Practitioner } from '@/types/booking-models';

/** TERMS-16: the month loader applies a calendar's own length once, as the day loader does. */
const serviceRow = {
  id: 's1',
  name: 'Colour',
  duration_minutes: 60,
  buffer_minutes: 0,
  price_pence: 4000,
  processing_time_blocks: [{ start_minute: 20, duration_minutes: 20 }],
  is_active: true,
  // Staff may set their own length and price for this service, so the calendar's values apply.
  staff_may_customize_duration: true,
  staff_may_customize_price: true,
};

const assignment = {
  id: 'a1',
  service_item_id: 's1',
  custom_duration_minutes: 40,
  custom_price_pence: 2200,
};

const calendar = { id: 'cal-1', is_active: true } as Practitioner;

describe('buildUnifiedCalendarMonthServices (TERMS-16)', () => {
  it("bakes the calendar's own length and price into the service once", () => {
    const { allServices, practitionerServices } = buildUnifiedCalendarMonthServices({
      venueId: 'v1',
      calendarId: 'cal-1',
      serviceRows: [serviceRow],
      assignmentRows: [assignment],
    });
    expect(allServices[0]).toMatchObject({ duration_minutes: 40, price_pence: 2200 });
    expect(practitionerServices[0]).toMatchObject({ custom_duration_minutes: null, custom_price_pence: 2200 });
  });

  it('keeps a length set on top of it (an option or add-on minutes) through the engine merge', () => {
    const { allServices, practitionerServices } = buildUnifiedCalendarMonthServices({
      venueId: 'v1',
      calendarId: 'cal-1',
      serviceRows: [serviceRow],
      assignmentRows: [assignment],
    });
    // What the month loop does for add-on minutes.
    const withAddons = allServices.map((s) => ({ ...s, duration_minutes: s.duration_minutes + 15 }));
    const offered = getOfferedAppointmentServicesForPractitioner(calendar, withAddons, practitionerServices);
    expect(offered[0]!.duration_minutes).toBe(55);
  });

  it('shapes the service exactly as the day loader does, processing pattern included', () => {
    const row = { ...serviceRow, processing_time_blocks: [{ start_minute: 30, duration_minutes: 30 }] };
    const { allServices } = buildUnifiedCalendarMonthServices({
      venueId: 'v1',
      calendarId: 'cal-1',
      serviceRows: [row],
      assignmentRows: [assignment],
    });
    const day = serviceItemRowToEngineService(row, 'v1', assignment);
    expect(allServices[0]!.duration_minutes).toBe(day.duration_minutes);
    const shape = (blocks: { start_minute: number; duration_minutes: number }[] | undefined) =>
      (blocks ?? []).map((b) => [b.start_minute, b.duration_minutes]);
    expect(shape(allServices[0]!.processing_time_blocks)).toEqual(shape(day.processing_time_blocks));
    // The pattern moved with the shorter length rather than staying where the 60-minute service drew it.
    expect(shape(allServices[0]!.processing_time_blocks)).toEqual([[40, 30]]);
  });

  it('ignores the calendar length and price once the service flags are off (D56)', () => {
    const { allServices } = buildUnifiedCalendarMonthServices({
      venueId: 'v1',
      calendarId: 'cal-1',
      serviceRows: [{ ...serviceRow, staff_may_customize_duration: false, staff_may_customize_price: false }],
      assignmentRows: [assignment],
    });
    expect(allServices[0]).toMatchObject({ duration_minutes: 60, price_pence: 4000 });
  });

  it('leaves an unassigned-length calendar on the service length', () => {
    const { allServices } = buildUnifiedCalendarMonthServices({
      venueId: 'v1',
      calendarId: 'cal-1',
      serviceRows: [serviceRow],
      assignmentRows: [{ ...assignment, custom_duration_minutes: null, custom_price_pence: null }],
    });
    expect(allServices[0]).toMatchObject({ duration_minutes: 60, price_pence: 4000 });
  });
});
