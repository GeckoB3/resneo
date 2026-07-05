import { NextRequest, NextResponse, after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireManagedCalendarAccess } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { recordBookingWriteAudit } from '@/lib/linked-accounts/audit';
import { notifyCrossVenueBookingWrite } from '@/lib/linked-accounts/notifications';
import { checkBookingCompliance, complianceUnmetMessage, COMPLIANCE_REQUIREMENT_UNMET } from '@/lib/compliance/enforce-booking';
import { stripe } from '@/lib/stripe';
import type { EngineInput } from '@/types/availability';
import { computeAvailability, fetchEngineInput } from '@/lib/availability';
import { AVAILABILITY_SETUP_REQUIRED_MESSAGE } from '@/lib/availability/availability-errors';
import {
  attachVenueClockToAppointmentInput,
  fetchAppointmentInput,
  validateAppointmentCustomInterval,
} from '@/lib/availability/appointment-engine';
import {
  minutesBetweenStartAndEndHM,
  resolveAppointmentModifyEndCoreHHmm,
  validateAppointmentModificationInterval,
} from '@/lib/booking/validate-appointment-modification';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import { parseProcessingTimeBlocksFromDb, validateProcessingTimeBlocks } from '@/lib/appointments/processing-time';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { autoAssignTable } from '@/lib/table-availability';
import { BOOKING_MUTABLE_STATUSES } from '@/lib/table-management/constants';
import {
  canTransitionBookingStatus,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
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
import { COMMUNICATION_LOG_TYPES_RESET_ON_BOOKING_START_CHANGE } from '@/lib/communications/scheduled-log-reset';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { offerAppointmentWaitlistOnCancel } from '@/lib/booking/offer-appointment-waitlist-on-cancel';
import { logBookingOp } from '@/lib/observability/booking-ops-log';
import { resolveCdeBookingContext } from '@/lib/booking/cde-booking-context';
import { loadStaffBookingDetailBundle } from '@/lib/booking/load-booking-detail-bundle';
import { loadAddonsForBooking } from '@/lib/addons/addon-resolution';
import { validateAddonSelections } from '@/lib/addons/addon-selection-validation';
import { buildAddonSnapshots, totalsFromSnapshots } from '@/lib/addons/snapshot-addons';
import {
  applyGroupBookingStatusChange,
  applyGroupClientArrivedChange,
  applyGroupStaffAttendanceChange,
  loadGroupBookingSiblings,
} from '@/lib/booking/group-booking-status-sync';
import { resolveBookingScopedCalendarId } from '@/lib/booking/staff-booking-calendar-scope';
import { tableGroupKeyFromIds } from '@/lib/table-management/combination-rules';
import type { BookingModel } from '@/types/booking-models';
import { listActiveAreasForVenue } from '@/lib/areas/resolve-default-area';
import { formatGuestDisplayName, normaliseGuestNamePart } from '@/lib/guests/name';
import {
  linkedGrantAllowsCalendar,
  linkedGrantAllowsCancel,
  linkedGrantAllowsMutation,
  loadStaffAccessibleBooking,
} from '@/lib/booking/staff-booking-access';
import { validateResourceBookingModification } from '@/lib/booking/validate-resource-booking-modification';
import { validateClassModification } from '@/lib/booking/validate-class-modification';
import { resolveCancellationNoticeHoursForCreate } from '@/lib/booking/resolve-cancellation-notice-hours';
import {
  deleteCardHoldCustomersForBookings,
  releaseCardHoldsForBookings,
} from '@/lib/booking/card-hold-release';
import { cardHoldChargeWindowEndsAtForBooking } from '@/lib/booking/card-hold-window';
import { cancellationDeadlineHoursBefore } from '@/lib/booking/cancellation-deadline';
import { venueLocalDateTimeToUtcMs } from '@/lib/venue/venue-local-clock';

const statusSchema = z.enum(BOOKING_MUTABLE_STATUSES);
const actualDepartedTimeSchema = z.string().datetime();

function cancellationDeadline(bookingDate: string, bookingTime: string): string {
  const [y, m, d] = bookingDate.split('-').map(Number);
  const [hh, mm] = bookingTime.slice(0, 5).split(':').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, hh, mm, 0));
  dt.setHours(dt.getHours() - 48);
  return dt.toISOString();
}

/**
 * Resolve the staff/calendar display name for a booking. The bookings row carries
 * only `calendar_id` / `practitioner_id`, and neither it nor the detail RPC
 * includes a name — so the detail panel's "with {staff}" line was always blank.
 * Mirrors the list route's `calendar_name` (from `unified_calendars`), falling
 * back to the legacy `practitioners` table. Returns null when neither resolves.
 */
async function resolveBookingStaffName(
  db: SupabaseClient,
  booking: { calendar_id?: string | null; practitioner_id?: string | null },
  venueId: string,
): Promise<string | null> {
  const calId = typeof booking.calendar_id === 'string' ? booking.calendar_id.trim() : '';
  if (calId) {
    const { data } = await db
      .from('unified_calendars')
      .select('name')
      .eq('id', calId)
      .eq('venue_id', venueId)
      .maybeSingle();
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    if (name) return name;
  }
  const pracId = typeof booking.practitioner_id === 'string' ? booking.practitioner_id.trim() : '';
  if (pracId) {
    const { data } = await db
      .from('practitioners')
      .select('name')
      .eq('id', pracId)
      .eq('venue_id', venueId)
      .maybeSingle();
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    if (name) return name;
  }
  return null;
}

