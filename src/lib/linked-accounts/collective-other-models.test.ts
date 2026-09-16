/**
 * BM-03 and §6.14: what a venue runs besides appointments, in the words the member and host read.
 */
import { describe, expect, it } from 'vitest';
import { otherBookingModelList, otherBookingModelWords } from './collective-other-models';

describe('otherBookingModelWords', () => {
  it('names classes, events and bookable rooms in a fixed order, and never appointments', () => {
    expect(
      otherBookingModelWords({
        pricing_tier: 'multi',
        booking_model: 'unified_scheduling',
        active_booking_models: ['resource_booking', 'unified_scheduling', 'class_session', 'event_ticket'],
      }),
    ).toEqual(['classes', 'events', 'bookable rooms']);
  });

  it('is empty for an appointments-only venue, or none at all', () => {
    expect(
      otherBookingModelWords({ pricing_tier: 'appointments', booking_model: 'unified_scheduling', active_booking_models: ['unified_scheduling'] }),
    ).toEqual([]);
    expect(otherBookingModelWords(null)).toEqual([]);
  });
});

describe('otherBookingModelList', () => {
  it('joins the words for a sentence, or answers null', () => {
    expect(
      otherBookingModelList({ booking_model: 'unified_scheduling', active_booking_models: ['unified_scheduling', 'class_session', 'event_ticket'] }),
    ).toBe('classes and events');
    expect(otherBookingModelList({ booking_model: 'unified_scheduling', active_booking_models: ['unified_scheduling'] })).toBeNull();
  });
});
