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
 *    that link only exists once `claim_user_account()` has run.
 * 2. **The audience filter is the whole point of P0-13's column.** This selects
 *    `audience = 'customer'` and the staff sender selects `'staff'`, so a
 *    dual-role person, which linked accounts actively create, does not get
 *    booking alerts for their venue on the customer app or the reverse.
 * 3. **The channel and category ids are customer semantics.** `bookings-new`
 *    and the rest are what a venue's staff app means by those words; reusing
 *    them would put customer messages in a staff notification channel that a
 *    customer may have configured for something else entirely.
 *
 * **Nothing sends this yet, and that is deliberate.** There is no customer app
 * to receive it: every device row today is `audience = 'staff'`, because build
 * 1.0.7 sends no audience and the column defaults. This is the ResNeo half,
 * built so the app half has something to talk to, and it is inert until a
 * client registers a customer device.
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
 * Send one push about one booking, if the customer wants it.
 *
 * Fails SOFT in every direction: a push is a courtesy on top of an email that
 * has already gone, so nothing here is worth failing a booking flow over.
 */
export async function sendCustomerPush(args: {
  bookingId: string;
  guestId?: string | null;
  event: CustomerPushEvent;
  body: string;
}): Promise<CustomerPushResult> {
  const { bookingId, event, body } = args;
  try {
    const admin = getSupabaseAdminClient();
    const meta = EVENT_META[event];

    // 1. Booking to guest, when the caller did not already know it.
    let guestId = args.guestId ?? null;
    if (!guestId) {
      const { data: booking } = await admin
        .from('bookings')
        .select('guest_id')
        .eq('id', bookingId)
        .maybeSingle();
      guestId = (booking as { guest_id?: string | null } | null)?.guest_id ?? null;
    }
    if (!guestId) return { sent: false, reason: 'no_guest' };

    // 2. Guest to account. A guest who has never signed in has no devices, and
    //    no preferences to honour either.
    const { data: guest } = await admin
      .from('guests')
      .select('user_id')
      .eq('id', guestId)
      .maybeSingle();
    const userId = (guest as { user_id?: string | null } | null)?.user_id ?? null;
    if (!userId) return { sent: false, reason: 'no_account' };

    // 3. The customer's own preference for this kind of message on push
    //    (P4-3). Push is not controllable there yet, so this currently always
    //    allows; it is wired now so the day it becomes controllable, the rule
    //    is already being consulted rather than needing to be remembered.
    const prefs = await readCustomerPrefs(admin, userId);
    if (!customerAllowsMessageOnChannel(prefs, meta.messageKey, 'push')) {
      return { sent: false, reason: 'suppressed' };
    }

    // 4. Their CUSTOMER devices only.
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
        `booking_id` is what the app routes on. The staff payload also sends
        `data.type`, which §5D records as read by nothing; it is included here
        anyway because the customer app does not exist yet and a field the
        client may want is cheaper to send from the start than to add later,
        but it is documented as advisory rather than as routing.
      */
      data: { type: event, booking_id: bookingId },
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
