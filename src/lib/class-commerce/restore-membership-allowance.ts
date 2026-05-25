import type { SupabaseClient } from '@supabase/supabase-js';

export interface RestoreMembershipAllowanceParams {
  admin: SupabaseClient;
  bookingId: string;
  /** Stamped onto each restore ledger row alongside the booking id for traceability. */
  idempotencyPrefix: string;
}

export interface RestoreMembershipAllowanceResult {
  ok: true;
  restoredSessions: number;
}

/**
 * Reverse all `redeem` rows previously written against `bookingId` by appending
 * matching `restore` rows. Idempotent: re-running produces no new rows because
 * the idempotency_key is derived from the redeem id.
 *
 * Returns 0 if the booking was never charged against a membership.
 */
export async function restoreMembershipAllowanceForBooking(
  params: RestoreMembershipAllowanceParams,
): Promise<RestoreMembershipAllowanceResult> {
  const { admin, bookingId, idempotencyPrefix } = params;

  const { data: redeemRows, error } = await admin
    .from('class_membership_allowance_ledger')
    .select('id, membership_id, venue_id, user_id, delta_sessions')
    .eq('booking_id', bookingId)
    .eq('reason', 'redeem');

  if (error) {
    console.error('[restoreMembershipAllowance] select', error);
    return { ok: true, restoredSessions: 0 };
  }

  let restored = 0;
  for (const r of (redeemRows ?? []) as Array<{
    id: string;
    membership_id: string;
    venue_id: string;
    user_id: string;
    delta_sessions: number;
  }>) {
    if (r.delta_sessions >= 0) continue; // not a real redeem
    const sessions = -r.delta_sessions;
    const idempotencyKey = `${idempotencyPrefix}:restore:${r.id}`;
    const { error: insErr } = await admin.from('class_membership_allowance_ledger').insert({
      membership_id: r.membership_id,
      venue_id: r.venue_id,
      user_id: r.user_id,
      delta_sessions: sessions,
      reason: 'restore',
      booking_id: bookingId,
      idempotency_key: idempotencyKey,
      note: 'Restored on booking cancellation',
    });
    if (insErr) {
      if (/duplicate key|unique/i.test(insErr.message)) continue;
      console.error('[restoreMembershipAllowance] insert', insErr);
      continue;
    }
    restored += sessions;
  }

  return { ok: true, restoredSessions: restored };
}
