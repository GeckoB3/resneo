import { describe, expect, it } from 'vitest';
import {
  bookingTypePillVariant,
  cdeDeepLinkEntityLabel,
  depositPillVariant,
  isCdeModel,
  readCdeDeepLinkFilter,
  shouldShowBookingRowInList,
} from './bookings-list-shared';

describe('isCdeModel', () => {
  it('true for class / event / resource', () => {
    expect(isCdeModel('event_ticket')).toBe(true);
    expect(isCdeModel('class_session')).toBe(true);
    expect(isCdeModel('resource_booking')).toBe(true);
  });

  it('false for appointment / table models', () => {
    expect(isCdeModel('table_reservation')).toBe(false);
    expect(isCdeModel('unified_scheduling')).toBe(false);
    expect(isCdeModel('practitioner_appointment')).toBe(false);
  });
});

describe('bookingTypePillVariant', () => {
  it('maps each model to its chip colour', () => {
    expect(bookingTypePillVariant('unified_scheduling')).toBe('brand');
    expect(bookingTypePillVariant('practitioner_appointment')).toBe('brand');
    expect(bookingTypePillVariant('event_ticket')).toBe('info');
    expect(bookingTypePillVariant('class_session')).toBe('success');
    expect(bookingTypePillVariant('resource_booking')).toBe('warning');
    expect(bookingTypePillVariant('table_reservation')).toBe('neutral');
  });
});

describe('depositPillVariant', () => {
  it('green for settled payments (case-insensitive)', () => {
    expect(depositPillVariant('Paid')).toBe('success');
    expect(depositPillVariant('captured')).toBe('success');
  });

  it('amber for in-flight payments', () => {
    expect(depositPillVariant('Pending')).toBe('warning');
    expect(depositPillVariant('requires_action')).toBe('warning');
  });

  it('red for failed / refunded / cancelled', () => {
    expect(depositPillVariant('Refunded')).toBe('danger');
    expect(depositPillVariant('failed')).toBe('danger');
    expect(depositPillVariant('cancelled')).toBe('danger');
  });

  it('neutral otherwise', () => {
    expect(depositPillVariant('none')).toBe('neutral');
    expect(depositPillVariant('Not Required')).toBe('neutral');
  });
});

describe('shouldShowBookingRowInList', () => {
  it('shows rows for the primary model', () => {
    expect(
      shouldShowBookingRowInList({ booking_model: 'unified_scheduling' }, 'unified_scheduling', []),
    ).toBe(true);
  });

  it('shows rows for an enabled secondary model', () => {
    expect(
      shouldShowBookingRowInList({ booking_model: 'event_ticket' }, 'unified_scheduling', ['event_ticket']),
    ).toBe(true);
  });

  it('still shows a historical CDE row whose model was since disabled (F18)', () => {
    // Resource bookings exist, but the venue has turned the resource model off.
    expect(
      shouldShowBookingRowInList({ booking_model: 'resource_booking' }, 'unified_scheduling', []),
    ).toBe(true);
    expect(
      shouldShowBookingRowInList({ booking_model: 'class_session' }, 'unified_scheduling', ['event_ticket']),
    ).toBe(true);
  });

  it('infers the CDE model from FK columns when booking_model is absent (legacy rows)', () => {
    expect(
      shouldShowBookingRowInList({ class_instance_id: 'abc' }, 'unified_scheduling', []),
    ).toBe(true);
  });

  it('filters out a non-CDE row for a model the venue does not expose', () => {
    // A stray table reservation on an appointments-primary venue with no table model.
    expect(
      shouldShowBookingRowInList({ booking_model: 'table_reservation' }, 'unified_scheduling', []),
    ).toBe(false);
  });
});

describe('readCdeDeepLinkFilter', () => {
  const VALID = '11111111-1111-1111-1111-111111111111';

  const reader = (params: Record<string, string>) => (key: string) => params[key] ?? null;

  it('reads experience_event_id', () => {
    expect(readCdeDeepLinkFilter(reader({ experience_event_id: VALID }))).toEqual({
      param: 'experience_event_id',
      id: VALID,
    });
  });

  it('reads class_instance_id and resource_id', () => {
    expect(readCdeDeepLinkFilter(reader({ class_instance_id: VALID }))).toEqual({
      param: 'class_instance_id',
      id: VALID,
    });
    expect(readCdeDeepLinkFilter(reader({ resource_id: VALID }))).toEqual({
      param: 'resource_id',
      id: VALID,
    });
  });

  it('prefers experience_event_id when several are present', () => {
    expect(
      readCdeDeepLinkFilter(reader({ resource_id: VALID, experience_event_id: VALID })),
    ).toEqual({ param: 'experience_event_id', id: VALID });
  });

  it('rejects a malformed id', () => {
    expect(readCdeDeepLinkFilter(reader({ experience_event_id: 'not-a-uuid' }))).toBeNull();
  });

  it('returns null when no CDE param is present', () => {
    expect(readCdeDeepLinkFilter(reader({ openBooking: VALID }))).toBeNull();
  });
});

describe('cdeDeepLinkEntityLabel', () => {
  it('maps each param to a human label', () => {
    expect(cdeDeepLinkEntityLabel('experience_event_id')).toBe('event');
    expect(cdeDeepLinkEntityLabel('class_instance_id')).toBe('class');
    expect(cdeDeepLinkEntityLabel('resource_id')).toBe('resource');
  });
});
