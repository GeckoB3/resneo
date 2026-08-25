import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getVenueStaff, requireManagedCalendarAccess } from '@/lib/venue-auth';
import { resolveBookingScopedCalendarId } from '@/lib/booking/staff-booking-calendar-scope';
import {
  linkedGrantAllowsCalendar,
  linkedGrantAllowsMutation,
  loadStaffAccessibleBooking,
} from '@/lib/booking/staff-booking-access';
import { planVisitSchedule } from '@/lib/booking/visit-schedule-plan';
import type { VisitServiceRow } from '@/lib/booking/appointment-visit';
import { validateAppointmentModificationInterval } from '@/lib/booking/validate-appointment-modification';
import { bookingEndFieldsForStorage } from '@/lib/booking/booking-end-time';
import {
  resetVisitScheduledComms,
  visitCancellationFields,
} from '@/lib/booking/visit-write-shared';
import {
  parseProcessingTimeBlocksFromDb,
  processingBlocksForDurationChange,
} from '@/lib/appointments/processing-time';
import {
  checkBookingCompliance,
  complianceUnmetMessage,
  COMPLIANCE_REQUIREMENT_UNMET,
} from '@/lib/compliance/enforce-booking';
import { rescheduleBookingComplianceRecords } from '@/lib/compliance/records-service';
import { recordBookingWriteAudit } from '@/lib/linked-accounts/audit';
import { notifyCrossVenueBookingWrite } from '@/lib/linked-accounts/notifications';
import { MIN_APPOINTMENT_CORE_DURATION_MINUTES } from '@/lib/availability/appointment-engine';

/**
 * The statuses that put a service on the calendar. A cancelled or no-show row
 * keeps its `group_booking_id`, but it is no longer part of the visit's shape
 * and must not be re-laid with the rest.
 */
const SCHEDULED_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

