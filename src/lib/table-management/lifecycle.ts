import type { SupabaseClient } from '@supabase/supabase-js';
import { BOOKING_ACTIVE_STATUSES, type TableServiceStatus } from '@/lib/table-management/constants';
import { canTransitionBookingStatus, canMarkNoShowForSlot, isRevertTransition, type BookingStatus } from '@/lib/table-management/booking-status';

interface BookingCore {
  id: string;
  venue_id: string;
  booking_date: string;
  booking_time: string;
  estimated_end_time: string | null;
  party_size: number;
  status: string;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

/** End minute-of-day for overlap checks; may exceed 1440 when the booking crosses midnight (wall time). */
export function computeEndMinutes(
  booking: Pick<BookingCore, 'booking_time' | 'estimated_end_time'>,
  fallbackMinutes = 90,
): number {
  const startMin = timeToMinutes(booking.booking_time);
  if (!booking.estimated_end_time) return startMin + fallbackMinutes;
  const raw = booking.estimated_end_time.includes('T')
    ? booking.estimated_end_time.split('T')[1] ?? ''
    : booking.estimated_end_time;
  if (!raw) return startMin + fallbackMinutes;
  let endMin = timeToMinutes(raw);
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  return endMin;
}

export async function getBookingById(
  db: SupabaseClient,
  venueId: string,
  bookingId: string,
): Promise<BookingCore | null> {
  const { data } = await db
    .from('bookings')
    .select('id, venue_id, booking_date, booking_time, estimated_end_time, party_size, status')
    .eq('id', bookingId)
    .eq('venue_id', venueId)
    .single();
  return (data as BookingCore | null) ?? null;
}

export async function getAssignedTableIds(db: SupabaseClient, bookingId: string): Promise<string[]> {
  const { data } = await db
    .from('booking_table_assignments')
    .select('table_id')
    .eq('booking_id', bookingId);
  return (data ?? []).map((row: { table_id: string }) => row.table_id);
}

export async function validateTablesBelongToVenue(
  db: SupabaseClient,
  venueId: string,
  tableIds: string[],
): Promise<boolean> {
  if (tableIds.length === 0) return false;
  const { data } = await db
    .from('venue_tables')
    .select('id')
    .eq('venue_id', venueId)
    .in('id', tableIds);
  return (data?.length ?? 0) === tableIds.length;
}

export async function validateTableCapacity(
  db: SupabaseClient,
  tableIds: string[],
  partySize: number,
): Promise<boolean> {
  const { data } = await db
    .from('venue_tables')
    .select('id, max_covers')
    .in('id', tableIds);
  const total = (data ?? []).reduce((sum, row: { max_covers: number }) => sum + row.max_covers, 0);
  return total >= partySize;
}

export async function detectAssignmentConflicts(
  db: SupabaseClient,
  venueId: string,
  booking: BookingCore,
  targetTableIds: string[],
  excludeBookingId?: string,
): Promise<string[]> {
  const { data } = await db
    .from('booking_table_assignments')
    .select('table_id, booking:bookings!inner(id, venue_id, booking_date, booking_time, estimated_end_time, status)')
    .in('table_id', targetTableIds)
    .eq('booking.venue_id', venueId)
    .eq('booking.booking_date', booking.booking_date)
    .in('booking.status', [...BOOKING_ACTIVE_STATUSES]);

  const startMin = timeToMinutes(booking.booking_time);
  const endMin = computeEndMinutes(booking);
  const conflicts = new Set<string>();
  const dayStart = `${booking.booking_date}T00:00:00.000Z`;
  const dayEnd = `${booking.booking_date}T23:59:59.999Z`;

  for (const row of data ?? []) {
    const bookingRaw = row.booking as BookingCore | BookingCore[] | null;
    const linked = Array.isArray(bookingRaw) ? bookingRaw[0] : bookingRaw;
    if (!linked?.id) continue;
    if (excludeBookingId && linked.id === excludeBookingId) continue;
    const otherStart = timeToMinutes(linked.booking_time);
    const otherEnd = computeEndMinutes(linked);
    if (intervalsOverlap(startMin, endMin, otherStart, otherEnd)) {
      conflicts.add(row.table_id);
    }
  }

  const { data: blocks } = await db
    .from('table_blocks')
    .select('table_id, start_at, end_at')
    .in('table_id', targetTableIds)
    .eq('venue_id', venueId)
    .lt('start_at', dayEnd)
    .gt('end_at', dayStart);

  for (const block of blocks ?? []) {
    const blockStart = timeToMinutes(new Date(block.start_at).toISOString().slice(11, 16));
    const blockEnd = timeToMinutes(new Date(block.end_at).toISOString().slice(11, 16));
    if (intervalsOverlap(startMin, endMin, blockStart, blockEnd)) {
      conflicts.add(block.table_id);
    }
  }

  return Array.from(conflicts);
}

export async function replaceBookingAssignments(
  db: SupabaseClient,
  bookingId: string,
  nextTableIds: string[],
  assignedBy: string | null,
): Promise<void> {
  const { error: deleteError } = await db.from('booking_table_assignments').delete().eq('booking_id', bookingId);
  if (deleteError) {
    throw new Error(`Failed to clear existing table assignments: ${deleteError.message}`);
  }

  if (nextTableIds.length === 0) return;

  const { error: insertError } = await db.from('booking_table_assignments').insert(
    nextTableIds.map((tableId) => ({
      booking_id: bookingId,
      table_id: tableId,
      assigned_by: assignedBy,
    })),
  );
  if (insertError) {
    throw new Error(`Failed to write table assignments: ${insertError.message}`);
  }
}

export async function syncTableStatusesForBooking(
  db: SupabaseClient,
  bookingId: string,
  tableIds: string[],
  bookingStatus: string,
  updatedBy: string | null,
): Promise<void> {
  const tableStatus: TableServiceStatus =
    bookingStatus === 'Seated' || bookingStatus === 'Arrived' ? 'seated' : 'reserved';

  if (tableIds.length > 0) {
    await db
      .from('table_statuses')
      .update({
        status: tableStatus,
        booking_id: bookingId,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      })
      .in('table_id', tableIds);
  }
}

export async function clearTableStatusesForBooking(
  db: SupabaseClient,
  bookingId: string,
  updatedBy: string | null,
): Promise<void> {
  await db
    .from('table_statuses')
    .update({
      status: 'available',
      booking_id: null,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    })
    .eq('booking_id', bookingId);
}

export async function deleteTemporaryTablesForBooking(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db
    .from('venue_tables')
    .delete()
    .eq('temporary_booking_id', bookingId)
    .eq('is_temporary', true);

  if (error) {
    throw new Error(`Failed to delete temporary tables: ${error.message}`);
  }
}

export function validateBookingStatusTransition(
  fromStatus: string,
  toStatus: BookingStatus,
): { ok: true } | { ok: false; error: string } {
  if (!canTransitionBookingStatus(fromStatus, toStatus)) {
    return { ok: false, error: `Cannot change status from ${fromStatus} to ${toStatus}` };
  }
  return { ok: true };
}

/**
 * Server-side enforcement of no-show grace period. Returns an error result
 * when a No-Show transition is attempted before the grace window has elapsed.
 */
export function validateNoShowGracePeriod(
  bookingDate: string,
  bookingTime: string,
  graceMinutes: number,
): { ok: true } | { ok: false; error: string } {
  if (!canMarkNoShowForSlot(bookingDate, bookingTime, graceMinutes)) {
    return {
      ok: false,
      error: `Cannot mark as no-show yet \u2014 the grace period of ${graceMinutes} minutes after booking time has not elapsed`,
    };
  }
  return { ok: true };
}

export async function applyBookingLifecycleStatusEffects(
  db: SupabaseClient,
  args: {
    bookingId: string;
    guestId: string;
    previousStatus: string;
    nextStatus: BookingStatus;
    actorId: string | null;
  },
): Promise<void> {
  const { bookingId, guestId, previousStatus, nextStatus, actorId } = args;

  const isRevert = isRevertTransition(previousStatus, nextStatus);

  if (previousStatus !== 'Seated' && nextStatus === 'Seated') {
    // Reopening from Completed should not count as another visit.
    if (previousStatus !== 'Completed') {
      const today = new Date().toISOString().slice(0, 10);
      const { data: guestData } = await db.from('guests').select('visit_count').eq('id', guestId).single();
      await db
        .from('guests')
        .update({
          visit_count: (guestData?.visit_count ?? 0) + 1,
          last_visit_date: today,
          updated_at: new Date().toISOString(),
        })
        .eq('id', guestId);
    }
  }

  if (previousStatus === 'Seated' && isRevert) {
    const { data: guestData } = await db.from('guests').select('visit_count').eq('id', guestId).single();
    const currentCount = guestData?.visit_count ?? 0;
    await db
      .from('guests')
      .update({
        visit_count: Math.max(0, currentCount - 1),
        updated_at: new Date().toISOString(),
      })
      .eq('id', guestId);
  }

  if (previousStatus !== 'No-Show' && nextStatus === 'No-Show') {
    const { data: guestData } = await db.from('guests').select('no_show_count').eq('id', guestId).single();
    await db
      .from('guests')
      .update({
        no_show_count: (guestData?.no_show_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', guestId);
  }

  if (previousStatus === 'No-Show' && isRevert) {
    const { data: guestData } = await db.from('guests').select('no_show_count').eq('id', guestId).single();
    const currentCount = guestData?.no_show_count ?? 0;
    await db
      .from('guests')
      .update({
        no_show_count: Math.max(0, currentCount - 1),
        updated_at: new Date().toISOString(),
      })
      .eq('id', guestId);
  }

  const assignedTableIds = await getAssignedTableIds(db, bookingId);
  if (nextStatus === 'Cancelled' || nextStatus === 'No-Show') {
    await clearTableStatusesForBooking(db, bookingId, actorId);
    // Remove assignment rows so dashboards and exports do not show stale table links.
    await replaceBookingAssignments(db, bookingId, [], actorId);
    await deleteTemporaryTablesForBooking(db, bookingId);
  } else if (nextStatus === 'Completed') {
    await clearTableStatusesForBooking(db, bookingId, actorId);
    await deleteTemporaryTablesForBooking(db, bookingId);
    // Keep table assignments so the timeline grid still shows where the party sat.
  } else if (nextStatus === 'Seated' || nextStatus === 'Booked' || nextStatus === 'Pending') {
    // Table assignment is locked at booking time, not at attendance time —
    // sync on Booked but skip on Booked → Confirmed (the table is already
    // marked `reserved`; nothing changes when the guest just confirms).
    await syncTableStatusesForBooking(db, bookingId, assignedTableIds, nextStatus, actorId);
  }
}
