import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Delivery health checks that `communication_logs` cannot answer on its own.
 *
 * The existing platform comms view counts rows by status, which catches a send
 * that was attempted and failed. It cannot catch a send that was never attempted,
 * because there is no row to count.
 *
 * That gap is real: `send-communications` wraps each booking in a try/catch, and
 * the log row is only written once `sendPolicyMessage` runs. Anything that throws
 * before that (short-link allocation, booking enrichment) is swallowed per booking,
 * the cron reports a successful run, and the customer silently gets no reminder.
 * The venue concludes the reminders "do not always work" and nobody can tell them
 * which customer missed one.
 *
 * These checks reconcile intent against record: bookings that happened, for a
 * contactable guest, with nothing logged.
 */

/** A booking that came and went with no communication recorded against it. */
export interface UncommunicatedBooking {
  booking_id: string;
  venue_id: string;
  booking_date: string;
  booking_time: string | null;
  status: string;
  guest_email: string | null;
}

/** A log row that was claimed but never resolved to sent, delivered or failed. */
export interface StuckPendingRow {
  id: string;
  venue_id: string;
  booking_id: string;
  message_type: string;
  channel: string;
  created_at: string;
  age_hours: number;
}

export interface DeliveryHealth {
  /** Past bookings with a contactable guest and zero communication_logs rows. */
  uncommunicated: UncommunicatedBooking[];
  uncommunicated_count: number;
  /** Rows stuck in `pending` well past the point a send should have resolved. */
  stuck_pending: StuckPendingRow[];
  stuck_pending_count: number;
  /** Window and thresholds used, so the UI can state what it checked. */
  window_days: number;
  stuck_after_hours: number;
}

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_STUCK_AFTER_HOURS = 2;
const MAX_ROWS = 50;

/** Statuses whose bookings we would not expect to have generated comms. */
const NON_COMMUNICATING_STATUSES = ['Cancelled', 'Canceled', 'No-Show', 'NoShow', 'No Show'];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Finds bookings in the window whose start has passed, whose guest had an email,
 * and for which no communication was ever logged.
 *
 * Deliberately does not replicate the cron's per-policy timing windows. Doing so
 * would duplicate logic that is likely to drift, and would report a venue that has
 * simply disabled reminders. "Zero rows of any kind" is the signal that survives
 * every policy configuration: a venue that sends nothing at all for a booking is
 * either misconfigured or hitting the swallowed-error path, and both are worth a
 * human look.
 */
export async function findUncommunicatedBookings(
  admin: SupabaseClient,
  opts: { windowDays?: number; limit?: number } = {},
): Promise<UncommunicatedBooking[]> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const limit = opts.limit ?? MAX_ROWS;
  const sinceIso = isoDaysAgo(windowDays);
  const sinceDate = sinceIso.slice(0, 10);
  const todayDate = new Date().toISOString().slice(0, 10);

  // Scan cap. At current volumes a week of bookings sits far inside this; if a
  // deployment ever exceeds it the check under-reports rather than misleads,
  // because everything it does return is genuinely uncommunicated.
  const SCAN_LIMIT = 500;

  const { data: bookings, error } = await admin
    .from('bookings')
    .select('id, venue_id, booking_date, booking_time, status, guest_email')
    .gte('booking_date', sinceDate)
    .lte('booking_date', todayDate)
    .not('guest_email', 'is', null)
    .not('status', 'in', `(${NON_COMMUNICATING_STATUSES.map((s) => `"${s}"`).join(',')})`)
    .order('booking_date', { ascending: false })
    .limit(SCAN_LIMIT);

  if (error) {
    console.error('[delivery-health] bookings load:', error.message);
    throw new Error('Failed to load bookings for delivery health');
  }

  interface RawBookingRow {
    id: string;
    venue_id: string;
    booking_date: string;
    booking_time: string | null;
    status: string;
    guest_email: string | null;
  }

  const rows = (bookings ?? []) as RawBookingRow[];
  if (rows.length === 0) return [];

  const { data: logged, error: logErr } = await admin
    .from('communication_logs')
    .select('booking_id')
    .in(
      'booking_id',
      rows.map((b) => b.id),
    );

  if (logErr) {
    console.error('[delivery-health] logs load:', logErr.message);
    throw new Error('Failed to load communication logs for delivery health');
  }

  const withComms = new Set((logged ?? []).map((r) => r.booking_id as string));

  return rows
    .filter((b) => !withComms.has(b.id))
    .slice(0, limit)
    .map((b) => ({
      booking_id: b.id,
      venue_id: b.venue_id,
      booking_date: b.booking_date,
      booking_time: b.booking_time,
      status: b.status,
      guest_email: b.guest_email,
    }));
}

/**
 * Rows claimed as `pending` that never resolved. `upsertPending` writes the row
 * before the provider call, so a row still pending hours later means the send
 * did not complete and nothing recorded why.
 */
export async function findStuckPendingComms(
  admin: SupabaseClient,
  opts: { stuckAfterHours?: number; windowDays?: number; limit?: number } = {},
): Promise<StuckPendingRow[]> {
  const stuckAfterHours = opts.stuckAfterHours ?? DEFAULT_STUCK_AFTER_HOURS;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const limit = opts.limit ?? MAX_ROWS;

  const cutoffIso = new Date(Date.now() - stuckAfterHours * 3_600_000).toISOString();

  const { data, error } = await admin
    .from('communication_logs')
    .select('id, venue_id, booking_id, message_type, channel, created_at')
    .eq('status', 'pending')
    .lte('created_at', cutoffIso)
    .gte('created_at', isoDaysAgo(windowDays))
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[delivery-health] stuck pending load:', error.message);
    throw new Error('Failed to load pending communications');
  }

  const now = Date.now();
  return (data ?? []).map((r) => ({
    id: r.id as string,
    venue_id: r.venue_id as string,
    booking_id: r.booking_id as string,
    message_type: r.message_type as string,
    channel: r.channel as string,
    created_at: r.created_at as string,
    age_hours: Math.round(((now - Date.parse(r.created_at as string)) / 3_600_000) * 10) / 10,
  }));
}

/** Both checks, for the platform comms view. */
export async function loadDeliveryHealth(
  admin: SupabaseClient,
  opts: { windowDays?: number; stuckAfterHours?: number } = {},
): Promise<DeliveryHealth> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const stuckAfterHours = opts.stuckAfterHours ?? DEFAULT_STUCK_AFTER_HOURS;

  const [uncommunicated, stuckPending] = await Promise.all([
    findUncommunicatedBookings(admin, { windowDays }),
    findStuckPendingComms(admin, { windowDays, stuckAfterHours }),
  ]);

  return {
    uncommunicated,
    uncommunicated_count: uncommunicated.length,
    stuck_pending: stuckPending,
    stuck_pending_count: stuckPending.length,
    window_days: windowDays,
    stuck_after_hours: stuckAfterHours,
  };
}
