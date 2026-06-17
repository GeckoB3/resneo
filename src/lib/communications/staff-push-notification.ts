/**
 * Staff push notifications — alert a venue's staff (on the mobile app) about
 * booking activity. Mirrors the venue-level pattern of `owner-booking-notification.ts`
 * but fans out to every active staff member's registered devices, gated by each
 * user's `notification_preferences` (scope + quiet hours).
 *
 * Payload contract (must match the app's `PushNotificationsProvider`):
 *   data.booking_id, channelId ∈ bookings-new|bookings-changed|reminders, categoryId 'booking'.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendExpoPush } from '@/lib/push/expo-push';
import {
  DEFAULT_STAFF_NOTIFICATION_PREFS,
  isBookingPushEvent,
  isWithinQuietHours,
  parseStaffNotificationPrefs,
  type StaffPushPrefKey,
} from '@/lib/push/staff-notification-prefs';

export type StaffPushEvent =
  | 'new_booking'
  | 'cancellation'
  | 'reschedule'
  | 'no_show'
  | 'payment_failed';

/** Minimal booking fields needed to build a push (a `BookingEmailData` satisfies this). */
export interface StaffPushBooking {
  id: string;
  guest_name?: string | null;
  booking_date?: string | null;
  booking_time?: string | null;
  appointment_service_name?: string | null;
}

export interface StaffPushVenue {
  name?: string | null;
  timezone?: string | null;
}

export interface StaffPushResult {
  sent: boolean;
  reason?: string;
}

const EVENT_META: Record<
  StaffPushEvent,
  { prefKey: StaffPushPrefKey; channelId: string; title: string }
> = {
  new_booking: { prefKey: 'new_booking', channelId: 'bookings-new', title: 'New booking' },
  cancellation: { prefKey: 'cancellation', channelId: 'bookings-changed', title: 'Booking cancelled' },
  reschedule: { prefKey: 'reschedule', channelId: 'bookings-changed', title: 'Booking changed' },
  no_show: { prefKey: 'no_show', channelId: 'reminders', title: 'Guest overdue' },
  payment_failed: { prefKey: 'payment', channelId: 'bookings-changed', title: 'Booking auto-cancelled' },
};

