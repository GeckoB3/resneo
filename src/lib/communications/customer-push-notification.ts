import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendExpoPush } from '@/lib/push/expo-push';
import { readCustomerPrefs } from '@/lib/notifications/customer-email-consent';
import { customerAllowsMessageOnChannel } from '@/lib/notifications/customer-channel-preferences';
import type { CommunicationMessageKey } from './policies';

/**
 * Push to a CUSTOMER (P5-2), mirroring `sendStaffPush` over the same transport.
 *
 * Three things make it a different function rather than a parameter on the
 * staff one:
 *
 * 1. **The recipient query is different.** Staff resolve venue to staff rows to
 *    users. A customer resolves booking to `guest_id` to `guests.user_id`, and
 *    that link only exists once `claim_user_account()` has run. A waitlist
 *    offer has no booking at all, so it resolves by address instead; see
 *    `CustomerPushRecipient` for the two constraints that bounds.
 * 2. **The audience filter is the whole point of P0-13's column.** This selects
 *    `audience = 'customer'` and the staff sender selects `'staff'`, so a
 *    dual-role person, which linked accounts actively create, does not get
 *    booking alerts for their venue on the customer app or the reverse.
 * 3. **The channel and category ids are customer semantics.** `bookings-new`
 *    and the rest are what a venue's staff app means by those words; reusing
 *    them would put customer messages in a staff notification channel that a
 *    customer may have configured for something else entirely.
 *
 * **It reaches nobody yet, and that is expected rather than broken.** All three
 * events are wired now (the reminder cron, the modification and cancellation
 * senders, and the waitlist offer), but every device row today is
 * `audience = 'staff'`, because build 1.0.7 sends no audience and the column
 * defaults. Until a client registers a customer device this returns
 * `no_tokens` and does nothing, which is why every call site logs the reason:
 * "nobody has a customer device yet" and "we are suppressing these by mistake"
 * are indistinguishable without it.
 */

export type CustomerPushEvent = 'reminder' | 'booking_changed' | 'waitlist_offer';

/**
 * Customer channel ids. Deliberately NOT the staff set.
 *
 * `categoryId` stays `'booking'` because the shipped app's tap handler keys on
 * it and the routing is the same idea; the channels differ because they are
 * what the user sees in their system notification settings.
 */
const EVENT_META: Record<
  CustomerPushEvent,
  { channelId: string; title: string; messageKey: CommunicationMessageKey }
> = {
  reminder: {
    channelId: 'customer-reminders',
    title: 'Your appointment is coming up',
    messageKey: 'pre_visit_reminder',
  },
  booking_changed: {
    channelId: 'customer-booking-changes',
    title: 'Your booking has changed',
    messageKey: 'booking_modification',
  },
  waitlist_offer: {
    channelId: 'customer-waitlist',
    title: 'A place has come up',
    messageKey: 'appointment_waitlist_offer',
  },
};

export interface CustomerPushResult {
  sent: boolean;
  reason?: 'no_guest' | 'no_account' | 'suppressed' | 'no_tokens' | 'not_sent' | 'send_error';
}

/**
 * Who to send to, in the two ways a customer can be identified.
 *
 * A BOOKING is the honest key and the one to prefer: `bookings.guest_id` to
 * `guests.user_id` is a link the customer made by booking, and the second half
 * only exists once `claim_user_account()` has run behind a verified sign-in.
 *
 * A waitlist offer has no booking to point at. `waitlist_entries` carries
 * `guest_name`, `guest_email` and `guest_phone` and no id of any kind, which is
 * deliberate rather than an oversight: an entry is made before there is a
 * booking, often by somebody with no account (see `account-waitlist.ts`, which
 * has to match by address for the same reason). So the only key available is
 * the address the person typed, and a typed address is not proof of anything.
 *
 * **Two constraints keep that from becoming a way to push to strangers.**
 *
 * The address must match a guest AT THAT VENUE who has already claimed their
 * account. Not any ResNeo account owning the address: somebody who has never
 * dealt with this venue cannot be reached this way at all, however cleverly the
 * form is filled in.
 *
 * And it is the same address the offer email is already going to. This adds a
 * push to a message that is being sent regardless; it does not create a new
 * channel to a person we were not already contacting.
 */
export type CustomerPushRecipient =
  | { bookingId: string; guestId?: string | null }
  | { venueId: string; guestEmail: string | null | undefined; bookingPageUrl?: string | null };

/**
 * The recipient's account id, or the reason there is not one.
 *
 * Returns a `reason` rather than null so the two silences stay distinguishable
 * at the call site: `no_guest` is "we could not find this person at all" and
 * `no_account` is "we found them and they have never signed in". They look the
 * same from outside and mean very different things, one of which is a customer
 * who could be reached if they made an account and one of which is not.
 */
