/**
 * Moving a booking to a calendar at another venue of the same collective (D46 revised 2026-09-16,
 * the owner's "option 2"; UX spec item 13).
 *
 * A booking belongs to its venue, so a move between venues is a hand-over: the other venue gets its
 * own booking, on its own service and client record, at the time and price it was booked at, and
 * the original is cancelled without telling the client. The client gets one message, from the new
 * venue, saying what changed. Only a booking with nothing attached that cannot move is moved: no
 * deposit, card hold, payment or completed form, and not part of a visit or a group. Everything
 * else is refused with the reason, and staff can still move it within its own venue.
 *
 * The database does the write in one transaction (`collective_move_booking`); this module checks
 * who may ask, that the time is free at the new calendar, and finds the client at the new venue.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VenueStaff } from '@/lib/venue-auth';
import { loadStaffAccessibleBooking, resolveLinkedStaffCreateScope } from '@/lib/booking/staff-booking-access';
import { findStaffCollectiveForVenue } from '@/lib/linked-accounts/collective-staff-scope';
import { validateAppointmentModificationInterval } from '@/lib/booking/validate-appointment-modification';
import { findOrCreateGuest } from '@/lib/guests';
import { recordCollectiveBookingAudit } from '@/lib/linked-accounts/audit';
import { executeBookingModificationGuestNotification } from '@/lib/booking/send-booking-modification-guest-notification';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import { formatIsoDateInTimeZone } from '@/lib/date/format-iso-date-in-timezone';

type Row = Record<string, unknown>;

export interface MoveBookingInput {
  bookingId: string;
  calendarId: string;
  bookingDate: string;
  /** HH:mm */
  bookingTime: string;
}

export type MoveBookingResult =
  | { ok: true; bookingId: string; venueId: string; venueName: string; guestNotified: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string; code?: string };

const refuse = (status: 400 | 403 | 404 | 409, error: string, code?: string): MoveBookingResult => ({
  ok: false,
  status,
  error,
  ...(code ? { code } : {}),
});

/** The words for a refusal the database gave, by its code and detail. */
export function moveRefusalWords(message: string, venueName: string): { error: string; code: string } | null {
  const match = /^(COLLECTIVE_MOVE_[A-Z_]+):\s*(.*)$/.exec(message.trim());
  if (!match) return null;
  const [, code, detail] = match;
  if (code === 'COLLECTIVE_MOVE_ATTACHED') {
    const reason = ['payment', 'forms', 'visit', 'status'].includes(detail!.split(/\s/)[0]!)
      ? (detail!.split(/\s/)[0] as 'payment' | 'forms' | 'visit' | 'status')
      : 'status';
    return { code, error: collectiveCopy(`move.refused.${reason}` as 'move.refused.payment', { venue: venueName }) };
  }
  if (code === 'COLLECTIVE_MOVE_SERVICE') return { code, error: collectiveCopy('move.refused.service', { venue: venueName }) };
  return { code: 'COLLECTIVE_MOVE_NOT_ALLOWED', error: collectiveCopy('move.refused.notAllowed', { venue: venueName }) };
}

