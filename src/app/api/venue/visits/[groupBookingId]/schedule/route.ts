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
import {
  planVisitSchedule,
  type PlannedVisitService,
  type VisitScheduleRow,
} from '@/lib/booking/visit-schedule-plan';
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
 * and must not be moved with the rest.
 */
const SCHEDULED_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hms = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

const bodySchema = z
  .object({
    /**
     * Move the WHOLE visit: every scheduled service moves by the same amount as
     * the visit's earliest one, keeping the gaps between them and any cross-day
     * offset. A calendar given here applies to every service. An empty object
     * is allowed and describes the visit as it stands (a dry run uses it to
     * learn the layout before anything is edited).
     */
    shift: z
      .object({
        booking_date: ymd.optional(),
        booking_time: hms.optional(),
        practitioner_id: z.string().uuid().optional(),
      })
      .optional(),
    /**
     * Change named services only. Each takes exactly the date, start, calendar
     * and length asked for; a service not named is left where it is. Shortening
     * one service no longer pulls the next one forward.
     */
    services: z
      .array(
        z.object({
          booking_id: z.string().uuid(),
          booking_date: ymd.optional(),
          booking_time: hms.optional(),
          practitioner_id: z.string().uuid().optional(),
          duration_minutes: z
            .number()
            .int()
            .min(MIN_APPOINTMENT_CORE_DURATION_MINUTES)
            .max(14 * 60)
            .optional(),
        }),
      )
      .min(1)
      .max(12)
      .optional(),
    /**
     * Every scheduled row of the visit as the caller last saw it. Optional here
     * (unlike the services endpoint, this route never removes a row), but a
     * caller writing per-service schedules should send it: an edit planned
     * against three services must not land on a visit that has since gained a
     * fourth nobody on that screen has seen.
     */
    known_booking_ids: z.array(z.string().uuid()).max(12).optional(),
    allow_manual_overlap: z.boolean().optional(),
    allow_outside_hours: z.boolean().optional(),
    /**
     * Staff placement over a break. A SEPARATE gate from the flag above,
     * because the engine has never let `allowOutsideHours` relax its break
     * check: a caller meaning "past closing" must not silently also mean "over
     * a break".
     */
    allow_during_breaks: z.boolean().optional(),
    /**
     * Plan and check every affected service, write nothing. The modify form's
     * live check and its save then judge the same request through the same
     * code, rather than the form validating each service on its own and hoping
     * the write agrees.
     */
    dry_run: z.boolean().optional(),
    /** The caller will fire the guest notification itself (undo window). */
    defer_modification_guest_notification: z.boolean().optional(),
    skip_booking_modification_guest_notification: z.boolean().optional(),
  })
  .refine((v) => (v.shift !== undefined) !== (v.services !== undefined), {
    message: 'Send either a shift for the whole visit or a list of services to change.',
  });

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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Venue-local "Wed 16 Sep" for a refusal that names another day. */
function describeDay(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/**
 * PATCH /api/venue/visits/[groupBookingId]/schedule
 *
 * Move a multi-service visit as one (`shift`), or change the schedule of some
 * of its services (`services`), as ONE write.
 *
 * A visit is N rows sharing a `group_booking_id`. Each row has its own date,
 * start, calendar and length, and the calendar moves them one at a time; this
 * route is for the edits that touch several at once, which must land whole or
 * not at all. Every affected service is planned, then checked against the
 * availability engine, then written, and a write that fails part-way puts back
 * the rows that already landed.
 *
 * See Docs/visit-services-independent-plan.md, part D.
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
      .sort((a, b) => `${a.booking_date}T${a.booking_time}`.localeCompare(`${b.booking_date}T${b.booking_time}`));
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
        { error: 'The services of this visit are on different ResNeo accounts, so it cannot be moved as one. Move each service on its own, or make a new booking on the other calendar and cancel this one.' },
        { status: 409 },
      );
    }
    if (!linkedGrantAllowsMutation(linkedGrant, isOwnVenue)) {
      return NextResponse.json(
        { error: 'This link does not allow editing the other venue’s bookings.' },
        { status: 403 },
      );
    }
    if (rows.some((r) => !calendarIdOf(r))) {
      return NextResponse.json(
        { error: 'This visit is not on a calendar, so it cannot be rescheduled here.' },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdminClient();
    const rowById = new Map(rows.map((r) => [r.id, r]));

    const planned = planVisitSchedule({
      rows: rows.map(
        (r): VisitScheduleRow => ({
          id: r.id,
          booking_date: r.booking_date,
          booking_time: r.booking_time,
          booking_end_time: r.booking_end_time ?? null,
          calendar_id: calendarIdOf(r),
          group_booking_id: groupBookingId,
          person_label: (r.person_label as string | null) ?? null,
          booking_item_name:
            (r.service_name_snapshot as string | null) ??
            (r.booking_item_name as string | null) ??
            null,
          addons_total_duration_minutes: (r.addons_total_duration_minutes as number | null) ?? 0,
        }),
      ),
      shift: body.shift ?? null,
      services: body.services ?? null,
      knownBookingIds: body.known_booking_ids ?? null,
    });
    if (!planned.ok) {
      if (planned.code === 'stale_visit') {
        return NextResponse.json({ error: planned.reason, code: 'stale_visit' }, { status: 412 });
      }
      return NextResponse.json({ error: planned.reason }, { status: 409 });
    }
    const plan = planned.plan;
    const targets = plan.services.filter((s) => s.changed);

    /**
     * One shape for every answer, so a dry run tells the form exactly what the
     * save would do: the same per-service slots, the same `changed`.
     */
    // Set once every service has been checked: true when the hours override is
    // what lets a service sit where it is going, so a dry run can say so.
    let outsideHours = false;
    const describePlan = (changed: boolean) => ({
      ok: true as const,
      group_booking_id: groupBookingId,
      booking_date: plan.startDateYmd,
      start_time: plan.startHm,
      end_date: plan.endDateYmd,
      end_time: plan.endHm,
      total_minutes: plan.totalMinutes,
      calendar_id: plan.calendarId,
      outside_hours: outsideHours,
      changed,
      dry_run: body.dry_run === true,
      services: plan.services.map((s) => ({
        id: s.id,
        name: s.name,
        // Carried so a caller that only has the visit's rows can drive the
        // services endpoint, which needs each line's service to say what the
        // visit is made of. The rows the booking list hands the UI have names,
        // not ids.
        service_id: serviceIdOf(rowById.get(s.id)!),
        service_variant_id: (rowById.get(s.id)!.service_variant_id as string | null) ?? null,
        booking_date: s.dateYmd,
        booking_time: `${s.startHm}:00`,
        booking_end_time: `${s.endHm}:00`,
        duration_minutes: s.durationMinutes,
        calendar_id: s.calendarId,
        moved: s.moved,
        changed: s.changed,
      })),
    });
    if (targets.length === 0) {
      return NextResponse.json(describePlan(false));
    }

    /**
     * Calendar access is checked for every calendar a changed service leaves
     * and every one it lands on. Gating only on the target would let a staff
     * member pull a colleague's service onto their own column, and gating only
     * on the source would let them push one onto anybody's.
     */
    if (isOwnVenue) {
      if (staff.role !== 'admin') {
        const calendarsToCheck = new Set<string>();
        for (const t of targets) {
          const scoped = await resolveBookingScopedCalendarId(
            admin,
            scopeVenueId,
            rowById.get(t.id)! as Parameters<typeof resolveBookingScopedCalendarId>[2],
          );
          if (!scoped) {
            return NextResponse.json(
              {
                error:
                  'This visit is not on a team calendar column tied to your permissions. Ask a venue admin to move it.',
              },
              { status: 403 },
            );
          }
          calendarsToCheck.add(scoped);
          if (t.calendarId) calendarsToCheck.add(t.calendarId);
        }
        for (const calId of calendarsToCheck) {
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
    } else {
      // §18 — every move TARGET must be in the link's scope, not just the
      // calendar the service sits on today. This route writes with the admin
      // client, so the RLS backstop never runs.
            for (const t of targets) {
        const current = rowById.get(t.id);
        const currentCalendarId =
          ((current?.calendar_id ?? current?.practitioner_id) as string | null | undefined) ?? null;
        if (
          !linkedGrantAllowsCalendar(linkedGrant, false, t.calendarId) ||
          !linkedGrantAllowsCalendar(linkedGrant, false, currentCalendarId)
        ) {
          return NextResponse.json(
            { error: 'This link does not include that calendar.' },
            { status: 403 },
          );
        }
      }
    }

    /**
     * Two services moved in the same request are each checked with the other
     * taken off the calendar (they are leaving their old slots), so their NEW
     * slots are compared here: landing on top of each other on one calendar
     * is a collision like any other.
     */
    if (body.allow_manual_overlap !== true) {
      const toMin = (hm: string): number => {
        const [h, m] = hm.split(':').map(Number);
        return (h ?? 0) * 60 + (m ?? 0);
      };
      for (let i = 0; i < targets.length; i += 1) {
        for (let j = i + 1; j < targets.length; j += 1) {
          const a = targets[i]!;
          const b = targets[j]!;
          if (a.dateYmd !== b.dateYmd || !a.calendarId || a.calendarId !== b.calendarId) continue;
          const aStart = toMin(a.startHm);
          const bStart = toMin(b.startHm);
          if (aStart < bStart + b.durationMinutes && bStart < aStart + a.durationMinutes) {
            const later = aStart <= bStart ? b : a;
            return NextResponse.json(
              {
                error: `${later.name ?? 'A service'} cannot go to ${later.startHm}: it would overlap ${
                  (later === a ? b : a).name ?? 'another service of this visit'
                }. Nothing on this visit was changed.`,
                service_id: later.id,
                reason: 'Overlaps another service of this visit',
              },
              { status: 409 },
            );
          }
        }
      }
    }

    /**
     * The catalogue pattern for each service, so a row whose length changes
     * carries processing blocks re-fitted to its new length rather than the
     * ones snapshotted against the old one.
     */
    const serviceItemIds = targets
      .map((t) => rowById.get(t.id)!.service_item_id as string | null)
      .filter((v): v is string => Boolean(v));
    const legacyServiceIds = targets
      .map((t) => rowById.get(t.id)!)
      .filter((r) => !r.service_item_id)
      .map((r) => r.appointment_service_id as string | null)
      .filter((v): v is string => Boolean(v));
    const [itemsRes, legacyRes] = await Promise.all([
      serviceItemIds.length > 0
        ? admin
            .from('service_items')
            .select('id, duration_minutes, processing_time_blocks')
            .in('id', serviceItemIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      legacyServiceIds.length > 0
        ? admin
            .from('appointment_services')
            .select('id, duration_minutes, processing_time_blocks')
            .in('id', legacyServiceIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);
    const catalogue = new Map<string, { duration_minutes: number; processing_time_blocks: unknown }>();
    for (const svc of [...(itemsRes.data ?? []), ...(legacyRes.data ?? [])] as Record<
      string,
      unknown
    >[]) {
      catalogue.set(svc.id as string, {
        duration_minutes: Math.max(0, (svc.duration_minutes as number | null) ?? 30),
        processing_time_blocks: svc.processing_time_blocks,
      });
    }

    const writes = targets.map((t) => {
      const row = rowById.get(t.id)!;
      const svcId = serviceIdOf(row);
      const cat = svcId ? catalogue.get(svcId) : undefined;
      const blocks = processingBlocksForDurationChange({
        snapshot: row.processing_time_blocks,
        currentDurationMinutes: t.previous.durationMinutes,
        templateBlocks: parseProcessingTimeBlocksFromDb(cat?.processing_time_blocks),
        templateDurationMinutes: cat?.duration_minutes ?? t.previous.durationMinutes,
        durationMinutes: t.durationMinutes,
      });
      return { schedule: t, row, svcId, blocks };
    });
    const missingService = writes.find((w) => !w.svcId);
    if (missingService) {
      return NextResponse.json(
        { error: 'A service on this visit has no service record, so it cannot be checked.' },
        { status: 409 },
      );
    }

    /**
     * Every changed service is checked before any is written. A service is
     * checked with its fellow MOVING services taken off the calendar, since
     * they are leaving the slots they hold; a sibling that stays put is a real
     * collision and is reported like any other, with `allow_manual_overlap` to
     * override it on purpose.
     */
    const movingIds = targets.map((t) => t.id);
    const checks = await Promise.all(
      writes.map(async (w) => {
        const result = await validateAppointmentModificationInterval({
          admin,
          venueId: scopeVenueId,
          bookingId: w.row.id,
          newDate: w.schedule.dateYmd,
          timeStr: w.schedule.startHm,
          practId: w.schedule.calendarId!,
          svcId: w.svcId!,
          durationMinutes: w.schedule.durationMinutes,
          bookingServiceVariantId: (w.row.service_variant_id as string | null) ?? null,
          bookingProcessingSnapshot: w.row.processing_time_blocks,
          ...(w.blocks !== null ? { processingTimeBlocksOverride: w.blocks } : {}),
          allowManualOverlap: body.allow_manual_overlap === true,
          allowOutsideHours: body.allow_outside_hours === true,
          allowDuringBreaks: body.allow_during_breaks === true,
          excludeBookingIds: movingIds,
        });
        return { w, result };
      }),
    );
    const blocked = checks.find((c) => !c.result.ok);
    if (blocked) {
      const s = blocked.w.schedule;
      const name = s.name ?? 'A service';
      const reason = blocked.result.ok ? '' : blocked.result.reason;
      const where =
        s.dateYmd !== s.previous.dateYmd ? `${s.startHm} on ${describeDay(s.dateYmd)}` : s.startHm;
      return NextResponse.json(
        {
          error: `${name} cannot go to ${where}: ${reason}. Nothing on this visit was changed.`,
          service_id: blocked.w.row.id,
          reason,
        },
        { status: 409 },
      );
    }
    outsideHours = checks.some((c) => c.result.ok && c.result.outsideHours);

    for (const w of writes) {
      if (!w.schedule.moved) continue;
      // A per-visit record was completed for THIS booking, so it moves with the
      // service. Runs before the gate, which would otherwise reject the
      // reschedule on the consent signed for the date being left behind. Skipped
      // on a dry run, which must not write: the trade-off is that a dry run can
      // still report a per-visit block that the real save would clear.
      if (body.dry_run !== true) {
        await rescheduleBookingComplianceRecords(admin, {
          venueId: scopeVenueId,
          bookingId: w.row.id,
          newBookingDate: w.schedule.dateYmd,
        });
      }
      const compliance = await checkBookingCompliance(admin, {
        venueId: scopeVenueId,
        guestId: (w.row.guest_id as string | null) ?? null,
        appointmentServiceId: (w.row.appointment_service_id as string | null) ?? null,
        serviceItemId: (w.row.service_item_id as string | null) ?? null,
        bookingDate: w.schedule.dateYmd,
        bookingTime: w.schedule.startHm,
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

    if (body.dry_run === true) {
      return NextResponse.json(describePlan(true));
    }

    /**
     * One cancellation deadline for the whole visit, pinned to its earliest
     * service. When that slot moves, every scheduled row is re-pinned, the
     * unchanged ones included: a row keeping a deadline computed against a
     * start the visit no longer has would enforce a window its own stored
     * policy no longer matches.
     */
    const firstRow = rowById.get(plan.services[0]!.id)!;
    const cancellation = plan.visitStartChanged
      ? await visitCancellationFields({
          admin,
          venueId: scopeVenueId,
          anchorRow: {
            service_item_id: (firstRow.service_item_id as string | null) ?? null,
            appointment_service_id: (firstRow.appointment_service_id as string | null) ?? null,
          },
          dateYmd: plan.startDateYmd,
          startHm: plan.startHm,
        })
      : null;

    /**
     * Written one row at a time, because a visit's rows are separate bookings
     * with separate optimistic-concurrency guards. A row that fails puts the
     * rows already written back where they were: the endpoint exists so a visit
     * cannot be left half changed, and it must not do that itself.
     */
    const written: { row: BookingRow; after: Record<string, unknown>; schedule: PlannedVisitService | null }[] = [];
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
    const writeRow = async (
      row: BookingRow,
      update: Record<string, unknown>,
      schedule: PlannedVisitService | null,
    ): Promise<NextResponse | null> => {
      const { data: updated, error: updErr } = await admin
        .from('bookings')
        .update(update)
        .eq('id', row.id)
        .eq('updated_at', row.updated_at)
        .select('*')
        .maybeSingle();
      if (updErr) {
        console.error('Visit schedule update failed:', updErr);
        await restoreWritten();
        return NextResponse.json({ error: 'Could not change this visit' }, { status: 500 });
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
      written.push({ row, after: updated as Record<string, unknown>, schedule });
      return null;
    };
    for (const w of writes) {
      const s = w.schedule;
      const endFields = bookingEndFieldsForStorage({
        dateYmd: s.dateYmd,
        startHHmm: s.startHm,
        durationMinutes: s.durationMinutes,
      });
      const update: Record<string, unknown> = {
        booking_date: s.dateYmd,
        booking_time: `${s.startHm}:00`,
        booking_end_time: endFields.booking_end_time,
        estimated_end_time: endFields.estimated_end_time,
        ...(cancellation ?? {}),
        updated_at: new Date().toISOString(),
        ...(w.blocks !== null ? { processing_time_blocks: w.blocks } : {}),
        ...(s.calendarChanged
          ? w.row.calendar_id != null
            ? { calendar_id: s.calendarId }
            : { practitioner_id: s.calendarId }
          : {}),
      };
      const failed = await writeRow(w.row, update, s);
      if (failed) return failed;
    }
    if (cancellation) {
      for (const s of plan.services) {
        if (s.changed) continue;
        const failed = await writeRow(
          rowById.get(s.id)!,
          { ...cancellation, updated_at: new Date().toISOString() },
          null,
        );
        if (failed) return failed;
      }
    }

    const { logBookingModifiedEvent } = await import('@/lib/booking/log-booking-modified-event');
    for (const w of writes) {
      await logBookingModifiedEvent(admin, {
        venue_id: scopeVenueId,
        booking_id: w.row.id,
        modification_actor: 'staff',
        before: {
          booking_date: w.row.booking_date,
          booking_time: w.row.booking_time.slice(0, 5),
          party_size: (w.row.party_size as number | null) ?? 1,
        },
        after: {
          booking_date: w.schedule.dateYmd,
          booking_time: w.schedule.startHm,
          party_size: (w.row.party_size as number | null) ?? 1,
          booking_end_time: w.schedule.endHm,
        },
      });
    }

    // Reminders are scheduled per row, so the rows that moved are the ones
    // whose reminders must re-trigger against the new time.
    const movedIds = targets.filter((t) => t.moved).map((t) => t.id);
    if (movedIds.length > 0) {
      await resetVisitScheduledComms(admin, movedIds);
    }

    /**
     * ONE notification for the visit, against its earliest service. A visit is
     * one appointment to the guest: three emails saying their booking moved
     * would be three times the same news.
     */
    if (
      plan.startChanged &&
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
      const changedWrites = written.filter((w) => w.schedule !== null);
      for (const w of changedWrites) {
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
      const firstWrite = changedWrites[0];
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
