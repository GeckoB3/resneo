import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';

/**
 * Card-hold release helper (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §9.3, §12.2, §12.3).
 *
 * Releasing a hold means: stamp released_at + release_reason on the open hold
 * rows, insert a card_hold_released events row per booking, and best-effort
 * delete the booking-scoped Stripe customer (which detaches the saved card,
 * satisfying data minimisation). Customer deletion is skipped while any OTHER
 * open hold still shares the same customer (a class-cart cancel of one line
 * must not detach the card sibling holds rely on); the last released hold
 * deletes the customer. Deletion always uses the hold's snapshotted connected
 * account, never the venue's current account, and a Stripe failure is logged
 * and swallowed: the charge guard keys on released_at, so an undeleted
 * customer is a cleanup miss, not a security hole.
 */

export type CardHoldReleaseReason =
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'abandoned'
  | 'admin';

type ReleasableHoldRow = {
  id: string;
  booking_id: string;
  venue_id: string;
  stripe_connected_account_id: string;
  stripe_customer_id: string | null;
  fee_pence: number;
};

export type ReleaseCardHoldsResult = {
  releasedBookingIds: string[];
  deletedCustomerIds: string[];
};

/**
 * Release any open holds on the given bookings. Safe to call on bookings with
 * no holds (no-op) and idempotent: already-released holds are never touched.
 */
export async function releaseCardHoldsForBookings(
  admin: SupabaseClient,
  bookingIds: string[],
  reason: CardHoldReleaseReason,
): Promise<ReleaseCardHoldsResult> {
  const result: ReleaseCardHoldsResult = { releasedBookingIds: [], deletedCustomerIds: [] };
  const ids = bookingIds.filter(Boolean);
  if (ids.length === 0) return result;

  const { data: holds, error: selErr } = await admin
    .from('booking_card_holds')
    .select('id, booking_id, venue_id, stripe_connected_account_id, stripe_customer_id, fee_pence')
    .in('booking_id', ids)
    .is('released_at', null);

  if (selErr) {
    console.error('[card-hold-release] failed to load holds', selErr);
    throw new Error('Failed to load card holds for release');
  }
  const openHolds = (holds ?? []) as ReleasableHoldRow[];
  if (openHolds.length === 0) return result;

  const nowIso = new Date().toISOString();
  const holdIds = openHolds.map((h) => h.id);

  const { data: released, error: updErr } = await admin
    .from('booking_card_holds')
    .update({ released_at: nowIso, release_reason: reason, updated_at: nowIso })
    .in('id', holdIds)
    .is('released_at', null)
    .select('id, booking_id, venue_id, stripe_connected_account_id, stripe_customer_id, fee_pence');

  if (updErr) {
    console.error('[card-hold-release] failed to release holds', updErr);
    throw new Error('Failed to release card holds');
  }
  const releasedRows = (released ?? []) as ReleasableHoldRow[];
  if (releasedRows.length === 0) return result;
  result.releasedBookingIds = releasedRows.map((h) => h.booking_id);

  // Booking events feed reporting and the staff timeline (spec §11).
  const eventRows = releasedRows.map((h) => ({
    venue_id: h.venue_id,
    booking_id: h.booking_id,
    event_type: 'card_hold_released',
    payload: { booking_id: h.booking_id, fee_pence: h.fee_pence, release_reason: reason },
  }));
  const { error: evErr } = await admin.from('events').insert(eventRows);
  if (evErr) {
    // Non-fatal: the release itself is the source of truth.
    console.error('[card-hold-release] failed to insert release events', evErr);
  }

  // Best-effort customer deletion with the shared-customer check (§9.3).
  const customerIds = [...new Set(releasedRows.map((h) => h.stripe_customer_id).filter(Boolean))] as string[];
  for (const customerId of customerIds) {
    const { data: siblings, error: sibErr } = await admin
      .from('booking_card_holds')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .is('released_at', null)
      .limit(1);
    if (sibErr) {
      console.error('[card-hold-release] sibling check failed', sibErr);
      continue;
    }
    if ((siblings ?? []).length > 0) continue; // an open sibling hold still needs the card

    const account = releasedRows.find((h) => h.stripe_customer_id === customerId)
      ?.stripe_connected_account_id;
    if (!account) continue;
    try {
      await stripe.customers.del(customerId, { stripeAccount: account });
      result.deletedCustomerIds.push(customerId);
    } catch (err) {
      console.error('[card-hold-release] customer deletion failed (cleanup miss, not fatal)', {
        customerId,
        err,
      });
    }
  }

  return result;
}

export type DeleteCardHoldCustomersResult = {
  deletedCustomerIds: string[];
};

/**
 * Best-effort Stripe customer cleanup ahead of a staff hard delete (§9.3).
 *
 * Hard delete destroys the booking row, and `ON DELETE CASCADE` takes the hold
 * row with it, so there is nothing to release here: this only deletes the
 * booking-scoped Stripe customers so vaulted cards do not outlive the rows.
 * Released holds are included deliberately: the hard delete is the last chance
 * to clean up a customer whose release-time deletion failed. A customer is kept
 * while any OPEN hold OUTSIDE the deleted set still shares it (a cart sibling's
 * saved card must survive). Deletion uses each hold's snapshotted connected
 * account; every failure is logged and swallowed so the delete never blocks.
 */
export async function deleteCardHoldCustomersForBookings(
  admin: SupabaseClient,
  bookingIds: string[],
): Promise<DeleteCardHoldCustomersResult> {
  const result: DeleteCardHoldCustomersResult = { deletedCustomerIds: [] };
  const ids = bookingIds.filter(Boolean);
  if (ids.length === 0) return result;

  const { data: holds, error: selErr } = await admin
    .from('booking_card_holds')
    .select('booking_id, stripe_connected_account_id, stripe_customer_id')
    .in('booking_id', ids)
    .not('stripe_customer_id', 'is', null);

  if (selErr) {
    // Best-effort only: never block the hard delete on a cleanup query.
    console.error('[card-hold-release] failed to load holds for customer cleanup', selErr);
    return result;
  }
  const rows = (holds ?? []) as Array<
    Pick<ReleasableHoldRow, 'booking_id' | 'stripe_connected_account_id' | 'stripe_customer_id'>
  >;
  const customerIds = [...new Set(rows.map((h) => h.stripe_customer_id).filter(Boolean))] as string[];

  for (const customerId of customerIds) {
    const { data: siblings, error: sibErr } = await admin
      .from('booking_card_holds')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .is('released_at', null)
      .not('booking_id', 'in', `(${ids.join(',')})`)
      .limit(1);
    if (sibErr) {
      console.error('[card-hold-release] sibling check failed during customer cleanup', sibErr);
      continue;
    }
    if ((siblings ?? []).length > 0) continue; // an open hold elsewhere still needs the card

    const account = rows.find((h) => h.stripe_customer_id === customerId)
      ?.stripe_connected_account_id;
    if (!account) continue;
    try {
      await stripe.customers.del(customerId, { stripeAccount: account });
      result.deletedCustomerIds.push(customerId);
    } catch (err) {
      console.error('[card-hold-release] customer deletion failed (cleanup miss, not fatal)', {
        customerId,
        err,
      });
    }
  }

  return result;
}