/** The venue's own service and option standing for the booked ones, found through the offering. */
async function targetServiceFor(
  admin: SupabaseClient,
  booking: Row,
  collective: { collectiveId: string; hostVenueId: string },
  targetVenueId: string,
): Promise<{ serviceId: string; variantId: string | null } | null> {
  const serviceId = booking.service_item_id as string | null;
  if (!serviceId) return null;
  let itemId = (booking.collective_service_item_id as string | null) ?? null;
  if (!itemId) {
    const { data: replica } = await admin
      .from('collective_service_replicas')
      .select('collective_service_item_id')
      .eq('collective_id', collective.collectiveId)
      .eq('venue_id', booking.venue_id as string)
      .eq('replica_service_id', serviceId)
      .is('released_at', null)
      .maybeSingle();
    itemId = (replica?.collective_service_item_id as string | undefined) ?? null;
  }
  const { data: item } = itemId
    ? await admin.from('collective_service_items').select('id, master_service_id, status').eq('id', itemId).maybeSingle()
    : await admin
        .from('collective_service_items')
        .select('id, master_service_id, status')
        .eq('collective_id', collective.collectiveId)
        .eq('master_service_id', serviceId)
        .maybeSingle();
  if (!item || item.status !== 'active') return null;

  let targetServiceId: string | null = null;
  if (targetVenueId === collective.hostVenueId) {
    targetServiceId = item.master_service_id as string;
  } else {
    const { data: link } = await admin
      .from('collective_service_replicas')
      .select('replica_service_id')
      .eq('collective_service_item_id', item.id as string)
      .eq('venue_id', targetVenueId)
      .is('released_at', null)
      .maybeSingle();
    targetServiceId = (link?.replica_service_id as string | undefined) ?? null;
  }
  if (!targetServiceId) return null;

  const variantId = (booking.service_variant_id as string | null) ?? null;
  if (!variantId) return { serviceId: targetServiceId, variantId: null };
  const { data: variant } = await admin
    .from('service_variants')
    .select('id, replica_of_variant_id')
    .eq('id', variantId)
    .maybeSingle();
  const key = (variant?.replica_of_variant_id as string | null) ?? (variant?.id as string | undefined) ?? null;
  if (!key) return null;
  const { data: options } = await admin
    .from('service_variants')
    .select('id, replica_of_variant_id')
    .eq('service_item_id', targetServiceId)
    .eq('is_active', true);
  const match = ((options ?? []) as Row[]).find((o) => ((o.replica_of_variant_id as string | null) ?? o.id) === key);
  return match ? { serviceId: targetServiceId, variantId: match.id as string } : null;
}