async function resolveRecipientUserId(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  recipient: CustomerPushRecipient,
): Promise<{ userId: string } | { reason: 'no_guest' | 'no_account' }> {
  if ('bookingId' in recipient) {
    let guestId = recipient.guestId ?? null;
    if (!guestId) {
      const { data: booking } = await admin
        .from('bookings')
        .select('guest_id')
        .eq('id', recipient.bookingId)
        .maybeSingle();
      guestId = (booking as { guest_id?: string | null } | null)?.guest_id ?? null;
    }
    if (!guestId) return { reason: 'no_guest' };

    const { data: guest } = await admin
      .from('guests')
      .select('user_id')
      .eq('id', guestId)
      .maybeSingle();
    const userId = (guest as { user_id?: string | null } | null)?.user_id;
    return userId ? { userId } : { reason: 'no_account' };
  }

  /*
    The address path. Normalised the way both waitlist join routes store it,
    trimmed and lowercased, so this is an exact match and never a fuzzy one.

    Scoped to the venue, which is the constraint that matters: a stranger's
    address typed into this venue's waitlist form reaches their phone only if
    they are already a claimed customer OF THIS VENUE, in which case this venue
    is already emailing them about this very offer.
  */
  const email = recipient.guestEmail?.trim().toLowerCase();
  if (!email) return { reason: 'no_guest' };

  const { data: guests } = await admin
    .from('guests')
    .select('user_id')
    .eq('venue_id', recipient.venueId)
    .eq('email', email);

  const rows = (guests ?? []) as Array<{ user_id?: string | null }>;
  if (rows.length === 0) return { reason: 'no_guest' };
  const claimed = rows.find((g) => typeof g.user_id === 'string' && g.user_id.length > 0)?.user_id;
  return claimed ? { userId: claimed } : { reason: 'no_account' };
}

/**
 * Send one push to a customer, if they want it.
 *
 * Fails SOFT in every direction: a push is a courtesy on top of an email that
 * has already gone, so nothing here is worth failing a booking flow over.
 */
export async function sendCustomerPush(
  args: { event: CustomerPushEvent; body: string } & CustomerPushRecipient,
): Promise<CustomerPushResult> {
  const { event, body } = args;
  const bookingId = 'bookingId' in args ? args.bookingId : null;
  try {
    const admin = getSupabaseAdminClient();
    const meta = EVENT_META[event];

    // 1. Whichever key the caller has, resolved to the account that holds the
    //    devices. Both paths end at a `user_id` or at nothing.
    const resolved = await resolveRecipientUserId(admin, args);
    if ('reason' in resolved) return { sent: false, reason: resolved.reason };
    const { userId } = resolved;

    // 2. The customer's own preference for this kind of message on push
    //    (P4-3). Push is not controllable there yet, so this currently always
    //    allows; it is wired now so the day it becomes controllable, the rule
    //    is already being consulted rather than needing to be remembered.
    const prefs = await readCustomerPrefs(admin, userId);
    if (!customerAllowsMessageOnChannel(prefs, meta.messageKey, 'push')) {
      return { sent: false, reason: 'suppressed' };
    }

    // 3. Their CUSTOMER devices only.
    const { data: devices } = await admin
      .from('user_devices')
      .select('push_token')
      .eq('user_id', userId)
      .eq('audience', 'customer')
      .not('push_token', 'is', null);
    const tokens = Array.from(
      new Set(
        ((devices ?? []) as Array<{ push_token: string | null }>)
          .map((d) => d.push_token)
          .filter((t): t is string => typeof t === 'string'),
      ),
    );
    if (tokens.length === 0) return { sent: false, reason: 'no_tokens' };

    const { sent, invalidTokens } = await sendExpoPush(tokens, {
      title: meta.title,
      body,
      /*
        What the app routes a TAP on.

        `booking_id` when there is a booking, which is what the shipped tap
        handler parks and drains. A waitlist offer has no booking, by the
        nature of the thing: it is an invitation to make one. Sending a
        fabricated id would route the tap to a 404, so that case sends
        `venue_id` and the booking page `url` instead, which is the same
        destination the offer email's button already points at.
        `booking_id` is then ABSENT rather than null, so a client testing for
        it does the right thing without knowing about events.

        `type` is advisory: §5D records nothing reading it, but a client may
        want to tell the three events apart, and a field is cheaper to send
        from the start than to add once builds are in the wild.
      */
      data: bookingId
        ? { type: event, booking_id: bookingId }
        : {
            type: event,
            venue_id: 'venueId' in args ? args.venueId : undefined,
            url: ('bookingPageUrl' in args ? args.bookingPageUrl : null) ?? undefined,
          },
      channelId: meta.channelId,
      categoryId: 'booking',
      sound: 'default',
      priority: 'high',
      /*
        The badge the staff sender never sends. §5D records that the app is
        fully wired to display and clear one, so without this the iOS badge can
        never increment. One is the honest number for a single notification.
      */
      badge: 1,
    });

    if (invalidTokens.length > 0) {
      // Scoped to this user AND this audience, so a dead customer token cannot
      // deregister the staff device that happens to share it.
      await admin
        .from('user_devices')
        .delete()
        .in('push_token', invalidTokens)
        .eq('user_id', userId)
        .eq('audience', 'customer');
    }

    return { sent: sent > 0, reason: sent > 0 ? undefined : 'not_sent' };
  } catch (err) {
    console.error('[sendCustomerPush] failed', { event, bookingId, err });
    return { sent: false, reason: 'send_error' };
  }
}
