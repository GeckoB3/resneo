import type { SupabaseClient } from '@supabase/supabase-js';
import { visitLifecycleStatus } from '@/lib/booking/group-visit-bookings';
import {
  NEW_BOOKING_CHANNELS,
  loadNewBookingUnits,
  type NewBookingChannel,
  type NewBookingRow,
  type NewBookingUnit,
} from '@/lib/reports/new-bookings';

/**
 * The Reports Overview's figures about bookings MADE in its date range: the
 * Appointment activity card (`report1_booking_summary`) and the Cancellation
 * rate card (`report3_cancellation`) on `GET /api/venue/reports`. Both are built
 * from the bookings the New bookings tab counts (`loadNewBookingUnits`), so
 * "Appointments created" and "New bookings" are one number for the same dates:
 * a multi-service visit counts once, on the venue-local day it was made;
 * imports, collective move copies and payment lapses are left out; a booking
 * still waiting for a deposit or card is not in the total until it is paid.
 *
 * These replaced the report_booking_summary and report_cancellation SQL
 * functions on 2026-09-19. Those counted one per service row on UTC days, kept
 * imported and deleted bookings, and took each booking's status from its
 * latest event. The dashboard's own status audit event (`{ from, to }`, no
 * `new_status`) is written after the trigger's, so every status change the
 * team made read as the booking's first status. Statuses here come from the
 * bookings themselves. The payload keeps its shape for the app, plus
 * `by_channel` and `cancelled_team_initiated`.
 */

export interface BookingActivitySummary {
  /** Bookings made in the range, including any since cancelled: the New bookings count. */
  total_bookings_created: number;
  /** The same bookings by `bookings.source` (the app labels these keys). */
  by_source: Record<string, number>;
  /** The same bookings by how they came in, as the New bookings tab splits them. */
  by_channel: Record<NewBookingChannel, number>;
  /**
   * Latest status, one per booking. `Pending` is the bookings still waiting for
   * a deposit or card, which are not in the total yet.
   */
  by_status: Record<string, number>;
  /** People on those bookings: a group of three counts three, a visit one. */
  covers_booked: number;
  /** Of those people, the ones who have arrived, started or finished. */
  covers_seated: number;
}

export interface CancellationSummary {
  /** Bookings made in the range, as `BookingActivitySummary.total_bookings_created`. */
  total_bookings_created: number;
  /** Of those, cancelled by the client. */
  cancelled_guest_initiated: number;
  /** Of those, cancelled by the team (anything the client did not cancel themselves). */
  cancelled_team_initiated: number;
  /**
   * Made in the range and cancelled by the system because a deposit or card
   * never came through. Not in the total or the rate: the client never finished booking.
   */
  cancelled_auto: number;
  /** The share of the total since cancelled by the client or the team, to 2 dp. */
  cancellation_rate_pct: number;
}

function inRange(unit: NewBookingUnit, from: string, to: string): boolean {
  return unit.day >= from && unit.day <= to;
}

/** People on one booking: a visit or standing reservation is its party once, not once per service or session. */
export function bookingHeadcount(unit: NewBookingUnit): number {
  let people = 0;
  for (const row of unit.rows) {
    const size = typeof row.party_size === 'number' && row.party_size > 0 ? row.party_size : 0;
    if (size > people) people = size;
  }
  return people;
}

/** Arrived, started or finished, as the Team, services & channels card counts it. */
function rowSeen(row: NewBookingRow): boolean {
  if (row.status === 'Seated' || row.status === 'Completed') return true;
  if (row.status === 'Cancelled' || row.status === 'No-Show') return false;
  return typeof row.client_arrived_at === 'string' && row.client_arrived_at.trim() !== '';
}

/** One status per booking. A visit reads as the lists show it (`visitLifecycleStatus`). */
export function bookingStatusForReport(unit: NewBookingUnit): string {
  if (unit.state === 'pending') return 'Pending';
  if (unit.state === 'cancelled' || unit.state === 'lapsed') return 'Cancelled';
  // On the books: a service still waiting for payment does not hold the booking back.
  const rows = unit.rows.filter((row) => row.status !== 'Pending');
  if (rows.length === 1) return rows[0]!.status ?? 'Booked';
  return visitLifecycleStatus(
    rows.map((row) => ({ status: row.status ?? 'Booked' })),
    rows.some((row) => row.status === 'No-Show') ? 'No-Show' : undefined,
  );
}

/** `report1_booking_summary`: the Appointment activity card. */
export function summariseBookingActivity(
  units: readonly NewBookingUnit[],
  from: string,
  to: string,
): BookingActivitySummary {
  const summary: BookingActivitySummary = {
    total_bookings_created: 0,
    by_source: {},
    by_channel: Object.fromEntries(NEW_BOOKING_CHANNELS.map((c) => [c, 0])) as Record<NewBookingChannel, number>,
    by_status: {},
    covers_booked: 0,
    covers_seated: 0,
  };
  for (const unit of units) {
    if (unit.state === 'lapsed' || !inRange(unit, from, to)) continue;
    const status = bookingStatusForReport(unit);
    summary.by_status[status] = (summary.by_status[status] ?? 0) + 1;
    if (unit.state === 'pending') continue;
    summary.total_bookings_created += 1;
    const source = unit.rows[0]?.source ?? 'unknown';
    summary.by_source[source] = (summary.by_source[source] ?? 0) + 1;
    summary.by_channel[unit.channel] += 1;
    const people = bookingHeadcount(unit);
    summary.covers_booked += people;
    if (unit.rows.some(rowSeen)) summary.covers_seated += people;
  }
  return summary;
}

/** `report3_cancellation`: the Cancellation rate card. */
export function summariseCancellations(
  units: readonly NewBookingUnit[],
  from: string,
  to: string,
): CancellationSummary {
  let total = 0;
  let byClient = 0;
  let byTeam = 0;
  let lapsed = 0;
  for (const unit of units) {
    if (!inRange(unit, from, to)) continue;
    if (unit.state === 'lapsed') {
      lapsed += 1;
      continue;
    }
    if (unit.state === 'pending') continue;
    total += 1;
    if (unit.state !== 'cancelled') continue;
    const clientCancelled = unit.rows.some(
      (row) => row.status === 'Cancelled' && row.cancellation_actor_type === 'customer',
    );
    if (clientCancelled) byClient += 1;
    else byTeam += 1;
  }
  return {
    total_bookings_created: total,
    cancelled_guest_initiated: byClient,
    cancelled_team_initiated: byTeam,
    cancelled_auto: lapsed,
    cancellation_rate_pct: total > 0 ? Math.round((10_000 * (byClient + byTeam)) / total) / 100 : 0,
  };
}

/** Both cards from one read of the bookings made on venue-local days `from` to `to`. */
export async function buildOverviewBookingReports(
  db: SupabaseClient,
  params: { venueId: string; timeZone: string; from: string; to: string },
): Promise<{ activity: BookingActivitySummary; cancellation: CancellationSummary }> {
  const units = await loadNewBookingUnits(db, params);
  return {
    activity: summariseBookingActivity(units, params.from, params.to),
    cancellation: summariseCancellations(units, params.from, params.to),
  };
}
