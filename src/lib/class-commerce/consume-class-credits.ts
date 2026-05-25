import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConsumeClassCreditsParams {
  admin: SupabaseClient;
  userId: string;
  venueId: string;
  credits: number;
  bookingId: string;
  idempotencyKey: string;
  /** When set, only balances from packs that apply to this class type are consumed. */
  classTypeId?: string;
}

/**
 * FIFO by expires_at (NULL last), then created_at. Idempotent via ledger
 * idempotency_key per batch. Uses the Postgres RPC `consume_class_credits_atomically`
 * which holds a transaction-scoped advisory lock keyed by (user, venue) to
 * prevent double-spend under concurrent class bookings.
 */
export async function consumeClassCreditsForBooking(
  params: ConsumeClassCreditsParams,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { admin, userId, venueId, credits, bookingId, idempotencyKey, classTypeId } = params;
  if (credits <= 0) return { ok: false, reason: 'invalid_amount' };

  const { data, error } = await admin.rpc('consume_class_credits_atomically', {
    p_user: userId,
    p_venue: venueId,
    p_credits: credits,
    p_booking_id: bookingId,
    p_class_type_id: classTypeId ?? null,
    p_idempotency_prefix: idempotencyKey,
  });

  if (error) {
    console.error('[consumeClassCreditsForBooking] rpc', error);
    return { ok: false, reason: 'db_error' };
  }

  // RPC returns TABLE(status text, reason text, credits_consumed int) — array of rows.
  const rows = (data ?? []) as Array<{
    status?: string;
    reason?: string | null;
    credits_consumed?: number;
  }>;
  const row = rows[0];
  if (!row) {
    // No row implies the RPC did nothing meaningful — treat as failure.
    return { ok: false, reason: 'db_error' };
  }
  if (row.status === 'ok') return { ok: true };
  return { ok: false, reason: row.reason ?? 'unknown' };
}
