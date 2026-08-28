import { venueLocalWallTimeToUtcMs } from '@/lib/venue/venue-local-clock';
import { resolveDisplayTimeZone } from '@/lib/time/iana-time-zone';

/**
 * Upcoming/past classification for the account booking surfaces (P0-2, closes
 * G5 and G5a).
 *
 * This used to compare `booking_date` against `new Date().toISOString()`, which
 * is a UTC calendar day, against a date that is venue wall-clock. Three things
 * were wrong with it.
 *
 *  1. THE DAY BOUNDARY WAS UTC. A customer of a Sydney venue looking at their
 *     bookings at 09:00 local on the 3rd was being classified against the 2nd,
 *     because Sydney is ten or eleven hours ahead of UTC. Their morning
 *     appointment sat under "Upcoming" until it was almost a day old. In Los
 *     Angeles the error runs the other way: a booking is treated as past while
 *     it is still hours away.
 *  2. THERE WAS NO TIME IN IT AT ALL. A booking at 09:00 stayed "Upcoming"
 *     until midnight, which is the single most visible symptom: a customer sees
 *     the appointment they attended this morning listed as still to come.
 *  3. `Completed` was classified as upcoming, because only the five cancelled
 *     variants were treated as terminal.
 *
 * The rule now: build the instant with `venueLocalWallTimeToUtcMs` in the
 * VENUE's timezone (AD4 and §2.4 record why this is the existing helper and why
 * no new instant module is created for it), then compare it to now.
 *
 * A booking is PAST when it has finished, or when its status says it will never
 * happen. Everything else is upcoming, INCLUDING a booking currently in
 * progress: someone sitting in the chair has not had a past appointment, and
 * the end instant rather than the start is what makes that true.
 */

/** Statuses that mean the booking will not happen. Case-sensitive, as stored. */
const CANCELLED = new Set(['Cancelled', 'Canceled', 'No-Show', 'NoShow', 'No Show']);

/**
 * Statuses that are past whatever the clock says. `Completed` joins the
 * cancelled variants here: a completed booking is over by definition, and
 * treating it as upcoming (which it was) put finished visits at the top of the
 * list.
 */
const TERMINAL_PAST = new Set([...CANCELLED, 'Completed']);

/** True for every stored spelling of "this booking was cancelled or missed". */
export function isCancelledAccountStatus(status: string | null | undefined): boolean {
  return CANCELLED.has((status ?? '').trim());
}

export interface AccountBookingInstantRow {
  booking_date: string;
  booking_time?: string | null;
  booking_end_time?: string | null;
  status: string;
  /** The venue's zone. Optional so callers holding a bare row still work. */
  time_zone?: string | null;
  venue?: { timezone?: string | null } | null;
}

/** The zone a booking's wall-clock date and time are expressed in. */
export function accountBookingZone(row: AccountBookingInstantRow, fallbackTz?: string | null): string {
  return resolveDisplayTimeZone(row.time_zone ?? row.venue?.timezone ?? null, fallbackTz);
}

/** Start instant of the booking, in UTC epoch milliseconds. */
export function accountBookingStartMs(
  row: AccountBookingInstantRow,
  fallbackTz?: string | null,
): number {
  const zone = accountBookingZone(row, fallbackTz);
  // A row with no time is a whole-day booking: it starts at local midnight.
  const time = (row.booking_time ?? '00:00').slice(0, 5);
  return venueLocalWallTimeToUtcMs(row.booking_date, time, zone);
}

/**
 * End instant, in UTC epoch milliseconds.
 *
 * Falls back to the start when there is no end time, so a booking with no
 * duration flips to past the moment it starts, which is the only defensible
 * reading when the data does not say how long it lasts. An end time earlier
 * than the start (a booking crossing midnight) is treated as the next day.
 */
export function accountBookingEndMs(
  row: AccountBookingInstantRow,
  fallbackTz?: string | null,
): number {
  const start = accountBookingStartMs(row, fallbackTz);
  const end = row.booking_end_time?.slice(0, 5);
  if (!end) return start;
  const zone = accountBookingZone(row, fallbackTz);
  const sameDay = venueLocalWallTimeToUtcMs(row.booking_date, end, zone);
  return sameDay >= start ? sameDay : sameDay + 24 * 60 * 60 * 1000;
}