function formatShortDate(date?: string | null): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatTime12(time?: string | null): string {
  if (!time) return '';
  const [hh, mm] = time.slice(0, 5).split(':');
  const hour = Number(hh);
  if (Number.isNaN(hour)) return time;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${mm}${suffix}`;
}

function buildBody(event: StaffPushEvent, booking: StaffPushBooking): string {
  const who = booking.guest_name?.trim() || 'Guest';
  const svc = booking.appointment_service_name ? ` · ${booking.appointment_service_name}` : '';
  const when = [formatShortDate(booking.booking_date), formatTime12(booking.booking_time)]
    .filter(Boolean)
    .join(' ');
  switch (event) {
    case 'new_booking':
    case 'cancellation':
      return when ? `${who}${svc} · ${when}` : `${who}${svc}`;
    case 'reschedule':
      return when ? `${who}${svc} → ${when}` : `${who}${svc}`;
    case 'no_show':
      return when ? `${who} hasn’t arrived · ${when}` : `${who} hasn’t arrived`;
    case 'payment_failed':
      return when ? `${who}${svc} · ${when} — deposit unpaid` : `${who}${svc} — deposit unpaid`;
  }
}

/** Staff user ids assigned to the booking's calendar(s) — for `booking_scope: 'mine'`. */
async function resolveAssignedUserIds(
  admin: SupabaseClient,
  venueId: string,
  bookingId: string,
): Promise<Set<string>> {
  try {
    const { data: bookingRow } = await admin
      .from('bookings')
      .select('calendar_id, practitioner_id')
      .eq('id', bookingId)
      .maybeSingle();
    const row = (bookingRow ?? {}) as { calendar_id?: string | null; practitioner_id?: string | null };
    const calendarIds = [row.calendar_id, row.practitioner_id].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    if (calendarIds.length === 0) return new Set();

    const { data: assignments } = await admin
      .from('staff_calendar_assignments')
      .select('staff_id')
      .eq('venue_id', venueId)
      .in('calendar_id', calendarIds);
    const staffIds = Array.from(
      new Set(((assignments ?? []) as { staff_id: string }[]).map((a) => a.staff_id)),
    );
    if (staffIds.length === 0) return new Set();

    const { data: staffRows } = await admin
      .from('staff')
      .select('user_id')
      .in('id', staffIds)
      .not('user_id', 'is', null);
    return new Set(
      ((staffRows ?? []) as { user_id: string | null }[])
        .map((s) => s.user_id)
        .filter((id): id is string => typeof id === 'string'),
    );
  } catch (err) {
    console.error('[sendStaffPush] resolveAssignedUserIds failed', { venueId, bookingId, err });
    return new Set();
  }
}

/**
 * Push a booking event to a venue's staff. Best-effort: returns a result instead
 * of throwing. Call inside a deferred `after(...)` block (post-response).
 */
export async function sendStaffPush(
  booking: StaffPushBooking,
  venue: StaffPushVenue,
  venueId: string,
  event: StaffPushEvent,
): Promise<StaffPushResult> {
  try {
    const admin = getSupabaseAdminClient();
    const meta = EVENT_META[event];

    // 1. Active staff (with an auth user) for this venue.
    const { data: staff } = await admin
      .from('staff')
      .select('user_id')
      .eq('venue_id', venueId)
      .is('revoked_at', null)
      .not('user_id', 'is', null);
    const userIds = Array.from(
      new Set(
        ((staff ?? []) as { user_id: string | null }[])
          .map((s) => s.user_id)
          .filter((id): id is string => typeof id === 'string'),
      ),
    );
    if (userIds.length === 0) return { sent: false, reason: 'no_staff' };

    // 2. Venue timezone (for quiet hours).
    let timezone = venue.timezone ?? null;
    if (!timezone) {
      const { data: venueRow } = await admin
        .from('venues')
        .select('timezone')
        .eq('id', venueId)
        .maybeSingle();
      timezone = (venueRow as { timezone?: string | null } | null)?.timezone ?? 'Europe/London';
    }

    // 3. Per-user prefs.
    const { data: profiles } = await admin
      .from('user_profiles')
      .select('id, notification_preferences')
      .in('id', userIds);
    const prefByUser = new Map(
      ((profiles ?? []) as { id: string; notification_preferences: unknown }[]).map((p) => [
        p.id,
        parseStaffNotificationPrefs(p.notification_preferences),
      ]),
    );

    // 4. Scope resolution — only needed if someone limits to their own bookings.
    const bookingEvent = isBookingPushEvent(meta.prefKey);
    const anyMine = Array.from(prefByUser.values()).some((p) => p.booking_scope === 'mine');
    const assignedUserIds =
      bookingEvent && anyMine ? await resolveAssignedUserIds(admin, venueId, booking.id) : null;

    const allowed = userIds.filter((userId) => {
      const prefs = prefByUser.get(userId) ?? DEFAULT_STAFF_NOTIFICATION_PREFS;
      if (!prefs.push_enabled) return false;
      if (!prefs[meta.prefKey]) return false;
      if (bookingEvent && prefs.booking_scope === 'mine') {
        // Only drop when we positively resolved an assignee set that excludes them;
        // if assignment is unknown, fall back to delivering (never silently drop).
        if (assignedUserIds && assignedUserIds.size > 0 && !assignedUserIds.has(userId)) {
          return false;
        }
      }
      if (
        prefs.quiet_hours_enabled &&
        isWithinQuietHours(timezone!, prefs.quiet_hours_start, prefs.quiet_hours_end)
      ) {
        return false;
      }
      return true;
    });
    if (allowed.length === 0) return { sent: false, reason: 'no_recipients' };

    // 5. Their device push tokens.
    const { data: devices } = await admin
      .from('user_devices')
      .select('push_token')
      .in('user_id', allowed)
      .not('push_token', 'is', null);
    const tokens = Array.from(
      new Set(
        ((devices ?? []) as { push_token: string | null }[])
          .map((d) => d.push_token)
          .filter((token): token is string => typeof token === 'string'),
      ),
    );
    if (tokens.length === 0) return { sent: false, reason: 'no_tokens' };

    // 6. Send, then prune any dead tokens.
    const { sent, invalidTokens } = await sendExpoPush(tokens, {
      title: meta.title,
      body: buildBody(event, booking),
      data: { type: event, booking_id: booking.id },
      channelId: meta.channelId,
      categoryId: 'booking',
      sound: 'default',
      priority: 'high',
    });
    if (invalidTokens.length > 0) {
      await admin.from('user_devices').delete().in('push_token', invalidTokens);
    }

    return { sent: sent > 0, reason: sent > 0 ? undefined : 'not_sent' };
  } catch (err) {
    console.error('[sendStaffPush] failed', { event, bookingId: booking.id, venueId, err });
    return { sent: false, reason: 'send_error' };
  }
}
