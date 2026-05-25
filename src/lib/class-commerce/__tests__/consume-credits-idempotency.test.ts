import { describe, it, expect, vi, beforeEach } from 'vitest';
import { consumeClassCreditsForBooking } from '@/lib/class-commerce/consume-class-credits';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The credit-consume helper delegates to the `consume_class_credits_atomically`
 * Postgres function (Phase 2 §5.2). These tests assert the wrapper translates
 * RPC results into the public { ok } / { ok: false, reason } shape.
 */
describe('consumeClassCreditsForBooking', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok when the RPC reports ok (existing redeem row inside the function => same result)', async () => {
    const rpc = vi.fn(async () => ({ data: [{ status: 'ok', reason: null, credits_consumed: 0 }], error: null }));
    const admin = { rpc } as unknown as SupabaseClient;

    const res = await consumeClassCreditsForBooking({
      admin,
      userId: 'u1',
      venueId: 'v1',
      credits: 2,
      bookingId: 'b1',
      idempotencyKey: 'k1',
    });
    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'consume_class_credits_atomically',
      expect.objectContaining({
        p_user: 'u1',
        p_venue: 'v1',
        p_credits: 2,
        p_booking_id: 'b1',
        p_idempotency_prefix: 'k1',
      }),
    );
  });

  it('propagates insufficient_credits from the RPC', async () => {
    const admin = {
      rpc: async () => ({ data: [{ status: 'error', reason: 'insufficient_credits' }], error: null }),
    } as unknown as SupabaseClient;
    const res = await consumeClassCreditsForBooking({
      admin,
      userId: 'u1',
      venueId: 'v1',
      credits: 5,
      bookingId: 'b1',
      idempotencyKey: 'k1',
    });
    expect(res).toEqual({ ok: false, reason: 'insufficient_credits' });
  });

  it('returns invalid_amount without calling RPC when credits <= 0', async () => {
    const rpc = vi.fn();
    const admin = { rpc } as unknown as SupabaseClient;
    const res = await consumeClassCreditsForBooking({
      admin,
      userId: 'u1',
      venueId: 'v1',
      credits: 0,
      bookingId: 'b1',
      idempotencyKey: 'k1',
    });
    expect(res).toEqual({ ok: false, reason: 'invalid_amount' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