export function isPastBooking(
  row: AccountBookingInstantRow,
  nowMs: number,
  fallbackTz?: string | null,
): boolean {
  if (TERMINAL_PAST.has((row.status ?? '').trim())) return true;
  return accountBookingEndMs(row, fallbackTz) <= nowMs;
}

export function isUpcomingBooking(
  row: AccountBookingInstantRow,
  nowMs: number,
  fallbackTz?: string | null,
): boolean {
  return !isPastBooking(row, nowMs, fallbackTz);
}

export type AccountBookingFilter = 'all' | 'upcoming' | 'past';

export function parseAccountBookingFilter(raw: string | undefined): AccountBookingFilter {
  const v = (raw ?? 'all').toLowerCase();
  if (v === 'upcoming' || v === 'past') return v;
  return 'all';
}

export function filterAccountBookings<T extends AccountBookingInstantRow>(
  bookings: T[],
  filter: AccountBookingFilter,
  nowMs: number,
  fallbackTz?: string | null,
): T[] {
  if (filter === 'upcoming') {
    return bookings.filter((b) => isUpcomingBooking(b, nowMs, fallbackTz));
  }
  if (filter === 'past') {
    return bookings.filter((b) => isPastBooking(b, nowMs, fallbackTz));
  }
  return bookings;
}

/**
 * The type filter over the bookings list (P1-3, closes part of G18).
 *
 * `/account/events` and `/account/resources` were separate pages listing one
 * booking model each. They are now this filter, so the customer has one list of
 * their bookings with a way to narrow it, rather than three lists that each
 * held part of the answer.
 *
 * The URL keys are consumer words, not the stored enum: a customer sharing
 * `?model=event` should not have to know the row says `event_ticket`. The two
 * appointment models collapse into one key deliberately, because the split
 * between `practitioner_appointment` and `unified_scheduling` is an internal
 * scheduling distinction and `bookingModelShortLabel` already prints both as
 * "Appointment".
 */
export type AccountBookingModelFilter =
  | 'all'
  | 'appointment'
  | 'class'
  | 'event'
  | 'resource'
  | 'table';

/** Which stored `booking_model` values each key covers. */
const MODEL_FILTER_MEMBERS: Record<Exclude<AccountBookingModelFilter, 'all'>, readonly string[]> = {
  appointment: ['practitioner_appointment', 'unified_scheduling'],
  class: ['class_session'],
  event: ['event_ticket'],
  resource: ['resource_booking'],
  table: ['table_reservation'],
};

/** Consumer label for each key. Order is the order the pills appear in. */
export const ACCOUNT_BOOKING_MODEL_LABELS: ReadonlyArray<{
  id: Exclude<AccountBookingModelFilter, 'all'>;
  label: string;
}> = [
  { id: 'appointment', label: 'Appointments' },
  { id: 'class', label: 'Classes' },
  { id: 'event', label: 'Events' },
  { id: 'resource', label: 'Resources' },
  { id: 'table', label: 'Tables' },
];

export function parseAccountBookingModel(
  raw: string | string[] | undefined | null,
): AccountBookingModelFilter {
  const values = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  for (const value of values) {
    const v = value?.trim().toLowerCase();
    if (v && v !== 'all' && v in MODEL_FILTER_MEMBERS) {
      return v as AccountBookingModelFilter;
    }
  }
  return 'all';
}

/** The filter key a stored booking model belongs to, or null if unrecognised. */
export function accountBookingModelKey(
  bookingModel: string | null | undefined,
): Exclude<AccountBookingModelFilter, 'all'> | null {
  const stored = (bookingModel ?? '').trim();
  for (const [key, members] of Object.entries(MODEL_FILTER_MEMBERS)) {
    if (members.includes(stored)) return key as Exclude<AccountBookingModelFilter, 'all'>;
  }
  return null;
}

export function filterAccountBookingsByModel<T extends { booking_model?: string | null }>(
  bookings: T[],
  model: AccountBookingModelFilter,
): T[] {
  if (model === 'all') return bookings;
  const members = MODEL_FILTER_MEMBERS[model];
  return bookings.filter((b) => members.includes((b.booking_model ?? '').trim()));
}
