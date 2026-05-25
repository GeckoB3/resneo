import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * True when the named booking has any `redeem` row in the credit ledger — i.e.
 * one or more class credits were spent on it. Used to decide whether to invoke
 * `restoreClassCreditsForBooking` on cancellation.
 */
export async function bookingWasCreditPaid(
  admin: SupabaseClient,
  bookingId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('class_credit_ledger')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('reason', 'redeem')
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

/**
 * True when the booking has any `redeem` row in the membership allowance ledger.
 */
export async function bookingWasMembershipPaid(
  admin: SupabaseClient,
  bookingId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('class_membership_allowance_ledger')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('reason', 'redeem')
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}
