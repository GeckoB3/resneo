/**
 * Server-side mirror of the mobile app's notification-preference contract
 * (`types/notification-preferences.ts` in the Resneo-app repo). The staff push
 * sender reads `user_profiles.notification_preferences` (jsonb) and honours these
 * keys to decide whether to push an event to a staff member.
 */

export type BookingNotificationScope = 'all' | 'mine';

/** Per-event preference keys (booleans) the sender checks. */
export type StaffPushPrefKey =
  | 'new_booking'
  | 'cancellation'
  | 'reschedule'
  | 'payment'
  | 'no_show'
  | 'waitlist'
  | 'daily_summary'
  | 'review'
  | 'low_sms_credit'
  | 'billing';

export interface StaffNotificationPrefs {
  push_enabled: boolean;
  new_booking: boolean;
  cancellation: boolean;
  reschedule: boolean;
  payment: boolean;
  no_show: boolean;
  waitlist: boolean;
  daily_summary: boolean;
  review: boolean;
  low_sms_credit: boolean;
  billing: boolean;
  booking_scope: BookingNotificationScope;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

export const DEFAULT_STAFF_NOTIFICATION_PREFS: StaffNotificationPrefs = {
  push_enabled: true,
  new_booking: true,
  cancellation: true,
  reschedule: true,
  payment: true,
  no_show: true,
  waitlist: true,
  daily_summary: false,
  review: false,
  low_sms_credit: true,
  billing: true,
  booking_scope: 'all',
  quiet_hours_enabled: false,
  quiet_hours_start: '21:00',
  quiet_hours_end: '07:00',
};

/** Booking events are the ones subject to `booking_scope` (all vs mine). */
const BOOKING_PREF_KEYS: ReadonlySet<StaffPushPrefKey> = new Set([
  'new_booking',
  'cancellation',
  'reschedule',
  'payment',
  'no_show',
]);

export function isBookingPushEvent(key: StaffPushPrefKey): boolean {
  return BOOKING_PREF_KEYS.has(key);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function timeOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && TIME_RE.test(value) ? value : fallback;
}

/** Validate a raw jsonb bag onto the defaults. Never throws. */
export function parseStaffNotificationPrefs(raw: unknown): StaffNotificationPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_STAFF_NOTIFICATION_PREFS;
  return {
    push_enabled: boolOr(r.push_enabled, d.push_enabled),
    new_booking: boolOr(r.new_booking, d.new_booking),
    cancellation: boolOr(r.cancellation, d.cancellation),
    reschedule: boolOr(r.reschedule, d.reschedule),
    payment: boolOr(r.payment, d.payment),
    no_show: boolOr(r.no_show, d.no_show),
    waitlist: boolOr(r.waitlist, d.waitlist),
    daily_summary: boolOr(r.daily_summary, d.daily_summary),
    review: boolOr(r.review, d.review),
    low_sms_credit: boolOr(r.low_sms_credit, d.low_sms_credit),
    billing: boolOr(r.billing, d.billing),
    booking_scope: r.booking_scope === 'mine' ? 'mine' : 'all',
    quiet_hours_enabled: boolOr(r.quiet_hours_enabled, d.quiet_hours_enabled),
    quiet_hours_start: timeOr(r.quiet_hours_start, d.quiet_hours_start),
    quiet_hours_end: timeOr(r.quiet_hours_end, d.quiet_hours_end),
  };
}

/** Current wall-clock "HH:mm" in an IANA timezone. */
function nowHHmmInTimeZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
      new Date(),
    );
  }
}

/**
 * Is "now" (in the venue timezone) inside the user's quiet-hours window?
 * Handles the overnight wrap where end < start (e.g. 21:00 → 07:00).
 */
export function isWithinQuietHours(timeZone: string, start: string, end: string): boolean {
  if (start === end) return false;
  const now = nowHHmmInTimeZone(timeZone);
  return start < end ? now >= start && now < end : now >= start || now < end;
}