/** GET /api/venue/bookings/[id] - full booking detail with guest and events timeline. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { id } = await params;

    const loaded = await loadStaffAccessibleBooking(staff, id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const { booking, ownerVenueId: scopeVenueId, isOwnVenue, linkedGrant } = loaded.ctx;
    const scopeDb = isOwnVenue ? staff.db : getSupabaseAdminClient();

    const bookingTimeStr = typeof booking.booking_time === 'string'
      ? booking.booking_time.slice(0, 5)
      : '';

    const inferredForRefund = inferBookingRowModel(
      booking as Parameters<typeof inferBookingRowModel>[0],
    );
    const [detailBundle, cde_context, practitioner_name, refund_notice_hours, holdRes] = await Promise.all([
      loadStaffBookingDetailBundle(scopeDb, id, scopeVenueId, { includeTimeline: true }),
      resolveCdeBookingContext(scopeDb, booking as Parameters<typeof resolveCdeBookingContext>[1]),
      resolveBookingStaffName(
        scopeDb,
        booking as { calendar_id?: string | null; practitioner_id?: string | null },
        scopeVenueId,
      ),
      // §5.6 #5 — the staff drawer's refund banner needs the booking's deposit
      // cancellation-notice window. Resolve it from the same per-entity source
      // the create/confirm-modify paths use (so it matches the stored
      // cancellation_deadline) rather than the venue-wide rule.
      resolveCancellationNoticeHoursForCreate({
        supabase: scopeDb,
        venueId: scopeVenueId,
        effectiveModel: inferredForRefund,
        tableServiceId: (booking as { service_id?: string | null }).service_id ?? null,
        appointmentServiceId: (booking as { appointment_service_id?: string | null }).appointment_service_id ?? null,
        serviceItemId: (booking as { service_item_id?: string | null }).service_item_id ?? null,
        experienceEventId: (booking as { experience_event_id?: string | null }).experience_event_id ?? null,
        classInstanceId: (booking as { class_instance_id?: string | null }).class_instance_id ?? null,
        resourceCalendarId: (booking as { resource_id?: string | null }).resource_id ?? null,
      }).catch((e) => {
        console.error('GET /api/venue/bookings/[id] refund notice resolve failed:', e);
        return 48;
      }),
      // §9.1 — staff-facing card-hold summary. Hold rows are service-role only
      // (RLS enabled, no policies), so always read via the admin client.
      getSupabaseAdminClient()
        .from('booking_card_holds')
        .select('fee_pence, stripe_payment_method_id, charged_pence, charged_at, released_at, charge_failure_code')
        .eq('booking_id', id)
        .maybeSingle(),
    ]);

    if (!detailBundle) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const area_name = detailBundle.area_name;
    const service_variant_name = detailBundle.service_variant_name;
    const service_variant_price_pence = detailBundle.service_variant_price_pence;

    let guest = detailBundle.guest as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      visit_count?: number | null;
      last_visit_date?: string | null;
      tags?: string[] | null;
      customer_profile_notes?: string | null;
    } | null;
    if (!isOwnVenue && linkedGrant && !linkedGrant.pii) {
      if (guest) {
        guest = {
          ...guest,
          email: null,
          phone: null,
          customer_profile_notes: null,
          tags: [],
        };
      } else {
        const snapFirst = normaliseGuestNamePart(
          (booking as { guest_first_name?: string | null }).guest_first_name,
        );
        const snapLast = normaliseGuestNamePart(
          (booking as { guest_last_name?: string | null }).guest_last_name,
        );
        if (snapFirst || snapLast) {
          guest = {
            id: booking.guest_id,
            first_name: snapFirst,
            last_name: snapLast,
            email: null,
            phone: null,
            visit_count: null,
            last_visit_date: null,
            tags: [],
            customer_profile_notes: null,
          };
        }
      }
    }
    const events = detailBundle.events;
    const communications = detailBundle.communications;
    const assignedTables = detailBundle.table_assignments;
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
      const { data: customCombo } = await scopeDb
        .from('table_combinations')
        .select('internal_notes')
        .eq('venue_id', scopeVenueId)
        .eq('table_group_key', key)
        .maybeSingle();
      if (customCombo?.internal_notes) {
        combination_staff_notes = customCombo.internal_notes as string;
      } else {
        const { data: autoOv } = await scopeDb
          .from('combination_auto_overrides')
          .select('internal_notes')
          .eq('venue_id', scopeVenueId)
          .eq('table_group_key', key)
          .maybeSingle();
        if (autoOv?.internal_notes) {
          combination_staff_notes = autoOv.internal_notes as string;
        }
      }
    }

    const addons = detailBundle.addons;

    // §9.1 — `card_hold` payload for the staff detail surfaces; null when the
    // booking has no hold row. `charge_window_ends_at` is derived, never stored.
    if (holdRes.error) {
      console.error('GET /api/venue/bookings/[id] card-hold load failed:', holdRes.error);
    }
    const holdRow = (holdRes.data ?? null) as {
      fee_pence: number;
      stripe_payment_method_id: string | null;
      charged_pence: number | null;
      charged_at: string | null;
      released_at: string | null;
      charge_failure_code: string | null;
    } | null;
    const card_hold = holdRow
      ? {
          fee_pence: holdRow.fee_pence,
          saved: holdRow.stripe_payment_method_id != null,
          charged_pence: holdRow.charged_pence ?? null,
          charged_at: holdRow.charged_at ?? null,
          released_at: holdRow.released_at ?? null,
          charge_failure_code: holdRow.charge_failure_code ?? null,
          charge_window_ends_at: cardHoldChargeWindowEndsAtForBooking({
            booking_date: String(booking.booking_date),
            booking_time: String(booking.booking_time),
            booking_end_time: booking.booking_end_time ?? null,
            estimated_end_time: booking.estimated_end_time ?? null,
          }),
        }
      : null;

    return NextResponse.json({
      ...booking,
      area_name,
      booking_time: bookingTimeStr,
      practitioner_name,
      guest: guest ?? null,
      events: events ?? [],
      communications: communications ?? [],
      table_assignments: assignedTables,
      combination_staff_notes,
      cde_context,
      inferred_booking_model: inferred_booking_model as BookingModel,
      service_variant_name,
      service_variant_price_pence,
      addons,
      refund_notice_hours,
      card_hold,
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
    const supabase = await createVenueRouteClient(request);
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

    const loaded = await loadStaffAccessibleBooking(staff, id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const {
      booking,
      ownerVenueId: scopeVenueId,
      isOwnVenue,
      linkedGrant,
      linkId: linkedAccountLinkId,
    } = loaded.ctx;

    // P0 fix (spec §16.1 #1): cross-venue booking writes through this route use
    // the service-role admin client, so the DB audit trigger cannot see the
    // acting venue and writes no audit row. Record the cross-venue audit row
    // explicitly (best-effort) so the owning venue's audit log — and the §17
    // notification trigger that fires off it — capture every linked-venue
    // edit/cancel. No-op for own-venue writes.
    let auditActorUserId: string | null = null;
    if (!isOwnVenue) {
      try {
        const { data: authData } = await supabase.auth.getUser();
        auditActorUserId = authData.user?.id ?? null;
      } catch {
        auditActorUserId = null;
      }
    }
    const auditLinkedBookingChange = async (
      afterState: Record<string, unknown> | null,
      actionType: 'edited_booking' | 'cancelled_booking',
    ): Promise<void> => {
      if (isOwnVenue || !linkedAccountLinkId) return;
      await recordBookingWriteAudit({
        admin: getSupabaseAdminClient(),
        linkId: linkedAccountLinkId,
        actingVenueId: staff.venue_id,
        actingUserId: auditActorUserId,
        owningVenueId: scopeVenueId,
        actionType,
        bookingId: id,
        beforeState: booking as Record<string, unknown>,
        afterState,
      });
      // §17.3 — email the owning venue per its preferences, after the response.
      after(() =>
        notifyCrossVenueBookingWrite({
          admin: getSupabaseAdminClient(),
          owningVenueId: scopeVenueId,
          actingVenueId: staff.venue_id,
          actionType,
          before: booking as Record<string, unknown>,
          after: afterState,
        }),
      );
    };

    /** Staff attendance toggle only — any venue staff may update (table, event, class, resource, etc.). */
    const bodyKeys = Object.keys(body as Record<string, unknown>).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    const isStaffAttendanceOnlyPatch =
      bodyKeys.length === 1 && bodyKeys[0] === 'staff_attendance_confirmed';
    if (isStaffAttendanceOnlyPatch) {
      if (!isOwnVenue && !linkedGrantAllowsMutation(linkedGrant, false)) {
        return NextResponse.json(
          { error: 'This link does not allow editing the other venue’s bookings.' },
          { status: 403 },
        );
      }
      const on = Boolean(body.staff_attendance_confirmed);
      const currentStatus = booking.status as string;
      const groupBookingId = booking.group_booking_id as string | null | undefined;
      const adminForHooks = getSupabaseAdminClient();

      if (groupBookingId) {
        const updatedIds = await applyGroupStaffAttendanceChange({
          db: staff.db,
          admin: adminForHooks,
          venueId: scopeVenueId,
          groupBookingId,
          confirmed: on,
          actorId: staff.id,
        });
        if (updatedIds.length === 0) {
          return NextResponse.json({ error: 'Could not update attendance' }, { status: 500 });
        }
      } else {
        const attPayload: Record<string, unknown> = {
          staff_attendance_confirmed_at: on ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        };
        if (
          on &&
          (currentStatus === 'Booked' ||
            currentStatus === 'Pending' ||
            currentStatus === 'Deposit Pending')
        ) {
          attPayload.status = 'Confirmed';
        } else if (
          !on &&
          (currentStatus === 'Pending' || currentStatus === 'Booked' || currentStatus === 'Confirmed')
        ) {
          attPayload.guest_attendance_confirmed_at = null;
          if (currentStatus === 'Confirmed') {
            attPayload.status = 'Booked';
          }
        }
        const { error: attErr } = await staff.db
          .from('bookings')
          .update(attPayload)
          .eq('id', id)
          .eq('venue_id', scopeVenueId);
        if (attErr) {
          console.error('PATCH staff_attendance_confirmed failed:', attErr);
          return NextResponse.json({ error: 'Could not update attendance' }, { status: 500 });
        }
        if (attPayload.status && attPayload.status !== currentStatus) {
          await applyBookingLifecycleStatusEffects(adminForHooks, {
            bookingId: id,
            guestId: booking.guest_id,
            previousStatus: currentStatus,
            nextStatus: attPayload.status as BookingStatus,
            actorId: staff.id,
          });
        }
      }

      const { data: updatedAttendance, error: selErr } = await staff.db
        .from('bookings')
        .select('*')
        .eq('id', id)
        .single();
      if (selErr || !updatedAttendance) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }
      await auditLinkedBookingChange(
        (updatedAttendance as Record<string, unknown> | null) ?? null,
        'edited_booking',
      );
      return NextResponse.json(updatedAttendance);
    }

    const admin = getSupabaseAdminClient();

    if (!isOwnVenue) {
      if (!linkedGrantAllowsMutation(linkedGrant, false)) {
        return NextResponse.json(
          { error: 'This link does not allow editing the other venue’s bookings.' },
          { status: 403 },
        );
      }
    } else if (staff.role !== 'admin') {
        const scopedCalendarId = await resolveBookingScopedCalendarId(
          admin,
          scopeVenueId,
          booking as Parameters<typeof resolveBookingScopedCalendarId>[2],
        );
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
          scopeVenueId,
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
        venueId: scopeVenueId,
        date: booking.booking_date as string,
        practitionerId: practId,
        serviceId: svcId,
      });
      apptInput.existingBookings = apptInput.existingBookings.filter((b) => b.id.toLowerCase() !== id.toLowerCase());
      apptInput.skipPastSlotFilter = true;
      const { data: venueClock } = await admin
        .from('venues')
        .select('timezone, booking_rules, opening_hours, venue_opening_exceptions')
        .eq('id', scopeVenueId)
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
        .eq('venue_id', scopeVenueId);
      if (procUpdErr) {
        console.error('PATCH processing_time_blocks only failed:', procUpdErr);
        return NextResponse.json({ error: 'Could not save processing time' }, { status: 500 });
      }

      const { data: updatedProc, error: procSelErr } = await staff.db.from('bookings').select('*').eq('id', id).single();
      if (procSelErr || !updatedProc) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }
      await auditLinkedBookingChange(
        (updatedProc as Record<string, unknown> | null) ?? null,
        'edited_booking',
      );
      return NextResponse.json(updatedProc);
    }

    if (body.status !== undefined) {
      const parsed = statusSchema.safeParse(body.status);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      const newStatus = parsed.data;

      if (newStatus === 'Cancelled' && !linkedGrantAllowsCancel(linkedGrant, isOwnVenue)) {
        return NextResponse.json(
          { error: 'This link does not allow cancelling the other venue’s bookings.' },
          { status: 403 },
        );
      }

      const transitionCheck = validateBookingStatusTransition(booking.status as string, newStatus);
      if (!transitionCheck.ok) {
        return NextResponse.json({ error: transitionCheck.error }, { status: 400 });
      }

      if (newStatus === 'No-Show') {
        const { data: venueGrace } = await admin
          .from('venues')
          .select('no_show_grace_minutes, timezone')
          .eq('id', scopeVenueId)
          .single();
        const graceMinutes = venueGrace?.no_show_grace_minutes ?? 15;
        const venueTimezone =
          typeof venueGrace?.timezone === 'string' && venueGrace.timezone.trim() !== ''
            ? venueGrace.timezone.trim()
            : 'Europe/London';
        const bookingTimeStr = typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '00:00';
        const graceCheck = validateNoShowGracePeriod(
          booking.booking_date,
          bookingTimeStr,
          graceMinutes,
          venueTimezone,
        );
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
            .eq('venue_id', scopeVenueId)
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
          const { data: venue } = await admin.from('venues').select('stripe_connected_account_id').eq('id', scopeVenueId).single();
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
                venue_id: scopeVenueId,
                booking_id: id,
                booking_model: inferBookingRowModel(
                  booking as Parameters<typeof inferBookingRowModel>[0],
                ),
                error: refundErr instanceof Error ? refundErr.message : String(refundErr),
              });
            }
          }
        }

        if (canRefund && !refundSucceeded) {
          return NextResponse.json(
            {
              error:
                'Refund could not be processed. The booking was not cancelled — please try again or refund manually in Stripe.',
              code: 'REFUND_FAILED',
            },
            { status: 502 },
          );
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
          venue_id: scopeVenueId,
          booking_id: id,
          booking_model: inferBookingRowModel(
            booking as Parameters<typeof inferBookingRowModel>[0],
          ),
        });

        // §9.3 — cancels release card holds in every path; group cancels
        // release per sibling row (idsToCancel carries every cancelled row and
        // each has its own hold). Best-effort: the cancel itself already
        // happened, and the charge gate also requires status = 'No-Show'.
        try {
          await releaseCardHoldsForBookings(admin, idsToCancel, 'cancelled');
        } catch (holdErr) {
          console.error('[PATCH booking cancel] card-hold release failed:', holdErr, {
            bookingId: id,
          });
        }

        const cancelledBookingForWaitlist = {
          id,
          venue_id: scopeVenueId,
          booking_date: String(booking.booking_date),
          booking_time: String(booking.booking_time),
          practitioner_id: booking.practitioner_id as string | null | undefined,
          calendar_id: booking.calendar_id as string | null | undefined,
          appointment_service_id: booking.appointment_service_id as string | null | undefined,
          service_item_id: booking.service_item_id as string | null | undefined,
          booking_model: booking.booking_model as string | null | undefined,
          experience_event_id: booking.experience_event_id as string | null | undefined,
          class_instance_id: booking.class_instance_id as string | null | undefined,
          resource_id: booking.resource_id as string | null | undefined,
          event_session_id: booking.event_session_id as string | null | undefined,
        };

        try {
          const offerResult = await offerAppointmentWaitlistOnCancel(
            admin,
            cancelledBookingForWaitlist,
          );
          if (offerResult.offered) {
            console.info('[PATCH booking cancel] waitlist offer sent', {
              bookingId: id,
              mode: offerResult.mode,
              ...(offerResult.mode === 'notify_in_order'
                ? {
                    waitlistEntryId: offerResult.waitlistEntryId,
                    emailSent: offerResult.emailSent,
                    smsSent: offerResult.smsSent,
                  }
                : offerResult.mode === 'notify_all'
                  ? {
                      notifiedCount: offerResult.notifiedCount,
                      emailSentCount: offerResult.emailSentCount,
                      smsSentCount: offerResult.smsSentCount,
                    }
                  : {}),
            });
          }
        } catch (waitlistErr) {
          console.error('[PATCH booking cancel] waitlist offer failed:', waitlistErr, {
            bookingId: id,
          });
        }

        const { data: guestRow } = await staff.db
          .from('guests')
          .select('first_name, last_name, email, phone')
          .eq('id', booking.guest_id)
          .single();
        const { data: venueRow } = await staff.db
          .from('venues')
          .select('name, address, phone, email, reply_to_email')
          .eq('id', scopeVenueId)
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
          const vid = scopeVenueId;
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
        const groupBookingId = booking.group_booking_id as string | null | undefined;
        const noShowTargets = groupBookingId
          ? await loadGroupBookingSiblings(staff.db, scopeVenueId, groupBookingId)
          : [
              {
                id,
                status: booking.status as string,
                deposit_status: booking.deposit_status as string | null | undefined,
                guest_id: booking.guest_id as string,
              },
            ];

        for (const row of noShowTargets) {
          if (!canTransitionBookingStatus(row.status, 'No-Show')) continue;
          const hadPaidDeposit = row.deposit_status === 'Paid';
          const depositStatus = hadPaidDeposit ? 'Forfeited' : row.deposit_status;
          const previousStatus = row.status;
          await staff.db
            .from('bookings')
            .update({
              status: 'No-Show',
              deposit_status: depositStatus,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id)
            .eq('venue_id', scopeVenueId);
          await applyBookingLifecycleStatusEffects(admin, {
            bookingId: row.id,
            guestId: row.guest_id,
            previousStatus,
            nextStatus: 'No-Show',
            actorId: staff.id,
          });
        }

        const hadPaidDeposit = booking.deposit_status === 'Paid';

        const { data: guestNoShow } = await staff.db
          .from('guests')
          .select('first_name, last_name, email')
          .eq('id', booking.guest_id)
          .maybeSingle();
        const { data: venueNoShow } = await admin.from('venues').select('name').eq('id', scopeVenueId).maybeSingle();
        if (guestNoShow?.email && venueNoShow?.name) {
          const bookingTimeNs = typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
          const venueIdNs = scopeVenueId;
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

        // Staff push — independent of guest contact: alert staff to the no-show.
        {
          const bookingTimeNsStaff =
            typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
          const venueNameNs = venueNoShow?.name ?? null;
          after(async () => {
            try {
              const { sendStaffPush } = await import('@/lib/communications/staff-push-notification');
              await sendStaffPush(
                {
                  id,
                  guest_name: formatGuestDisplayName(
                    guestNoShow?.first_name ?? null,
                    guestNoShow?.last_name ?? null,
                  ),
                  booking_date: booking.booking_date as string,
                  booking_time: bookingTimeNsStaff,
                },
                { name: venueNameNs },
                scopeVenueId,
                'no_show',
              );
            } catch (noShowPushErr) {
              console.error('No-show staff push failed:', noShowPushErr);
            }
          });
        }
      } else {
        const groupBookingId = booking.group_booking_id as string | null | undefined;
        let statusLifecycleHandled = false;

        let actualDepartedTime: string | undefined;
        if (newStatus === 'Completed') {
          const parsedDepartedTime =
            body.actual_departed_time !== undefined
              ? actualDepartedTimeSchema.safeParse(body.actual_departed_time)
              : null;
          if (body.actual_departed_time !== undefined && !parsedDepartedTime?.success) {
            return NextResponse.json({ error: 'Invalid actual departed time' }, { status: 400 });
          }
          actualDepartedTime = parsedDepartedTime?.success
            ? parsedDepartedTime.data
            : new Date().toISOString();
        }

        if (groupBookingId) {
          const updatedIds = await applyGroupBookingStatusChange({
            db: staff.db,
            admin,
            venueId: scopeVenueId,
            groupBookingId,
            newStatus,
            actorId: staff.id,
            primaryBookingId: id,
            primaryPreviousStatus: booking.status as string,
            actualDepartedTime,
          });
          if (updatedIds.length === 0) {
            return NextResponse.json(
              { error: 'Status could not be applied to this visit' },
              { status: 400 },
            );
          }
          statusLifecycleHandled = true;
        } else {
          const statusPayload: Record<string, unknown> = {
            status: newStatus,
            updated_at: new Date().toISOString(),
          };
          if (newStatus === 'Seated' && !booking.practitioner_id && !booking.calendar_id) {
            statusPayload.client_arrived_at = null;
          }
          if (newStatus === 'Confirmed' && booking.status !== 'Confirmed') {
            statusPayload.staff_attendance_confirmed_at = new Date().toISOString();
          }
          if (booking.status === 'Confirmed' && newStatus === 'Booked') {
            statusPayload.staff_attendance_confirmed_at = null;
            statusPayload.guest_attendance_confirmed_at = null;
          }
          if (newStatus === 'Completed') {
            statusPayload.actual_departed_time = actualDepartedTime ?? new Date().toISOString();
          }
          if (booking.status === 'Completed' && newStatus === 'Seated') {
            statusPayload.actual_departed_time = null;
          }
          if (
            booking.status === 'No-Show' &&
            (newStatus === 'Booked' || newStatus === 'Confirmed') &&
            booking.deposit_status === 'Forfeited'
          ) {
            statusPayload.deposit_status = 'Paid';
          }
          await staff.db.from('bookings').update(statusPayload).eq('id', id);
        }

        if (booking.status === 'Pending' && newStatus === 'Booked') {
          const { sendBookingConfirmationNotifications } = await import('@/lib/communications/send-templated');
          const { data: guestRow } = await staff.db
            .from('guests')
            .select('first_name, last_name, email, phone')
            .eq('id', booking.guest_id)
            .single();
          const { data: venueRow } = await staff.db.from('venues').select('name, address').eq('id', scopeVenueId).single();
          if (guestRow?.email && venueRow?.name) {
            const bookingTime = typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';
            const emailData = {
              id,
              guest_name: formatGuestDisplayName(guestRow.first_name, guestRow.last_name),
              guest_email: guestRow.email,
              guest_phone: guestRow.phone ?? null,
              booking_date: booking.booking_date,
              booking_time: bookingTime,
              booking_model: (booking.booking_model as BookingModel | null | undefined) ?? undefined,
              party_size: booking.party_size,
            };
            const venueEmailData = { name: venueRow.name, address: venueRow.address ?? undefined };
            const vid = scopeVenueId;
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

        if (!statusLifecycleHandled) {
          await applyBookingLifecycleStatusEffects(admin, {
            bookingId: id,
            guestId: booking.guest_id,
            previousStatus: booking.status as string,
            nextStatus: newStatus,
            actorId: staff.id,
          });
        }
      }

      if (newStatus === 'Seated' && Array.isArray(body.table_ids) && body.table_ids.length > 0) {
        const tableIds = body.table_ids as string[];
        const valid = await validateTablesBelongToVenue(admin, scopeVenueId, tableIds);
        if (valid) {
          await replaceBookingAssignments(admin, id, tableIds, staff.id);
          await syncTableStatusesForBooking(admin, id, tableIds, newStatus, staff.id);
        }
      }

      const updated = await staff.db.from('bookings').select('*').eq('id', id).single();
      await auditLinkedBookingChange(
        (updated.data as Record<string, unknown> | null) ?? null,
        newStatus === 'Cancelled' ? 'cancelled_booking' : 'edited_booking',
      );
      return NextResponse.json(updated.data);
    }

    /** Staff marks client as arrived / waiting (appointments and CDE rosters). */
    if (body.client_arrived !== undefined) {
      const canMarkArrived =
        Boolean(booking.practitioner_id || booking.calendar_id) ||
        Boolean(
          (booking as { experience_event_id?: string | null }).experience_event_id ||
            (booking as { class_instance_id?: string | null }).class_instance_id ||
            (booking as { resource_id?: string | null }).resource_id,
        );
      if (!canMarkArrived) {
        return NextResponse.json({ error: 'Arrived is not available for this booking type' }, { status: 400 });
      }
      const st = booking.status as string;
      if (!['Pending', 'Booked', 'Confirmed'].includes(st)) {
        return NextResponse.json(
          { error: 'Arrived can only be set when the booking is pending, booked, or confirmed' },
          { status: 400 },
        );
      }
      const arrived = Boolean(body.client_arrived);
      const groupBookingId = booking.group_booking_id as string | null | undefined;
      if (groupBookingId) {
        await applyGroupClientArrivedChange(staff.db, scopeVenueId, groupBookingId, arrived);
      } else {
        await staff.db
          .from('bookings')
          .update({
            client_arrived_at: arrived ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('venue_id', scopeVenueId);
      }

      const updated = await staff.db.from('bookings').select('*').eq('id', id).single();
      await auditLinkedBookingChange(
        (updated.data as Record<string, unknown> | null) ?? null,
        'edited_booking',
      );
      return NextResponse.json(updated.data);
    }

    if (body.staff_attendance_confirmed !== undefined) {
      const on = Boolean(body.staff_attendance_confirmed);
      const currentStatus = booking.status as string;
      const groupBookingId = booking.group_booking_id as string | null | undefined;

      if (groupBookingId) {
        const updatedIds = await applyGroupStaffAttendanceChange({
          db: staff.db,
          admin,
          venueId: scopeVenueId,
          groupBookingId,
          confirmed: on,
          actorId: staff.id,
        });
        if (updatedIds.length === 0) {
          return NextResponse.json({ error: 'Could not update attendance' }, { status: 500 });
        }
      } else {
        const updatePayload: Record<string, unknown> = {
          staff_attendance_confirmed_at: on ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        };
        if (
          on &&
          (currentStatus === 'Booked' ||
            currentStatus === 'Pending' ||
            currentStatus === 'Deposit Pending')
        ) {
          updatePayload.status = 'Confirmed';
        } else if (
          !on &&
          (currentStatus === 'Pending' || currentStatus === 'Booked' || currentStatus === 'Confirmed')
        ) {
          updatePayload.guest_attendance_confirmed_at = null;
          if (currentStatus === 'Confirmed') {
            updatePayload.status = 'Booked';
          }
        }

        await staff.db
          .from('bookings')
          .update(updatePayload)
          .eq('id', id)
          .eq('venue_id', scopeVenueId);

        if (updatePayload.status && updatePayload.status !== currentStatus) {
          await applyBookingLifecycleStatusEffects(admin, {
            bookingId: id,
            guestId: booking.guest_id,
            previousStatus: currentStatus,
            nextStatus: updatePayload.status as BookingStatus,
            actorId: staff.id,
          });
        }
      }

      const updated = await staff.db.from('bookings').select('*').eq('id', id).single();
      await auditLinkedBookingChange(
        (updated.data as Record<string, unknown> | null) ?? null,
        'edited_booking',
      );
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
          .eq('venue_id', scopeVenueId);
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

        if (body.guest_email !== undefined || body.guest_phone !== undefined) {
          const contactSnap: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          };
          if (body.guest_email !== undefined) {
            contactSnap.guest_email = guestUpdatePayload.email ?? null;
          }
          if (body.guest_phone !== undefined) {
            contactSnap.guest_phone = guestUpdatePayload.phone ?? null;
          }
          await staff.db.from('bookings').update(contactSnap).eq('id', id).eq('venue_id', scopeVenueId);
        }

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
          await staff.db.from('bookings').update(bookingSnap).eq('id', id).eq('venue_id', scopeVenueId);
        }
      }

      const scheduleModifyRequested =
        body.booking_date !== undefined ||
        body.booking_time !== undefined ||
        body.booking_end_time !== undefined ||
        body.party_size !== undefined ||
        body.duration_minutes !== undefined ||
        body.appointment_service_id !== undefined ||
        body.service_item_id !== undefined ||
        body.processing_time_blocks !== undefined ||
        body.practitioner_id !== undefined ||
        body.target_class_instance_id !== undefined ||
        (body as { service_variant_id?: unknown }).service_variant_id !== undefined;

      if (!scheduleModifyRequested) {
        const updated = await staff.db.from('bookings').select('*').eq('id', id).single();
        await auditLinkedBookingChange(
          (updated.data as Record<string, unknown> | null) ?? null,
          'edited_booking',
        );
        return NextResponse.json(updated.data);
      }
    }

    if (
      body.booking_date !== undefined ||
      body.booking_time !== undefined ||
      body.party_size !== undefined ||
      body.booking_end_time !== undefined ||
      body.appointment_service_id !== undefined ||
      body.service_item_id !== undefined ||
      body.duration_minutes !== undefined ||
      body.processing_time_blocks !== undefined ||
      body.practitioner_id !== undefined ||
      body.target_class_instance_id !== undefined ||
      (body as { service_variant_id?: unknown }).service_variant_id !== undefined
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

      if (inferredForModify === 'resource_booking') {
        if (
          body.party_size !== undefined ||
          body.practitioner_id !== undefined ||
          body.appointment_service_id !== undefined ||
          body.service_item_id !== undefined ||
          body.processing_time_blocks !== undefined ||
          (body as { service_variant_id?: unknown }).service_variant_id !== undefined
        ) {
          return NextResponse.json({ error: 'Invalid fields for resource booking modification' }, { status: 400 });
        }

        const resourceId = booking.resource_id as string | null;
        if (!resourceId) {
          return NextResponse.json({ error: 'Booking is missing resource_id' }, { status: 400 });
        }

        const currentStatus = booking.status as string;
        if (!['Pending', 'Booked', 'Confirmed', 'Seated'].includes(currentStatus)) {
          return NextResponse.json({ error: 'This booking can no longer be rescheduled' }, { status: 400 });
        }

        const newDate = (body.booking_date as string) ?? (booking.booking_date as string);
        const newTimeRaw =
          (body.booking_time as string) ??
          (typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '12:00');
        const timeStr = newTimeRaw.length >= 5 ? newTimeRaw.slice(0, 5) : newTimeRaw;
        const newTime = timeStr.length === 5 ? `${timeStr}:00` : newTimeRaw;

        const existingEnd =
          typeof (booking as { booking_end_time?: string | null }).booking_end_time === 'string'
            ? String((booking as { booking_end_time?: string | null }).booking_end_time).slice(0, 5)
            : null;

        const validation = await validateResourceBookingModification({
          admin,
          venueId: scopeVenueId,
          bookingId: id,
          resourceId,
          newDate,
          timeStr,
          durationMinutes: body.duration_minutes as number | null | undefined,
          bookingEndTime:
            (body.booking_end_time as string | null | undefined) ??
            (body.duration_minutes === undefined ? existingEnd : null),
        });

        if (!validation.ok) {
          const status = validation.reason.includes('no longer available') ? 409 : 400;
          return NextResponse.json({ error: validation.reason }, { status });
        }

        const beforeTime =
          typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '12:00';
        const bookingStartChanged = newDate !== booking.booking_date || timeStr !== beforeTime;

        const deferModificationGuestNotification =
          (body as Record<string, unknown>).defer_modification_guest_notification === true ||
          (body as Record<string, unknown>).defer_modification_notification === true;
        const skipModificationGuestNotification =
          (body as Record<string, unknown>).skip_booking_modification_guest_notification === true;

        // estimated_end_time must be a TRUE UTC instant for the venue timezone.
        // We resolve the venue-local start wall-clock (newDate + timeStr) to a
        // real UTC instant via venueLocalDateTimeToUtcMs, then add the booking
        // duration. Adding minutes to the start *instant* is correct across DST
        // and midnight wrap (unlike re-interpreting an HH:mm end that may have
        // rolled past 24:00). booking_end_time still carries the venue-local
        // wall-clock HH:mm, so every wall-clock reader keeps working — they all
        // prefer booking_end_time over estimated_end_time for resource rows.
        const { data: venueTz } = await admin
          .from('venues')
          .select('timezone')
          .eq('id', scopeVenueId)
          .single();
        const venueTimezone =
          typeof venueTz?.timezone === 'string' && venueTz.timezone.trim() !== ''
            ? venueTz.timezone.trim()
            : 'Europe/London';
        const startUtcMs = venueLocalDateTimeToUtcMs(newDate, timeStr, venueTimezone);
        const estimatedEnd = new Date(startUtcMs + validation.durationMinutes * 60_000);

        // Re-pin the deposit-refund deadline to the NEW start. Without this the
        // cancellation_deadline stays anchored to the old start time after a
        // staff move (mirrors the guest self-reschedule path in /api/confirm).
        const refundWindowHours = await resolveCancellationNoticeHoursForCreate({
          supabase: admin,
          venueId: scopeVenueId,
          effectiveModel: 'resource_booking',
          resourceCalendarId: resourceId,
        });
        const cancellation_deadline = cancellationDeadlineHoursBefore(
          newDate,
          newTime,
          refundWindowHours,
        );

        const bookingUpdate: Record<string, unknown> = {
          booking_date: newDate,
          booking_time: newTime,
          booking_end_time: `${validation.endHHmm}:00`,
          estimated_end_time: estimatedEnd.toISOString(),
          cancellation_deadline,
          updated_at: new Date().toISOString(),
        };

        const prevUpdatedAt = booking.updated_at as string;
        const { data: updatedAfterModify, error: modifyUpdErr } = await staff.db
          .from('bookings')
          .update(bookingUpdate)
          .eq('id', id)
          .eq('updated_at', prevUpdatedAt)
          .select('*')
          .maybeSingle();

        if (modifyUpdErr) {
          // The `enforce_cde_capacity` DB trigger RAISEs SQLSTATE 23P01 with
          // message 'CDE_CAPACITY' when this reschedule would overlap another
          // resource booking. Surface that as a 409 (slot taken) rather than a
          // generic 500, while keeping the optimistic-concurrency 412 below.
          const modifyErr = modifyUpdErr as { code?: string | null; message?: string | null };
          const isCapacityConflict =
            modifyErr.code === '23P01' ||
            (typeof modifyErr.message === 'string' && modifyErr.message.includes('CDE_CAPACITY'));
          if (isCapacityConflict) {
            return NextResponse.json(
              { error: 'That slot is no longer available.', code: 'slot_unavailable' },
              { status: 409 },
            );
          }
          console.error('Resource booking modify update failed:', modifyUpdErr);
          return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 });
        }
        if (!updatedAfterModify) {
          return NextResponse.json(
            { error: 'Booking was modified elsewhere. Refresh and try again.', code: 'stale_booking' },
            { status: 412 },
          );
        }

        const { logBookingModifiedEvent } = await import('@/lib/booking/log-booking-modified-event');
        await logBookingModifiedEvent(admin, {
          venue_id: scopeVenueId,
          booking_id: id,
          modification_actor: 'staff',
          before: {
            booking_date: booking.booking_date,
            booking_time: beforeTime,
            ...(existingEnd ? { booking_end_time: existingEnd } : {}),
          },
          after: {
            booking_date: newDate,
            booking_time: timeStr,
            booking_end_time: validation.endHHmm,
          },
        });

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
              await executeBookingModificationGuestNotification(admin, scopeVenueId, id);
            } catch (commsErr) {
              console.error('Resource booking modification notification failed:', commsErr);
            }
          });
        }

        if (bookingStartChanged) {
          try {
            await admin
              .from('communication_logs')
              .delete()
              .eq('booking_id', id)
              .in('message_type', [...COMMUNICATION_LOG_TYPES_RESET_ON_BOOKING_START_CHANGE]);
          } catch (logResetErr) {
            console.error('Communication log reset failed after resource modification:', logResetErr);
          }
        }

        await auditLinkedBookingChange(
          (updatedAfterModify as Record<string, unknown> | null) ?? null,
          'edited_booking',
        );
        return NextResponse.json(updatedAfterModify);
      }

      if (inferredForModify === 'class_session') {
        // Staff slot-move: relocate to another FUTURE instance of the SAME class
        // type (§5.6 #1). Reuses validateClassModification (the same dry-run the
        // guest manage link uses) and is capacity-safe via the
        // `enforce_cde_capacity` DB trigger (409 on oversell). Date/time/party
        // edits other than the instance move are not supported here.
        const targetInstanceId =
          typeof body.target_class_instance_id === 'string'
            ? body.target_class_instance_id
            : null;
        if (!targetInstanceId) {
          return NextResponse.json(
            {
              error:
                'Pick another session of this class to move the booking to. Other fields can’t be changed here.',
            },
            { status: 400 },
          );
        }

        const currentStatus = booking.status as string;
        if (!['Pending', 'Booked', 'Confirmed', 'Seated'].includes(currentStatus)) {
          return NextResponse.json(
            { error: 'This booking can no longer be moved' },
            { status: 400 },
          );
        }

        const currentInstanceId = booking.class_instance_id as string | null;
        if (!currentInstanceId) {
          return NextResponse.json(
            { error: 'This booking is missing its class session' },
            { status: 400 },
          );
        }
        if (targetInstanceId === currentInstanceId) {
          return NextResponse.json(
            { error: 'That is the session this booking is already on' },
            { status: 400 },
          );
        }

        // Block credit/membership-paid moves (v1) — re-attaching the entitlement
        // to a different instance is not yet built; cancel+rebook restores it.
        const { bookingWasCreditPaid, bookingWasMembershipPaid } = await import(
          '@/lib/class-commerce/booking-was-credit-paid'
        );
        if (
          (await bookingWasCreditPaid(admin, id)) ||
          (await bookingWasMembershipPaid(admin, id))
        ) {
          return NextResponse.json(
            {
              error:
                'This class was paid with a class pass or membership, so it can’t be moved here yet. Cancel and rebook to keep the entitlement.',
              code: 'entitlement_booking',
            },
            { status: 409 },
          );
        }

        const { data: curInst } = await admin
          .from('class_instances')
          .select('class_type_id')
          .eq('id', currentInstanceId)
          .maybeSingle();
        const currentClassTypeId =
          (curInst as { class_type_id?: string } | null)?.class_type_id ?? null;
        if (!currentClassTypeId) {
          return NextResponse.json({ error: 'This class is no longer available' }, { status: 400 });
        }

        const { data: venueTzRow } = await admin
          .from('venues')
          .select('timezone')
          .eq('id', scopeVenueId)
          .single();
        const venueTimezone =
          typeof venueTzRow?.timezone === 'string' && venueTzRow.timezone.trim() !== ''
            ? venueTzRow.timezone.trim()
            : 'Europe/London';

        const partySize = Number(booking.party_size) || 1;
        const validation = await validateClassModification({
          admin,
          venueId: scopeVenueId,
          bookingId: id,
          currentClassTypeId,
          targetInstanceId,
          partySize,
          venueTimezone,
          enforceGuestNotice: false,
        });
        if (!validation.ok) {
          const status = validation.reason.includes('full') ? 409 : 400;
          return NextResponse.json({ error: validation.reason }, { status });
        }

        const newTime =
          validation.startTime.length === 5 ? `${validation.startTime}:00` : validation.startTime;
        const startUtcMs = venueLocalDateTimeToUtcMs(
          validation.instanceDate,
          validation.startTime,
          venueTimezone,
        );
        const estimatedEnd = new Date(startUtcMs + validation.durationMinutes * 60_000);
        const cancellation_deadline = cancellationDeadlineHoursBefore(
          validation.instanceDate,
          newTime,
          validation.cancellationNoticeHours,
        );

        const beforeTime =
          typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '12:00';
        const prevUpdatedAt = booking.updated_at as string;
        const { data: classUpdated, error: classUpdErr } = await staff.db
          .from('bookings')
          .update({
            class_instance_id: targetInstanceId,
            booking_date: validation.instanceDate,
            booking_time: newTime,
            estimated_end_time: estimatedEnd.toISOString(),
            cancellation_deadline,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('updated_at', prevUpdatedAt)
          .select('*')
          .maybeSingle();

        if (classUpdErr) {
          const e = classUpdErr as { code?: string | null; message?: string | null };
          const isCapacityConflict =
            e.code === '23P01' ||
            (typeof e.message === 'string' && e.message.includes('CDE_CAPACITY'));
          if (isCapacityConflict) {
            return NextResponse.json(
              { error: 'That session just filled. Please choose another session.', code: 'slot_unavailable' },
              { status: 409 },
            );
          }
          console.error('Class booking staff move failed:', classUpdErr);
          return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 });
        }
        if (!classUpdated) {
          return NextResponse.json(
            { error: 'Booking was modified elsewhere. Refresh and try again.', code: 'stale_booking' },
            { status: 412 },
          );
        }

        const { logBookingModifiedEvent } = await import('@/lib/booking/log-booking-modified-event');
        await logBookingModifiedEvent(admin, {
          venue_id: scopeVenueId,
          booking_id: id,
          modification_actor: 'staff',
          before: { booking_date: booking.booking_date, booking_time: beforeTime },
          after: { booking_date: validation.instanceDate, booking_time: validation.startTime },
        });

        after(async () => {
          try {
            const { executeBookingModificationGuestNotification } = await import(
              '@/lib/booking/send-booking-modification-guest-notification'
            );
            await executeBookingModificationGuestNotification(admin, scopeVenueId, id);
          } catch (commsErr) {
            console.error('Class booking staff move notification failed:', commsErr);
          }
        });

        try {
          await admin
            .from('communication_logs')
            .delete()
            .eq('booking_id', id)
            .in('message_type', [...COMMUNICATION_LOG_TYPES_RESET_ON_BOOKING_START_CHANGE]);
        } catch (logResetErr) {
          console.error('Communication log reset failed after class move:', logResetErr);
        }

        await auditLinkedBookingChange(
          (classUpdated as Record<string, unknown> | null) ?? null,
          'edited_booking',
        );
        return NextResponse.json(classUpdated);
      }

      if (inferredForModify === 'event_ticket') {
        return NextResponse.json(
          {
            error:
              'Event tickets can’t be moved to another date here. Cancel the booking if policy allows and create a new booking.',
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
      const allowManualCalendarOverlap =
        isAppointment &&
        (body.allow_manual_overlap === true || body.allow_booking_overlap === true) &&
        (
          body.booking_date !== undefined ||
          body.booking_time !== undefined ||
          body.booking_end_time !== undefined ||
          body.duration_minutes !== undefined ||
          body.practitioner_id !== undefined ||
          body.appointment_service_id !== undefined ||
          body.service_item_id !== undefined
        );
      // Staff moving/extending a booking past opening hours from the calendar
      // (the UI shows an amber "outside opening hours" warning first).
      const allowOutsideHoursCalendar = isAppointment && body.allow_outside_hours === true;
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

        const variantIdForDefault =
          (body as { service_variant_id?: string | null }).service_variant_id !== undefined
            ? ((body as { service_variant_id?: string | null }).service_variant_id as string | null)
            : ((booking as { service_variant_id?: string | null }).service_variant_id ?? null);
        if (variantIdForDefault) {
          const vRow = await loadActiveVariantForService({
            admin,
            venueId: scopeVenueId,
            serviceId: svcId,
            variantId: variantIdForDefault,
          });
          if (!vRow) {
            return NextResponse.json({ error: 'Invalid or inactive variant for this service' }, { status: 400 });
          }
          appointmentSvcDurationMinutes = vRow.duration_minutes;
        }

        const intervalResult = await validateAppointmentModificationInterval({
          admin,
          venueId: scopeVenueId,
          bookingId: id,
          newDate,
          timeStr,
          practId,
          svcId,
          durationMinutes: body.duration_minutes as number | null | undefined,
          bookingEndTime: body.booking_end_time as string | null | undefined,
          serviceVariantId:
            (body as { service_variant_id?: string | null }).service_variant_id !== undefined
              ? ((body as { service_variant_id?: string | null }).service_variant_id as string | null)
              : undefined,
          bookingServiceVariantId: (booking as { service_variant_id?: string | null }).service_variant_id ?? null,
          bookingProcessingSnapshot: (booking as { processing_time_blocks?: unknown }).processing_time_blocks,
          processingTimeBlocksOverride:
            body.processing_time_blocks !== undefined ? body.processing_time_blocks : undefined,
          allowManualOverlap: allowManualCalendarOverlap,
          allowOutsideHours: allowOutsideHoursCalendar,
        });
        if (!intervalResult.ok) {
          return NextResponse.json(
            { error: intervalResult.reason ?? 'Selected time is not available for this practitioner' },
            { status: 409 },
          );
        }
      } else {
        const venueMode = await resolveVenueMode(admin, scopeVenueId);
        if (venueMode.availabilityEngine !== 'service') {
          return NextResponse.json({ error: AVAILABILITY_SETUP_REQUIRED_MESSAGE }, { status: 503 });
        }

        const bookingAreaId = (booking as { area_id?: string | null }).area_id ?? null;
        let targetAreaId = bookingAreaId;
        if (typeof body.area_id === 'string' && body.area_id.trim() !== '') {
          const areas = await listActiveAreasForVenue(admin, scopeVenueId);
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
          venueId: scopeVenueId,
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
        // §18 — for a cross-venue edit, the *move target* calendar must also be in
        // the link's scope (loadStaffAccessibleBooking only checked the booking's
        // current calendar). This route writes via the service-role admin client,
        // so the RLS `link_calendar_allows` backstop never runs — enforce here.
        if (
          !isOwnVenue &&
          !linkedGrantAllowsCalendar(linkedGrant, false, body.practitioner_id as string)
        ) {
          return NextResponse.json(
            { error: 'This link does not include that calendar.' },
            { status: 403 },
          );
        }
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
        const endResolved = resolveAppointmentModifyEndCoreHHmm({
          startHHmm: timeStr,
          durationMinutes: body.duration_minutes as number | null | undefined,
          bookingEndTime: body.booking_end_time as string | null | undefined,
          defaultDurationMinutes: appointmentSvcDurationMinutes,
        });
        if (!endResolved.ok) {
          return NextResponse.json({ error: endResolved.reason }, { status: 400 });
        }
        const durationMinutes = minutesBetweenStartAndEndHM(timeStr, endResolved.endCoreHHmm);
        rEnd.setMinutes(rEnd.getMinutes() + durationMinutes);
        bookingUpdate.estimated_end_time = rEnd.toISOString();
        bookingUpdate.booking_end_time = `${endResolved.endCoreHHmm}:00`;

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

      if (isAppointment && (body as { service_variant_id?: unknown }).service_variant_id !== undefined) {
        bookingUpdate.service_variant_id = (body as { service_variant_id?: string | null }).service_variant_id;
      }

      // Add-ons (web parity with create): when staff change add-ons in the modify
      // sheet, validate them against the (possibly new) service, snapshot them, and
      // refresh the breakdown totals. The wall-clock end time already reflects the
      // chosen add-ons because the client folds add-on minutes into
      // `duration_minutes`; this only persists the `booking_addons` rows + totals.
      let addonRowsToReplace: ReturnType<typeof buildAddonSnapshots> | null = null;
      if (isAppointment && body.addons !== undefined) {
        const rawAddons = body.addons;
        if (!Array.isArray(rawAddons)) {
          return NextResponse.json({ error: 'addons must be an array' }, { status: 400 });
        }
        if (rawAddons.length === 0) {
          bookingUpdate.addons_total_price_pence = 0;
          bookingUpdate.addons_total_duration_minutes = 0;
          addonRowsToReplace = [];
        } else {
          const bookingUsesServiceItem = Boolean(booking.service_item_id);
          const addonParentId = bookingUsesServiceItem
            ? ((body.service_item_id as string | undefined) ?? (booking.service_item_id as string | null))
            : ((body.appointment_service_id as string | undefined) ??
              (booking.appointment_service_id as string | null));
          if (!addonParentId) {
            return NextResponse.json({ error: 'Cannot resolve the service for add-ons' }, { status: 400 });
          }
          const { groups, groupsById } = await loadAddonsForBooking({
            admin,
            venueId: scopeVenueId,
            schema: bookingUsesServiceItem ? 'service_item' : 'appointment_service',
            parentId: addonParentId,
            includeHidden: true,
          });
          const addonValidation = validateAddonSelections({
            selections: rawAddons as { addon_id: string }[],
            groupsForService: groups,
            source: 'staff',
          });
          if (!addonValidation.ok) {
            return NextResponse.json(
              { error: 'INVALID_ADDON_SELECTION', details: addonValidation.errors },
              { status: 400 },
            );
          }
          const snapshots = buildAddonSnapshots({
            selected: addonValidation.resolvedAddons,
            groupsById,
            segmentIndex: null,
          });
          const totals = totalsFromSnapshots(snapshots);
          bookingUpdate.addons_total_price_pence = totals.total_price_pence;
          bookingUpdate.addons_total_duration_minutes = totals.total_duration_minutes;
          addonRowsToReplace = snapshots;
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
          .eq('id', scopeVenueId)
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
                metadata: { booking_id: id, venue_id: scopeVenueId, type: 'additional_deposit' },
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

      // Compliance gate on the edited service/time (§5.1). Staff context blocks
      // only on `block_all`; an admin may acknowledge via override_compliance.
      // No-ops when the feature is off or the booking is not Model B.
      if (isAppointment) {
        const effApptSvc =
          (bookingUpdate.appointment_service_id as string | undefined) ??
          (booking.appointment_service_id as string | null) ??
          null;
        const effServiceItem =
          (bookingUpdate.service_item_id as string | undefined) ??
          (booking.service_item_id as string | null) ??
          null;
        const patchCompliance = await checkBookingCompliance(admin, {
          venueId: scopeVenueId,
          guestId: (booking.guest_id as string | null) ?? null,
          appointmentServiceId: effApptSvc,
          serviceItemId: effServiceItem,
          bookingDate: newDate,
          bookingTime: timeStr,
          context: 'staff',
        });
        if (
          patchCompliance.blocked &&
          !(staff.role === 'admin' && (body as { override_compliance?: unknown }).override_compliance === true)
        ) {
          return NextResponse.json(
            {
              error: COMPLIANCE_REQUIREMENT_UNMET,
              message: complianceUnmetMessage(patchCompliance.details, 'staff'),
              details: patchCompliance.details,
            },
            { status: 409 },
          );
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

      // Replace the booking's add-on snapshots after the parent row update lands
      // (matches the create flow's `booking_addons` write). REPLACE semantics:
      // delete the existing rows, then insert the new selection (empty = cleared).
      if (addonRowsToReplace !== null) {
        const { error: addonDelErr } = await admin
          .from('booking_addons')
          .delete()
          .eq('booking_id', id);
        if (addonDelErr) {
          console.error('booking_addons modify delete failed:', addonDelErr);
          return NextResponse.json({ error: 'Failed to update add-ons for booking' }, { status: 500 });
        }
        if (addonRowsToReplace.length > 0) {
          const addonRows = addonRowsToReplace.map((s) => ({ ...s, booking_id: id }));
          const { error: addonInsErr } = await admin.from('booking_addons').insert(addonRows);
          if (addonInsErr) {
            console.error('booking_addons modify insert failed:', addonInsErr);
            return NextResponse.json({ error: 'Failed to update add-ons for booking' }, { status: 500 });
          }
        }
      }

      const afterEndHm =
        typeof bookingUpdate.booking_end_time === 'string'
          ? String(bookingUpdate.booking_end_time).slice(0, 5)
          : beforeEndHm;

      const { logBookingModifiedEvent } = await import('@/lib/booking/log-booking-modified-event');
      await logBookingModifiedEvent(admin, {
        venue_id: scopeVenueId,
        booking_id: id,
        modification_actor: 'staff',
        before,
        after: {
          booking_date: newDate,
          booking_time: timeStr,
          party_size: newPartySize,
          ...(afterEndHm ? { booking_end_time: afterEndHm } : {}),
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
          .eq('id', scopeVenueId)
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
              scopeVenueId,
              newDate,
              newPartySize,
              serviceIdForDuration,
            );
            durationMinutes = resolved.durationMinutes;
            bufferMinutes = resolved.bufferMinutes;
          }
          const assigned = await autoAssignTable(
            admin,
            scopeVenueId,
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
            await executeBookingModificationGuestNotification(admin, scopeVenueId, id);
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
            .in('message_type', [...COMMUNICATION_LOG_TYPES_RESET_ON_BOOKING_START_CHANGE]);
        } catch (logResetErr) {
          console.error('Communication log reset failed after modification:', logResetErr);
        }
      }
      await auditLinkedBookingChange(
        (updatedAfterModify as Record<string, unknown> | null) ?? null,
        'edited_booking',
      );
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const loaded = await loadStaffAccessibleBooking(staff, id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const {
      booking,
      ownerVenueId: scopeVenueId,
      isOwnVenue,
      linkedGrant,
      linkId: linkedAccountLinkId,
    } = loaded.ctx;

    if (!isOwnVenue && !linkedGrantAllowsCancel(linkedGrant, false)) {
      return NextResponse.json(
        { error: 'This link does not allow deleting the other venue’s bookings.' },
        { status: 403 },
      );
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

    // §9.3 — the row delete cascades away any hold row (with the customer id
    // needed for cleanup), so best-effort delete the hold's Stripe customer
    // first (snapshot account, shared-customer check). Never blocks the delete.
    try {
      await deleteCardHoldCustomersForBookings(admin, [id]);
    } catch (holdErr) {
      console.error('DELETE booking: card-hold customer cleanup failed:', holdErr);
    }

    const { error: delErr } = await admin.from('bookings').delete().eq('id', id).eq('venue_id', scopeVenueId);
    if (delErr) {
      console.error('DELETE booking: bookings delete failed:', delErr);
      return NextResponse.json({ error: 'Could not delete booking' }, { status: 500 });
    }

    logBookingOp({ operation: 'delete', venue_id: scopeVenueId, booking_id: id });

    // §16.1 #1c — a cross-venue hard-delete is not covered by the audit trigger
    // (INSERT/UPDATE only) and the admin client skips it, so record it explicitly.
    // No notification: the booking row is gone, so there is nothing to link to.
    if (!isOwnVenue && linkedAccountLinkId) {
      let deleteActorUserId: string | null = null;
      try {
        const { data: authData } = await supabase.auth.getUser();
        deleteActorUserId = authData.user?.id ?? null;
      } catch {
        deleteActorUserId = null;
      }
      await recordBookingWriteAudit({
        admin,
        linkId: linkedAccountLinkId,
        actingVenueId: staff.venue_id,
        actingUserId: deleteActorUserId,
        owningVenueId: scopeVenueId,
        actionType: 'deleted_booking',
        bookingId: id,
        beforeState: booking as Record<string, unknown>,
        afterState: null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/bookings/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
