import { describe, expect, it } from 'vitest';
import type { VenueResource } from '@/types/booking-models';
import {
  computeResourceAvailability,
  resourceHasAvailabilityForAnyDurationCandidate,
  type ResourceEngineInput,
} from './resource-booking-engine';

/**
 * RS-2: resource minimum notice was enforced only for "the rest of today".
 * `earliestGuestSlotStartMinute` returned null for every date that was not the
 * venue-local today, so any notice beyond that was silently a no-op. Owners can
 * configure up to 168 hours; a 48-hour room was bookable at 23:50 for 09:00 the
 * next morning.
 *
 * The rule is now date-aware and deliberately WALL-CLOCK, matching the
 * appointment engine's `slotMinutesFromNow`: a venue promising "48 hours notice"
 * means the calendar, which keeps the rule stable across a DST boundary.
 */

function noticeResource(overrides: Partial<VenueResource> = {}): VenueResource {
  return {
    id: 'res-1',
    venue_id: 'venue-1',
    name: 'Court 1',
    resource_type: 'court',
    min_booking_minutes: 60,
    max_booking_minutes: 120,
    slot_interval_minutes: 30,
    price_per_slot_pence: 1000,
    payment_requirement: 'none',
    deposit_amount_pence: null,
    // Open 09:00-12:00 every day so the date under test is never the variable.
    availability_hours: {
      '0': [{ start: '09:00', end: '12:00' }],
      '1': [{ start: '09:00', end: '12:00' }],
      '2': [{ start: '09:00', end: '12:00' }],
      '3': [{ start: '09:00', end: '12:00' }],
      '4': [{ start: '09:00', end: '12:00' }],
      '5': [{ start: '09:00', end: '12:00' }],
      '6': [{ start: '09:00', end: '12:00' }],
    },
    is_active: true,
    sort_order: 0,
    created_at: '',
    display_on_calendar_id: null,
    ...overrides,
  } as VenueResource;
}

/** Today is 2026-06-09 at 23:50 venue-local, matching the finding's example. */
const TODAY = '2026-06-09';
const LATE_TONIGHT = { venueDateYmd: TODAY, minutesNow: 23 * 60 + 50 };

function inputFor(date: string, resource: VenueResource): ResourceEngineInput {
  return {
    date,
    resources: [resource],
    existingBookings: [],
    sameDaySlotCutoff: LATE_TONIGHT,
  };
}

function slotStarts(date: string, resource: VenueResource, duration = 60): string[] {
  const results = computeResourceAvailability(inputFor(date, resource), duration);
  return results.find((r) => r.id === resource.id)?.slots.map((s) => s.start_time) ?? [];
}

describe('resource minimum notice across dates (RS-2)', () => {
  const notice48 = noticeResource({
    min_booking_notice_hours: 48,
    allow_same_day_booking: true,
  } as Partial<VenueResource>);

  it('blocks tomorrow entirely when 48 hours notice is required at 23:50', () => {
    // The reported case. 2026-06-10 09:00 is ~9 hours away, far inside the window.
    expect(slotStarts('2026-06-10', notice48)).toEqual([]);
  });

  it('blocks the day after tomorrow up to the wall-clock cutoff', () => {
    // 23:50 + 48h lands at 23:50 on 2026-06-11, after the 09:00-12:00 opening.
    expect(slotStarts('2026-06-11', notice48)).toEqual([]);
  });

  it('opens normally once the notice window has fully passed', () => {
    // 2026-06-12 is 3 days out: cutoff falls before the day began.
    expect(slotStarts('2026-06-12', notice48).length).toBeGreaterThan(0);
  });

  it('still applies the same-day rule it always did', () => {
    const notice2 = noticeResource({
      min_booking_notice_hours: 2,
      allow_same_day_booking: true,
    } as Partial<VenueResource>);
    // At 23:50 nothing is left today whatever the notice.
    expect(slotStarts(TODAY, notice2)).toEqual([]);
  });

  it('applies a partial-day cutoff on a future date at the right minute', () => {
    // Now is 08:00, notice 26 hours: the cutoff lands at 10:00 tomorrow, so the
    // 09:00 and 09:30 starts go and 10:00 onwards stay.
    const morning = { venueDateYmd: TODAY, minutesNow: 8 * 60 };
    const notice26 = noticeResource({
      min_booking_notice_hours: 26,
      allow_same_day_booking: true,
    } as Partial<VenueResource>);
    const results = computeResourceAvailability(
      { date: '2026-06-10', resources: [notice26], existingBookings: [], sameDaySlotCutoff: morning },
      60,
    );
    expect(results[0]?.slots.map((s) => s.start_time)).toEqual(['10:00', '10:30', '11:00']);
  });

  it('leaves a zero-notice resource unchanged on future dates', () => {
    const noNotice = noticeResource({
      min_booking_notice_hours: 0,
      allow_same_day_booking: true,
    } as Partial<VenueResource>);
    expect(slotStarts('2026-06-10', noNotice).length).toBeGreaterThan(0);
  });

  it('keeps same-day-disabled resources unavailable today, as before', () => {
    const noSameDay = noticeResource({
      min_booking_notice_hours: 0,
      allow_same_day_booking: false,
    } as Partial<VenueResource>);
    expect(slotStarts(TODAY, noSameDay)).toEqual([]);
    // ...while future dates are unaffected by the same-day flag.
    expect(slotStarts('2026-06-10', noSameDay).length).toBeGreaterThan(0);
  });

  it('agrees with the month pre-filter, which shares the same cutoff', () => {
    // Both call sites read one function, so the month picker cannot paint a date
    // green that the day view then refuses.
    const durations = [60, 90, 120];
    for (const date of ['2026-06-10', '2026-06-11', '2026-06-12']) {
      const anyViaPrefilter = resourceHasAvailabilityForAnyDurationCandidate(
        inputFor(date, notice48),
        notice48.id,
        durations,
      );
      const anyViaLoop = durations.some((d) => slotStarts(date, notice48, d).length > 0);
      expect(anyViaPrefilter).toBe(anyViaLoop);
    }
  });
});
