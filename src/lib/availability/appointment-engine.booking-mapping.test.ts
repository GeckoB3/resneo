import { describe, it, expect } from 'vitest';
import type { AppointmentService, PractitionerService, ProcessingTimeBlock } from '@/types/booking-models';
import { mapRowToAppointmentBooking, type EngineBookingRow } from './appointment-engine';

/**
 * `mapRowToAppointmentBooking` decides how much of a calendar an existing booking
 * holds. Both fetchers share it; before they did, the unified one resolved
 * neighbour services against a list narrowed to the service being browsed, so
 * bookings of any OTHER service came back with no buffer and a 30-minute
 * default and the engine offered slots that ran into them.
 */

const CAL = 'cal-1';

function service(over: Partial<AppointmentService> = {}): AppointmentService {
  return {
    id: 'colour',
    venue_id: 'v1',
    name: 'Colour',
    description: null,
    duration_minutes: 90,
    buffer_minutes: 15,
    processing_time_minutes: 0,
    processing_time_blocks: [],
    price_pence: 5000,
    deposit_pence: null,
    colour: '#000',
    is_active: true,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as AppointmentService;
}

function row(over: Partial<EngineBookingRow> = {}): EngineBookingRow {
  return {
    id: 'b1',
    booking_time: '10:00:00',
    status: 'Confirmed',
    calendar_id: CAL,
    service_item_id: 'colour',
    booking_end_time: '11:30:00',
    ...over,
  };
}

function mapOne(params: {
  row: EngineBookingRow;
  services: AppointmentService[];
  links?: PractitionerService[];
  variantBlocks?: Map<string, ProcessingTimeBlock[]>;
  forPractitionerId?: string;
}) {
  return mapRowToAppointmentBooking({
    row: params.row,
    serviceMap: new Map(params.services.map((s) => [s.id, s])),
    practitionerServices: params.links ?? [],
    variantBlocksById: params.variantBlocks ?? new Map(),
    forPractitionerId: params.forPractitionerId,
  });
}

describe('mapRowToAppointmentBooking', () => {
  it("carries the neighbour service's buffer, which decides where the next slot can start", () => {
    // Regression: a Cut lookup narrowed the service map, so this Colour booking
    // came back with buffer 0 and 11:30 was offered against a chair busy to 11:45.
    const b = mapOne({ row: row(), services: [service()] });
    expect(b.duration_minutes).toBe(90);
    expect(b.buffer_minutes).toBe(15);
  });

  it('falls back to a 30 minute stub only when the service is genuinely absent', () => {
    const b = mapOne({ row: row({ booking_end_time: null }), services: [] });
    expect(b.duration_minutes).toBe(30);
    expect(b.buffer_minutes).toBe(0);
  });

  it("prefers the row's own end time over the catalogue duration", () => {
    const b = mapOne({ row: row({ booking_end_time: '13:00:00' }), services: [service()] });
    expect(b.duration_minutes).toBe(180);
  });

  it('honours a short end time rather than inflating it to the catalogue default', () => {
    const b = mapOne({ row: row({ booking_end_time: '10:10:00' }), services: [service()] });
    expect(b.duration_minutes).toBe(10);
  });

  it('falls back to the catalogue when the row has no end time at all', () => {
    const b = mapOne({ row: row({ booking_end_time: null }), services: [service()] });
    expect(b.duration_minutes).toBe(90);
  });

  it('survives a stale end time that precedes the start instead of blocking the day', () => {
    // A reschedule that moved booking_time and left booking_end_time behind.
    // Wrapping this past midnight would hold the practitioner for 23 hours.
    const b = mapOne({
      row: row({ booking_time: '14:00:00', booking_end_time: '11:30:00' }),
      services: [service()],
    });
    expect(b.duration_minutes).toBe(90);
  });

  it("applies the calendar's custom duration override", () => {
    const links: PractitionerService[] = [
      { practitioner_id: CAL, service_id: 'colour', custom_duration_minutes: 45 } as PractitionerService,
    ];
    const b = mapOne({
      row: row({ booking_end_time: null }),
      services: [service()],
      links,
      forPractitionerId: CAL,
    });
    expect(b.duration_minutes).toBe(45);
  });

  it('pins the anchor and the link lookup to the requested calendar', () => {
    // A row carrying a stale foreign practitioner_id must still resolve against
    // the calendar it was fetched for, or it misses its link and is filed under
    // a practitioner the engine is not evaluating.
    const links: PractitionerService[] = [
      { practitioner_id: CAL, service_id: 'colour', custom_duration_minutes: 45 } as PractitionerService,
    ];
    const b = mapOne({
      row: row({ practitioner_id: 'stale-practitioner', booking_end_time: null }),
      services: [service()],
      links,
      forPractitionerId: CAL,
    });
    expect(b.practitioner_id).toBe(CAL);
    expect(b.duration_minutes).toBe(45);
  });

  it('derives the anchor from the row when no calendar is pinned', () => {
    const b = mapOne({ row: row({ practitioner_id: 'p9', calendar_id: null }), services: [service()] });
    expect(b.practitioner_id).toBe('p9');
  });

  describe('processing block resolution', () => {
    const template: ProcessingTimeBlock[] = [{ id: 't', start_minute: 30, duration_minutes: 20 }];
    const snapshot = [{ id: '5a3c1f7e-0000-4000-8000-000000000001', start_minute: 40, duration_minutes: 15 }];

    it('treats a stored snapshot as authoritative', () => {
      const b = mapOne({
        row: row({ processing_time_blocks: snapshot }),
        services: [service({ processing_time_blocks: template })],
      });
      expect(b.processing_time_blocks).toEqual(snapshot);
    });

    it('treats an EMPTY snapshot as "deliberately no gap", not as missing', () => {
      const b = mapOne({
        row: row({ processing_time_blocks: [] }),
        services: [service({ processing_time_blocks: template })],
      });
      expect(b.processing_time_blocks).toEqual([]);
    });

    it('falls back to the catalogue template only when the snapshot is null', () => {
      const b = mapOne({
        row: row({ processing_time_blocks: null }),
        services: [service({ processing_time_blocks: template })],
      });
      expect(b.processing_time_blocks).toEqual(template);
    });

    it("prefers the variant's blocks over the parent's on a null snapshot", () => {
      const variantBlocks: ProcessingTimeBlock[] = [{ id: 'v', start_minute: 10, duration_minutes: 25 }];
      const b = mapOne({
        row: row({ processing_time_blocks: null, service_variant_id: 'var-1' }),
        services: [service({ processing_time_blocks: template })],
        variantBlocks: new Map([['var-1', variantBlocks]]),
      });
      expect(b.processing_time_blocks).toEqual(variantBlocks);
    });
  });
});
