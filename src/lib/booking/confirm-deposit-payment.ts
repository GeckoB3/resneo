import type { SupabaseClient } from '@supabase/supabase-js';
import { generateConfirmToken, hashConfirmToken } from '@/lib/confirm-token';
import {
  sendBookingConfirmationNotifications,
  sendDepositConfirmationEmail,
} from '@/lib/communications/send-templated';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { isSelfServeBookingSource } from '@/lib/booking-source';
import { formatGuestDisplayName } from '@/lib/guests/name';
import type { VenueEmailData } from '@/lib/emails/types';

export type ConfirmDepositPaymentResult =
  | { ok: true; confirmedIds: string[]; alreadyConfirmed: boolean }
  | { ok: false; reason: string };

/** Hold-row fields the confirm paths need (card holds, spec §7.4). */
type CardHoldConfirmRow = {
  id: string;
  booking_id: string;
  fee_pence: number;
  stripe_payment_method_id: string | null;
  terms_snapshot: unknown;
};

const CARD_HOLD_CONFIRM_COLUMNS = 'id, booking_id, fee_pence, stripe_payment_method_id, terms_snapshot';

/** Merge accepted_at (now, ISO) into the §7.5 terms snapshot without clobbering an earlier stamp. */
function stampSnapshotAcceptedAt(snapshot: unknown): Record<string, unknown> {
  const base =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? { ...(snapshot as Record<string, unknown>) }
      : {};
  if (!base.accepted_at) base.accepted_at = new Date().toISOString();
  return base;
}

/**
 * Persist the "card saved" facts onto hold rows: the payment method from the
 * succeeded intent and the consent accepted_at stamp. Idempotent: an already
 * stamped/populated row is left untouched, so webhook/route double-fires and
 * retried events are safe. Runs BEFORE the booking status flip so a failure
 * here leaves the unit re-confirmable by the webhook retry.
 */
async function persistCardHoldsSaved(
  admin: SupabaseClient,
  holds: CardHoldConfirmRow[],
  paymentMethodId: string | null | undefined,
  logContext: Record<string, unknown>,
): Promise<boolean> {
  for (const hold of holds) {
    const snapshot = hold.terms_snapshot as { accepted_at?: unknown } | null;
    const needsAcceptedAt = !snapshot?.accepted_at;
    const needsPaymentMethod = Boolean(paymentMethodId) && !hold.stripe_payment_method_id;
    if (!needsAcceptedAt && !needsPaymentMethod) continue;

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (needsAcceptedAt) update.terms_snapshot = stampSnapshotAcceptedAt(hold.terms_snapshot);
    if (needsPaymentMethod) update.stripe_payment_method_id = paymentMethodId;

    const { error } = await admin.from('booking_card_holds').update(update).eq('id', hold.id);
    if (error) {
      console.error('[confirm-deposit-payment] card hold update failed:', error, {
        holdId: hold.id,
        ...logContext,
      });
      return false;
    }
  }
  return true;
}

/** Insert `card_hold_saved` events for newly confirmed hold rows (spec §11). Best-effort observability. */
async function insertCardHoldSavedEvents(
  admin: SupabaseClient,
  venueId: string,
  holds: CardHoldConfirmRow[],
): Promise<void> {
  if (holds.length === 0) return;
  const { error } = await admin.from('events').insert(
    holds.map((hold) => ({
      venue_id: venueId,
      booking_id: hold.booking_id,
      event_type: 'card_hold_saved',
      payload: { booking_id: hold.booking_id, fee_pence: hold.fee_pence },
    })),
  );
  if (error) {
    console.error('[confirm-deposit-payment] card_hold_saved events insert failed:', error, {
      venueId,
      bookingIds: holds.map((h) => h.booking_id),
    });
  }
}

/** Overwrite guest_email on the confirmed rows when the confirm call carried one. */
async function applyGuestEmail(
  admin: SupabaseClient,
  confirmedIds: string[],
  guestEmail: string | null | undefined,
  logContext: Record<string, unknown>,
): Promise<boolean> {
  if (!guestEmail || confirmedIds.length === 0) return true;
  const { error } = await admin
    .from('bookings')
    .update({ guest_email: guestEmail, updated_at: new Date().toISOString() })
    .in('id', confirmedIds);
  if (error) {
    console.error('[confirm-deposit-payment] guest_email update failed:', error, logContext);
    return false;
  }
  return true;
}

