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
    let query = admin
      .from('service_variants')
      .select('price_pence')
      .eq('id', booking.service_variant_id);
    // Defence in depth: scope to the owning venue when known, mirroring the
    // detail-bundle RPC's `sv.venue_id = p_venue_id` filter.
    if (booking.venue_id) query = query.eq('venue_id', booking.venue_id);
    const { data: variant, error } = await query.maybeSingle();
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

/** §5.3/§5.6 — the paid deposit's contribution to amount_paid. Waived /
 * Forfeited / Not Required / Refunded deposits contribute nothing. */
export function depositPaidContributionPence(booking: {
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
}): number {
  return booking.deposit_status === 'Paid' ? Math.max(0, booking.deposit_amount_pence ?? 0) : 0;
}

export interface BookingLedgerSums {
  balancePaidPence: number;
  tipPaidPence: number;
  hasRefundedRow: boolean;
}

/** Sum ledger rows for one or more bookings, per booking id and in total. */
export async function sumSucceededBookingPayments(
  admin: SupabaseClient,
  bookingIds: string | string[],
): Promise<BookingLedgerSums & { perBooking: Map<string, BookingLedgerSums> }> {
  const ids = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
  const empty = (): BookingLedgerSums => ({
    balancePaidPence: 0,
    tipPaidPence: 0,
    hasRefundedRow: false,
  });
  const totals = { ...empty(), perBooking: new Map<string, BookingLedgerSums>() };
  if (ids.length === 0) return totals;

  const { data, error } = await admin
    .from('booking_payments')
    .select('booking_id, amount_pence, tip_amount_pence, status')
    .in('booking_id', ids);
  if (error) {
    console.error('[payment-summary] ledger load failed:', error.message, { bookingIds: ids });
    throw error;
  }

  for (const id of ids) totals.perBooking.set(id, empty());
  for (const row of (data ?? []) as Array<{
    booking_id: string;
    amount_pence: number;
    tip_amount_pence: number;
    status: string;
  }>) {
    const per = totals.perBooking.get(row.booking_id) ?? empty();
    if (row.status === 'succeeded') {
      per.balancePaidPence += row.amount_pence;
      per.tipPaidPence += row.tip_amount_pence;
      totals.balancePaidPence += row.amount_pence;
      totals.tipPaidPence += row.tip_amount_pence;
    } else if (row.status === 'refunded') {
      per.hasRefundedRow = true;
      totals.hasRefundedRow = true;
    }
    totals.perBooking.set(row.booking_id, per);
  }
  return totals;
}

/** The booking columns a visit picture needs from each row in the visit. */
export interface VisitBookingRow {
  id: string;
  venue_id?: string | null;
  group_booking_id?: string | null;
  booking_total_price_pence?: number | null;
  service_variant_id?: string | null;
  addons_total_price_pence?: number | null;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
}

/**
 * The money picture for a whole **visit** — every `bookings` row sharing the
 * anchor's `group_booking_id` (a multi-service visit or group booking), or
 * just the anchor row when it has none.
 *
 * Taking payment settles the visit, not the opened line: a cut + colour visit
 * is one collection. Amounts are always derived LIVE (paid deposits +
 * succeeded ledger rows) — never from `bookings.amount_paid_pence`, which only
 * refreshes on in-person payment activity and would omit a deposit paid since.
 */
/**
 * One priced line of a visit, so the app can show what each service costs
 * instead of only the visit total. Names are resolved from `service_variants`
 * and are only populated for a real multi-line visit (a standalone booking
 * already carries `service_variant_name` on the detail payload).
 */
export interface VisitPaymentLine {
  booking_id: string;
  /** Service/option name when resolvable; null for an unnamed or non-variant line. */
  name: string | null;
  /** This line's resolved price; null when it cannot be determined (§5.7). */
  total_pence: number | null;
}

