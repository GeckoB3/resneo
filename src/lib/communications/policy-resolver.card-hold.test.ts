import { describe, expect, it, vi } from 'vitest';

// getVenueCommunicationPolicies and resolveCommPolicy both read the venues
// table; returning null data falls back to the default policies, which is
// exactly what these tests assert against.
vi.mock('@/lib/supabase', () => {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { getSupabaseAdminClient: () => ({ from }) };
});

vi.mock('@/lib/tier-enforcement', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/tier-enforcement')>();
  return { ...mod, isSmsAllowed: vi.fn().mockResolvedValue(true) };
});

vi.mock('@/lib/stripe/venue-customer-payment', () => ({
  venueHasStripePaymentMethodForSms: vi.fn().mockResolvedValue(true),
}));

import { resolveCommPolicy } from './policy-resolver';

describe('card-hold policy resolution and log-type mapping', () => {
  it('card_hold_request defaults to email + SMS and maps to card_hold_request_email/sms', async () => {
    const resolved = await resolveCommPolicy({
      venueId: 'venue-hold-1',
      messageKey: 'card_hold_request',
      bookingModel: 'unified_scheduling',
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.channels).toEqual(['email', 'sms']);
    expect(resolved.logMessageTypeByChannel).toEqual({
      email: 'card_hold_request_email',
      sms: 'card_hold_request_sms',
    });
  });

  it('card_hold_payment_reminder defaults to email + SMS and maps to card_hold_payment_reminder_email/sms', async () => {
    const resolved = await resolveCommPolicy({
      venueId: 'venue-hold-1',
      messageKey: 'card_hold_payment_reminder',
      bookingModel: 'table_reservation',
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.channels).toEqual(['email', 'sms']);
    expect(resolved.logMessageTypeByChannel).toEqual({
      email: 'card_hold_payment_reminder_email',
      sms: 'card_hold_payment_reminder_sms',
    });
  });
});
