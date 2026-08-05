import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';
import {
  linkedGrantAllowsMutation,
  loadStaffAccessibleBooking,
} from '@/lib/booking/staff-booking-access';
import {
  loadVisitPaymentPicture,
  recomputeBookingPaymentSummary,
  visitAnchorFromBooking,
} from '@/lib/booking/payment-summary';
import { recordBookingWriteAudit } from '@/lib/linked-accounts/audit';

/** §5.7 — cap for staff-entered amounts when the price is unknown (£1,000). */
const MAX_IN_PERSON_PENCE = 100_000;

/** Pence → "£1,000.00" for an error message. Errors are English-only, as elsewhere. */
function formatPenceForError(pence: number): string {
  return `£${(pence / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const schema = z.object({
  method: z.enum(['card_present', 'cash', 'external']).optional(),
  action: z.literal('refund').optional(), // admin-only; always full (v1, §6.3a)
  // Charges only — refunds ignore it. Omit = full balance (when known).
  // The MAX_IN_PERSON_PENCE cap is deliberately NOT a `.max()` here: a schema
  // breach fails parse and returns a bare `{ error: 'Invalid request' }`, which
  // is unusable to a client and left staff with no idea a cap existed. It is
  // enforced below instead, with a message and a code.
  amount_pence: z.number().int().min(1).optional(),
  // REQUIRED for card_present: client-generated once per payment attempt.
  // Keys the PI idempotency so equal-amount split payments never collide (§6.3c).
  attempt_id: z.string().uuid().optional(),
  payment_id: z.string().uuid().optional(), // refund: which ledger row
  note: z.string().max(500).optional(),
  // §7A.8 — which card-present channel collected it (reporting only).
  reader_type: z.enum(['tap_to_pay', 'bluetooth']).optional(),
});

/** Postgres unique-violation — an idempotent replay hitting booking_payments_pi_uq. */
const PG_UNIQUE_VIOLATION = '23505';

type LedgerPaymentRow = {
  id: string;
  booking_id: string;
  venue_id: string;
  stripe_connected_account_id: string | null;
  stripe_payment_intent_id: string | null;
  method: 'card_present' | 'cash' | 'external' | 'online';
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amount_pence: number;
  note: string | null;
};

/**
 * POST /api/venue/bookings/[id]/charge — in-person settlement for appointments
 * (§6.3): Tap to Pay / Terminal card PI, cash/external recording, and admin
 * refunds. All paths write the `booking_payments` ledger; the webhook is the
 * source of truth for card success (§6.4). Never sets an application fee.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const input = parsed.data;
  const isRefund = input.action === 'refund';
  if (!isRefund && !input.method) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  // The £1,000 cap, enforced here rather than in the schema so a breach is
  // explicable. Applied to any explicitly supplied amount, exactly as the schema
  // did — omitting `amount_pence` still charges the resolved balance in full,
  // whatever its size.
  if (input.amount_pence != null && input.amount_pence > MAX_IN_PERSON_PENCE) {
    return NextResponse.json(
      {
        error: `The most you can take in one in-person payment is ${formatPenceForError(MAX_IN_PERSON_PENCE)}.`,
        code: 'amount_above_cap',
        max_amount_pence: MAX_IN_PERSON_PENCE,
      },
      { status: 400 },
    );
  }

  const loaded = await loadStaffAccessibleBooking(staff, id);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  if (!linkedGrantAllowsMutation(loaded.ctx.linkedGrant, loaded.ctx.isOwnVenue)) {
    return NextResponse.json(
      { error: 'This link does not allow taking payments on the other venue’s bookings.' },
      { status: 403 },
    );
  }
  const scopeVenueId = loaded.ctx.ownerVenueId;
  const booking = loaded.ctx.booking;

  // §6.7 — the per-venue flag gates the whole endpoint: when off, the surface
  // does not exist. (Refunds for a since-disabled venue go via Stripe.)
  const { data: venueData, error: venueErr } = await staff.db
    .from('venues')
    .select('in_person_payments_enabled, stripe_connected_account_id')
    .eq('id', scopeVenueId)
    .maybeSingle();
  if (venueErr) {
    console.error('[charge route] venue load failed:', venueErr.message, { venueId: scopeVenueId });
    return NextResponse.json({ error: 'Failed to load venue' }, { status: 500 });
  }
  const venue = venueData as
    | { in_person_payments_enabled: boolean | null; stripe_connected_account_id: string | null }
    | null;
  if (!venue?.in_person_payments_enabled) {
    return NextResponse.json(
      { error: 'In-person payments are not enabled for this venue.' },
      { status: 403 },
    );
  }

  // Cross-venue money actions leave an audit trail (house pattern; §9).
  const auditCrossVenueWrite = async (afterState: Record<string, unknown>) => {
    if (loaded.ctx.isOwnVenue || !loaded.ctx.linkId) return;
    let actorUserId: string | null = null;
    try {
      const { data: authData } = await supabase.auth.getUser();
      actorUserId = authData.user?.id ?? null;
    } catch {
      actorUserId = null;
    }
    await recordBookingWriteAudit({
      admin: staff.db,
      linkId: loaded.ctx.linkId,
      actingVenueId: staff.venue_id,
      actingUserId: actorUserId,
      owningVenueId: scopeVenueId,
      actionType: 'edited_booking',
      bookingId: id,
      beforeState: booking as Record<string, unknown>,
      afterState,
    });
  };

  // ---------------------------------------------------------------------------
  // (a) Refund — admin-only, always the FULL amount of the chosen row (§6.3a).
  // ---------------------------------------------------------------------------
  if (isRefund) {
    if (!requireAdmin(staff)) {
      return NextResponse.json(
        { error: 'Only admins can refund a payment.', code: 'admin_only' },
        { status: 403 },
      );
    }
    if (!input.payment_id) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { data: payData, error: payErr } = await staff.db
      .from('booking_payments')
      .select('id, booking_id, venue_id, stripe_connected_account_id, stripe_payment_intent_id, method, status, amount_pence, note')
      .eq('id', input.payment_id)
      .eq('booking_id', id)
      .maybeSingle();
    if (payErr) {
      console.error('[charge route] refund payment load failed:', payErr.message, {
        paymentId: input.payment_id,
      });
      return NextResponse.json({ error: 'Failed to load payment' }, { status: 500 });
    }
    const pay = payData as LedgerPaymentRow | null;
    if (!pay || pay.status !== 'succeeded') {
      return NextResponse.json(
        { error: 'This payment cannot be refunded.', code: 'invalid_state' },
        { status: 409 },
      );
    }

    if (pay.method === 'card_present' || pay.method === 'online') {
      // Stripe leg: ledger flip + recompute happen in the charge.refunded
      // webhook (§6.4). Refund routes to the SNAPSHOTTED account so it
      // survives a venue account change.
      if (!pay.stripe_payment_intent_id || !pay.stripe_connected_account_id) {
        return NextResponse.json(
          { error: 'No Stripe payment was found for this ledger entry.', code: 'invalid_state' },
          { status: 409 },
        );
      }
      try {
        await stripe.refunds.create(
          { payment_intent: pay.stripe_payment_intent_id }, // full refund — no amount
          {
            stripeAccount: pay.stripe_connected_account_id,
            idempotencyKey: `refund:${pay.stripe_payment_intent_id}`,
          },
        );
      } catch (refundErr) {
        // Already fully refunded in Stripe (e.g. via the dashboard): proceed so
        // our state converges with Stripe's. Anything else fails.
        const code = (refundErr as { code?: string } | null)?.code;
        if (code !== 'charge_already_refunded') {
          console.error('[charge route] refund failed:', refundErr, { paymentId: pay.id });
          return NextResponse.json(
            { error: 'The refund could not be completed. Please try again.' },
            { status: 502 },
          );
        }
      }
    } else {
      // cash/external: no Stripe leg exists — write the reversal directly.
      // This is also the fix-up path for a mis-recorded cash payment.
      const { error: reverseErr } = await staff.db
        .from('booking_payments')
        .update({
          status: 'refunded',
          note: input.note ?? pay.note,
          updated_at: new Date().toISOString(),
        })
        .eq('id', pay.id)
        .eq('status', 'succeeded');
      if (reverseErr) {
        console.error('[charge route] cash reversal failed:', reverseErr.message, {
          paymentId: pay.id,
        });
        return NextResponse.json(
          { error: 'The refund could not be recorded. Please try again.' },
          { status: 500 },
        );
      }
      await recomputeBookingPaymentSummary(staff.db, id);
    }

    await auditCrossVenueWrite({
      balance_payment_refunded: true,
      payment_id: pay.id,
      amount_pence: pay.amount_pence,
      method: pay.method,
    });
    return NextResponse.json({ success: true });
  }

  // ---------------------------------------------------------------------------
  // Charge paths — appointments only in v1 (§6.3 step 3).
  // ---------------------------------------------------------------------------
  const bookingModel = (booking.booking_model as string | null) ?? null;
  const isAppointment = bookingModel
    ? bookingModel === 'practitioner_appointment' || bookingModel === 'unified_scheduling'
    : Boolean(booking.practitioner_id && booking.appointment_service_id);
  if (!isAppointment) {
    return NextResponse.json(
      { error: 'In-person payment is only available for appointments.' },
      { status: 400 },
    );
  }

  // Amount (§5.7): a payment settles the whole VISIT (every row sharing
  // group_booking_id), not just the opened line — a cut + colour visit is one
  // collection. Everything is derived LIVE (paid deposits + succeeded ledger
  // rows) and never from bookings.amount_paid_pence, which only refreshes on
  // in-person payment activity and would omit a deposit paid since.
  const visit = await loadVisitPaymentPicture(
    staff.db,
    visitAnchorFromBooking(booking as Record<string, unknown>, { id, venueId: scopeVenueId }),
    { venueId: scopeVenueId },
  );
  const balanceDuePence = visit.balanceDuePence;
  const groupBookingId = (booking.group_booking_id as string | null) ?? null;
  // Provenance: the ledger row is anchored to the opened booking, so record
  // that it settled a whole visit (and which one) for reporting and support.
  const visitMetadata: Record<string, unknown> = groupBookingId
    ? { group_booking_id: groupBookingId, visit_booking_ids: visit.bookingIds }
    : {};

  let chargePence: number;
  if (balanceDuePence !== null) {
    if (balanceDuePence <= 0) {
      return NextResponse.json({ error: 'Nothing left to pay.' }, { status: 400 });
    }
    const requested = input.amount_pence ?? balanceDuePence;
    /**
     * Refuse an over-payment rather than silently clamping it.
     *
     * The old `Math.min(...)` recorded a different figure from the one
     * submitted, without saying so. On cash that is a till-reconciliation bug:
     * staff take £50 in notes, the ledger says £30, and nothing anywhere
     * reports the discrepancy. Clients that check client-side never see this;
     * ones that do not silently corrupt the ledger.
     */
    if (requested > balanceDuePence) {
      return NextResponse.json(
        {
          error: 'That is more than the outstanding balance for this visit.',
          code: 'amount_exceeds_balance',
          balance_due_pence: balanceDuePence,
        },
        { status: 400 },
      );
    }
    // The schema floors a supplied amount at 1, and an omitted one takes the
    // balance, which the guard above proved positive.
    chargePence = requested;
  } else {
    // Unknown price: the staff-entered amount is required (schema caps it).
    if (typeof input.amount_pence !== 'number') {
      return NextResponse.json(
        { error: 'Enter the amount to charge for this appointment.' },
        { status: 400 },
      );
    }
    chargePence = input.amount_pence;
  }

  // ---------------------------------------------------------------------------
  // (b) Cash / external — ledger row only, no Stripe (§6.3b).
  // ---------------------------------------------------------------------------
  if (input.method === 'cash' || input.method === 'external') {
    const { error: insertErr } = await staff.db.from('booking_payments').insert({
      booking_id: id,
      venue_id: scopeVenueId,
      method: input.method,
      status: 'succeeded',
      amount_pence: chargePence,
      staff_id: staff.id,
      note: input.note ?? null,
      metadata: visitMetadata,
    });
    if (insertErr) {
      console.error('[charge route] cash/external insert failed:', insertErr.message, {
        bookingId: id,
      });
      return NextResponse.json(
        { error: 'The payment could not be recorded. Please try again.' },
        { status: 500 },
      );
    }
    await recomputeBookingPaymentSummary(staff.db, id);
    await auditCrossVenueWrite({
      balance_payment_recorded: true,
      method: input.method,
      amount_pence: chargePence,
    });
    /**
     * Echo what was actually recorded, and re-read the balance rather than
     * subtracting locally.
     *
     * The route previously returned a bare `{ success: true }`, so the client's
     * success screen ("£30 collected, £60 still outstanding") was built from
     * what it believed the balance was at render time. If the server balance had
     * moved in between — a deposit landing, a sibling service settled, a
     * colleague collecting — staff read the wrong number out to the client. The
     * card path was already immune because it echoes `amount_pence`.
     */
    const settled = await loadVisitPaymentPicture(
      staff.db,
      visitAnchorFromBooking(booking as Record<string, unknown>, { id, venueId: scopeVenueId }),
      { venueId: scopeVenueId },
    );
    return NextResponse.json({
      success: true,
      amount_pence: chargePence,
      balance_due_pence: settled.balanceDuePence,
    });
  }

  // ---------------------------------------------------------------------------
  // (c) card_present — Tap to Pay / Terminal PI on the connected account (§6.3c).
  // ---------------------------------------------------------------------------
  if (!venue.stripe_connected_account_id) {
    return NextResponse.json(
      { error: "This venue isn't set up for in-person payments yet." },
      { status: 400 },
    );
  }
  if (!input.attempt_id) {
    return NextResponse.json(
      { error: 'A payment attempt id is required for card payments.' },
      { status: 400 },
    );
  }

  let paymentIntentId: string;
  let clientSecret: string | null;
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: chargePence, // tip = 0 in v1
        currency: 'gbp',
        payment_method_types: ['card_present'], // NOT automatic_payment_methods
        capture_method: 'automatic', // §13 capture-flow verify item
        metadata: {
          booking_id: id,
          venue_id: scopeVenueId,
          reserve_ni_purpose: RESERVE_NI_PI_PURPOSE.APPOINTMENT_BALANCE,
          staff_id: staff.id,
          ...(groupBookingId ? { group_booking_id: groupBookingId } : {}),
          ...(input.reader_type ? { reader_type: input.reader_type } : {}),
        },
        // NO application_fee_amount — preserves the 0% platform cut (§9).
      },
      {
        stripeAccount: venue.stripe_connected_account_id,
        // Keyed on the client-minted attempt_id, NOT the amount: an amount key
        // collides on legitimate equal-amount split payments; the attempt key
        // stays double-POST safe while letting a new payment mint a new PI.
        idempotencyKey: `balance:${id}:${input.attempt_id}`,
      },
    );
    paymentIntentId = pi.id;
    clientSecret = pi.client_secret;
  } catch (piErr) {
    // A reused attempt_id with different details (e.g. the amount changed
    // between retries) trips Stripe's idempotency guard. Surface it distinctly
    // so it is never mistaken for a capability problem.
    const stripeErr = piErr as { type?: string; rawType?: string } | null;
    if (stripeErr?.type === 'StripeIdempotencyError' || stripeErr?.rawType === 'idempotency_error') {
      console.warn('[charge route] attempt_id reused with different details:', {
        bookingId: id,
        attemptId: input.attempt_id,
      });
      return NextResponse.json(
        { error: 'This payment attempt has already started. Close the payment sheet and start a new one.' },
        { status: 409 },
      );
    }
    // Otherwise most likely the connected account lacks the card-present capability.
    console.error('[charge route] PI create failed:', piErr, { bookingId: id });
    return NextResponse.json(
      { error: "This venue isn't enabled for in-person card payments yet." },
      { status: 400 },
    );
  }

  const { error: ledgerErr } = await staff.db.from('booking_payments').insert({
    booking_id: id,
    venue_id: scopeVenueId,
    stripe_connected_account_id: venue.stripe_connected_account_id,
    stripe_payment_intent_id: paymentIntentId,
    method: 'card_present',
    status: 'pending',
    amount_pence: chargePence,
    staff_id: staff.id,
    metadata: {
      ...visitMetadata,
      ...(input.reader_type ? { reader_type: input.reader_type } : {}),
    },
  });
  // An idempotent replay of the same attempt returns the same PI, whose row
  // already exists — the unique-index violation is success, not an error.
  // (upsert onConflict can't target booking_payments_pi_uq: it is a PARTIAL
  // unique index, which PostgREST's conflict target cannot infer.)
  if (ledgerErr && ledgerErr.code !== PG_UNIQUE_VIOLATION) {
    console.error('[charge route] ledger insert failed:', ledgerErr.message, {
      bookingId: id,
      paymentIntentId,
    });
    return NextResponse.json(
      { error: 'The payment could not be recorded. Please try again.' },
      { status: 500 },
    );
  }

  await auditCrossVenueWrite({
    balance_payment_intent_created: true,
    payment_intent_id: paymentIntentId,
    amount_pence: chargePence,
  });

  return NextResponse.json({
    payment_intent_id: paymentIntentId,
    client_secret: clientSecret,
    amount_pence: chargePence,
  });
}
