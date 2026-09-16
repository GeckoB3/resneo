/**
 * Per-venue Linked Accounts notification email preferences (spec §17.4).
 *
 * These gate the *email* channel only. In-app notifications (§17.2) are always
 * created by the DB trigger regardless of these prefs. Stored as
 * `venues.linked_notification_prefs jsonb`; NULL means "use defaults".
 */

/** The cross-venue write categories a venue can be emailed about. */
export type LinkedNotificationCategory = 'cancel' | 'reschedule' | 'create' | 'notes';

/**
 * What a venue in a collective can be emailed about (plan Appendix E contract 15; W5).
 *
 *   collective_digest    the daily summary of the host's other changes to shared services (N7)
 *   collective_calendars another venue changing which calendars offer a shared service (N11, N12)
 *
 * Both start on, unlike the four above: a venue that shares its page with others has agreed to be
 * told what changes on it. Emails about prices, payments and forms are not a preference at all,
 * because they change what a guest pays or fills in, so they always send.
 */
export type CollectiveNotificationCategory = 'collective_digest' | 'collective_calendars';

/** Email-on flags per category. */
export type LinkedNotificationPrefs = Record<LinkedNotificationCategory, boolean> &
  Record<CollectiveNotificationCategory, boolean>;

export const LINKED_NOTIFICATION_CATEGORIES: LinkedNotificationCategory[] = [
  'cancel',
  'reschedule',
  'create',
  'notes',
];

/**
 * Defaults: every category is off. Most venues do not want cross-venue activity
 * emails, so a newly linked venue starts quiet and opts in per category from
 * Settings → Linked Accounts. In-app bell notifications (§17.2) are unaffected.
 */
export const DEFAULT_LINKED_NOTIFICATION_PREFS: LinkedNotificationPrefs = {
  cancel: false,
  reschedule: false,
  create: false,
  notes: false,
  collective_digest: true,
  collective_calendars: true,
};

export const COLLECTIVE_NOTIFICATION_CATEGORIES: CollectiveNotificationCategory[] = [
  'collective_digest',
  'collective_calendars',
];

/** Human-readable labels for the settings matrix. */
export const LINKED_NOTIFICATION_LABELS: Record<LinkedNotificationCategory, string> = {
  cancel: 'Cancels a booking',
  reschedule: 'Reschedules a booking',
  create: 'Creates a new booking',
  notes: 'Edits booking notes or service',
};

/** The same, for a venue that shares a page with others. */
export const COLLECTIVE_NOTIFICATION_LABELS: Record<CollectiveNotificationCategory, string> = {
  collective_digest: 'Email me a daily summary of other changes to shared services',
  collective_calendars: 'Email me when another venue changes which of our calendars offer a service',
};

/** Merge a stored (possibly partial / malformed) prefs blob over the defaults. */
export function resolveLinkedNotificationPrefs(raw: unknown): LinkedNotificationPrefs {
  const out: LinkedNotificationPrefs = { ...DEFAULT_LINKED_NOTIFICATION_PREFS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    for (const key of [...LINKED_NOTIFICATION_CATEGORIES, ...COLLECTIVE_NOTIFICATION_CATEGORIES]) {
      if (typeof obj[key] === 'boolean') out[key] = obj[key] as boolean;
    }
  }
  return out;
}

/** Keep only the known boolean keys when persisting (drops anything else). */
export function sanitiseLinkedNotificationPrefs(raw: unknown): LinkedNotificationPrefs {
  return resolveLinkedNotificationPrefs(raw);
}

type BookingFacts = { booking_date?: unknown; booking_time?: unknown } | null | undefined;

function sameSchedule(before: BookingFacts, after: BookingFacts): boolean {
  if (!before || !after) return false;
  return (
    before.booking_date === after.booking_date && before.booking_time === after.booking_time
  );
}

/**
 * Classify an audited cross-venue booking write into the preference category
 * that governs whether the owning venue is emailed. Returns null for actions
 * that never email (a hard delete — the row is gone, nothing to link to).
 *
 * An `edited_booking` is a "reschedule" when the date/time changed, otherwise a
 * "notes" edit (service/notes/status touch-ups).
 */
export function classifyCrossVenueWrite(
  actionType: string,
  before: BookingFacts,
  after: BookingFacts,
): LinkedNotificationCategory | null {
  switch (actionType) {
    case 'cancelled_booking':
      return 'cancel';
    case 'created_booking':
      return 'create';
    case 'edited_booking':
      return sameSchedule(before, after) ? 'notes' : 'reschedule';
    default:
      return null; // deleted_booking and anything else: no email
  }
}
