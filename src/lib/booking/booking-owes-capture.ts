import type { SupabaseClient } from '@supabase/supabase-js';

/** Deposit states that still owe the capture (deposit-payment-robustness-plan). */
export const DEPOSIT_OWED_STATUSES = ['Pending', 'Failed'] as const;

export type CaptureUnitOwes = {
  owes: boolean;
  /** The lead row's deposit_status ('Pending' | 'Failed') when owing, else null. */
  depositStatus: string | null;
  /** Total money owed across the unit's owing rows (pence). */
  depositAmountPence: number;
  /** Total open unsaved hold fee across the unit (pence). */
  cardHoldFeePence: number;
  /** Every row id in the capture unit (the row itself, or all group siblings). */
  unitBookingIds: string[];
  /** The subset of unit rows that still owe their capture. */
  owingBookingIds: string[];
};

/**
 * Does this booking's CAPTURE UNIT still owe its deposit or card save?
 * (deposit-payment-robustness-plan 6.1). The unit is the row itself, or every
 * sibling sharing its `group_booking_id`: multi-service and group bookings
 * share one PaymentIntent, so accepting one row accepts the unit's debt.
 *
 * A row owes when `deposit_status IN ('Pending','Failed')` AND it either
 * carries a money deposit (`deposit_amount_pence > 0`) or an open unsaved card
 * hold (`released_at IS NULL AND stripe_payment_method_id IS NULL`).
 */
export async function bookingCaptureUnitOwesCapture(
  admin: SupabaseClient,
  params: {
    bookingId: string;
    venueId: string;
    groupBookingId: string | null;
  },
): Promise<CaptureUnitOwes> {
  const { bookingId, venueId, groupBookingId } = params;

  let query = admin
    .from('bookings')
    .select('id, deposit_status, deposit_amount_pence')
    .eq('venue_id', venueId)
    // Only LIVE rows can owe: a previously cancelled group sibling keeps its
    // stale 'Pending' deposit columns, and its dead debt must neither trip
    // the guard nor be "accepted".
    .in('status', ['Pending', 'Booked', 'Confirmed', 'Seated']);
  query = groupBookingId ? query.eq('group_booking_id', groupBookingId) : query.eq('id', bookingId);
  const { data: rowData, error: rowErr } = await query;
  if (rowErr) {
    // Fail closed: reporting "owes" on a read error blocks an accept with a
    // retryable message instead of silently promoting an unpaid unit.
    console.error('[bookingCaptureUnitOwesCapture] unit load failed:', rowErr, { bookingId });
    return {
      owes: true,
      depositStatus: null,
      depositAmountPence: 0,
      cardHoldFeePence: 0,
      unitBookingIds: [bookingId],
      owingBookingIds: [bookingId],
    };
  }

  const rows = (rowData ?? []) as Array<{
    id: string;
    deposit_status: string | null;
    deposit_amount_pence: number | null;
  }>;
  if (rows.length === 0) {
    return {
      owes: false,
      depositStatus: null,
      depositAmountPence: 0,
      cardHoldFeePence: 0,
      unitBookingIds: [bookingId],
      owingBookingIds: [],
    };
  }

  const unitBookingIds = rows.map((r) => r.id);

  const candidateRows = rows.filter((r) =>
    (DEPOSIT_OWED_STATUSES as readonly string[]).includes(r.deposit_status ?? ''),
  );

  let openHoldFeeByBookingId = new Map<string, number>();
  if (candidateRows.length > 0) {
    const { data: holdRows, error: holdErr } = await admin
      .from('booking_card_holds')
      .select('booking_id, fee_pence')
      .in('booking_id', candidateRows.map((r) => r.id))
      .is('released_at', null)
      .is('stripe_payment_method_id', null);
    if (holdErr) {
      console.error('[bookingCaptureUnitOwesCapture] hold load failed:', holdErr, { bookingId });
      return {
        owes: true,
        depositStatus: candidateRows[0]?.deposit_status ?? null,
        depositAmountPence: 0,
        cardHoldFeePence: 0,
        unitBookingIds,
        owingBookingIds: candidateRows.map((r) => r.id),
      };
    }
    openHoldFeeByBookingId = new Map(
      ((holdRows ?? []) as Array<{ booking_id: string; fee_pence: number | null }>).map((h) => [
        h.booking_id,
        h.fee_pence ?? 0,
      ]),
    );
  }

  const owingRows = candidateRows.filter(
    (r) => (r.deposit_amount_pence ?? 0) > 0 || openHoldFeeByBookingId.has(r.id),
  );

  const depositAmountPence = owingRows.reduce((sum, r) => sum + (r.deposit_amount_pence ?? 0), 0);
  const cardHoldFeePence = owingRows.reduce(
    (sum, r) => sum + (openHoldFeeByBookingId.get(r.id) ?? 0),
    0,
  );

  return {
    owes: owingRows.length > 0,
    depositStatus: owingRows[0]?.deposit_status ?? null,
    depositAmountPence,
    cardHoldFeePence,
    unitBookingIds,
    owingBookingIds: owingRows.map((r) => r.id),
  };
}
