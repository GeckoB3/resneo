/**
 * The words a customer sees on a lock screen (P5-2).
 *
 * Here rather than at the three call sites so the copy is one thing that can
 * be read, changed and tested together. A lock-screen line is seen by whoever
 * is looking at the phone, not only its owner, which drives two rules:
 *
 *   - **Name the venue, not the service.** The venue is what makes the message
 *     recognisable at a glance, and "microneedling" on a lock screen is more
 *     than a passer-by needs to know.
 *   - **Say what happened, and stop.** The email that went first carries the
 *     detail; this only has to be worth unlocking the phone for.
 *
 * House copy rule applies: no em-dashes, plain second person.
 */

/** `2026-09-01` to `Mon 1 Sep`. Civil date, parsed as parts so no timezone is applied. */
function formatShortDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** `14:30:00` to `2:30pm`. */
function formatTime12(time: string | null | undefined): string | null {
  if (!time) return null;
  const [hh, mm] = time.slice(0, 5).split(':');
  const hour = Number(hh);
  if (Number.isNaN(hour) || !mm) return null;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${mm}${suffix}`;
}

/** `at The Studio`, or nothing at all when the venue has no name to use. */
function atVenue(venueName: string | null | undefined): string {
  const name = venueName?.trim();
  return name ? ` at ${name}` : '';
}

/**
 * The pre-visit reminder.
 *
 * It says WHEN rather than "tomorrow", which is what a lock-screen reminder
 * would normally say, because `pre_visit_reminder` is venue-configurable:
 * `hoursBefore` is commonly same-day and can be anything a venue sets. A
 * message that says "tomorrow" to somebody whose appointment is in two hours
 * is worse than one that names the time.
 */
export function reminderPushBody(args: {
  venueName?: string | null;
  bookingDate?: string | null;
  bookingTime?: string | null;
}): string {
  const when = [formatTime12(args.bookingTime), formatShortDate(args.bookingDate)]
    .filter(Boolean)
    .join(' on ');
  return when
    ? `Your appointment${atVenue(args.venueName)} is at ${when}.`
    : `Your appointment${atVenue(args.venueName)} is coming up.`;
}

/**
 * A booking that moved, or one that was cancelled.
 *
 * Deliberately does NOT say who did it. This fires for a change the venue made
 * and for one the customer made themselves through the portal, and "The Studio
 * has changed your booking" is a lie in the second case. It also does not
 * promise a new TIME: the same notification covers a change of party size or
 * service, where a customer told to look for a new time would find the old one
 * and reasonably wonder what moved.
 */
export function bookingChangedPushBody(args: {
  venueName?: string | null;
  kind: 'modified' | 'cancelled';
}): string {
  return args.kind === 'cancelled'
    ? `Your booking${atVenue(args.venueName)} has been cancelled.`
    : `Your booking${atVenue(args.venueName)} has changed. Tap to see the details.`;
}

/** A waitlist place that has come free. */
export function waitlistOfferPushBody(args: { venueName?: string | null }): string {
  return `A place has come up${atVenue(args.venueName)}.`;
}
