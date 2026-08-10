import type { SupabaseClient } from '@supabase/supabase-js';
import { generateConfirmToken, hashConfirmToken } from '@/lib/confirm-token';
import { sendDepositPaidBookingComms } from '@/lib/booking/confirm-deposit-payment';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';

/**
 * Side effects of a staff `accept_unpaid` promotion
 * (deposit-payment-robustness-plan 6.1/6.2), shared by the status branch and
 * both attendance branches so they cannot drift:
 *
 * - one `booking_accepted_without_payment` event per promoted row (the audit
 *   trace that a human chose to hold the slot without the money);
 * - a manage-booking token for rows that lack one (the guest of an unpaid
 *   booking never went through the paid-confirm path that assigns them);
 * - the standard booking confirmation comms, WITHOUT a deposit receipt
 *   (nothing was paid; plan D3). The deposit stays owed and collectable.
 *
 * Best-effort: the status flip has already happened; a failure here is logged
 * and must not roll it back.
 */
export async function applyAcceptUnpaidSideEffects(
  admin: SupabaseClient,
  params: {
    bookingIds: string[];
    venueId: string;
    staffId: string;
    depositStatus: string | null;
    /**
     * The status branch of the staff PATCH already sends its own Pending ->
     * Booked confirmation (route.ts ~1229), so it passes false; the attendance
     * branches have no such block and keep the default.
     */
    sendComms?: boolean;
  },
): Promise<void> {
  const { bookingIds, venueId, staffId, depositStatus, sendComms = true } = params;
  if (bookingIds.length === 0) return;

  const { error: eventErr } = await admin.from('events').insert(
    bookingIds.map((id) => ({
      venue_id: venueId,
      booking_id: id,
      event_type: 'booking_accepted_without_payment',
      payload: { staff_id: staffId, deposit_status: depositStatus },
    })),
  );
  if (eventErr) {
    console.error('[accept-unpaid] events insert failed:', eventErr, { bookingIds });
  }

  for (const id of bookingIds) {
    const token = generateConfirmToken();
    const { error: tokenErr } = await admin
      .from('bookings')
      .update({ confirm_token_hash: hashConfirmToken(token), updated_at: new Date().toISOString() })
      .eq('id', id)
      .is('confirm_token_hash', null);
    if (tokenErr) {
      console.error('[accept-unpaid] confirm token update failed:', tokenErr, { bookingId: id });
    }
  }

  if (!sendComms) return;

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
      .eq('id', bookingIds[0]!)
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

    await sendDepositPaidBookingComms(admin, {
      confirmedIds: bookingIds,
      venueId,
      venueData: venueRowToEmailData({
        name: venue?.name ?? 'Venue',
        address: venue?.address ?? null,
        email: venue?.email ?? null,
        reply_to_email: venue?.reply_to_email ?? null,
        logo_url: (venue as { logo_url?: string | null } | null)?.logo_url ?? null,
        cover_photo_url: (venue as { cover_photo_url?: string | null } | null)?.cover_photo_url ?? null,
        website_url: (venue as { website_url?: string | null } | null)?.website_url ?? null,
        timezone: (venue as { timezone?: string | null } | null)?.timezone ?? null,
      }),
      guest,
      mode: 'confirmation_only',
    });
  } catch (commsErr) {
    console.error('[accept-unpaid] confirmation comms failed:', commsErr, { bookingIds });
  }
}