const bodySchema = z
  .object({
    booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** New start for the visit's FIRST service; the rest follow it. */
    booking_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    /** Target calendar (unified `calendar_id`, legacy `practitioner_id`). */
    practitioner_id: z.string().uuid().optional(),
    /** New wall-clock span for the whole visit, configured gaps included. */
    total_duration_minutes: z
      .number()
      .int()
      .min(MIN_APPOINTMENT_CORE_DURATION_MINUTES)
      .max(14 * 60)
      .optional(),
    allow_manual_overlap: z.boolean().optional(),
    allow_outside_hours: z.boolean().optional(),
    /**
     * Staff placement over a break. A SEPARATE gate from the flag above,
     * because the engine has never let `allowOutsideHours` relax its break
     * check: a caller meaning "past closing" must not silently also mean "over
     * a break".
     *
     * SA-H5 threaded this through the single-booking PATCH and its dry run and
     * stopped one route short of the two visit routes, so a staff member could
     * drag a single appointment over a break but not a multi-service visit,
     * with nothing explaining the difference.
     */
    allow_during_breaks: z.boolean().optional(),
    /**
     * Plan and check the whole visit, write nothing. The modify form's live
     * check and its save then judge the same request through the same code,
     * rather than the form validating each service on its own and hoping the
     * write agrees.
     */
    dry_run: z.boolean().optional(),
    /** The caller will fire the guest notification itself (calendar's undo window). */
    defer_modification_guest_notification: z.boolean().optional(),
    skip_booking_modification_guest_notification: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.booking_date !== undefined ||
      v.booking_time !== undefined ||
      v.practitioner_id !== undefined ||
      v.total_duration_minutes !== undefined,
    { message: 'Nothing to change' },
  );

type BookingRow = Record<string, unknown> & {
  id: string;
  venue_id: string;
  status: string;
  booking_date: string;
  booking_time: string;
  booking_end_time?: string | null;
  updated_at: string;
};

function serviceIdOf(row: BookingRow): string | null {
  return (
    (row.service_item_id as string | null) ?? (row.appointment_service_id as string | null) ?? null
  );
}

function calendarIdOf(row: BookingRow): string | null {
  return (row.calendar_id as string | null) ?? (row.practitioner_id as string | null) ?? null;
}

/**
 * PATCH /api/venue/visits/[groupBookingId]/schedule
 *
 * Move a multi-service visit, change its wall-clock length, or both, as ONE
 * write.
 *
 * A visit is N rows sharing a `group_booking_id`, so every schedule edit rewrites
 * all of them. Done as N client PATCHes, a refusal part-way through leaves one
 * service moved and the rest behind: that is exactly how the reported booking
 * ended up running 10:11 to 18:16. Every service is planned, then checked
 * against the availability engine, then written, and a write that fails part-way
 * puts back the rows that already landed.
 *
 * See Docs/multi-service-visit-plan.md, workstream 5.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ groupBookingId: string }> },
) {
  try {
    const { groupBookingId } = await params;
    /**
     * A `group_booking_id` that is not a uuid cannot match anything, and reaches
     * the database as a cast error rather than a miss: answer it as the miss it
     * is instead of a 500.
     */
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupBookingId)) {
      return NextResponse.json({ error: 'Visit not found' }, { status: 404 });
    }
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const { data: groupRows, error: rowsErr } = await staff.db
      .from('bookings')
      .select('*')
      .eq('group_booking_id', groupBookingId);

    if (rowsErr) {
      console.error('Visit schedule load failed:', rowsErr);
      return NextResponse.json({ error: 'Could not load this visit' }, { status: 500 });
    }
    const allRows = (groupRows ?? []) as BookingRow[];
    if (allRows.length === 0) {
      return NextResponse.json({ error: 'Visit not found' }, { status: 404 });
    }

    const rows = allRows
      .filter((r) => SCHEDULED_STATUSES.includes(r.status))
      .sort((a, b) => a.booking_time.localeCompare(b.booking_time));
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'This visit has no services left to move.' },
        { status: 409 },
      );
    }

    /**
     * Access is resolved through the same loader every other booking route uses,
     * against the visit's first service. The rows are one guest at one venue, so
     * one check answers for all of them, but that is asserted rather than
     * assumed.
     */
    const loaded = await loadStaffAccessibleBooking(staff, rows[0]!.id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const { ownerVenueId: scopeVenueId, isOwnVenue, linkedGrant, linkId } = loaded.ctx;

    if (rows.some((r) => r.venue_id !== scopeVenueId)) {
      return NextResponse.json(
        { error: 'This visit spans more than one venue and cannot be moved as one.' },
        { status: 409 },
      );
    }
    if (!linkedGrantAllowsMutation(linkedGrant, isOwnVenue)) {
      return NextResponse.json(
        { error: 'This link does not allow editing the other venue’s bookings.' },
        { status: 403 },
      );
    }

    const admin = getSupabaseAdminClient();
    const currentCalendarId = calendarIdOf(rows[0]!);
    const targetCalendarId = body.practitioner_id ?? currentCalendarId;
    if (!targetCalendarId) {
      return NextResponse.json(
        { error: 'This visit is not on a calendar, so it cannot be rescheduled here.' },
        { status: 400 },
      );
    }

    if (isOwnVenue) {
      if (staff.role !== 'admin') {
        /**
         * BOTH calendars, because a move has two. The per-booking route gates on
         * the calendar a booking sits on; gating only on the target would let a
         * staff member pull a colleague's visit onto their own column, and
         * gating only on the source would let them push one onto anybody's.
         */
        const scopedCalendarId = await resolveBookingScopedCalendarId(
          admin,
          scopeVenueId,
          rows[0]! as Parameters<typeof resolveBookingScopedCalendarId>[2],
        );
        if (!scopedCalendarId) {
          return NextResponse.json(
            {
              error:
                'This visit is not on a team calendar column tied to your permissions. Ask a venue admin to move it.',
            },
            { status: 403 },
          );
        }
        for (const calId of new Set([scopedCalendarId, targetCalendarId])) {
          const access = await requireManagedCalendarAccess(
            admin,
            scopeVenueId,
            staff,
            calId,
            'You can only move visits between calendars assigned to your account.',
          );
          if (!access.ok) {
            return NextResponse.json({ error: access.error }, { status: 403 });
          }
        }
      }
    } else if (!linkedGrantAllowsCalendar(linkedGrant, false, targetCalendarId)) {
      // §18 — the move TARGET must be in the link's scope, not just the calendar
      // the visit sits on today. This route writes with the admin client, so the
      // RLS backstop never runs.
      return NextResponse.json({ error: 'This link does not include that calendar.' }, { status: 403 });
    }

    /**
     * `buffer_minutes` is what separates a service's configured gap from dead
     * time an earlier edit left behind. Without it the resolver preserves every
     * observed gap, so the 11:30 to 11:45 hole in the reported visit would
     * survive the re-lay that is supposed to close it.
     */
    const serviceItemIds = rows
      .map((r) => r.service_item_id as string | null)
      .filter((v): v is string => Boolean(v));
    const legacyServiceIds = rows
      .filter((r) => !r.service_item_id)
      .map((r) => r.appointment_service_id as string | null)
      .filter((v): v is string => Boolean(v));

    const [itemsRes, legacyRes] = await Promise.all([
      serviceItemIds.length > 0
        ? admin
            .from('service_items')
            .select('id, name, buffer_minutes, processing_time_blocks')
            .in('id', serviceItemIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      legacyServiceIds.length > 0
        ? admin
            .from('appointment_services')
            .select('id, name, buffer_minutes, processing_time_blocks')
            .in('id', legacyServiceIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);
    const catalogue = new Map<string, { buffer_minutes: number; processing_time_blocks: unknown }>();
    for (const svc of [...(itemsRes.data ?? []), ...(legacyRes.data ?? [])] as Record<
      string,
      unknown
    >[]) {
      catalogue.set(svc.id as string, {
        buffer_minutes: Math.max(0, (svc.buffer_minutes as number | null) ?? 0),
        processing_time_blocks: svc.processing_time_blocks,
      });
    }

    const visitRows: VisitServiceRow[] = rows.map((r) => {
      const svcId = serviceIdOf(r);
      return {
        id: r.id,
        booking_time: r.booking_time,
        booking_end_time: r.booking_end_time ?? null,
        group_booking_id: groupBookingId,
        person_label: (r.person_label as string | null) ?? null,
        booking_item_name:
          (r.service_name_snapshot as string | null) ??
          (r.booking_item_name as string | null) ??
          null,
        addons_total_duration_minutes: (r.addons_total_duration_minutes as number | null) ?? 0,
        buffer_minutes: svcId ? (catalogue.get(svcId)?.buffer_minutes ?? null) : null,
      };
    });

    const planned = planVisitSchedule({
      rows: visitRows,
      startHm: body.booking_time ?? null,
      totalDurationMinutes: body.total_duration_minutes ?? null,
    });
    if (!planned.ok) {
      return NextResponse.json({ error: planned.reason }, { status: 409 });
    }
    const plan = planned.plan;

    const currentDate = rows[0]!.booking_date;
    const newDate = body.booking_date ?? currentDate;
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const visitBookingIds = rows.map((r) => r.id);
    const calendarChanged = targetCalendarId !== currentCalendarId;
    const dateChanged = newDate !== currentDate;
    const visitStartChanged = dateChanged || plan.startHm !== plan.visit.startHm;

    /**
     * One shape for every answer, so a dry run tells the form exactly what the
     * save would do: the same per-service times, the same total, the same
     * `changed`.
     */
    const describePlan = (changed: boolean) => ({
      ok: true as const,
      group_booking_id: groupBookingId,
      booking_date: newDate,
      start_time: plan.startHm,
      end_time: plan.endHm,
      total_minutes: plan.totalMinutes,
      calendar_id: targetCalendarId,
      changed,
      dry_run: body.dry_run === true,
      services: plan.services.map((s) => ({
        id: s.id,
        name: plan.visit.services.find((v) => v.id === s.id)?.name ?? null,
        // Carried so a caller that only has the visit's rows can drive the
        // services endpoint, which needs each line's service to say what the
        // visit is made of. The rows the booking list hands the UI have names,
        // not ids.
        service_id: serviceIdOf(rowById.get(s.id)!),
        service_variant_id: (rowById.get(s.id)!.service_variant_id as string | null) ?? null,
        booking_date: newDate,
        booking_time: `${s.startHm}:00`,
        booking_end_time: `${s.endHm}:00`,
        duration_minutes: s.durationMinutes,
        moved: s.changed,
      })),
    });

    if (!plan.changed && !dateChanged && !calendarChanged) {
      return NextResponse.json(describePlan(false));
    }

    /**
     * Every service is checked before any of them is written, and each is checked
     * with the whole visit taken off the calendar: the rows are moving together,
     * so a service must not be reported as conflicting with the sibling it is
     * about to follow.
     */
    const targets = plan.services.map((s) => {
      const row = rowById.get(s.id)!;
      const svcId = serviceIdOf(row);
      const blocks = processingBlocksForDurationChange({
        snapshot: row.processing_time_blocks,
        templateBlocks: parseProcessingTimeBlocksFromDb(
          svcId ? catalogue.get(svcId)?.processing_time_blocks : null,
        ),
        durationMinutes: s.durationMinutes,
      });
      return { schedule: s, row, svcId, blocks };
    });

    const missingService = targets.find((t) => !t.svcId);
    if (missingService) {
      return NextResponse.json(
        { error: 'A service on this visit has no service record, so it cannot be checked.' },
        { status: 409 },
      );
    }

    const checks = await Promise.all(
      targets.map(async (t) => {
        const result = await validateAppointmentModificationInterval({
          admin,
          venueId: scopeVenueId,
          bookingId: t.row.id,
          newDate,
          timeStr: t.schedule.startHm,
          practId: targetCalendarId,
          svcId: t.svcId!,
          durationMinutes: t.schedule.durationMinutes,
          bookingServiceVariantId: (t.row.service_variant_id as string | null) ?? null,
          bookingProcessingSnapshot: t.row.processing_time_blocks,
          ...(t.blocks !== null ? { processingTimeBlocksOverride: t.blocks } : {}),
          allowManualOverlap: body.allow_manual_overlap === true,
          allowOutsideHours: body.allow_outside_hours === true,
          allowDuringBreaks: body.allow_during_breaks === true,
          excludeBookingIds: visitBookingIds,
        });
        return { t, result };
      }),
    );

    const blocked = checks.find((c) => !c.result.ok);
    if (blocked) {
      const name = plan.visit.services.find((s) => s.id === blocked.t.row.id)?.name ?? 'A service';
      const reason = blocked.result.ok ? '' : blocked.result.reason;
      return NextResponse.json(
        {
          error: `${name} cannot go to ${blocked.t.schedule.startHm}: ${reason}. The visit was not moved.`,
          service_id: blocked.t.row.id,
          reason,
        },
        { status: 409 },
      );
    }

    if (visitStartChanged) {
      for (const t of targets) {
        // A per-visit record was completed for THIS booking, so it moves with the visit.
        // Runs before the gate, which would otherwise reject the reschedule on the consent
        // signed for the date being left behind. Skipped on a dry run, which must not write:
        // the trade-off is that a dry run can still report a per-visit block that the real
        // save would clear.
        if (body.dry_run !== true) {
          await rescheduleBookingComplianceRecords(admin, {
            venueId: scopeVenueId,
            bookingId: t.row.id as string,
            newBookingDate: newDate,
          });
        }

        const compliance = await checkBookingCompliance(admin, {
          venueId: scopeVenueId,
          guestId: (t.row.guest_id as string | null) ?? null,
          appointmentServiceId: (t.row.appointment_service_id as string | null) ?? null,
          serviceItemId: (t.row.service_item_id as string | null) ?? null,
          bookingDate: newDate,
          bookingTime: t.schedule.startHm,
          context: 'staff',
        });
        if (compliance.blocked) {
          return NextResponse.json(
            {
              error: COMPLIANCE_REQUIREMENT_UNMET,
              message: complianceUnmetMessage(compliance.details, 'staff'),
              details: compliance.details,
            },
            { status: 409 },
          );
        }
      }
    }

    if (body.dry_run === true) {
      return NextResponse.json(describePlan(true));
    }

    const firstRow = rowById.get(plan.services[0]!.id)!;
    const cancellation = await visitCancellationFields({
      admin,
      venueId: scopeVenueId,
      anchorRow: {
        service_item_id: (firstRow.service_item_id as string | null) ?? null,
        appointment_service_id: (firstRow.appointment_service_id as string | null) ?? null,
      },
      dateYmd: newDate,
      startHm: plan.startHm,
    });

    /**
     * Written one row at a time, because a visit's rows are separate bookings
     * with separate optimistic-concurrency guards. A row that fails puts the
     * rows already written back where they were: the endpoint exists so a visit
     * cannot be left half re-laid, and it must not do that itself.
     */
    const written: { row: BookingRow; after: Record<string, unknown> }[] = [];
    const restoreWritten = async () => {
      for (const w of written) {
        const { error: undoErr } = await admin
          .from('bookings')
          .update({
            booking_date: w.row.booking_date,
            booking_time: w.row.booking_time,
            booking_end_time: w.row.booking_end_time ?? null,
            estimated_end_time: (w.row.estimated_end_time as string | null) ?? null,
            processing_time_blocks: w.row.processing_time_blocks ?? null,
            cancellation_deadline: (w.row.cancellation_deadline as string | null) ?? null,
            cancellation_policy_snapshot: w.row.cancellation_policy_snapshot ?? null,
            ...(w.row.calendar_id != null
              ? { calendar_id: w.row.calendar_id }
              : { practitioner_id: w.row.practitioner_id }),
            updated_at: new Date().toISOString(),
          })
          .eq('id', w.row.id);
        if (undoErr) {
          console.error('Visit schedule rollback failed for booking', w.row.id, undoErr);
        }
      }
    };

    for (const t of targets) {
      const endFields = bookingEndFieldsForStorage({
        dateYmd: newDate,
        startHHmm: t.schedule.startHm,
        durationMinutes: t.schedule.durationMinutes,
      });
      const update: Record<string, unknown> = {
        booking_date: newDate,
        booking_time: `${t.schedule.startHm}:00`,
        booking_end_time: endFields.booking_end_time,
        estimated_end_time: endFields.estimated_end_time,
        ...cancellation,
        updated_at: new Date().toISOString(),
        ...(t.blocks !== null ? { processing_time_blocks: t.blocks } : {}),
        ...(calendarChanged
          ? t.row.calendar_id != null
            ? { calendar_id: targetCalendarId }
            : { practitioner_id: targetCalendarId }
          : {}),
      };

      const { data: updated, error: updErr } = await admin
        .from('bookings')
        .update(update)
        .eq('id', t.row.id)
        .eq('updated_at', t.row.updated_at)
        .select('*')
        .maybeSingle();

      if (updErr) {
        console.error('Visit schedule update failed:', updErr);
        await restoreWritten();
        return NextResponse.json({ error: 'Could not move this visit' }, { status: 500 });
      }
      if (!updated) {
        await restoreWritten();
        return NextResponse.json(
          {
            error: 'This visit was changed somewhere else. Refresh and try again.',
            code: 'stale_booking',
          },
          { status: 412 },
        );
      }
      written.push({ row: t.row, after: updated as Record<string, unknown> });
    }

    const { logBookingModifiedEvent } = await import('@/lib/booking/log-booking-modified-event');
    for (const t of targets) {
      await logBookingModifiedEvent(admin, {
        venue_id: scopeVenueId,
        booking_id: t.row.id,
        modification_actor: 'staff',
        before: {
          booking_date: t.row.booking_date,
          booking_time: t.row.booking_time.slice(0, 5),
          party_size: (t.row.party_size as number | null) ?? 1,
        },
        after: {
          booking_date: newDate,
          booking_time: t.schedule.startHm,
          party_size: (t.row.party_size as number | null) ?? 1,
          booking_end_time: t.schedule.endHm,
        },
      });
    }

    if (visitStartChanged) {
      await resetVisitScheduledComms(admin, visitBookingIds);
    }

    /**
     * ONE notification for the visit, against its first service, matching what
     * the calendar's own move already does. A visit is one appointment to the
     * guest: three emails saying their booking moved would be three times the
     * same news.
     */
    if (
      visitStartChanged &&
      body.defer_modification_guest_notification !== true &&
      body.skip_booking_modification_guest_notification !== true
    ) {
      const notifyBookingId = plan.services[0]!.id;
      after(async () => {
        try {
          const { executeBookingModificationGuestNotification } = await import(
            '@/lib/booking/send-booking-modification-guest-notification'
          );
          await executeBookingModificationGuestNotification(admin, scopeVenueId, notifyBookingId);
        } catch (commsErr) {
          console.error('Visit modification notification failed:', commsErr);
        }
      });
    }

    if (!isOwnVenue && linkId) {
      let auditActorUserId: string | null = null;
      try {
        const { data: authData } = await supabase.auth.getUser();
        auditActorUserId = authData.user?.id ?? null;
      } catch {
        auditActorUserId = null;
      }
      for (const w of written) {
        await recordBookingWriteAudit({
          admin,
          linkId,
          actingVenueId: staff.venue_id,
          actingUserId: auditActorUserId,
          owningVenueId: scopeVenueId,
          actionType: 'edited_booking',
          bookingId: w.row.id,
          beforeState: w.row as Record<string, unknown>,
          afterState: w.after,
        });
      }
      // §17.3 — the owning venue hears about it once, for the visit.
      const firstWrite = written[0];
      if (firstWrite) {
        after(() =>
          notifyCrossVenueBookingWrite({
            admin,
            owningVenueId: scopeVenueId,
            actingVenueId: staff.venue_id,
            actionType: 'edited_booking',
            before: firstWrite.row as Record<string, unknown>,
            after: firstWrite.after,
          }),
        );
      }
    }

    return NextResponse.json(describePlan(true));
  } catch (err) {
    console.error('PATCH /api/venue/visits/[groupBookingId]/schedule failed:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
