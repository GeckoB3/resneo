import { describe, expect, it } from 'vitest';
import {
  isBookingAccountLoginError,
  mergeGuestDetailsPrefill,
  venueRequiresAccountLoginForBooking,
} from '@/lib/booking/public-booking-account-gate';
import type { VenuePublic } from '@/components/booking/types';

describe('public-booking-account-gate helpers', () => {
  it('detects venue login requirement from public venue payload', () => {
    expect(
      venueRequiresAccountLoginForBooking({ require_account_login_for_bookings: true } as VenuePublic),
    ).toBe(true);
    expect(
      venueRequiresAccountLoginForBooking({ require_account_login_for_bookings: false } as VenuePublic),
    ).toBe(false);
  });

  it('recognises API auth failures for public booking', () => {
    expect(isBookingAccountLoginError(401, 'Sign in is required to book this venue.')).toBe(true);
    expect(
      isBookingAccountLoginError(403, 'Booking email must match the signed-in account for this venue.'),
    ).toBe(true);
    expect(isBookingAccountLoginError(409, 'Slot unavailable')).toBe(false);
  });

  it('merges signed-in email prefill over existing guest details', () => {
    expect(
      mergeGuestDetailsPrefill({ first_name: 'Alex', email: 'old@example.com' }, { email: 'new@example.com' }),
    ).toEqual({ first_name: 'Alex', email: 'new@example.com' });
  });
});
