import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * In-person payments (Tap to Pay / Terminal) — booking payment summary helpers.
 * Spec: Docs/TAP_TO_PAY_DESIGN_AND_IMPLEMENTATION.md §5.5–§5.7.
 *
 * The `booking_payments` ledger is the source of truth; these helpers derive
 * the denormalised `bookings.{amount_paid_pence, tip_amount_pence,
 * payment_state}` columns from it. App-layer (not a DB trigger) to match the
 * class-commerce ledger style and keep the derivation legible.
 */

export type BookingPaymentState =
  | 'unpaid'
  | 'deposit_paid'
  | 'partially_paid'
  | 'paid'
  | 'refunded';

/** The booking columns the total resolver reads. */
export interface BookingTotalInputs {
  booking_total_price_pence?: number | null;
  service_variant_price_pence?: number | null;
  addons_total_price_pence?: number | null;
}

/**
 * §5.7 — the appointment's full price in pence, or null when it cannot be
 * determined. `booking_total_price_pence` is only written for event tickets and
 * CSV imports, so appointments fall back to variant + add-ons. `null` means
 * "unknown" (free or un-priced): the balance is then staff-confirmable, never a
 * hard dependency.
 */
export function resolveBookingTotalPence(b: BookingTotalInputs): number | null {
  if (typeof b.booking_total_price_pence === 'number' && b.booking_total_price_pence > 0) {
    return b.booking_total_price_pence;
  }
  const variant =
    typeof b.service_variant_price_pence === 'number' && Number.isFinite(b.service_variant_price_pence)
      ? b.service_variant_price_pence
      : 0;
  const addons =
    typeof b.addons_total_price_pence === 'number' && Number.isFinite(b.addons_total_price_pence)
      ? b.addons_total_price_pence
      : 0;
  const computed = variant + addons;
  return computed > 0 ? computed : null; // null = unknown (free or un-priced)
}

/** Row shape {@link resolveBookingTotalPenceFromRow} reads off a bookings row. */
export interface BookingRowForTotal {
  booking_total_price_pence?: number | null;
  service_variant_id?: string | null;
  addons_total_price_pence?: number | null;
  venue_id?: string | null;
}

/**
 * Resolve a booking row's total, fetching the service-variant price when the
 * stored total is unusable. Contexts that already hold the variant price (the
 * detail-bundle routes) should call {@link resolveBookingTotalPence} directly.
 */
export async function resolveBookingTotalPenceFromRow(
  admin: SupabaseClient,
  booking: BookingRowForTotal,
): Promise<number | null> {
  if (
    typeof booking.booking_total_price_pence === 'number' &&
    booking.booking_total_price_pence > 0
  ) {
    return booking.booking_total_price_pence;
  }

  let variantPricePence: number | null = null;
  if (booking.service_variant_id) {
    const { data: variant, error } = await admin
      .from('service_variants')
      .select('price_pence')
      .eq('id', booking.service_variant_id)
      .maybeSingle();
    if (error) {
      // A missing variant price only widens the "unknown total" path (§5.7),
      // which is staff-confirmable — log and continue rather than failing.
      console.error('[payment-summary] service variant price load failed:', error.message, {
        serviceVariantId: booking.service_variant_id,
      });
    }
    const raw = (variant as { price_pence?: number | null } | null)?.price_pence;
    variantPricePence = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }

  return resolveBookingTotalPence({
    booking_total_price_pence: booking.booking_total_price_pence ?? null,
    service_variant_price_pence: variantPricePence,
    addons_total_price_pence: booking.addons_total_price_pence ?? null,
  });
}

/** Pure state derivation (§5.5) — exported for the truth-table tests. */
export function deriveBookingPaymentState(input: {
  totalPence: number | null;
  depositPaidPence: number;
  balancePaidPence: number;
  hasRefundedRow: boolean;
}): BookingPaymentState {
  const amountPaid = input.depositPaidPence + input.balancePaidPence;

  // Precedence (§5.5): 'refunded' only when a refunded ledger row exists AND
  // nothing remains paid. A refunded balance with a live deposit lands back on
  // 'deposit_paid' — the deposit flow owns its own refund lifecycle.
  if (input.hasRefundedRow && amountPaid === 0) return 'refunded';
  if (input.totalPence !== null && input.totalPence > 0 && amountPaid >= input.totalPence) {
    return 'paid';
  }
  // Unknown total (§5.7/§8-G): a balance payment can never prove "paid in
  // full", so it stays 'partially_paid' and the Take payment surface remains
  // available — that is the designed behaviour, not a fallback.
  if (amountPaid > 0 && input.balancePaidPence > 0) return 'partially_paid';
  if (amountPaid > 0) return 'deposit_paid';
  return 'unpaid';
}

/**
 * §5.6 — recompute `bookings.{amount_paid_pence, tip_amount_pence,
 * payment_state}` from the ledger. Called by the balance webhook, the
 * cash/external handler, and the refund paths. Throws on DB errors so webhook
 * callers release their idempotency claim and Stripe redelivers.
 */
export async function recomputeBookingPaymentSummary(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  const { data: bookingData, error: bookingErr } = await admin
    .from('bookings')
    .select(
      'id, venue_id, booking_total_price_pence, service_variant_id, addons_total_price_pence, deposit_status, deposit_amount_pence',
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (bookingErr) {
    console.error('[payment-summary] booking load failed:', bookingErr.message, { bookingId });
    throw bookingErr;
  }
  const booking = bookingData as
    | {
        booking_total_price_pence: number | null;
        service_variant_id: string | null;
        addons_total_price_pence: number | null;
        deposit_status: string | null;
        deposit_amount_pence: number | null;
      }
    | null;
  if (!booking) {
    console.warn('[payment-summary] booking not found, skipping recompute', { bookingId });
    return;
  }

  const { data: ledgerData, error: ledgerErr } = await admin
    .from('booking_payments')
    .select('amount_pence, tip_amount_pence, status')
    .eq('booking_id', bookingId);
  if (ledgerErr) {
    console.error('[payment-summary] ledger load failed:', ledgerErr.message, { bookingId });
    throw ledgerErr;
  }
  const rows = (ledgerData ?? []) as Array<{
    amount_pence: number;
    tip_amount_pence: number;
    status: string;
  }>;

  const totalPence = await resolveBookingTotalPenceFromRow(admin, booking);

  // A paid deposit counts toward amount_paid (§5.3 backfill parity). Waived /
  // Forfeited / Not Required deposits contribute nothing.
  const depositPaidPence =
    booking.deposit_status === 'Paid' ? Math.max(0, booking.deposit_amount_pence ?? 0) : 0;

  let balancePaidPence = 0;
  let tipPaidPence = 0;
  let hasRefundedRow = false;
  for (const row of rows) {
    if (row.status === 'succeeded') {
      balancePaidPence += row.amount_pence;
      tipPaidPence += row.tip_amount_pence;
    } else if (row.status === 'refunded') {
      hasRefundedRow = true;
    }
  }

  const paymentState = deriveBookingPaymentState({
    totalPence,
    depositPaidPence,
    balancePaidPence,
    hasRefundedRow,
  });

  const { error: updateErr } = await admin
    .from('bookings')
    .update({
      amount_paid_pence: depositPaidPence + balancePaidPence,
      tip_amount_pence: tipPaidPence,
      payment_state: paymentState,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId);
  if (updateErr) {
    console.error('[payment-summary] summary update failed:', updateErr.message, { bookingId });
    throw updateErr;
  }
}
