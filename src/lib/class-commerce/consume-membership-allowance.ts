import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConsumeMembershipAllowanceParams {
  admin: SupabaseClient;
  membershipId: string;
  userId: string;
  venueId: string;
  sessions: number;
  bookingId: string;
  idempotencyKey: string;
}

/**
 * Append a `redeem` allowance-ledger row for a class booking.
 * Idempotent via the unique idempotency_key index. Caller has already verified
 * the remaining allowance via `membershipCoversClassType`.
 */
export async function consumeMembershipAllowanceForBooking(
  params: ConsumeMembershipAllowanceParams,
): Promise<
  | { ok: true }
  | { ok: false; reason: 'invalid_amount' | 'db_error' | 'ledger_failed' }
> {
  const { admin, membershipId, userId, venueId, sessions, bookingId, idempotencyKey } = params;
  if (sessions <= 0) return { ok: false, reason: 'invalid_amount' };

  // Treat existing redeem row for this booking as already-consumed (idempotency).
  const { data: existing } = await admin
    .from('class_membership_allowance_ledger')
    .select('id')
    .eq('membership_id', membershipId)
    .eq('booking_id', bookingId)
    .eq('reason', 'redeem')
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true };

  const { error: ledErr } = await admin.from('class_membership_allowance_ledger').insert({
    membership_id: membershipId,
    venue_id: venueId,
    user_id: userId,
    delta_sessions: -sessions,
    reason: 'redeem',
    booking_id: bookingId,
    idempotency_key: idempotencyKey,
    note: 'Redeemed for class booking',
  });
  if (ledErr) {
    if (/duplicate key|unique/i.test(ledErr.message)) return { ok: true };
    console.error('[consumeMembershipAllowance] ledger', ledErr);
    return { ok: false, reason: 'ledger_failed' };
  }
  return { ok: true };
}
