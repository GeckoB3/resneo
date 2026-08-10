import type { SupabaseClient } from '@supabase/supabase-js';
import {
  confirmBookingsForSucceededPaymentIntent,
  sendDepositPaidBookingComms,
} from '@/lib/booking/confirm-deposit-payment';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';

export type SelfHealOutcome =
  /** Rows were flipped to Booked and comms sent. */
  | { outcome: 'confirmed'; confirmedIds: string[] }
  /** Nothing was Pending any more (benign replay). */
  | { outcome: 'already_confirmed' }
  /** The unit is Cancelled; money was taken for a dead unit (alert only). */
  | { outcome: 'cancelled_unit' }
  /** The confirm helper failed; nothing changed. */
  | { outcome: 'failed'; reason: string };

/**
 * Shared self-heal for a PaymentIntent that Stripe reports `succeeded` while
 * the platform still shows the booking unit unpaid (plan 3.1 / 3.5 / 8.2): the
 * webhook and the client confirm both missed the payment. One helper for the
 * abandonment sweeps and the reconciliation cron so the comms step cannot be
 * forgotten in one of the callers (the confirm helper itself is DB-only).
 *
 * Flips the unit via confirmBookingsForSucceededPaymentIntent, sends the
 * deposit-paid comms for the flipped rows, and inserts a reconciliation alert
 * so silent webhook/confirm misses stay visible even after being repaired.
 */
export async function selfHealSucceededPaymentIntent(
  admin: SupabaseClient,
  params: {
    paymentIntentId: string;
    venueId: string;
    /** From the retrieved PI; threaded through for payment_with_setup holds. */
    paymentMethodId?: string | null;
    /** Booking id the reconciliation alert rows anchor to. */
    leadBookingId: string;
    /** Caller tag for logs. */
    source: 'auto-cancel-sweep' | 'reconciliation';
  },
): Promise<SelfHealOutcome> {
  const { paymentIntentId, venueId, paymentMethodId, leadBookingId, source } = params;
  const logContext = { paymentIntentId, venueId, leadBookingId, source };

  const insertAlert = async (actualStripeStatus: string): Promise<void> => {
    const { error } = await admin.from('reconciliation_alerts').insert({
      booking_id: leadBookingId,
      expected_status: 'Booked',
      actual_stripe_status: actualStripeStatus,
    });
    if (error) {
      console.error('[selfHealSucceededPaymentIntent] alert insert failed:', error, logContext);
    }
  };

  const confirmResult = await confirmBookingsForSucceededPaymentIntent(admin, {
    paymentIntentId,
    venueId,
    paymentMethodId: paymentMethodId ?? null,
  });

  if (!confirmResult.ok) {
    if (confirmResult.reason === 'booking_cancelled') {
      // Mirrors the webhook's J2 handling: money was taken for a cancelled
      // unit; the alert is the durable trace and a human arranges the refund.
      await insertAlert('succeeded_cancelled_unit');
      return { outcome: 'cancelled_unit' };
    }
    console.error(
      '[selfHealSucceededPaymentIntent] confirm failed:',
      confirmResult.reason,
      logContext,
    );
    return { outcome: 'failed', reason: confirmResult.reason };
  }

  const confirmedIds = confirmResult.confirmedIds;
  const depositOnlyIds = confirmResult.depositOnlyIds;
  if (
    confirmResult.alreadyConfirmed ||
    (confirmedIds.length === 0 && depositOnlyIds.length === 0)
  ) {
    return { outcome: 'already_confirmed' };
  }

  const healedIds = [...confirmedIds, ...depositOnlyIds];

  // Comms: the guest never got a confirmation for this unit (the normal paths
  // both missed), so send the standard deposit-paid set now.
  try {
    const { data: venue } = await admin
      .from('venues')
      .select(
        'name, address, email, reply_to_email, logo_url, cover_photo_url, website_url, timezone',
      )
      .eq('id', venueId)
      .single();

    const { data: leadBooking } = await admin
      .from('bookings')
      .select('guest_id')
      .eq('id', healedIds[0]!)
      .maybeSingle();

    let guest: {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      phone?: string | null;
    } | null = null;
    if (leadBooking?.guest_id) {
      const { data: guestRow } = await admin
        .from('guests')
        .select('first_name, last_name, email, phone')
        .eq('id', leadBooking.guest_id)
        .maybeSingle();
      guest = guestRow ?? null;
    }

    const venueData = venueRowToEmailData({
      name: venue?.name ?? 'Venue',
      address: venue?.address ?? null,
      email: venue?.email ?? null,
      reply_to_email: venue?.reply_to_email ?? null,
      logo_url: (venue as { logo_url?: string | null } | null)?.logo_url ?? null,
      cover_photo_url: (venue as { cover_photo_url?: string | null } | null)?.cover_photo_url ?? null,
      website_url: (venue as { website_url?: string | null } | null)?.website_url ?? null,
      timezone: (venue as { timezone?: string | null } | null)?.timezone ?? null,
    });

    if (confirmedIds.length > 0) {
      await sendDepositPaidBookingComms(admin, { confirmedIds, venueId, venueData, guest });
    }
    // Accepted rows completing a late deposit (plan 6.7): receipt only.
    if (depositOnlyIds.length > 0) {
      await sendDepositPaidBookingComms(admin, {
        confirmedIds: depositOnlyIds,
        venueId,
        venueData,
        guest,
        mode: 'receipt_only',
      });
    }
  } catch (commsErr) {
    // The unit is confirmed either way; losing the email is survivable and the
    // alert below still records that the normal paths missed this payment.
    console.error('[selfHealSucceededPaymentIntent] comms failed:', commsErr, logContext);
  }

  await insertAlert('succeeded_unconfirmed_selfhealed');

  return { outcome: 'confirmed', confirmedIds: healedIds };
}
