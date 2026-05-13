import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireManagedCalendarAccess } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import type { EngineInput } from '@/types/availability';
import { computeAvailability, fetchEngineInput } from '@/lib/availability';
import { AVAILABILITY_SETUP_REQUIRED_MESSAGE } from '@/lib/availability/availability-errors';
import {
  attachVenueClockToAppointmentInput,
  fetchAppointmentInput,
  validateAppointmentCustomInterval,
} from '@/lib/availability/appointment-engine';
import { parseProcessingTimeBlocksFromDb, validateProcessingTimeBlocks } from '@/lib/appointments/processing-time';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { autoAssignTable } from '@/lib/table-availability';
import { BOOKING_MUTABLE_STATUSES } from '@/lib/table-management/constants';
import type { BookingStatus } from '@/lib/table-management/booking-status';
import {
  applyBookingLifecycleStatusEffects,
  clearTableStatusesForBooking,
  getAssignedTableIds,
  replaceBookingAssignments,
  syncTableStatusesForBooking,
  validateBookingStatusTransition,
  validateNoShowGracePeriod,
  validateTablesBelongToVenue,
} from '@/lib/table-management/lifecycle';
import {
  resolveDurationAndBufferForTableAssignment,
  resolveTableAssignmentDurationBuffer,
} from '@/lib/table-management/booking-table-duration';
import { resolveVenueMode } from '@/lib/venue-mode';
import { z } from 'zod';
import { normalizeToE164 } from '@/lib/phone/e164';
import { communicationService } from '@/lib/communications';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { logBookingOp } from '@/lib/observability/booking-ops-log';
import { resolveCdeBookingContext } from '@/lib/booking/cde-booking-context';
import { resolveBookingScopedCalendarId } from '@/lib/booking/staff-booking-calendar-scope';
import { tableGroupKeyFromIds } from '@/lib/table-management/combination-rules';
import type { BookingModel } from '@/types/booking-models';
import { listActiveAreasForVenue } from '@/lib/areas/resolve-default-area';
import { formatGuestDisplayName, normaliseGuestNamePart } from '@/lib/guests/name';

const statusSchema = z.enum(BOOKING_MUTABLE_STATUSES);
const actualDepartedTimeSchema = z.string().datetime();

function minutesBetweenStartAndEnd(startHHmm: string, endHHmm: string): number {
  const startMin = timeToMinutes(startHHmm);
  let endMin = timeToMinutes(endHHmm);
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  return endMin - startMin;
}

function cancellationDeadline(bookingDate: string, bookingTime: string): string {
  const [y, m, d] = bookingDate.split('-').map(Number);
  const [hh, mm] = bookingTime.slice(0, 5).split(':').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, hh, mm, 0));
  dt.setHours(dt.getHours() - 48);
  return dt.toISOString();
}

