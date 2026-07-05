import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Verify that the class_instance belongs to the staff's venue. Returns the
 * instance row when ok.
 */
export async function loadStaffClassInstance(
  admin: SupabaseClient,
  venueId: string,
  classInstanceId: string,
): Promise<
  | { ok: true; instance: { id: string; class_type_id: string } }
  | { ok: false; status: number; error: string }
> {
  const { data: inst, error: instErr } = await admin
    .from('class_instances')
    .select('id, class_type_id')
    .eq('id', classInstanceId)
    .maybeSingle();
  if (instErr || !inst) {
    return { ok: false, status: 404, error: 'Class instance not found' };
  }
  const { data: ct } = await admin
    .from('class_types')
    .select('id')
    .eq('id', (inst as { class_type_id: string }).class_type_id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!ct) {
    return { ok: false, status: 404, error: 'Class instance not found' };
  }
  return {
    ok: true,
    instance: inst as { id: string; class_type_id: string },
  };
}

export type AttendanceMutationKind = 'check_in' | 'no_show';

interface AttendanceMutationParams {
  admin: SupabaseClient;
  venueId: string;
  classInstanceId: string;
  bookingId: string;
  kind: AttendanceMutationKind;
  actorId: string | null;
}

/**
 * Apply a single check-in / no-show against a booking that belongs to this class
 * instance. Mirrors the change onto a linked class_course_session_enrollments row
 * when one exists. Idempotent.
 */
export async function applyAttendanceMutation(
  params: AttendanceMutationParams,
): Promise<{ ok: true; changed: boolean } | { ok: false; status: number; error: string }> {
  const { admin, venueId, classInstanceId, bookingId, kind, actorId } = params;

  const { data: bookingRaw, error: bErr } = await admin
    .from('bookings')
    .select('id, venue_id, class_instance_id, guest_id, status, checked_in_at')
    .eq('id', bookingId)
    .maybeSingle();
  if (bErr || !bookingRaw) {
    return { ok: false, status: 404, error: 'Booking not found' };
  }
  const booking = bookingRaw as {
    id: string;
    venue_id: string;
    class_instance_id: string | null;
    guest_id: string;
    status: string;
    checked_in_at: string | null;
  };
  if (booking.venue_id !== venueId || booking.class_instance_id !== classInstanceId) {
    return { ok: false, status: 403, error: 'Booking does not belong to this class instance' };
  }
  if (booking.status === 'Cancelled') {
    return { ok: false, status: 409, error: 'Cannot mark attendance on a cancelled booking' };
  }

  const nowIso = new Date().toISOString();
  let changed = false;

  if (kind === 'check_in') {
    if (booking.checked_in_at) {
      // already checked in — no-op
    } else {
      const { error: upErr } = await admin
        .from('bookings')
        .update({ checked_in_at: nowIso, status: 'Seated', updated_at: nowIso })
        .eq('id', bookingId);
      if (upErr) {
        console.error('[applyAttendanceMutation] check-in update', upErr);
        return { ok: false, status: 500, error: 'Update failed' };
      }
      changed = true;
    }

    // Mirror to course session enrollment if present.
    const { data: guestRows } = await admin
      .from('guests')
      .select('user_id')
      .eq('id', booking.guest_id)
      .maybeSingle();
    const userId = (guestRows as { user_id?: string | null } | null)?.user_id ?? null;
    if (userId) {
      const { data: enrollments } = await admin
        .from('class_course_enrollments')
        .select('id')
        .eq('user_id', userId)
        .eq('venue_id', venueId)
        .in('status', ['active', 'completed']);
      const enrollmentIds = ((enrollments ?? []) as Array<{ id: string }>).map((e) => e.id);
      if (enrollmentIds.length > 0) {
        await admin
          .from('class_course_session_enrollments')
          .update({ status: 'attended', updated_at: nowIso })
          .eq('class_instance_id', classInstanceId)
          .in('enrollment_id', enrollmentIds)
          .in('status', ['scheduled']);
      }
    }
  } else {
    // no_show
    if (booking.status === 'No-Show') {
      // already
    } else {
      const { error: upErr } = await admin
        .from('bookings')
        .update({ status: 'No-Show', updated_at: nowIso })
        .eq('id', bookingId);
      if (upErr) {
        console.error('[applyAttendanceMutation] no-show update', upErr);
        return { ok: false, status: 500, error: 'Update failed' };
      }
      changed = true;
    }

    const { data: guestRows } = await admin
      .from('guests')
      .select('user_id')
      .eq('id', booking.guest_id)
      .maybeSingle();
    const userId = (guestRows as { user_id?: string | null } | null)?.user_id ?? null;
    if (userId) {
      const { data: enrollments } = await admin
        .from('class_course_enrollments')
        .select('id')
        .eq('user_id', userId)
        .eq('venue_id', venueId)
        .in('status', ['active', 'completed']);
      const enrollmentIds = ((enrollments ?? []) as Array<{ id: string }>).map((e) => e.id);
      if (enrollmentIds.length > 0) {
        await admin
          .from('class_course_session_enrollments')
          .update({ status: 'no_show', updated_at: nowIso })
          .eq('class_instance_id', classInstanceId)
          .in('enrollment_id', enrollmentIds)
          .in('status', ['scheduled']);
      }
    }
  }

  if (changed) {
    await admin.from('events').insert({
      venue_id: venueId,
      booking_id: bookingId,
      event_type: kind === 'check_in' ? 'class_checked_in' : 'class_no_show',
      payload: { class_instance_id: classInstanceId, actor_id: actorId },
    });
  }

  return { ok: true, changed };
}
