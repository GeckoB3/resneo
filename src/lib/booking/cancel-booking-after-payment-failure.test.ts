import { describe, expect, it, vi } from 'vitest';
import {
  cancelBookingAfterPaymentFailure,
  PAYMENT_SETUP_FAILED_NOTE,
} from '@/lib/booking/cancel-booking-after-payment-failure';
import { isCapacityConsumingStatus } from '@/lib/availability/capacity-status';

/**
 * These bookings used to be hard-deleted, so a venue whose Stripe account was
 * connected but not yet charge-enabled turned paying guests away with no trace
 * anywhere in the dashboard.
 */
function stubAdmin(error: { message: string } | null = null) {
  const update = vi.fn((_patch: Record<string, unknown>) => ({
    eq: async () => ({ error }),
  }));
  const from = vi.fn((_table: string) => ({ update }));
  return { client: { from } as never, from, update };
}

describe('cancelBookingAfterPaymentFailure', () => {
  it('cancels the booking instead of deleting it, and records why', async () => {
    const { client, from, update } = stubAdmin();
    await cancelBookingAfterPaymentFailure(client, 'booking-1', PAYMENT_SETUP_FAILED_NOTE);

    expect(from).toHaveBeenCalledWith('bookings');
    const patch = update.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.status).toBe('Cancelled');
    expect(patch.deposit_status).toBe('Failed');
    expect(patch.cancellation_actor_type).toBe('system');
    expect(patch.internal_notes).toBe(PAYMENT_SETUP_FAILED_NOTE);
  });

  it('leaves the slot free: Cancelled does not consume capacity', () => {
    expect(isCapacityConsumingStatus('Cancelled')).toBe(false);
    // Sanity: the statuses a live booking uses do hold the slot.
    expect(isCapacityConsumingStatus('Pending')).toBe(true);
    expect(isCapacityConsumingStatus('Booked')).toBe(true);
  });

  it('swallows a database error so it never masks the original Stripe failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = stubAdmin({ message: 'db down' });
    await expect(
      cancelBookingAfterPaymentFailure(client, 'booking-1', PAYMENT_SETUP_FAILED_NOTE),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('the note tells the owner where to look', () => {
    expect(PAYMENT_SETUP_FAILED_NOTE).toMatch(/Stripe/);
    expect(PAYMENT_SETUP_FAILED_NOTE).toMatch(/Payments/);
  });
});