export interface VisitPaymentPicture {
  /** Every booking row in the visit (always includes the anchor). */
  rows: VisitBookingRow[];
  bookingIds: string[];
  /** Per-line names + prices, in the same order as `rows`. */
  lines: VisitPaymentLine[];
  /** This row's own resolved price (unchanged single-booking meaning). */
  anchorTotalPence: number | null;
  /** Visit price. null when ANY row's price is unresolvable (§5.7). */
  totalPence: number | null;
  /** Visit paid: deposits across rows + all succeeded ledger rows. */
  amountPaidPence: number;
  /** null when the visit total is unknown. */
  balanceDuePence: number | null;
  paymentState: BookingPaymentState;
  ledger: BookingLedgerSums & { perBooking: Map<string, BookingLedgerSums> };
  depositPaidByBooking: Map<string, number>;
}

/**
 * Build the visit picture for a booking. Pass the already-loaded anchor row
 * (routes hold it from `loadStaffAccessibleBooking`) to avoid re-reading it.
 *
 * Cost: at most three queries (siblings, variant prices, ledger), and only one
 * when the booking is a standalone appointment with a known price.
 */
export async function loadVisitPaymentPicture(
  admin: SupabaseClient,
  anchor: VisitBookingRow,
  opts?: {
    /** Anchor's variant price when the caller already has it (detail bundle). */
    anchorServiceVariantPricePence?: number | null;
    /** Scope siblings to this venue; defaults to the anchor's own venue. */
    venueId?: string | null;
  },
): Promise<VisitPaymentPicture> {
  const venueId = opts?.venueId ?? anchor.venue_id ?? null;

  let rows: VisitBookingRow[] = [anchor];
  const groupId = anchor.group_booking_id ?? null;
  if (groupId) {
    let q = admin
      .from('bookings')
      .select(
        'id, venue_id, group_booking_id, booking_total_price_pence, service_variant_id, addons_total_price_pence, deposit_status, deposit_amount_pence, status',
      )
      .eq('group_booking_id', groupId);
    // Never let a group id reach across venues.
    if (venueId) q = q.eq('venue_id', venueId);
    const { data, error } = await q;
    if (error) {
      console.error('[payment-summary] visit sibling load failed:', error.message, { groupId });
      throw error;
    }
    const loaded = (data ?? []) as Array<VisitBookingRow & { status?: string | null }>;
    // Cancelled lines are not owed for, so they never inflate the visit total.
    const live = loaded.filter((r) => r.status !== 'Cancelled' || r.id === anchor.id);
    if (live.length > 0) rows = live;
  }

  // Variant prices for rows that need one, in a single batched query.
  const variantPrices = new Map<string, number>();
  const variantNames = new Map<string, string>();
  if (opts?.anchorServiceVariantPricePence != null && anchor.service_variant_id) {
    variantPrices.set(anchor.service_variant_id, opts.anchorServiceVariantPricePence);
  }
  const needPrice = rows
    .filter(
      (r) => !(typeof r.booking_total_price_pence === 'number' && r.booking_total_price_pence > 0),
    )
    .map((r) => r.service_variant_id)
    .filter((v): v is string => typeof v === 'string' && !variantPrices.has(v));
  // Names label the per-line breakdown, which only exists for a real visit. A
  // standalone booking already carries `service_variant_name` from the detail
  // bundle, so asking for names there would cost a second query for nothing and
  // lose this function's single-query fast path.
  const needName =
    rows.length > 1
      ? rows
          .map((r) => r.service_variant_id)
          .filter((v): v is string => typeof v === 'string')
      : [];
  const needed = [...new Set([...needPrice, ...needName])];
  if (needed.length > 0) {
    let vq = admin.from('service_variants').select('id, price_pence, name').in('id', needed);
    if (venueId) vq = vq.eq('venue_id', venueId);
    const { data, error } = await vq;
    if (error) {
      // A missing variant price only widens the "unknown total" path (§5.7),
      // which is staff-confirmable — log and continue rather than failing.
      console.error('[payment-summary] visit variant price load failed:', error.message);
    }
    for (const v of (data ?? []) as Array<{
      id: string;
      price_pence: number | null;
      name: string | null;
    }>) {
      // Never overwrite the caller's authoritative anchor price.
      if (
        typeof v.price_pence === 'number' &&
        Number.isFinite(v.price_pence) &&
        !variantPrices.has(v.id)
      ) {
        variantPrices.set(v.id, v.price_pence);
      }
      if (typeof v.name === 'string' && v.name.trim()) variantNames.set(v.id, v.name.trim());
    }
  }

  const rowTotal = (r: VisitBookingRow): number | null =>
    resolveBookingTotalPence({
      booking_total_price_pence: r.booking_total_price_pence ?? null,
      service_variant_price_pence: r.service_variant_id
        ? (variantPrices.get(r.service_variant_id) ?? null)
        : null,
      addons_total_price_pence: r.addons_total_price_pence ?? null,
    });

  // Visit total: the sum, but UNKNOWN if any line is unresolvable. Treating an
  // unresolvable line as £0 would silently understate the visit and the clamp
  // would then block staff from collecting the rest (§5.7 / §8-G: unknown means
  // the staff enter the amount).
  let totalPence: number | null = 0;
  for (const r of rows) {
    const t = rowTotal(r);
    if (t === null) {
      totalPence = null;
      break;
    }
    totalPence += t;
  }

  const depositPaidByBooking = new Map<string, number>();
  let depositPaidPence = 0;
  for (const r of rows) {
    const d = depositPaidContributionPence(r);
    depositPaidByBooking.set(r.id, d);
    depositPaidPence += d;
  }

  const bookingIds = rows.map((r) => r.id);
  const ledger = await sumSucceededBookingPayments(admin, bookingIds);
  const amountPaidPence = depositPaidPence + ledger.balancePaidPence;

  return {
    rows,
    bookingIds,
    lines: rows.map((r) => ({
      booking_id: r.id,
      name: r.service_variant_id ? (variantNames.get(r.service_variant_id) ?? null) : null,
      total_pence: rowTotal(r),
    })),
    anchorTotalPence: rowTotal(anchor),
    totalPence,
    amountPaidPence,
    balanceDuePence: totalPence === null ? null : Math.max(0, totalPence - amountPaidPence),
    paymentState: deriveBookingPaymentState({
      totalPence,
      depositPaidPence,
      balancePaidPence: ledger.balancePaidPence,
      hasRefundedRow: ledger.hasRefundedRow,
    }),
    ledger,
    depositPaidByBooking,
  };
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
 * §5.6 — recompute the denormalised `bookings.{amount_paid_pence,
 * tip_amount_pence, payment_state}` cache from the ledger, for **every row in
 * the visit** (settlement is visit-scoped, §5.7). Called by the balance
 * webhook, the cash/external handler, and the refund paths. Throws on DB
 * errors so webhook callers release their idempotency claim and Stripe
 * redelivers.
 *
 * Cache semantics, deliberately mixed so both readings stay correct:
 * - `amount_paid_pence` / `tip_amount_pence` are **per row** (its own paid
 *   deposit + the ledger rows anchored to it), so summing the column across
 *   bookings for revenue reporting never double-counts a visit payment.
 * - `payment_state` is the **visit** state, because a visit is settled as one
 *   unit: every line of a paid visit reads `paid`.
 */
export async function recomputeBookingPaymentSummary(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  const { data: bookingData, error: bookingErr } = await admin
    .from('bookings')
    .select(
      'id, venue_id, group_booking_id, booking_total_price_pence, service_variant_id, addons_total_price_pence, deposit_status, deposit_amount_pence',
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (bookingErr) {
    console.error('[payment-summary] booking load failed:', bookingErr.message, { bookingId });
    throw bookingErr;
  }
  const booking = (bookingData ?? null) as VisitBookingRow | null;
  if (!booking) {
    console.warn('[payment-summary] booking not found, skipping recompute', { bookingId });
    return;
  }

  const visit = await loadVisitPaymentPicture(admin, booking);

  for (const row of visit.rows) {
    const per = visit.ledger.perBooking.get(row.id);
    const ownDeposit = visit.depositPaidByBooking.get(row.id) ?? 0;
    const { error: updateErr } = await admin
      .from('bookings')
      .update({
        amount_paid_pence: ownDeposit + (per?.balancePaidPence ?? 0),
        tip_amount_pence: per?.tipPaidPence ?? 0,
        payment_state: visit.paymentState,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (updateErr) {
      console.error('[payment-summary] summary update failed:', updateErr.message, {
        bookingId: row.id,
      });
      throw updateErr;
    }
  }
}