export async function moveBookingToCollectiveVenue(
  admin: SupabaseClient,
  staff: VenueStaff,
  actorUserId: string | null,
  input: MoveBookingInput,
): Promise<MoveBookingResult> {
  const loaded = await loadStaffAccessibleBooking(staff, input.bookingId);
  if (!loaded.ok) return refuse(loaded.status, loaded.error);
  const { booking, ownerVenueId, isOwnVenue, linkedGrant } = loaded.ctx;
  // A move cancels the original, so a partner's booking needs the right to cancel it.
  if (!isOwnVenue && linkedGrant?.act !== 'create_edit_cancel') {
    return refuse(403, 'This link does not allow cancelling the other venue’s bookings, so it cannot be moved.');
  }

  const { data: calendar } = await admin
    .from('unified_calendars')
    .select('id, name, venue_id, is_active')
    .eq('id', input.calendarId)
    .maybeSingle();
  if (!calendar || calendar.is_active === false) return refuse(404, 'That calendar was not found.');
  const targetVenueId = calendar.venue_id as string;
  if (targetVenueId === ownerVenueId) {
    return refuse(400, 'That calendar is at the same venue. Move the booking there as usual.');
  }

  const collective = await findStaffCollectiveForVenue(admin, staff.venue_id);
  const { data: venues } = await admin.from('venues').select('id, name, timezone').in('id', [targetVenueId, ownerVenueId]);
  const targetVenue = ((venues ?? []) as Row[]).find((v) => v.id === targetVenueId);
  const venueName = (targetVenue?.name as string | undefined) ?? 'the other venue';
  if (
    !collective ||
    !collective.memberVenueIds.includes(ownerVenueId) ||
    !collective.memberVenueIds.includes(targetVenueId)
  ) {
    return refuse(409, collectiveCopy('move.refused.notAllowed', { venue: venueName }), 'COLLECTIVE_MOVE_NOT_ALLOWED');
  }
  const createScope = await resolveLinkedStaffCreateScope(admin, staff.venue_id, targetVenueId, actorUserId);
  if (!createScope.ok) return refuse(403, createScope.error);

  const today = formatIsoDateInTimeZone(new Date(), (targetVenue?.timezone as string | null) || 'Europe/London');
  if (input.bookingDate < today) return refuse(400, 'Choose a date from today onwards.');

  const target = await targetServiceFor(admin, booking as Row, collective, targetVenueId);
  if (!target) {
    return refuse(409, collectiveCopy('move.refused.service', { venue: venueName }), 'COLLECTIVE_MOVE_SERVICE');
  }

  // The same length at the new time; the new venue's own rules decide whether the time is free.
  const startHm = input.bookingTime.slice(0, 5);
  const oldStart = timeToMinutes(String(booking.booking_time).slice(0, 5));
  const oldEnd = booking.booking_end_time ? timeToMinutes(String(booking.booking_end_time).slice(0, 5)) : null;
  const endHm = oldEnd !== null && oldEnd > oldStart ? minutesToTime(timeToMinutes(startHm) + (oldEnd - oldStart)) : null;
  const check = await validateAppointmentModificationInterval({
    admin,
    venueId: targetVenueId,
    bookingId: input.bookingId,
    newDate: input.bookingDate,
    timeStr: startHm,
    practId: input.calendarId,
    svcId: target.serviceId,
    bookingEndTime: endHm,
    serviceVariantId: target.variantId,
    bookingServiceVariantId: target.variantId,
    bookingProcessingSnapshot: (booking as Row).processing_time_blocks,
  } as Parameters<typeof validateAppointmentModificationInterval>[0]);
  if (!check.ok) return refuse(409, check.reason, 'COLLECTIVE_MOVE_TIME');

  // The client's own record at the new venue: found by email or phone there, or created.
  const row = booking as Row;
  let first = (row.guest_first_name as string | null) ?? null;
  let last = (row.guest_last_name as string | null) ?? null;
  let email = (row.guest_email as string | null) ?? null;
  let phone = (row.guest_phone as string | null) ?? null;
  if (row.guest_id) {
    const { data: guest } = await admin
      .from('guests')
      .select('first_name, last_name, email, phone')
      .eq('id', row.guest_id as string)
      .maybeSingle();
    first = (guest?.first_name as string | null) ?? first;
    last = (guest?.last_name as string | null) ?? last;
    email = (guest?.email as string | null) ?? email;
    phone = (guest?.phone as string | null) ?? phone;
  }
  const { guest } = await findOrCreateGuest(
    admin,
    targetVenueId,
    { first_name: first, last_name: last, email, phone },
    { silentAuthSignup: Boolean(email) },
  );

  const { data: newId, error } = await admin.rpc('collective_move_booking', {
    p_booking_id: input.bookingId,
    p_target_calendar_id: input.calendarId,
    p_booking_date: input.bookingDate,
    p_booking_time: `${startHm}:00`,
    p_target_guest_id: guest.id,
    p_actor_venue_id: staff.venue_id,
    p_actor_staff_id: staff.id,
  });
  if (error || !newId) {
    const words = error?.message ? moveRefusalWords(error.message, venueName) : null;
    if (words) return refuse(409, words.error, words.code);
    console.error('[moveBookingToCollectiveVenue] move failed', { bookingId: input.bookingId, error });
    return { ok: false, status: 500, error: 'The booking could not be moved. Please try again.' };
  }
  const movedId = newId as string;

  // Both venues' records of who did it, where the actor is not the owner.
  await Promise.all([
    recordCollectiveBookingAudit({
      admin,
      collectiveId: collective.collectiveId,
      actingVenueId: staff.venue_id,
      actingUserId: actorUserId,
      owningVenueId: targetVenueId,
      bookingIds: [movedId],
      actionType: 'created_booking',
    }),
    recordCollectiveBookingAudit({
      admin,
      collectiveId: collective.collectiveId,
      actingVenueId: staff.venue_id,
      actingUserId: actorUserId,
      owningVenueId: ownerVenueId,
      bookingIds: [input.bookingId],
      actionType: 'cancelled_booking',
    }),
  ]).catch((err) => console.error('[moveBookingToCollectiveVenue] audit failed', err));

  // One message to the client, from the venue that now has the booking.
  let guestNotified = false;
  try {
    const sent = await executeBookingModificationGuestNotification(admin, targetVenueId, movedId, {
      changeSummary: collectiveCopy('move.guest.changed', {
        venue: venueName,
        calendar: (calendar.name as string | null) ?? venueName,
      }),
    });
    guestNotified = sent.emailSent || sent.smsSent;
  } catch (err) {
    console.error('[moveBookingToCollectiveVenue] client message failed', { movedId, err });
  }

  return { ok: true, bookingId: movedId, venueId: targetVenueId, venueName, guestNotified };
}