/** GET /api/venue/bookings/[id] - full booking detail with guest and events timeline. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { id } = await params;

    const { data: booking, error: bookErr } = await staff.db
      .from('bookings')
      .select('*')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .single();

    if (bookErr || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    let area_name: string | null = null;
    const bookingAreaId = (booking as { area_id?: string | null }).area_id;
    if (bookingAreaId) {
      const { data: ar } = await staff.db
        .from('areas')
        .select('name')
        .eq('id', bookingAreaId)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();
      area_name = (ar as { name?: string } | null)?.name ?? null;
    }

    let service_variant_name: string | null = null;
    let service_variant_price_pence: number | null = null;
    const bookingVariantId = (booking as { service_variant_id?: string | null }).service_variant_id;
    if (bookingVariantId) {
      const { data: sv } = await staff.db
        .from('service_variants')
        .select('name, price_pence')
        .eq('id', bookingVariantId)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();
      if (sv) {
        service_variant_name = (sv as { name?: string }).name ?? null;
        service_variant_price_pence = (sv as { price_pence?: number | null }).price_pence ?? null;
      }
    }

    const { data: guest } = await staff.db
      .from('guests')
      .select('id, first_name, last_name, email, phone, visit_count, last_visit_date, tags, customer_profile_notes')
      .eq('id', booking.guest_id)
      .single();

    const { data: events } = await staff.db
      .from('events')
      .select('id, event_type, payload, created_at')
      .eq('booking_id', id)
      .order('created_at', { ascending: true });

    const { data: communications } = await staff.db
      .from('communications')
      .select('id, message_type, channel, status, created_at')
      .eq('booking_id', id)
      .order('created_at', { ascending: true });

    const bookingTimeStr = typeof booking.booking_time === 'string'
      ? booking.booking_time.slice(0, 5)
      : '';

    const { data: tableAssignments } = await staff.db
      .from('booking_table_assignments')
      .select('table_id, table:venue_tables(id, name)')
      .eq('booking_id', id);

    const assignedTables = (tableAssignments ?? []).map((a: { table_id: string; table: unknown }) => {
      const tbl = a.table as { id: string; name: string } | null;
      return { id: tbl?.id ?? a.table_id, name: tbl?.name ?? 'Unknown' };
    });

    const cde_context = await resolveCdeBookingContext(staff.db, booking as Parameters<typeof resolveCdeBookingContext>[1]);
    const inferred_booking_model = inferBookingRowModel(
      booking as {
        booking_model?: string | null;
        experience_event_id?: string | null;
        class_instance_id?: string | null;
        resource_id?: string | null;
        event_session_id?: string | null;
        calendar_id?: string | null;
        service_item_id?: string | null;
        practitioner_id?: string | null;
        appointment_service_id?: string | null;
      },
    );

    let combination_staff_notes: string | null = null;
    if (assignedTables.length >= 2) {
      const key = tableGroupKeyFromIds(assignedTables.map((t) => t.id));
      const { data: customCombo } = await staff.db
        .from('table_combinations')
        .select('internal_notes')
        .eq('venue_id', staff.venue_id)
        .eq('table_group_key', key)
        .maybeSingle();
      if (customCombo?.internal_notes) {
        combination_staff_notes = customCombo.internal_notes as string;
      } else {
        const { data: autoOv } = await staff.db
          .from('combination_auto_overrides')
          .select('internal_notes')
          .eq('venue_id', staff.venue_id)
          .eq('table_group_key', key)
          .maybeSingle();
        if (autoOv?.internal_notes) {
          combination_staff_notes = autoOv.internal_notes as string;
        }
      }
    }

    return NextResponse.json({
      ...booking,
      area_name,
      booking_time: bookingTimeStr,
      guest: guest ?? null,
      events: events ?? [],
      communications: communications ?? [],
      table_assignments: assignedTables,
      combination_staff_notes,
      cde_context,
      inferred_booking_model: inferred_booking_model as BookingModel,
      service_variant_name,
      service_variant_price_pence,
    });
  } catch (err) {
    console.error('GET /api/venue/bookings/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/bookings/[id] - status change or modify booking fields. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    if (body.ticket_lines !== undefined) {
      return NextResponse.json(
        {
          error:
            'Ticket line edits are not supported (v1). Cancel the booking if policy allows and create a new booking.',
        },
        { status: 400 },
      );
    }

    const { data: booking, error: fetchErr } = await staff.db
      .from('bookings')
      .select('*')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .single();

    if (fetchErr || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    /** Staff attendance toggle only — any venue staff may update (table, event, class, resource, etc.). */
    const bodyKeys = Object.keys(body as Record<string, unknown>).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    const isStaffAttendanceOnlyPatch =
      bodyKeys.length === 1 && bodyKeys[0] === 'staff_attendance_confirmed';
    if (isStaffAttendanceOnlyPatch) {
      const on = Boolean(body.staff_attendance_confirmed);
      const currentStatus = booking.status as string;
      const attPayload: Record<string, unknown> = {
        staff_attendance_confirmed_at: on ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      // Mirror the full handler: promote Booked → Confirmed on confirm,
      // and revert Confirmed → Booked on cancel (when guest has not also confirmed).
      if (on && currentStatus === 'Booked') {
        attPayload.status = 'Confirmed';
      } else if (!on && currentStatus === 'Confirmed' && !booking.guest_attendance_confirmed_at) {
        attPayload.status = 'Booked';
      }
      const { error: attErr } = await staff.db
        .from('bookings')
        .update(attPayload)
        .eq('id', id)
        .eq('venue_id', staff.venue_id);
      if (attErr) {
        console.error('PATCH staff_attendance_confirmed failed:', attErr);
        return NextResponse.json({ error: 'Could not update attendance' }, { status: 500 });
      }
      // Run lifecycle hooks when the status changed.
      if (attPayload.status && attPayload.status !== currentStatus) {
        const adminForHooks = getSupabaseAdminClient();
        await applyBookingLifecycleStatusEffects(adminForHooks, {
          bookingId: id,
          guestId: booking.guest_id,
          previousStatus: currentStatus,
          nextStatus: attPayload.status as BookingStatus,
          actorId: staff.id,
        });
      }
      const { data: updatedAttendance, error: selErr } = await staff.db
        .from('bookings')
        .select('*')
        .eq('id', id)
        .single();
      if (selErr || !updatedAttendance) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }
      return NextResponse.json(updatedAttendance);
    }

    const admin = getSupabaseAdminClient();
    const scopedCalendarId =
      staff.role === 'admin'
        ? null
        : await resolveBookingScopedCalendarId(admin, staff.venue_id, booking as Parameters<
            typeof resolveBookingScopedCalendarId
          >[2]);

    if (staff.role !== 'admin') {
      if (!scopedCalendarId) {
        return NextResponse.json(
          {
            error:
              'This booking is not linked to a team calendar column tied to your permissions. Ask a venue admin to update this booking, or contact support if that seems wrong.',
          },
          { status: 403 },
        );
      }
      const access = await requireManagedCalendarAccess(
        admin,
        staff.venue_id,
        staff,
        scopedCalendarId,
        'You can only modify bookings on calendars assigned to your account.',
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }
    }

    /** Per-booking salon processing blocks only (no reschedule). */
    const isProcessingBlocksOnlyPatch =
      bodyKeys.length === 1 &&
      bodyKeys[0] === 'processing_time_blocks' &&
      !(booking as { experience_event_id?: string | null }).experience_event_id &&
      !(booking as { class_instance_id?: string | null }).class_instance_id &&
      !(booking as { resource_id?: string | null }).resource_id &&
      (Boolean((booking as { practitioner_id?: string | null }).practitioner_id) ||
        Boolean((booking as { calendar_id?: string | null }).calendar_id)) &&
      (Boolean((booking as { appointment_service_id?: string | null }).appointment_service_id) ||
        Boolean((booking as { service_item_id?: string | null }).service_item_id));

    if (isProcessingBlocksOnlyPatch) {
      const bookingTimeStr =
        typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '12:00';
      const startMin = timeToMinutes(bookingTimeStr);
      let coreDuration = 30;
      const bet = (booking as { booking_end_time?: string | null }).booking_end_time;
      if (typeof bet === 'string' && bet.trim().length >= 5) {
        coreDuration = Math.max(15, timeToMinutes(bet.slice(0, 5)) - startMin);
      } else {
        const appointmentSvcIdForDuration = booking.appointment_service_id as string | null | undefined;
        const serviceItemIdForDuration = booking.service_item_id as string | null | undefined;
        if (appointmentSvcIdForDuration) {
          const { data: svcRow } = await admin
            .from('appointment_services')
            .select('duration_minutes')
            .eq('id', appointmentSvcIdForDuration)
            .single();
          coreDuration = svcRow?.duration_minutes ?? 30;
        } else if (serviceItemIdForDuration) {
          const { data: siRow } = await admin
            .from('service_items')
            .select('duration_minutes')
            .eq('id', serviceItemIdForDuration)
            .single();
          coreDuration = (siRow as { duration_minutes?: number } | null)?.duration_minutes ?? 30;
        }
      }

      const parsedBlocks = parseProcessingTimeBlocksFromDb(body.processing_time_blocks);
      const procChk = validateProcessingTimeBlocks(parsedBlocks, coreDuration);
      if (!procChk.ok) {
        return NextResponse.json({ error: procChk.error }, { status: 400 });
      }

      const practId =
        ((booking as { calendar_id?: string | null }).calendar_id as string | null) ??
        (booking.practitioner_id as string | null);
      const svcId =
        ((booking as { appointment_service_id?: string | null }).appointment_service_id as string | null) ??
        ((booking as { service_item_id?: string | null }).service_item_id as string | null);
      if (!practId || !svcId) {
        return NextResponse.json({ error: 'Cannot update processing time for this booking' }, { status: 400 });
      }

      const apptInput = await fetchAppointmentInput({
        supabase: admin,
        venueId: staff.venue_id,
        date: booking.booking_date as string,
        practitionerId: practId,
        serviceId: svcId,
      });
      apptInput.existingBookings = apptInput.existingBookings.filter((b) => b.id.toLowerCase() !== id.toLowerCase());
      apptInput.skipPastSlotFilter = true;
      const { data: venueClock } = await admin
        .from('venues')
        .select('timezone, booking_rules, opening_hours, venue_opening_exceptions')
        .eq('id', staff.venue_id)
        .single();
      attachVenueClockToAppointmentInput(apptInput, venueClock ?? {});

      const endCoreHHmm = minutesToTime(startMin + coreDuration);
      const intervalCheck = validateAppointmentCustomInterval(
        apptInput,
        practId,
        svcId,
        bookingTimeStr,
        endCoreHHmm,
        id,
        { processingTimeBlocks: procChk.normalized ?? [] },
      );
      if (!intervalCheck.ok) {
        return NextResponse.json(
          { error: intervalCheck.reason ?? 'Selected processing pattern conflicts with another booking' },
          { status: 409 },
        );
      }

      const { error: procUpdErr } = await staff.db
        .from('bookings')
        .update({
          processing_time_blocks: procChk.normalized ?? [],
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('venue_id', staff.venue_id);
      if (procUpdErr) {
        console.error('PATCH processing_time_blocks only failed:', procUpdErr);
        return NextResponse.json({ error: 'Could not save processing time' }, { status: 500 });
      }

      const { data: updatedProc, error: procSelErr } = await staff.db.from('bookings').select('*').eq('id', id).single();
      if (procSelErr || !updatedProc) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }
      return NextResponse.json(updatedProc);
    }

    if (body.status !== undefined) {
      const parsed = statusSchema.safeParse(body.status);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      const newStatus = parsed.data;

      const transitionCheck = validateBookingStatusTransition(booking.status as string, newStatus);
      if (!transitionCheck.ok) {
        return NextResponse.json({ error: transitionCheck.error }, { status: 400 });
      }

      if (newStatus === 'No-Show') {
        const { data: venueGrace } = await admin.from('venues').select('no_show_grace_minutes').eq('id', staff.venue_id).single();
        const graceMinutes = venueGrace?.no_show_grace_minutes ?? 15;
        const bookingTimeStr = typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '00:00';
        const graceCheck = validateNoShowGracePeriod(booking.booking_date, bookingTimeStr, graceMinutes);
        if (!graceCheck.ok) {
          return NextResponse.json({ error: graceCheck.error }, { status: 400 });
        }
      }

      if (newStatus === 'Cancelled' && (booking.status === 'Confirmed' || booking.status === 'Booked' || booking.status === 'Pending' || booking.status === 'Seated')) {
        const groupBookingId = booking.group_booking_id as string | null | undefined;
        let idsToCancel: string[] = [id];
        let paymentIntentForRefund: string | null =
          typeof booking.stripe_payment_intent_id === 'string' ? booking.stripe_payment_intent_id : null;
        let depositPenceForMessage: number | null =
          typeof booking.deposit_amount_pence === 'number' ? booking.deposit_amount_pence : null;
        let hadPaidDeposit = booking.deposit_status === 'Paid';

        if (groupBookingId) {
          const { data: groupRows } = await staff.db
            .from('bookings')
            .select('id, stripe_payment_intent_id, deposit_status, deposit_amount_pence')
            .eq('venue_id', staff.venue_id)
            .eq('group_booking_id', groupBookingId)
            .in('status', ['Pending', 'Booked', 'Confirmed', 'Seated']);

          idsToCancel = (groupRows ?? []).map((r: { id: string }) => r.id);
          if (idsToCancel.length === 0) {
            idsToCancel = [id];
          }
          const withPi = (groupRows ?? []).find(
            (r: { stripe_payment_intent_id?: string | null }) => r.stripe_payment_intent_id,
          );
          paymentIntentForRefund =
            typeof withPi?.stripe_payment_intent_id === 'string' ? withPi.stripe_payment_intent_id : paymentIntentForRefund;
          const totalPence = (groupRows ?? []).reduce(
            (sum: number, r: { deposit_amount_pence?: number | null }) => sum + (r.deposit_amount_pence ?? 0),
            0,
          );
          if (totalPence > 0) {
            depositPenceForMessage = totalPence;
          }
          hadPaidDeposit = (groupRows ?? []).some((r: { deposit_status?: string | null }) => r.deposit_status === 'Paid');
        }

        const deadline = booking.cancellation_deadline ? new Date(booking.cancellation_deadline) : null;
        const canRefund =
          Boolean(deadline && new Date() <= deadline && hadPaidDeposit && paymentIntentForRefund);

        let refundSucceeded = false;
        if (canRefund && paymentIntentForRefund) {
          const { data: venue } = await admin.from('venues').select('stripe_connected_account_id').eq('id', staff.venue_id).single();
          if (venue?.stripe_connected_account_id) {
            try {
              await stripe.refunds.create(
                { payment_intent: paymentIntentForRefund },
                { stripeAccount: venue.stripe_connected_account_id },
              );
              refundSucceeded = true;
            } catch (refundErr) {
              logBookingOp({
                operation: 'refund_failed',
                venue_id: staff.venue_id,
                booking_id: id,
                booking_model: inferBookingRowModel(
                  booking as Parameters<typeof inferBookingRowModel>[0],
                ),
                error: refundErr instanceof Error ? refundErr.message : String(refundErr),
              });
            }
          }
        }

        if (refundSucceeded) {
          await staff.db
            .from('bookings')
            .update({
              status: 'Cancelled',
              deposit_status: 'Refunded',
              cancelled_by_staff_id: staff.id,
              cancellation_actor_type: 'staff',
              updated_at: new Date().toISOString(),
            })
            .in('id', idsToCancel);
        } else {
          await staff.db
            .from('bookings')
            .update({
              status: 'Cancelled',
              cancelled_by_staff_id: staff.id,
              cancellation_actor_type: 'staff',
              updated_at: new Date().toISOString(),
            })
            .in('id', idsToCancel);
        }

        logBookingOp({
          operation: 'cancel',
          venue_id: staff.venue_id,
          booking_id: id,
          booking_model: inferBookingRowModel(
            booking as Parameters<typeof inferBookingRowModel>[0],
          ),
        });

        const { data: guestRow } = await staff.db
          .from('guests')
          .select('first_name, last_name, email, phone')
          .eq('id', booking.guest_id)
          .single();
        const { data: venueRow } = await staff.db
          .from('venues')
          .select('name, address, phone, email, reply_to_email')
          .eq('id', staff.venue_id)
          .single();
        if (guestRow && venueRow?.name) {
          const depositAmountStr = depositPenceForMessage
            ? `£${(depositPenceForMessage / 100).toFixed(2)}`
            : null;
          let refund_message: string | undefined;
          if (refundSucceeded) {
            refund_message = `Your deposit of ${depositAmountStr} will be refunded to your original payment method within 5\u201310 business days.`;
          } else if (hadPaidDeposit && !canRefund) {
            refund_message = `Your deposit of ${depositAmountStr} is non-refundable as the cancellation was made less than 48 hours before the reservation.`;
          } else if (hadPaidDeposit && canRefund && !refundSucceeded) {
            refund_message = `We were unable to process your refund automatically. Please contact the venue directly to arrange your refund of ${depositAmountStr}.`;
          }
          const bookingTime = typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
          const { sendCancellationNotification } = await import('@/lib/communications/send-templated');
          const cancelBookingEmail: import('@/lib/emails/types').BookingEmailData = {
            id,
            guest_name: formatGuestDisplayName(guestRow.first_name, guestRow.last_name),
            guest_email: guestRow.email ?? null,
            guest_phone: guestRow.phone ?? null,
            booking_date: booking.booking_date,
            booking_time: bookingTime,
            party_size: booking.party_size,
            deposit_amount_pence: depositPenceForMessage ?? booking.deposit_amount_pence ?? null,
            deposit_status: booking.deposit_status ?? null,
          };
          const cancelVenueEmail = venueRowToEmailData({
            name: venueRow.name,
            address: venueRow.address ?? null,
            phone: venueRow.phone ?? null,
            email: venueRow.email ?? null,
            reply_to_email: venueRow.reply_to_email ?? null,
          });
          const vid = staff.venue_id;
          const refundMsg = refund_message;
          after(async () => {
            try {
              const enriched = await enrichBookingEmailForComms(admin, id, cancelBookingEmail);
              await sendCancellationNotification(enriched, cancelVenueEmail, vid, refundMsg);
            } catch (commsErr) {
              console.error('Staff cancellation notification failed:', commsErr);
            }
          });
        }
      } else if (newStatus === 'No-Show') {
        const hadPaidDeposit = booking.deposit_status === 'Paid';
        const depositStatus = hadPaidDeposit ? 'Forfeited' : booking.deposit_status;
        await staff.db
          .from('bookings')
          .update({ status: 'No-Show', deposit_status: depositStatus, updated_at: new Date().toISOString() })
          .eq('id', id);

        const { data: guestNoShow } = await staff.db
          .from('guests')
          .select('first_name, last_name, email')
          .eq('id', booking.guest_id)
          .maybeSingle();
        const { data: venueNoShow } = await admin.from('venues').select('name').eq('id', staff.venue_id).maybeSingle();
        if (guestNoShow?.email && venueNoShow?.name) {
          const bookingTimeNs = typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
          const venueIdNs = staff.venue_id;
          const bookingIdNs = id;
          const guestIdNs = booking.guest_id;
          after(async () => {
            try {
              await communicationService.send(
                'no_show_notification',
                { email: guestNoShow.email! },
                {
                  guest_name: formatGuestDisplayName(guestNoShow.first_name, guestNoShow.last_name),
                  venue_name: venueNoShow.name!,
                  booking_date: booking.booking_date,
                  booking_time: bookingTimeNs,
                  party_size: booking.party_size,
                  ...(hadPaidDeposit && typeof booking.deposit_amount_pence === 'number'
                    ? { deposit_amount_pence: booking.deposit_amount_pence }
                    : {}),
                },
                {
                  venue_id: venueIdNs,
                  booking_id: bookingIdNs,
                  guest_id: guestIdNs,
                },
              );
            } catch (noShowCommsErr) {
              console.error('No-show guest notification failed:', noShowCommsErr);
            }
          });
        }
      } else {
        const statusPayload: Record<string, unknown> = {
          status: newStatus,
          updated_at: new Date().toISOString(),
        };
        // Table bookings: clear "arrived" when seated. Appointment (practitioner) bookings keep client_arrived_at
        // so staff can undo start and return to the held state with waiting state restored.
        if (newStatus === 'Seated' && !booking.practitioner_id && !booking.calendar_id) {
          statusPayload.client_arrived_at = null;
        }
        // Manual transition to `Confirmed` via the status dropdown is treated
        // as staff confirming attendance — record the timestamp so attendance
        // pills and `attendanceConfirmationSources` stay in sync.
        if (newStatus === 'Confirmed' && booking.status !== 'Confirmed') {
          statusPayload.staff_attendance_confirmed_at = new Date().toISOString();
        }
        // Reverting away from `Confirmed` clears the staff attendance timestamp
        // (mirror of the staff_attendance_confirmed=false path below).
        if (booking.status === 'Confirmed' && newStatus === 'Booked') {
          statusPayload.staff_attendance_confirmed_at = null;
        }
        if (newStatus === 'Completed') {
          const parsedDepartedTime =
            body.actual_departed_time !== undefined
              ? actualDepartedTimeSchema.safeParse(body.actual_departed_time)
              : null;
          if (body.actual_departed_time !== undefined && !parsedDepartedTime?.success) {
            return NextResponse.json({ error: 'Invalid actual departed time' }, { status: 400 });
          }
          statusPayload.actual_departed_time = parsedDepartedTime?.success
            ? parsedDepartedTime.data
            : new Date().toISOString();
        }
        if (booking.status === 'Completed' && newStatus === 'Seated') {
          statusPayload.actual_departed_time = null;
        }
        await staff.db.from('bookings').update(statusPayload).eq('id', id);

        // Booking confirmation comms: send when the slot first becomes "active",
        // i.e. Pending → Booked. (Was previously Pending → Confirmed under the
        // old overloaded enum.)
        if (booking.status === 'Pending' && newStatus === 'Booked') {
          const { sendBookingConfirmationNotifications } = await import('@/lib/communications/send-templated');
          const { data: guestRow } = await staff.db
          .from('guests')
          .select('first_name, last_name, email, phone')
          .eq('id', booking.guest_id)
          .single();
          const { data: venueRow } = await staff.db.from('venues').select('name, address').eq('id', staff.venue_id).single();
          if (guestRow?.email && venueRow?.name) {
            const bookingTime = typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
            const emailData = {
              id,
              guest_name: formatGuestDisplayName(guestRow.first_name, guestRow.last_name),
              guest_email: guestRow.email,
              guest_phone: guestRow.phone ?? null,
              booking_date: booking.booking_date,
              booking_time: bookingTime,
              party_size: booking.party_size,
            };
            const venueEmailData = { name: venueRow.name, address: venueRow.address ?? undefined };
            const vid = staff.venue_id;
            after(async () => {
              try {
                const enriched = await enrichBookingEmailForComms(getSupabaseAdminClient(), id, emailData);
                const { email, sms } = await sendBookingConfirmationNotifications(enriched, venueEmailData, vid);
                if (!email.sent) console.warn('[after] status-confirm email not sent:', email.reason);
                if (!sms.sent && sms.reason !== 'skipped' && sms.reason !== 'no_phone') {
                  console.warn('[after] status-confirm SMS not sent:', sms.reason);
                }
              } catch (err) {
                console.error('[after] status-confirm notifications failed:', err);
              }
            });
          }
        }

      }

      await applyBookingLifecycleStatusEffects(admin, {
        bookingId: id,
        guestId: booking.guest_id,
        previousStatus: booking.status as string,
        nextStatus: newStatus,
        actorId: staff.id,
      });

      if (newStatus === 'Seated' && Array.isArray(body.table_ids) && body.table_ids.length > 0) {
        const tableIds = body.table_ids as string[];
        const valid = await validateTablesBelongToVenue(admin, staff.venue_id, tableIds);
        if (valid) {
          await replaceBookingAssignments(admin, id, tableIds, staff.id);
          await syncTableStatusesForBooking(admin, id, tableIds, newStatus, staff.id);
        }
      }

      const updated = await staff.db.from('bookings').select('*').eq('id', id).single();
      return NextResponse.json(updated.data);
    }

    /** Appointment bookings: staff marks client as arrived / waiting (optional; cleared when status → Seated). */
    if (body.client_arrived !== undefined) {
      if (!booking.practitioner_id && !booking.calendar_id) {
        return NextResponse.json({ error: 'Arrived is only available for appointment bookings' }, { status: 400 });
      }
      const st = booking.status as string;
      if (!['Pending', 'Booked', 'Confirmed'].includes(st)) {
        return NextResponse.json(
          { error: 'Arrived can only be set when the booking is pending, booked, or confirmed' },
          { status: 400 },
        );
      }
      const arrived = Boolean(body.client_arrived);
      await staff.db
        .from('bookings')
        .update({
          client_arrived_at: arrived ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('venue_id', staff.venue_id);

      const updated = await staff.db.from('bookings').select('*').eq('id', id).single();
      return NextResponse.json(updated.data);
    }

    if (body.staff_attendance_confirmed !== undefined) {
      const on = Boolean(body.staff_attendance_confirmed);
      const currentStatus = booking.status as string;
      const updatePayload: Record<string, unknown> = {
        staff_attendance_confirmed_at: on ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      // Tie the timestamp to the lifecycle status:
      //   on=true,  status=Booked    → promote to Confirmed
      //   on=false, status=Confirmed → revert to Booked (only if the guest
      //                               hasn't independently confirmed)
      // Other statuses (Seated, Completed, Cancelled, No-Show) keep the
      // attendance timestamp as a passive audit field without altering status.
      if (on && currentStatus === 'Booked') {
        updatePayload.status = 'Confirmed';
      } else if (
        !on &&
        currentStatus === 'Confirmed' &&
        !booking.guest_attendance_confirmed_at
      ) {
        updatePayload.status = 'Booked';
      }

      await staff.db
        .from('bookings')
        .update(updatePayload)
        .eq('id', id)
        .eq('venue_id', staff.venue_id);

      // Run lifecycle hooks if status changed (mirrors the status-PATCH path).
      if (updatePayload.status && updatePayload.status !== currentStatus) {
        await applyBookingLifecycleStatusEffects(admin, {
          bookingId: id,
          guestId: booking.guest_id,
          previousStatus: currentStatus,
          nextStatus: updatePayload.status as BookingStatus,
          actorId: staff.id,
        });
      }

      const updated = await staff.db.from('bookings').select('*').eq('id', id).single();
      return NextResponse.json(updated.data);
    }

    if (
      body.special_requests !== undefined ||
      body.internal_notes !== undefined ||
      body.dietary_notes !== undefined ||
      body.occasion !== undefined ||
      body.guest_first_name !== undefined ||
      body.guest_last_name !== undefined ||
      body.guest_phone !== undefined ||
      body.guest_email !== undefined
    ) {
      const bookingUpdatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      let hasBookingUpdate = false;
      if (body.special_requests !== undefined) {
        bookingUpdatePayload.special_requests = typeof body.special_requests === 'string' ? body.special_requests : null;
        hasBookingUpdate = true;
      }
      if (body.internal_notes !== undefined) {
        bookingUpdatePayload.internal_notes = typeof body.internal_notes === 'string' ? body.internal_notes : null;
        hasBookingUpdate = true;
      }
      if (body.dietary_notes !== undefined) {
        bookingUpdatePayload.dietary_notes = typeof body.dietary_notes === 'string' ? body.dietary_notes : null;
        hasBookingUpdate = true;
      }
      if (body.occasion !== undefined) {
        bookingUpdatePayload.occasion = typeof body.occasion === 'string' ? body.occasion : null;
        hasBookingUpdate = true;
      }
      if (hasBookingUpdate) {
        await staff.db
          .from('bookings')
          .update(bookingUpdatePayload)
          .eq('id', id)
          .eq('venue_id', staff.venue_id);
      }

      if (
        body.guest_first_name !== undefined ||
        body.guest_last_name !== undefined ||
        body.guest_phone !== undefined ||
        body.guest_email !== undefined
      ) {
        const guestUpdatePayload: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (body.guest_first_name !== undefined) {
          guestUpdatePayload.first_name =
            typeof body.guest_first_name === 'string' ? normaliseGuestNamePart(body.guest_first_name) : null;
        }
        if (body.guest_last_name !== undefined) {
          guestUpdatePayload.last_name =
            typeof body.guest_last_name === 'string' ? normaliseGuestNamePart(body.guest_last_name) : null;
        }
        if (body.guest_phone !== undefined) {
          const raw = typeof body.guest_phone === 'string' ? body.guest_phone.trim() : '';
          if (!raw) {
            guestUpdatePayload.phone = null;
          } else {
            const e164 = normalizeToE164(raw, 'GB');
            if (!e164) {
              return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
            }
            guestUpdatePayload.phone = e164;
          }
        }
        if (body.guest_email !== undefined) {
          guestUpdatePayload.email = typeof body.guest_email === 'string' && body.guest_email.trim() ? body.guest_email.trim() : null;
        }
        await staff.db.from('guests').update(guestUpdatePayload).eq('id', booking.guest_id);

        if (body.guest_first_name !== undefined || body.guest_last_name !== undefined) {
          const bookingSnap: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          };
          if (body.guest_first_name !== undefined) {
            bookingSnap.guest_first_name =
              typeof body.guest_first_name === 'string' ? normaliseGuestNamePart(body.guest_first_name) : null;
          }
          if (body.guest_last_name !== undefined) {
            bookingSnap.guest_last_name =
              typeof body.guest_last_name === 'string' ? normaliseGuestNamePart(body.guest_last_name) : null;
          }
          await staff.db.from('bookings').update(bookingSnap).eq('id', id).eq('venue_id', staff.venue_id);
        }
      }

      const updated = await staff.db.from('bookings').select('*').eq('id', id).single();
      return NextResponse.json(updated.data);
    }

    if (
      body.booking_date !== undefined ||
      body.booking_time !== undefined ||
      body.party_size !== undefined ||
      body.booking_end_time !== undefined ||
      body.appointment_service_id !== undefined ||
      body.service_item_id !== undefined ||
      body.duration_minutes !== undefined ||
      body.processing_time_blocks !== undefined
    ) {
      const inferredForModify = inferBookingRowModel({
        booking_model: (booking as { booking_model?: string | null }).booking_model,
        experience_event_id: booking.experience_event_id as string | null | undefined,
        class_instance_id: booking.class_instance_id as string | null | undefined,
        resource_id: booking.resource_id as string | null | undefined,
        event_session_id: booking.event_session_id as string | null | undefined,
        calendar_id: booking.calendar_id as string | null | undefined,
        service_item_id: booking.service_item_id as string | null | undefined,
        practitioner_id: booking.practitioner_id as string | null | undefined,
        appointment_service_id: booking.appointment_service_id as string | null | undefined,
      });
      if (
        inferredForModify === 'event_ticket' ||
        inferredForModify === 'class_session' ||
        inferredForModify === 'resource_booking'
      ) {
        return NextResponse.json(
          {
            error:
              'Date, time, or party size cannot be changed here for this booking type. Cancel the booking if policy allows and create a new booking.',
          },
          { status: 400 },
        );
      }

      const deferModificationGuestNotification =
        (body as Record<string, unknown>).defer_modification_guest_notification === true ||
        /** @deprecated camelCase alias */
        (body as Record<string, unknown>).defer_modification_notification === true;
      const skipModificationGuestNotification =
        (body as Record<string, unknown>).skip_booking_modification_guest_notification === true;

      const newDate = (body.booking_date as string) ?? booking.booking_date;
      const newTimeRaw = (body.booking_time as string) ?? (typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '12:00');
      const newTime = newTimeRaw.length === 5 ? newTimeRaw + ':00' : newTimeRaw;
      const newPartySize = body.party_size !== undefined ? Number(body.party_size) : booking.party_size;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || newPartySize < 1 || newPartySize > 50) {
        return NextResponse.json({ error: 'Invalid date or party size' }, { status: 400 });
      }

      const timeStr = newTime.slice(0, 5);
      const isAppointment = Boolean(booking.practitioner_id || booking.calendar_id);
      if (isAppointment && body.duration_minutes !== undefined) {
        return NextResponse.json(
          { error: 'Cover time cannot be changed here for appointment bookings' },
          { status: 400 },
        );
      }
      const allowManualCalendarOverlap =
        isAppointment &&
        (body.allow_manual_overlap === true || body.allow_booking_overlap === true) &&
        (
          body.booking_date !== undefined ||
          body.booking_time !== undefined ||
          body.booking_end_time !== undefined ||
          body.practitioner_id !== undefined ||
          body.appointment_service_id !== undefined ||
          body.service_item_id !== undefined
        );
      const idLc = id.toLowerCase();
      const beforeEndHm =
        typeof (booking as { booking_end_time?: string | null }).booking_end_time === 'string'
          ? String((booking as { booking_end_time?: string | null }).booking_end_time).slice(0, 5)
          : null;

      /** Default catalogue duration; used for appointment interval validation and end-time projection. */
      let appointmentSvcDurationMinutes = 30;

      let tableRescheduleServiceId: string | null = null;
      let tableRescheduleAreaId: string | null = null;
      let tableAreaChanged = false;
      let tableModifyEngineInput: EngineInput | null = null;
      let tableSittingMinutesForAssignment: number | null = null;
      let tableBufferMinutesForAssignment: number | null = null;

      // --- Validate slot availability ---
      if (isAppointment) {
        const practId =
          (body.practitioner_id as string | undefined) ??
          (booking.practitioner_id as string | null) ??
          (booking.calendar_id as string | null);
        const svcId =
          (body.appointment_service_id as string | undefined) ??
          (body.service_item_id as string | undefined) ??
          (booking.appointment_service_id as string | null) ??
          (booking.service_item_id as string | null);
        if (!practId || !svcId) {
          return NextResponse.json(
            { error: 'Cannot validate appointment: missing practitioner or service on booking' },
            { status: 400 },
          );
        }

        const appointmentSvcIdForDuration =
          (body.appointment_service_id as string | undefined) ??
          (booking.appointment_service_id as string | null | undefined);
        const serviceItemIdForDuration =
          (body.service_item_id as string | undefined) ??
          (booking.service_item_id as string | null | undefined);
        if (appointmentSvcIdForDuration) {
          const { data: svcRow } = await admin
            .from('appointment_services')
            .select('duration_minutes')
            .eq('id', appointmentSvcIdForDuration)
            .single();
          appointmentSvcDurationMinutes = svcRow?.duration_minutes ?? 30;
        } else if (serviceItemIdForDuration) {
          const { data: siRow } = await admin
            .from('service_items')
            .select('duration_minutes')
            .eq('id', serviceItemIdForDuration)
            .single();
          appointmentSvcDurationMinutes = (siRow as { duration_minutes?: number } | null)?.duration_minutes ?? 30;
        }

        const apptInput = await fetchAppointmentInput({
          supabase: admin,
          venueId: staff.venue_id,
          date: newDate,
          practitionerId: practId,
          serviceId: svcId,
        });
        apptInput.existingBookings = apptInput.existingBookings.filter((b) => b.id.toLowerCase() !== idLc);
        apptInput.skipPastSlotFilter = true;
        const { data: venueClock } = await admin
          .from('venues')
          .select('timezone, booking_rules, opening_hours, venue_opening_exceptions')
          .eq('id', staff.venue_id)
          .single();
        attachVenueClockToAppointmentInput(apptInput, venueClock ?? {});

        const startMin = timeToMinutes(timeStr);
        let endCoreHHmm: string;
        if (typeof body.booking_end_time === 'string' && body.booking_end_time.trim() !== '') {
          const raw = body.booking_end_time.trim();
          endCoreHHmm = raw.length >= 5 ? raw.slice(0, 5) : minutesToTime(startMin + appointmentSvcDurationMinutes);
        } else {
          endCoreHHmm = minutesToTime(startMin + appointmentSvcDurationMinutes);
        }

        const intervalCheck = validateAppointmentCustomInterval(
          apptInput,
          practId,
          svcId,
          timeStr,
          endCoreHHmm,
          id,
          {
            allowBookingOverlap: allowManualCalendarOverlap,
            processingTimeBlocks:
              body.processing_time_blocks !== undefined
                ? parseProcessingTimeBlocksFromDb(body.processing_time_blocks)
                : booking.processing_time_blocks != null
                  ? parseProcessingTimeBlocksFromDb(
                      (booking as { processing_time_blocks?: unknown }).processing_time_blocks,
                    )
                  : undefined,
          },
        );
        if (!intervalCheck.ok) {
          return NextResponse.json(
            { error: intervalCheck.reason ?? 'Selected time is not available for this practitioner' },
            { status: 409 },
          );
        }
      } else {
        const venueMode = await resolveVenueMode(admin, staff.venue_id);
        if (venueMode.availabilityEngine !== 'service') {
          return NextResponse.json({ error: AVAILABILITY_SETUP_REQUIRED_MESSAGE }, { status: 503 });
        }

        const bookingAreaId = (booking as { area_id?: string | null }).area_id ?? null;
        let targetAreaId = bookingAreaId;
        if (typeof body.area_id === 'string' && body.area_id.trim() !== '') {
          const areas = await listActiveAreasForVenue(admin, staff.venue_id);
          if (!areas.some((a) => a.id === body.area_id)) {
            return NextResponse.json({ error: 'Invalid area_id' }, { status: 400 });
          }
          targetAreaId = body.area_id;
        }
        if (!targetAreaId) {
          return NextResponse.json(
            { error: 'Booking has no dining area; set area_id to reschedule.' },
            { status: 400 },
          );
        }

        const areaChanged =
          typeof body.area_id === 'string' &&
          body.area_id.trim() !== '' &&
          body.area_id !== bookingAreaId;

        const engineInput = await fetchEngineInput({
          supabase: admin,
          venueId: staff.venue_id,
          date: newDate,
          partySize: newPartySize,
          areaId: targetAreaId,
        });
        engineInput.bookings = engineInput.bookings.filter((b) => b.id.toLowerCase() !== idLc);
        const slots = computeAvailability(engineInput).flatMap((result) => result.slots);
        const slot = areaChanged
          ? slots.find((s) => s.start_time === timeStr)
          : slots.find(
              (s) =>
                s.start_time === timeStr &&
                (!(booking as { service_id?: string | null }).service_id ||
                  s.service_id === (booking as { service_id?: string | null }).service_id),
            );
        if (!slot || slot.available_covers < newPartySize) {
          return NextResponse.json(
            { error: 'Selected date/time is not available or has insufficient capacity' },
            { status: 409 },
          );
        }

        tableRescheduleServiceId = slot.service_id;
        tableRescheduleAreaId = targetAreaId;
        tableAreaChanged = areaChanged;
        tableModifyEngineInput = engineInput;
      }

      const before = {
        booking_date: booking.booking_date,
        booking_time: typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '',
        party_size: booking.party_size,
      };
      /** Guest-facing “slot” shifted (date or start clock). Duration / end-only edits must not notify. */
      const bookingStartChanged =
        newDate !== before.booking_date || timeStr !== before.booking_time;

      const bookingUpdate: Record<string, unknown> = {
        booking_date: newDate,
        booking_time: newTime,
        party_size: newPartySize,
        updated_at: new Date().toISOString(),
        cancellation_deadline: cancellationDeadline(newDate, timeStr),
      };

      if (!isAppointment && tableRescheduleServiceId) {
        bookingUpdate.service_id = tableRescheduleServiceId;
      }
      if (!isAppointment && tableAreaChanged && tableRescheduleAreaId) {
        bookingUpdate.area_id = tableRescheduleAreaId;
      }

      if (body.practitioner_id && isAppointment) {
        if (booking.calendar_id) {
          bookingUpdate.calendar_id = body.practitioner_id;
        } else {
          bookingUpdate.practitioner_id = body.practitioner_id;
        }
      }
      if (isAppointment && (body.appointment_service_id || body.service_item_id)) {
        const nextServiceId = (body.appointment_service_id as string | undefined) ?? (body.service_item_id as string | undefined);
        if (booking.service_item_id) {
          bookingUpdate.service_item_id = nextServiceId;
        } else {
          bookingUpdate.appointment_service_id = nextServiceId;
        }
      }

      const appointmentSvcId = booking.appointment_service_id as string | null | undefined;
      const serviceItemId = booking.service_item_id as string | null | undefined;
      if (isAppointment && (appointmentSvcId || serviceItemId)) {
        const [ry, rmo, rd] = newDate.split('-').map(Number);
        const [rhh, rmm] = timeStr.split(':').map(Number);
        const rEnd = new Date(Date.UTC(ry!, rmo! - 1, rd!, rhh!, rmm!, 0));
        let durationMinutes = appointmentSvcDurationMinutes;
        if (typeof body.booking_end_time === 'string' && body.booking_end_time.trim() !== '') {
          const endHm = body.booking_end_time.trim().slice(0, 5);
          durationMinutes = Math.max(15, minutesBetweenStartAndEnd(timeStr, endHm));
        }
        rEnd.setMinutes(rEnd.getMinutes() + durationMinutes);
        bookingUpdate.estimated_end_time = rEnd.toISOString();
        bookingUpdate.booking_end_time = `${String(rEnd.getUTCHours()).padStart(2, '0')}:${String(rEnd.getUTCMinutes()).padStart(2, '0')}:00`;

        if (body.processing_time_blocks !== undefined) {
          const procChk = validateProcessingTimeBlocks(
            parseProcessingTimeBlocksFromDb(body.processing_time_blocks),
            durationMinutes,
          );
          if (!procChk.ok) {
            return NextResponse.json({ error: procChk.error }, { status: 400 });
          }
          bookingUpdate.processing_time_blocks = procChk.normalized ?? [];
        }
      }

      if (!isAppointment && tableRescheduleServiceId && tableModifyEngineInput) {
        const { durationMinutes: engineDurationMinutes, bufferMinutes } =
          await resolveDurationAndBufferForTableAssignment(
            admin,
            tableModifyEngineInput,
            newDate,
            newPartySize,
            tableRescheduleServiceId,
          );
        let sittingMinutes = engineDurationMinutes;
        if (body.duration_minutes !== undefined && body.duration_minutes !== null) {
          const raw = Number(body.duration_minutes);
          if (!Number.isInteger(raw) || raw < 15 || raw > 300) {
            return NextResponse.json(
              { error: 'duration_minutes must be an integer between 15 and 300' },
              { status: 400 },
            );
          }
          sittingMinutes = raw;
        }
        tableSittingMinutesForAssignment = sittingMinutes;
        tableBufferMinutesForAssignment = bufferMinutes;
        const [ey, emo, ed] = newDate.split('-').map(Number);
        const [ehh, emm] = timeStr.split(':').map(Number);
        const tableEnd = new Date(Date.UTC(ey!, emo! - 1, ed!, ehh!, emm!, 0));
        tableEnd.setMinutes(tableEnd.getMinutes() + sittingMinutes);
        bookingUpdate.estimated_end_time = tableEnd.toISOString();
      }

      if (newPartySize > booking.party_size && booking.deposit_status === 'Paid' && booking.deposit_amount_pence) {
        const tableServiceId = booking.service_id as string | null | undefined;
        const { data: venueForDeposit } = await admin
          .from('venues')
          .select('deposit_config, stripe_connected_account_id')
          .eq('id', staff.venue_id)
          .single();

        const { data: brRow } = tableServiceId
          ? await admin
              .from('booking_restrictions')
              .select('deposit_amount_per_person_gbp')
              .eq('service_id', tableServiceId)
              .maybeSingle()
          : { data: null };

        const legacyGbp = (venueForDeposit?.deposit_config as { amount_per_person_gbp?: number })?.amount_per_person_gbp;
        const perPersonGbp =
          typeof brRow?.deposit_amount_per_person_gbp === 'number'
            ? brRow.deposit_amount_per_person_gbp
            : typeof legacyGbp === 'number'
              ? legacyGbp
              : null;

        const additionalCovers = newPartySize - booking.party_size;
        const additionalPence =
          perPersonGbp != null && perPersonGbp > 0 ? Math.round(perPersonGbp * additionalCovers * 100) : 0;

        if (additionalPence > 0 && venueForDeposit?.stripe_connected_account_id) {
          try {
            await stripe.paymentIntents.create(
              {
                amount: additionalPence,
                currency: 'gbp',
                metadata: { booking_id: id, venue_id: staff.venue_id, type: 'additional_deposit' },
                automatic_payment_methods: { enabled: true },
              },
              { stripeAccount: venueForDeposit.stripe_connected_account_id }
            );
            bookingUpdate.deposit_amount_pence = booking.deposit_amount_pence + additionalPence;
            bookingUpdate.deposit_status = 'Pending';
          } catch (stripeErr) {
            console.error('Additional deposit PI failed:', stripeErr);
          }
        }
      }

      const prevUpdatedAt = booking.updated_at as string;
      const { data: updatedAfterModify, error: modifyUpdErr } = await staff.db
        .from('bookings')
        .update(bookingUpdate)
        .eq('id', id)
        .eq('updated_at', prevUpdatedAt)
        .select('*')
        .maybeSingle();

      if (modifyUpdErr) {
        console.error('Booking modify update failed:', modifyUpdErr);
        return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 });
      }
      if (!updatedAfterModify) {
        return NextResponse.json(
          { error: 'Booking was modified elsewhere. Refresh and try again.', code: 'stale_booking' },
          { status: 412 },
        );
      }

      const afterEndHm =
        typeof bookingUpdate.booking_end_time === 'string'
          ? String(bookingUpdate.booking_end_time).slice(0, 5)
          : beforeEndHm;

      await admin.from('events').insert({
        venue_id: staff.venue_id,
        booking_id: id,
        event_type: 'booking_modified',
        payload: {
          before,
          after: {
            booking_date: newDate,
            booking_time: timeStr,
            party_size: newPartySize,
            ...(afterEndHm ? { booking_end_time: afterEndHm } : {}),
          },
        },
      });

      const dateChanged = newDate !== booking.booking_date;
      const timeChanged = timeStr !== before.booking_time;
      const partySizeChanged = newPartySize !== booking.party_size;
      let tableAssignmentUnassigned = false;
      if (dateChanged || timeChanged || partySizeChanged) {
        const { data: venueForTables } = await admin
          .from('venues')
          .select('table_management_enabled')
          .eq('id', staff.venue_id)
          .single();

        if (venueForTables?.table_management_enabled) {
          await replaceBookingAssignments(admin, id, [], staff.id);
          await clearTableStatusesForBooking(admin, id, staff.id);

          const serviceIdForDuration = tableRescheduleServiceId ?? (booking.service_id as string | null);
          let durationMinutes: number;
          let bufferMinutes: number;
          if (tableSittingMinutesForAssignment != null && tableBufferMinutesForAssignment != null) {
            durationMinutes = tableSittingMinutesForAssignment;
            bufferMinutes = tableBufferMinutesForAssignment;
          } else {
            const resolved = await resolveTableAssignmentDurationBuffer(
              admin,
              staff.venue_id,
              newDate,
              newPartySize,
              serviceIdForDuration,
            );
            durationMinutes = resolved.durationMinutes;
            bufferMinutes = resolved.bufferMinutes;
          }
          const assigned = await autoAssignTable(
            admin,
            staff.venue_id,
            id,
            newDate,
            timeStr,
            durationMinutes,
            bufferMinutes,
            newPartySize,
          );
          if (!assigned) {
            tableAssignmentUnassigned = true;
          }
          const nextAssigned = await getAssignedTableIds(admin, id);
          await syncTableStatusesForBooking(admin, id, nextAssigned, updatedAfterModify.status as string, staff.id);
        }
      }

      if (
        bookingStartChanged &&
        !deferModificationGuestNotification &&
        !skipModificationGuestNotification
      ) {
        after(async () => {
          try {
            const { executeBookingModificationGuestNotification } = await import(
              '@/lib/booking/send-booking-modification-guest-notification'
            );
            await executeBookingModificationGuestNotification(admin, staff.venue_id, id);
          } catch (commsErr) {
            console.error('Booking modification notification failed:', commsErr);
          }
        });
      }
      // Reset scheduled communication logs when the booking start shifted so reminders re-trigger
      if (bookingStartChanged) {
        try {
          await admin
            .from('communication_logs')
            .delete()
            .eq('booking_id', id)
            .in('message_type', [
              'reminder_56h_email',
              'day_of_reminder_sms',
              'day_of_reminder_email',
              'post_visit_email',
              'reminder_1_email',
              'reminder_1_sms',
              'reminder_2_email',
              'reminder_2_sms',
              'unified_post_visit_email',
            ]);
        } catch (logResetErr) {
          console.error('Communication log reset failed after modification:', logResetErr);
        }
      }
      return NextResponse.json({
        ...updatedAfterModify,
        ...(tableAssignmentUnassigned ? { table_assignment_unassigned: true as const } : {}),
      });
    }

    return NextResponse.json(
      { error: 'Provide status or booking_date/booking_time/party_size/booking_end_time' },
      { status: 400 },
    );
  } catch (err) {
    console.error('PATCH /api/venue/bookings/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/venue/bookings/[id] — permanently remove a cancelled booking (venue staff).
 * Clears related rows that would otherwise remain with null booking_id.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const { data: booking, error: fetchErr } = await staff.db
      .from('bookings')
      .select('id, venue_id, status')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .single();

    if (fetchErr || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    if (booking.status !== 'Cancelled') {
      return NextResponse.json(
        { error: 'Only cancelled bookings can be permanently deleted' },
        { status: 400 },
      );
    }

    await clearTableStatusesForBooking(admin, id, staff.id);

    const { error: commErr } = await admin.from('communications').delete().eq('booking_id', id);
    if (commErr) {
      console.error('DELETE booking: communications delete failed:', commErr);
      return NextResponse.json({ error: 'Could not delete booking' }, { status: 500 });
    }

    const { error: eventsErr } = await admin.from('events').delete().eq('booking_id', id);
    if (eventsErr) {
      console.error('DELETE booking: events delete failed:', eventsErr);
      return NextResponse.json({ error: 'Could not delete booking' }, { status: 500 });
    }

    const { error: smsErr } = await admin.from('sms_log').delete().eq('booking_id', id);
    if (smsErr) {
      console.error('DELETE booking: sms_log delete failed:', smsErr);
      return NextResponse.json({ error: 'Could not delete booking' }, { status: 500 });
    }

    const { error: recErr } = await admin.from('reconciliation_alerts').delete().eq('booking_id', id);
    if (recErr) {
      console.error('DELETE booking: reconciliation_alerts delete failed:', recErr);
      return NextResponse.json({ error: 'Could not delete booking' }, { status: 500 });
    }

    const { error: delErr } = await admin.from('bookings').delete().eq('id', id).eq('venue_id', staff.venue_id);
    if (delErr) {
      console.error('DELETE booking: bookings delete failed:', delErr);
      return NextResponse.json({ error: 'Could not delete booking' }, { status: 500 });
    }

    logBookingOp({ operation: 'delete', venue_id: staff.venue_id, booking_id: id });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/bookings/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
