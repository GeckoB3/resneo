import { describe, expect, it } from 'vitest';
import { venueClosureCoversBookingStart } from './venue-closure-covers-booking';
import type { AvailabilityBlock } from '@/types/availability';

function block(over: Partial<AvailabilityBlock>): AvailabilityBlock {
  return {
    id: 'b1',
    venue_id: 'v1',
    service_id: null,
    block_type: 'closed',
    date_start: '2026-09-10',
    date_end: '2026-09-10',
    time_start: null,
    time_end: null,
    override_max_covers: null,
    reason: null,
    ...over,
  };
}

const DATE = '2026-09-10';

describe('venueClosureCoversBookingStart — closures the owner made', () => {
  it('covers everything on a full-day closure', () => {
    const blocks = [block({})];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '09:30', blocks })).toBe(true);
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '23:59', blocks })).toBe(true);
  });

  it('covers a start inside a part-day closure', () => {
    const blocks = [block({ time_start: '14:00', time_end: '16:00' })];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '14:30', blocks })).toBe(true);
  });

  it('leaves a start outside a part-day closure alone', () => {
    const blocks = [block({ time_start: '14:00', time_end: '16:00' })];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '10:00', blocks })).toBe(false);
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '17:00', blocks })).toBe(false);
  });

  it('treats the closure end as exclusive', () => {
    const blocks = [block({ time_start: '14:00', time_end: '16:00' })];
    // 16:00 is when the venue reopens, so an appointment starting then happens.
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '16:00', blocks })).toBe(false);
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '15:59', blocks })).toBe(true);
  });

  it('covers a multi-day closure on every date in its range', () => {
    const blocks = [block({ date_start: '2026-09-08', date_end: '2026-09-12' })];
    expect(venueClosureCoversBookingStart({ dateStr: '2026-09-08', startHhMm: '09:00', blocks })).toBe(true);
    expect(venueClosureCoversBookingStart({ dateStr: '2026-09-12', startHhMm: '09:00', blocks })).toBe(true);
    expect(venueClosureCoversBookingStart({ dateStr: '2026-09-13', startHhMm: '09:00', blocks })).toBe(false);
  });

  it('treats special_event as a closure, matching blocksForDate', () => {
    const blocks = [block({ block_type: 'special_event' })];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '09:30', blocks })).toBe(true);
  });

  it('treats a reversed or unusable time pair as a whole-day closure', () => {
    // SA-M6: reversed ranges are storable. The owner believes the day is shut.
    const blocks = [block({ time_start: '16:00', time_end: '14:00' })];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '09:00', blocks })).toBe(true);
  });
});

describe('venueClosureCoversBookingStart — what it must NOT suppress', () => {
  /**
   * The whole reason this does not use `resolveVenueWideAllowedMinuteRanges`.
   * Staff booking past closing time is documented, shipped behaviour (SA-H5).
   * That guest is coming and must get their reminder.
   */
  it('ignores weekly opening hours entirely, so an after-hours booking is not suppressed', () => {
    // No blocks at all: whatever the weekly schedule says, nothing is closed here.
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '17:15', blocks: [] })).toBe(false);
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '03:00', blocks: [] })).toBe(false);
  });

  it('ignores per-service blocks, which are not the venue closing', () => {
    const blocks = [block({ service_id: 'svc-1' })];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '09:30', blocks })).toBe(false);
  });

  it('ignores reduced_capacity, which is not a closure', () => {
    const blocks = [block({ block_type: 'reduced_capacity', override_max_covers: 4 })];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '09:30', blocks })).toBe(false);
  });

  it('ignores a closure on another date', () => {
    const blocks = [block({ date_start: '2026-09-11', date_end: '2026-09-11' })];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '09:30', blocks })).toBe(false);
  });

  it('returns false rather than throwing on an unparseable time', () => {
    // Fails towards SENDING. A missed reminder is worse than a needless one.
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '', blocks: [block({})] })).toBe(false);
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: 'nonsense', blocks: [block({})] })).toBe(false);
  });

  it('accepts HH:mm:ss as stored in the bookings table', () => {
    const blocks = [block({ time_start: '14:00', time_end: '16:00' })];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '14:30:00', blocks })).toBe(true);
  });
});

describe('venueClosureCoversBookingStart — amended hours', () => {
  it('suppresses a start outside the amended window', () => {
    const blocks = [
      block({ block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] }),
    ];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '15:00', blocks })).toBe(true);
  });

  it('leaves a start inside the amended window alone', () => {
    const blocks = [
      block({ block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] }),
    ];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '10:00', blocks })).toBe(false);
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '13:59', blocks })).toBe(false);
  });

  it('unions multiple amended windows', () => {
    const blocks = [
      block({
        block_type: 'amended_hours',
        override_periods: [
          { open: '09:00', close: '11:00' },
          { open: '15:00', close: '17:00' },
        ],
      }),
    ];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '10:00', blocks })).toBe(false);
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '16:00', blocks })).toBe(false);
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '12:00', blocks })).toBe(true);
  });

  it('ignores an amended block with no usable periods rather than calling the day shut', () => {
    // SA-M6: clearing a period box saves `override_periods: null`. That is a
    // data problem, not the owner saying the venue is closed.
    const blocks = [block({ block_type: 'amended_hours', override_periods: null })];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '09:30', blocks })).toBe(false);
  });

  it('lets a closure win over amended hours on the same day', () => {
    const blocks = [
      block({ id: 'b1', block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] }),
      block({ id: 'b2', block_type: 'closed' }),
    ];
    expect(venueClosureCoversBookingStart({ dateStr: DATE, startHhMm: '11:00', blocks })).toBe(true);
  });
});
