import { describe, expect, it } from 'vitest';
import {
  bookingIdFromParams,
  redirectModeFromParams,
  redirectStatusFromParams,
} from './redirect-params';

describe('redirectStatusFromParams', () => {
  it('maps Stripe redirect_status values', () => {
    expect(redirectStatusFromParams('succeeded')).toBe('succeeded');
    expect(redirectStatusFromParams('failed')).toBe('failed');
    expect(redirectStatusFromParams('processing')).toBe('pending');
  });

  it('treats a missing or unknown status as succeeded (direct visit)', () => {
    expect(redirectStatusFromParams(null)).toBe('succeeded');
    expect(redirectStatusFromParams('something_else')).toBe('succeeded');
  });
});

describe('redirectModeFromParams (spec 7.7)', () => {
  it('detects setup mode from setup_intent', () => {
    const params = new URLSearchParams({ setup_intent: 'seti_123', redirect_status: 'succeeded' });
    expect(redirectModeFromParams(params)).toBe('setup');
  });

  it('detects setup mode from setup_intent_client_secret alone', () => {
    const params = new URLSearchParams({ setup_intent_client_secret: 'seti_123_secret_abc' });
    expect(redirectModeFromParams(params)).toBe('setup');
  });

  it('is payment mode when payment_intent params are present', () => {
    const params = new URLSearchParams({
      payment_intent: 'pi_123',
      payment_intent_client_secret: 'pi_123_secret_abc',
      redirect_status: 'succeeded',
    });
    expect(redirectModeFromParams(params)).toBe('payment');
  });

  it('defaults to payment mode with no Stripe params at all', () => {
    expect(redirectModeFromParams(new URLSearchParams())).toBe('payment');
  });
});

describe('bookingIdFromParams', () => {
  it('returns the booking_id the /pay page embedded in the return_url', () => {
    const params = new URLSearchParams({ booking_id: 'b-123', setup_intent: 'seti_1' });
    expect(bookingIdFromParams(params)).toBe('b-123');
  });

  it('returns null when absent or blank', () => {
    expect(bookingIdFromParams(new URLSearchParams())).toBeNull();
    expect(bookingIdFromParams(new URLSearchParams({ booking_id: '  ' }))).toBeNull();
  });
});