/** Assign a manage-booking confirm token to each confirmed row that lacks one. */
async function assignConfirmTokens(
  admin: SupabaseClient,
  confirmedIds: string[],
  logContext: Record<string, unknown>,
): Promise<boolean> {
  for (const bid of confirmedIds) {
    const candidateToken = generateConfirmToken();
    const { error } = await admin
      .from('bookings')
      .update({
        confirm_token_hash: hashConfirmToken(candidateToken),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bid)
      .is('confirm_token_hash', null);
    if (error) {
      console.error('[confirm-deposit-payment] confirm token update failed:', error, {
        bookingId: bid,
        ...logContext,
      });
      return false;
    }
  }
  return true;
}

/**
 * Marks every Pending booking row sharing a succeeded PaymentIntent as Booked
 * and assigns manage-booking tokens when missing. Per-row deposit_status
 * (spec §7.4 payment branch):
 * - deposit_status 'Pending' + hold row + null deposit_amount_pence -> 'Card Held'
 * - deposit_status 'Pending' otherwise -> 'Paid'
 * - any other deposit_status (e.g. 'Not Required' zero-deposit group siblings)
 *   keeps its deposit_status; only the booking status flips to 'Booked'.
 *
 * When `paymentMethodId` is provided (payment_with_setup units) it is written
 * onto the unit's hold rows together with the consent accepted_at stamp and a
 * `card_hold_saved` event per newly confirmed hold row.
 */
export async function confirmBookingsForSucceededPaymentIntent(
  admin: SupabaseClient,
  params: {
    paymentIntentId: string;
    venueId: string;
    guestEmail?: string | null;
    paymentMethodId?: string | null;
  },
): Promise<ConfirmDepositPaymentResult> {
  const { paymentIntentId, venueId, guestEmail, paymentMethodId } = params;
  const logContext = { paymentIntentId, venueId };

  const { data: candidateRows, error: candidateErr } = await admin
    .from('bookings')
    .select('id, deposit_status, deposit_amount_pence')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('venue_id', venueId)
    .eq('status', 'Pending');

  if (candidateErr) {
    console.error('[confirmBookingsForSucceededPaymentIntent] booking load failed:', candidateErr, logContext);
    return { ok: false, reason: 'booking_load_failed' };
  }

  const candidates = (candidateRows ?? []) as Array<{
    id: string;
    deposit_status: string | null;
    deposit_amount_pence: number | null;
  }>;

  if (candidates.length === 0) {
    return { ok: true, confirmedIds: [], alreadyConfirmed: true };
  }

  const candidateIds = candidates.map((c) => c.id);

  const { data: holdRows, error: holdErr } = await admin
    .from('booking_card_holds')
    .select(CARD_HOLD_CONFIRM_COLUMNS)
    .in('booking_id', candidateIds);

  if (holdErr) {
    console.error('[confirmBookingsForSucceededPaymentIntent] hold load failed:', holdErr, logContext);
    return { ok: false, reason: 'hold_load_failed' };
  }

  const holds = (holdRows ?? []) as unknown as CardHoldConfirmRow[];
  const holdByBookingId = new Map(holds.map((h) => [h.booking_id, h]));

  // Stamp the hold rows before flipping bookings so a failure here keeps the
  // unit re-confirmable (webhook retries would otherwise see alreadyConfirmed).
  if (holds.length > 0) {
    const ok = await persistCardHoldsSaved(admin, holds, paymentMethodId, logContext);
    if (!ok) return { ok: false, reason: 'card_hold_update_failed' };
  }

  const heldIds: string[] = [];
  const paidIds: string[] = [];
  const untouchedDepositIds: string[] = [];
  for (const row of candidates) {
    if (row.deposit_status !== 'Pending') {
      // Regression requirement: 'Not Required' zero-deposit siblings must stop
      // flipping to 'Paid'; they only get their status confirmed.
      untouchedDepositIds.push(row.id);
    } else if (holdByBookingId.has(row.id) && row.deposit_amount_pence == null) {
      heldIds.push(row.id);
    } else {
      paidIds.push(row.id);
    }
  }

  const confirmedIds: string[] = [];
  const groups: Array<{ ids: string[]; update: Record<string, unknown> }> = [
    { ids: heldIds, update: { status: 'Booked', deposit_status: 'Card Held' } },
    { ids: paidIds, update: { status: 'Booked', deposit_status: 'Paid' } },
    { ids: untouchedDepositIds, update: { status: 'Booked' } },
  ];

  for (const group of groups) {
    if (group.ids.length === 0) continue;
    const { data: updatedRows, error: updateErr } = await admin
      .from('bookings')
      .update({ ...group.update, updated_at: new Date().toISOString() })
      .in('id', group.ids)
      .eq('venue_id', venueId)
      .eq('status', 'Pending')
      .select('id');
    if (updateErr) {
      console.error('[confirmBookingsForSucceededPaymentIntent] booking update failed:', updateErr, logContext);
      return { ok: false, reason: 'booking_update_failed' };
    }
    for (const r of updatedRows ?? []) {
      if (r.id) confirmedIds.push(r.id as string);
    }
  }

  if (confirmedIds.length === 0) {
    return { ok: true, confirmedIds: [], alreadyConfirmed: true };
  }

  if (!(await applyGuestEmail(admin, confirmedIds, guestEmail, logContext))) {
    return { ok: false, reason: 'guest_email_update_failed' };
  }

  if (!(await assignConfirmTokens(admin, confirmedIds, logContext))) {
    return { ok: false, reason: 'confirm_token_update_failed' };
  }

  const confirmedSet = new Set(confirmedIds);
  await insertCardHoldSavedEvents(
    admin,
    venueId,
    holds.filter((h) => confirmedSet.has(h.booking_id)),
  );

  return { ok: true, confirmedIds, alreadyConfirmed: false };
}

/**
 * Setup branch of the confirm path (spec §7.4): marks every Pending booking row
 * in the capture unit of a succeeded SetupIntent as Booked / 'Card Held'.
 * DB-only, like its PaymentIntent sibling: the caller retrieves the SI on the
 * connected account, verifies status === 'succeeded' and passes the extracted
 * payment method in. Idempotent: a second call (route/webhook race) returns
 * alreadyConfirmed with no side effects.
 */
export async function confirmBookingsForSucceededSetupIntent(
  admin: SupabaseClient,
  params: {
    setupIntentId: string;
    paymentMethodId: string | null;
    venueId: string;
    guestEmail?: string | null;
  },
): Promise<ConfirmDepositPaymentResult> {
  const { setupIntentId, paymentMethodId, venueId, guestEmail } = params;
  const logContext = { setupIntentId, venueId };

  const { data: holdRows, error: holdErr } = await admin
    .from('booking_card_holds')
    .select(CARD_HOLD_CONFIRM_COLUMNS)
    .eq('stripe_setup_intent_id', setupIntentId)
    .eq('venue_id', venueId);

  if (holdErr) {
    console.error('[confirmBookingsForSucceededSetupIntent] hold load failed:', holdErr, logContext);
    return { ok: false, reason: 'hold_load_failed' };
  }

  const holds = (holdRows ?? []) as unknown as CardHoldConfirmRow[];
  if (holds.length === 0) {
    return { ok: false, reason: 'hold_not_found' };
  }

  // Stamp the hold rows before flipping bookings so a failure here keeps the
  // unit re-confirmable (webhook retries would otherwise see alreadyConfirmed).
  if (!(await persistCardHoldsSaved(admin, holds, paymentMethodId, logContext))) {
    return { ok: false, reason: 'card_hold_update_failed' };
  }

  const { data: updatedRows, error: updateErr } = await admin
    .from('bookings')
    .update({
      status: 'Booked',
      deposit_status: 'Card Held',
      updated_at: new Date().toISOString(),
    })
    .in('id', holds.map((h) => h.booking_id))
    .eq('venue_id', venueId)
    .eq('status', 'Pending')
    .select('id');

  if (updateErr) {
    console.error('[confirmBookingsForSucceededSetupIntent] booking update failed:', updateErr, logContext);
    return { ok: false, reason: 'booking_update_failed' };
  }

  if (!updatedRows?.length) {
    return { ok: true, confirmedIds: [], alreadyConfirmed: true };
  }

  const confirmedIds = updatedRows.map((r) => r.id).filter(Boolean) as string[];

  if (!(await applyGuestEmail(admin, confirmedIds, guestEmail, logContext))) {
    return { ok: false, reason: 'guest_email_update_failed' };
  }

  if (!(await assignConfirmTokens(admin, confirmedIds, logContext))) {
    return { ok: false, reason: 'confirm_token_update_failed' };
  }

  const confirmedSet = new Set(confirmedIds);
  await insertCardHoldSavedEvents(
    admin,
    venueId,
    holds.filter((h) => confirmedSet.has(h.booking_id)),
  );

  return { ok: true, confirmedIds, alreadyConfirmed: false };
}

export async function sendDepositPaidBookingComms(
  admin: SupabaseClient,
  params: {
    confirmedIds: string[];
    venueId: string;
    venueData: VenueEmailData;
    guest?: {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      phone?: string | null;
    } | null;
    guestEmail?: string | null;
  },
): Promise<void> {
  const { confirmedIds, venueId, venueData, guest, guestEmail } = params;
  const recipientEmail = guestEmail ?? guest?.email ?? null;

  for (const bid of confirmedIds) {
    const { data: b } = await admin
      .from('bookings')
      .select(
        'booking_model, booking_date, booking_time, party_size, deposit_amount_pence, deposit_status, guest_email, source, cancellation_deadline',
      )
      .eq('id', bid)
      .maybeSingle();
    if (!b) continue;

    const manageBookingLink = await createOrGetBookingShortLink({
      venueId,
      bookingId: bid,
      purpose: 'manage',
    });
    const rowEmail = (b as { guest_email?: string | null }).guest_email ?? recipientEmail;
    const guestDisplay = formatGuestDisplayName(guest?.first_name, guest?.last_name);
    const bookingData = {
      id: bid,
      guest_name: guestDisplay !== 'Guest' ? guestDisplay : (rowEmail ?? 'Guest'),
      guest_email: rowEmail ?? null,
      guest_phone: guest?.phone ?? null,
      booking_date: b.booking_date ?? '',
      booking_time: typeof b.booking_time === 'string' ? b.booking_time.slice(0, 5) : b.booking_time ?? '',
      party_size: b.party_size ?? 2,
      deposit_amount_pence: b.deposit_amount_pence ?? null,
      deposit_status: ((b as { deposit_status?: string | null }).deposit_status ?? 'Paid') as string,
      manage_booking_link: manageBookingLink,
      booking_model: b.booking_model,
      refund_cutoff: (b as { cancellation_deadline?: string | null }).cancellation_deadline ?? null,
    };

    // Deposit receipt only for rows that actually paid a deposit. Card-hold
    // rows carry deposit_amount_pence NULL (no money taken) so a mixed
    // payment_with_setup unit sends receipts to its paid rows only; hold-only
    // rows get the booking confirmation alone.
    const hasDeposit = Boolean(rowEmail && b.deposit_amount_pence);
    const skipDepositReceipt = isSelfServeBookingSource(b.source as string | null);

    try {
      const enriched = await enrichBookingEmailForComms(admin, bid, bookingData);
      const { email: confEmail, sms: confSms } = await sendBookingConfirmationNotifications(
        enriched,
        venueData,
        venueId,
      );
      if (!confEmail.sent) console.warn('[deposit-paid comms] confirmation email not sent:', confEmail.reason);
      if (!confSms.sent && confSms.reason !== 'skipped' && confSms.reason !== 'no_phone') {
        console.warn('[deposit-paid comms] confirmation SMS not sent:', confSms.reason);
      }
    } catch (err) {
      console.error('[deposit-paid comms] confirmation notifications failed:', err, { bookingId: bid });
    }

    if (hasDeposit && !skipDepositReceipt) {
      try {
        const enrichedDep = await enrichBookingEmailForComms(admin, bid, bookingData);
        const depResult = await sendDepositConfirmationEmail(enrichedDep, venueData, venueId);
        if (!depResult.sent) console.warn('[deposit-paid comms] deposit email not sent:', depResult.reason);
      } catch (err) {
        console.error('[deposit-paid comms] deposit email failed:', err, { bookingId: bid });
      }
    }
  }
}
