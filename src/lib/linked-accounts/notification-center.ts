/**
 * In-app notification center for Linked Accounts (spec §17).
 *
 * This module holds the row/view types and the *pure* display formatter used by
 * the notifications API and (Phase 2) the dashboard bell. Creation of cross-venue
 * write notifications is handled in the database (trigger on
 * account_link_audit_log — see 20260924120000_linked_account_notifications.sql);
 * this layer only reads and shapes them.
 */

const DASHBOARD_BASE = '/dashboard';

/** A row as stored in account_link_notifications. */
export interface LinkNotificationRow {
  id: string;
  type: string;
  category: string;
  link_id: string | null;
  collective_id: string | null;
  actor_venue_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

/** A display-ready notification for the bell/inbox. */
export interface LinkNotificationView {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  href: string;
  actorVenueName: string | null;
  read: boolean;
  createdAt: string;
}

function str(payload: Record<string, unknown> | null, key: string): string | null {
  const v = payload?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** "14:30:00" / "14:30" → "14:30"; null-safe. */
function shortTime(t: string | null): string | null {
  if (!t) return null;
  return t.length >= 5 ? t.slice(0, 5) : t;
}

/** Build the display copy (title + body) for a notification. Pure. */
export function formatNotificationCopy(
  type: string,
  payload: Record<string, unknown> | null,
): { title: string; body: string } {
  // Lifecycle events (§17 Phase 4) carry display-ready copy in the payload,
  // mirroring their email; prefer it over the type-based templates below.
  const presetTitle = str(payload, 'title');
  if (presetTitle) {
    return { title: presetTitle, body: str(payload, 'body') ?? '' };
  }

  const actor = str(payload, 'actor_venue_name') ?? 'A linked venue';
  const date = str(payload, 'booking_date');
  const time = shortTime(str(payload, 'booking_time'));
  const when = date ? (time ? `${date} at ${time}` : date) : null;

  switch (type) {
    case 'cross_venue_booking_created':
      return {
        title: `New booking from ${actor}`,
        body: when
          ? `${actor} booked an appointment in your calendar for ${when}.`
          : `${actor} created a booking in your calendar.`,
      };
    case 'cross_venue_booking_cancelled':
      return {
        title: `Booking cancelled by ${actor}`,
        body: when
          ? `${actor} cancelled the ${when} booking in your calendar.`
          : `${actor} cancelled a booking in your calendar.`,
      };
    case 'cross_venue_booking_edited': {
      const oldDate = str(payload, 'old_booking_date');
      const oldTime = shortTime(str(payload, 'old_booking_time'));
      const movedFrom =
        oldDate && (oldDate !== date || oldTime !== time)
          ? `${oldDate}${oldTime ? ` at ${oldTime}` : ''}`
          : null;
      return {
        title: `Booking updated by ${actor}`,
        body: movedFrom && when
          ? `${actor} moved a booking in your calendar from ${movedFrom} to ${when}.`
          : when
            ? `${actor} updated the ${when} booking in your calendar.`
            : `${actor} updated a booking in your calendar.`,
      };
    }
    default:
      return {
        title: `Update from ${actor}`,
        body: `${actor} made a change in your calendar.`,
      };
  }
}

/** Deep-link for a notification: the calendar on the affected booking's date. */
export function notificationHref(row: LinkNotificationRow): string {
  const date = str(row.payload, 'booking_date');
  if (row.resource_type === 'booking' && date) {
    return `${DASHBOARD_BASE}/calendar?date=${encodeURIComponent(date)}`;
  }
  return `${DASHBOARD_BASE}/settings?tab=linked-accounts`;
}

/** Shape a stored row into a display-ready view. Pure. */
export function buildNotificationView(row: LinkNotificationRow): LinkNotificationView {
  const { title, body } = formatNotificationCopy(row.type, row.payload);
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    title,
    body,
    href: notificationHref(row),
    actorVenueName: str(row.payload, 'actor_venue_name'),
    read: row.read_at != null,
    createdAt: row.created_at,
  };
}
