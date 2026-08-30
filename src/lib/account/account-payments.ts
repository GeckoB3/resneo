import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase';

/**
 * What a customer is shown of a payment.
 *
 * **This list is the security boundary, not a convenience.** The ledger row
 * carries `stripe_payment_intent_id`, `stripe_connected_account_id`,
 * `staff_id`, a free-text `note` and a raw `metadata` blob, none of which
 * belong to the customer: two are ResNeo's payment plumbing, one names an
 * employee, and the last two are written by staff for staff and can say
 * anything at all. `accountPaymentProjection` is the only way a row becomes
 * one of these, so the omission cannot be undone by a caller selecting `*`.
 */
export interface AccountPaymentRow {
  id: string;
  booking_id: string;
  venue_id: string;
  /** `card_present`, `cash`, `external` or `online`. */
  method: string;
  /** `pending`, `succeeded`, `failed` or `refunded`. */
  status: string;
  amount_pence: number;
  currency: string;
  /** The venue's own label for the row, e.g. "balance". */
  purpose: string;
  created_at: string;
}

/** Exactly the columns above, as a PostgREST select list. */
export const ACCOUNT_PAYMENT_COLUMNS =
  'id, booking_id, venue_id, method, status, amount_pence, currency, purpose, created_at';

/**
 * Fields that must never reach a customer, named so a test can assert their
 * absence from a real response body rather than trusting the select string.
 */
export const ACCOUNT_PAYMENT_FORBIDDEN_FIELDS = [
  'stripe_payment_intent_id',
  'stripe_connected_account_id',
  'staff_id',
  'note',
  'metadata',
] as const;

/**
 * `tip_amount_pence` is NOT projected, and that is a product decision rather
 * than a security one: the ledger comments it as "RESERVED, unused in v1", so
 * every row carries zero. A tip line showing 0.00 on every receipt is worse
 * than no tip line, and it can be added the day tipping ships.
 */

function toRow(raw: Record<string, unknown>): AccountPaymentRow {
  return {
    id: String(raw.id),
    booking_id: String(raw.booking_id),
    venue_id: String(raw.venue_id),
    method: String(raw.method ?? ''),
    status: String(raw.status ?? ''),
    amount_pence: Number(raw.amount_pence ?? 0),
    currency: String(raw.currency ?? 'gbp'),
    purpose: String(raw.purpose ?? ''),
    created_at: String(raw.created_at ?? ''),
  };
}

export type AccountPaymentsResult = {
  payments: AccountPaymentRow[];
  /** Booking ids the caller owns, so a caller can tell "none" from "not yours". */
  ownedBookingIds: string[];
};

/**
 * Payments for the caller's bookings.
 *
 * **Ownership first, then the ledger as admin** (AD8, applied to a second
 * table). `booking_payments` has RLS enabled with NO policies, so it is
 * service-role only and there is no customer projection to read it through.
 * The safe shape is therefore: resolve which bookings are the caller's using
 * `bookings_account_safe` on the SESSION client, whose `WHERE` clause is the
 * ownership predicate, and only then read the ledger as admin filtered to
 * exactly those ids. The admin client is never asked a question whose answer
 * was not already bounded by the session client.
 *
 * Passing `bookingId` narrows to one booking, and a booking that is not the
 * caller's simply is not in the owned set, so it returns nothing rather than
 * anything about someone else's payment.
 */
export async function loadAccountPayments(
  session: SupabaseClient,
  admin: SupabaseClient = getSupabaseAdminClient(),
  opts: { bookingId?: string | null; limit?: number } = {},
): Promise<AccountPaymentsResult> {
  const ownership = session.from('bookings_account_safe').select('id');
  const { data: owned, error: ownedErr } = opts.bookingId
    ? await ownership.eq('id', opts.bookingId)
    : await ownership;

  if (ownedErr) {
    console.error('[loadAccountPayments] ownership read failed:', ownedErr.message);
    throw new Error('Failed to load payments');
  }

  const ownedBookingIds = (owned ?? [])
    .map((r) => String((r as { id?: unknown }).id ?? ''))
    .filter(Boolean);

  // No owned bookings means no query at all: an empty `.in()` would either
  // error or, worse, be read as "no filter" by a future refactor.
  if (ownedBookingIds.length === 0) return { payments: [], ownedBookingIds };

  const { data, error } = await admin
    .from('booking_payments')
    .select(ACCOUNT_PAYMENT_COLUMNS)
    .in('booking_id', ownedBookingIds)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 200);

  if (error) {
    console.error('[loadAccountPayments] payments read failed:', error.message);
    throw new Error('Failed to load payments');
  }

  return {
    payments: (data ?? []).map((r) => toRow(r as Record<string, unknown>)),
    ownedBookingIds,
  };
}
