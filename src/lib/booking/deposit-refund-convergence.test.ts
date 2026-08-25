import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/stripe', () => ({
  stripe: { paymentIntents: { retrieve: vi.fn() } },
}));

import { stripe } from '@/lib/stripe';
import { classifyDepositRefundFailure } from './deposit-refund-convergence';

const mockRetrieve = vi.mocked(stripe.paymentIntents.retrieve);

const PARAMS = { paymentIntentId: 'pi_1', stripeAccountId: 'acct_1' };

/** PM-1: which refund failures are safe to cancel through, and which are not. */
describe('classifyDepositRefundFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('treats charge_already_refunded as refunded without reading the intent', async () => {
    const result = await classifyDepositRefundFailure({ code: 'charge_already_refunded' }, PARAMS);

    expect(result).toBe('refunded');
    // The money is already back; no need to spend a Stripe read to learn that.
    expect(mockRetrieve).not.toHaveBeenCalled();
  });

  it('treats a cancelled intent as nothing to refund (the record_cash case)', async () => {
    mockRetrieve.mockResolvedValue({ id: 'pi_1', status: 'canceled' } as never);

    const result = await classifyDepositRefundFailure(new Error('cannot refund'), PARAMS);

    expect(result).toBe('nothing_to_refund');
  });

  it('fails on a succeeded intent: real money that genuinely did not refund', async () => {
    mockRetrieve.mockResolvedValue({ id: 'pi_1', status: 'succeeded' } as never);

    const result = await classifyDepositRefundFailure(new Error('network blip'), PARAMS);

    expect(result).toBe('failed');
  });

  it('fails on a processing intent rather than converging early', async () => {
    mockRetrieve.mockResolvedValue({ id: 'pi_1', status: 'processing' } as never);

    expect(await classifyDepositRefundFailure(new Error('nope'), PARAMS)).toBe('failed');
  });

  it('fails when the intent cannot be read: never converge on an unknown', async () => {
    mockRetrieve.mockRejectedValue(new Error('stripe unreachable'));

    const result = await classifyDepositRefundFailure(new Error('cannot refund'), PARAMS);

    expect(result).toBe('failed');
  });

  it('does not converge on requires_payment_method, which is a real inconsistency', async () => {
    // A row claiming Paid whose intent never collected is a data problem worth
    // surfacing, not something to cancel silently through.
    mockRetrieve.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method' } as never);

    expect(await classifyDepositRefundFailure(new Error('cannot refund'), PARAMS)).toBe('failed');
  });
});
