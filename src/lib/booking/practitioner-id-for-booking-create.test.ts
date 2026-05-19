import { describe, expect, it } from 'vitest';
import { ANY_AVAILABLE_PRACTITIONER_ID } from '@/lib/availability/appointment-any-practitioner';
import { practitionerIdForBookingCreate } from '@/lib/booking/practitioner-id-for-booking-create';

describe('practitionerIdForBookingCreate', () => {
  it('returns selected id for a specific practitioner', () => {
    expect(
      practitionerIdForBookingCreate('prac-1', [{ practitionerId: 'prac-2' }]),
    ).toBe('prac-1');
  });

  it('resolves any-available from first segment', () => {
    expect(
      practitionerIdForBookingCreate(ANY_AVAILABLE_PRACTITIONER_ID, [
        { practitionerId: 'prac-b' },
      ]),
    ).toBe('prac-b');
  });

  it('returns null when any-available has no resolved segment', () => {
    expect(practitionerIdForBookingCreate(ANY_AVAILABLE_PRACTITIONER_ID, null)).toBeNull();
    expect(practitionerIdForBookingCreate(ANY_AVAILABLE_PRACTITIONER_ID, [])).toBeNull();
  });
});
