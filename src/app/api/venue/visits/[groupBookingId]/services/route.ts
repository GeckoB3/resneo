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
  planVisitServices,
  type CatalogueServiceForVisit,
  type RequestedVisitService,
  type VisitServiceRowState,
} from '@/lib/booking/visit-services-plan';
import { validateAppointmentModificationInterval } from '@/lib/booking/validate-appointment-modification';
import { bookingEndFieldsForStorage } from '@/lib/booking/booking-end-time';
import { resolveBookingTotalPenceFromRow } from '@/lib/booking/payment-summary';
import {
  fitProcessingBlocksToDuration,
  parseProcessingTimeBlocksFromDb,
  processingBlocksForDurationChange,
  effectiveProcessingBlocksForTemplate,
} from '@/lib/appointments/processing-time';
import {
  checkBookingCompliance,
  complianceUnmetMessage,
  COMPLIANCE_REQUIREMENT_UNMET,
} from '@/lib/compliance/enforce-booking';
import { cancelOpenDepositIntentForBookings } from '@/lib/booking/cancel-open-deposit-intent';
import {
  resetVisitScheduledComms,
  visitCancellationFields,
} from '@/lib/booking/visit-write-shared';

/** The statuses that put a service on the calendar; see the schedule route. */
const SCHEDULED_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

const bodySchema = z.object({
  /**
   * The visit's services, in order. A line with `booking_id` keeps that row (and
   * re-services it when `service_id` differs); a line without one adds a service.
   * Rows of the visit left out of the list are removed from it.
   */
  services: z
    .array(
      z.object({
        booking_id: z.string().uuid().optional().nullable(),
        service_id: z.string().uuid(),
        service_variant_id: z.string().uuid().optional().nullable(),
      }),
    )
    /**
     * An empty list is deliberately allowed through: the planner answers it with
     * a sentence staff can act on ("cancel it instead"), where the schema's own
     * refusal is "Too small: expected array to have >=1 items".
     */
    .max(12),
  /**
   * Every scheduled row of the visit as the caller last saw it.
   *
   * Omission is how this endpoint removes a service, which makes a stale list
   * destructive: a caller that planned against three services and saves after a
   * fourth appears would cancel that fourth without ever having seen it. The
   * per-row `updated_at` guards cannot catch that, because the row the caller
   * never knew about is the one being dropped. Required, and checked against the
   * visit as it stands.
   */
  known_booking_ids: z
    .array(z.string().uuid(), {
      error: 'Reopen this visit and try again: its services could not be confirmed.',
    })
    .min(1)
    .max(12),
  /**
   * The visit's schedule, when the same edit moves it. Sent together so a
   * staff member who re-services a visit AND moves it still gets one write that
   * either lands whole or does not land.
   */
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  booking_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  practitioner_id: z.string().uuid().optional(),
  allow_manual_overlap: z.boolean().optional(),
  allow_outside_hours: z.boolean().optional(),
  /**
   * Staff placement over a break. Separate from the flag above on purpose: the
   * engine has never let `allowOutsideHours` relax its break check. See the
   * sibling `schedule` route for why this arrived a round late (SA-H5).
   */
  allow_during_breaks: z.boolean().optional(),
  /** Plan and check without writing, so the form judges what the save will do. */
  dry_run: z.boolean().optional(),
  /** The caller will fire the guest notification itself. */
  defer_modification_guest_notification: z.boolean().optional(),
  skip_booking_modification_guest_notification: z.boolean().optional(),
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

function durationOfRow(row: BookingRow): number {
  const start = String(row.booking_time).slice(0, 5);
  const end = row.booking_end_time ? String(row.booking_end_time).slice(0, 5) : null;
  const toMin = (hm: string) => {
    const [h, m] = hm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  if (!end) return 30;
  const span = toMin(end) - toMin(start);
  return span > 0 ? span : span + 1440;
}

/**
 * PATCH /api/venue/visits/[groupBookingId]/services
 *
 * Add, remove, swap or reorder the services of a multi-service visit.
 *
 * The list is declarative: what comes in is what the visit will be. Every line is
 * laid out from the visit's start, checked against the availability engine, and
 * only then written, so a visit cannot end up half re-serviced any more than it
 * can end up half moved (workstream 5's rule, applied to its contents).
 *
 * See Docs/multi-service-visit-plan.md, workstream 3b.
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
      console.error('Visit services load failed:', rowsErr);
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
        { error: 'This visit has no services left to change.' },
        { status: 409 },
      );
    }
    if (allRows.some((r) => typeof r.person_label === 'string' && r.person_label.trim() !== '')) {
      // A party shares the same group id and is several people, not one visit.
      return NextResponse.json(
        { error: 'These bookings are not a single visit, so their services cannot be edited here.' },
        { status: 409 },
      );
    }

    /**
     * The caller must be looking at the visit it is about to rewrite. Omission
     * removes a service here, so a list built against a visit that has since
     * gained or lost one would cancel a service nobody chose to cancel.
     */
    const currentIds = new Set(rows.map((r) => r.id));
    const knownIds = new Set(body.known_booking_ids);
    const staleView =
      currentIds.size !== knownIds.size || [...currentIds].some((id) => !knownIds.has(id));
    if (staleView) {
      return NextResponse.json(
        {
          error: 'This visit was changed somewhere else. Refresh and try again.',
          code: 'stale_visit',
        },
        { status: 412 },
      );
    }

    const loaded = await loadStaffAccessibleBooking(staff, rows[0]!.id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const { ownerVenueId: scopeVenueId, isOwnVenue, linkedGrant } = loaded.ctx;

    if (rows.some((r) => r.venue_id !== scopeVenueId)) {
      return NextResponse.json(
        { error: 'This visit spans more than one venue and cannot be edited as one.' },
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
    const calendarId = body.practitioner_id ?? currentCalendarId;
    if (!calendarId) {
      return NextResponse.json(
        { error: 'This visit is not on a calendar, so its services cannot be edited here.' },
        { status: 400 },
      );
    }
    if (isOwnVenue) {
      if (staff.role !== 'admin') {
        // Both calendars, for the same reason the schedule route checks both:
        // this endpoint can move a visit as well as re-service it.
        const scopedCalendarId = await resolveBookingScopedCalendarId(
          admin,
          scopeVenueId,
          rows[0]! as Parameters<typeof resolveBookingScopedCalendarId>[2],
        );
        if (!scopedCalendarId) {
          return NextResponse.json(
            {
              error:
                'This visit is not on a team calendar column tied to your permissions. Ask a venue admin to edit it.',
            },
            { status: 403 },
          );
        }
        for (const calId of new Set([scopedCalendarId, calendarId])) {
          const access = await requireManagedCalendarAccess(
            admin,
            scopeVenueId,
            staff,
            calId,
            'You can only edit visits on calendars assigned to your account.',
          );
          if (!access.ok) {
            return NextResponse.json({ error: access.error }, { status: 403 });
          }
        }
      }
    } else if (!linkedGrantAllowsCalendar(linkedGrant, false, calendarId)) {
      return NextResponse.json({ error: 'This link does not include that calendar.' }, { status: 403 });
    }

    /**
     * A visit's rows all sit on one schema: unified `service_item_id` throughout,
     * or the legacy `appointment_service_id`. The added rows follow the ones
     * already there rather than guessing from the venue.
     */
    const usesServiceItems = Boolean(rows[0]!.service_item_id);
    const serviceTable = usesServiceItems ? 'service_items' : 'appointment_services';
    const wantedServiceIds = new Set<string>(body.services.map((s) => s.service_id));
    for (const r of rows) {
      const sid = serviceIdOf(r);
      if (sid) wantedServiceIds.add(sid);
    }

    const [svcRes, variantRes, assignRes] = await Promise.all([
      admin
        .from(serviceTable)
        .select('id, name, duration_minutes, buffer_minutes, processing_time_blocks, is_active')
        .eq('venue_id', scopeVenueId)
        .in('id', [...wantedServiceIds]),
      admin
        .from('service_variants')
        .select('id, name, duration_minutes, is_active, processing_time_blocks, service_item_id, appointment_service_id')
        .eq('venue_id', scopeVenueId),
      usesServiceItems
        ? admin
            .from('calendar_service_assignments')
            .select('service_item_id, custom_duration_minutes')
            .eq('calendar_id', calendarId)
        : admin
            .from('practitioner_services')
            .select('service_id, custom_duration_minutes')
            .eq('practitioner_id', calendarId),
    ]);

    const serviceRows = (svcRes.data ?? []) as Array<Record<string, unknown>>;
    const variantRows = (variantRes.data ?? []) as Array<Record<string, unknown>>;
    const offeredIds = new Set(
      ((assignRes.data ?? []) as Array<Record<string, unknown>>).map((a) =>
        String(usesServiceItems ? a.service_item_id : a.service_id),
      ),
    );
    const customDurationByService = new Map<string, number>();
    for (const a of (assignRes.data ?? []) as Array<Record<string, unknown>>) {
      const sid = String(usesServiceItems ? a.service_item_id : a.service_id);
      const custom = a.custom_duration_minutes;
      if (typeof custom === 'number' && Number.isFinite(custom)) customDurationByService.set(sid, custom);
    }

    const catalogue = new Map<string, CatalogueServiceForVisit>();
    for (const svc of serviceRows) {
      const id = String(svc.id);
      const parentCol = usesServiceItems ? 'service_item_id' : 'appointment_service_id';
      catalogue.set(id, {
        id,
        name: String(svc.name ?? 'Service'),
        // A calendar's own length for the service wins, the way every other
        // appointment path resolves it.
        durationMinutes:
          customDurationByService.get(id) ?? Number(svc.duration_minutes ?? 30),
        bufferMinutes: Math.max(0, Number(svc.buffer_minutes ?? 0)),
        variants: variantRows
          .filter((v) => String(v[parentCol] ?? '') === id)
          .map((v) => ({
            id: String(v.id),
            durationMinutes: Number(v.duration_minutes ?? 0),
            isActive: v.is_active !== false,
          })),
      });
    }

    // A service the calendar does not offer cannot be added to its visit: the
    // engine would refuse it anyway, with a less useful message.
    for (const want of body.services) {
      if (!catalogue.has(want.service_id)) {
        return NextResponse.json(
          { error: 'One of the services chosen is not in this venue’s catalogue.' },
          { status: 409 },
        );
      }
      const svcRow = serviceRows.find((s) => String(s.id) === want.service_id);
      if (svcRow?.is_active === false) {
        return NextResponse.json(
          { error: `${catalogue.get(want.service_id)!.name} is no longer offered.` },
          { status: 409 },
        );
      }
      if (!offeredIds.has(want.service_id)) {
        return NextResponse.json(
          {
            error: `${catalogue.get(want.service_id)!.name} is not offered on this calendar, so it cannot be added to this visit.`,
          },
          { status: 409 },
        );
      }
    }

    const rowStates: VisitServiceRowState[] = rows.map((r) => ({
      id: r.id,
      serviceId: serviceIdOf(r),
      variantId: (r.service_variant_id as string | null) ?? null,
      name:
        (r.service_name_snapshot as string | null) ?? (r.booking_item_name as string | null) ?? null,
      startHm: String(r.booking_time).slice(0, 5),
      durationMinutes: durationOfRow(r),
    }));

    const requested: RequestedVisitService[] = body.services.map((s) => ({
      bookingId: s.booking_id ?? null,
      serviceId: s.service_id,
      variantId: s.service_variant_id ?? null,
    }));

    const planned = planVisitServices({
      rows: rowStates,
      requested,
      catalogue,
      startHm: body.booking_time ?? null,
    });
    if (!planned.ok) {
      return NextResponse.json({ error: planned.reason }, { status: 409 });
    }
    const plan = planned.plan;
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const currentDate = rows[0]!.booking_date;
    const bookingDate = body.booking_date ?? currentDate;
    const visitBookingIds = rows.map((r) => r.id);
    const calendarChanged = calendarId !== currentCalendarId;
    const visitStartChanged =
      bookingDate !== currentDate || plan.startHm !== rowStates[0]!.startHm.slice(0, 5);

    /**
     * Money already taken against a service is not something an edit may quietly
     * drop: refunds and their notifications belong to cancellation, which is a
     * deliberate act with its own rules.
     */
    if (plan.removedRowIds.length > 0) {
      const { data: ledger } = await admin
        .from('booking_payments')
        .select('booking_id, status')
        .in('booking_id', plan.removedRowIds);
      const paidRowIds = new Set(
        ((ledger ?? []) as Array<{ booking_id: string; status: string }>)
          .filter((p) => p.status === 'succeeded')
          .map((p) => p.booking_id),
      );
      for (const id of plan.removedRowIds) {
        const row = rowById.get(id)!;
        const depositPaid =
          row.deposit_status === 'Paid' ||
          (typeof row.deposit_amount_pence === 'number' &&
            row.deposit_amount_pence > 0 &&
            row.deposit_status !== 'Not Required');
        if (paidRowIds.has(id) || depositPaid) {
          const name = rowStates.find((r) => r.id === id)?.name ?? 'That service';
          return NextResponse.json(
            {
              error: `${name} has been paid for, so it cannot just be taken off the visit. Cancel that service on its own and the refund rules will run.`,
              service_id: id,
            },
            { status: 409 },
          );
        }
      }
    }

    /**
     * The blocks each line will carry: its own snapshot while it keeps its
     * service, otherwise the pattern of the service it is moving to, fitted to
     * the new length. A snapshot belongs to the service it was taken from.
     */
    const blocksForEntry = (entry: (typeof plan.entries)[number]): unknown[] | null => {
      const row = entry.bookingId ? rowById.get(entry.bookingId) : null;
      const svcRow = serviceRows.find((s) => String(s.id) === entry.serviceId);
      const variantRow = entry.variantId
        ? variantRows.find((v) => String(v.id) === entry.variantId)
        : null;
      const template = effectiveProcessingBlocksForTemplate({
        parentBlocks: parseProcessingTimeBlocksFromDb(svcRow?.processing_time_blocks),
        variantBlocks: variantRow
          ? parseProcessingTimeBlocksFromDb(variantRow.processing_time_blocks)
          : null,
      });
      if (entry.kind === 'keep' && row) {
        return processingBlocksForDurationChange({
          snapshot: row.processing_time_blocks,
          templateBlocks: template,
          durationMinutes: entry.durationMinutes,
        });
      }
      return fitProcessingBlocksToDuration(template, entry.durationMinutes).blocks;
    };

    const checks = await Promise.all(
      plan.entries.map(async (entry) => {
        const blocks = blocksForEntry(entry);
        const result = await validateAppointmentModificationInterval({
          admin,
          venueId: scopeVenueId,
          // Every row of the visit is excluded below, so an added service is
          // checked against everything except the visit it is joining.
          bookingId: entry.bookingId ?? rows[0]!.id,
          newDate: bookingDate,
          timeStr: entry.startHm,
          practId: calendarId,
          svcId: entry.serviceId,
          durationMinutes: entry.durationMinutes,
          serviceVariantId: entry.variantId,
          ...(blocks !== null ? { processingTimeBlocksOverride: blocks } : {}),
          allowManualOverlap: body.allow_manual_overlap === true,
          allowOutsideHours: body.allow_outside_hours === true,
          allowDuringBreaks: body.allow_during_breaks === true,
          excludeBookingIds: visitBookingIds,
        });
        return { entry, result };
      }),
    );

    const blocked = checks.find((c) => !c.result.ok);
    if (blocked) {
      const reason = blocked.result.ok ? '' : blocked.result.reason;
      return NextResponse.json(
        {
          error: `${blocked.entry.name} cannot go at ${blocked.entry.startHm}: ${reason}. The visit was not changed.`,
          service_id: blocked.entry.serviceId,
          reason,
        },
        { status: 409 },
      );
    }

    // A service being added or swapped in may carry its own compliance
    // requirement for this guest, the same gate the create and modify paths run.
    for (const entry of plan.entries) {
      if (entry.kind === 'keep') continue;
      const compliance = await checkBookingCompliance(admin, {
        venueId: scopeVenueId,
        guestId: (rows[0]!.guest_id as string | null) ?? null,
        appointmentServiceId: usesServiceItems ? null : entry.serviceId,
        serviceItemId: usesServiceItems ? entry.serviceId : null,
        bookingDate,
        bookingTime: entry.startHm,
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

    const describePlan = (changed: boolean) => ({
      ok: true as const,
      group_booking_id: groupBookingId,
      booking_date: bookingDate,
      start_time: plan.startHm,
      end_time: plan.endHm,
      total_minutes: plan.totalMinutes,
      changed,
      dry_run: body.dry_run === true,
      removed_booking_ids: plan.removedRowIds,
      services: plan.entries.map((e) => ({
        id: e.bookingId,
        kind: e.kind,
        service_id: e.serviceId,
        service_variant_id: e.variantId,
        name: e.name,
        booking_date: bookingDate,
        booking_time: `${e.startHm}:00`,
        booking_end_time: `${e.endHm}:00`,
        duration_minutes: e.durationMinutes,
      })),
    });

    if (!plan.changed && !visitStartChanged && !calendarChanged) {
      return NextResponse.json(describePlan(false));
    }
    if (body.dry_run === true) {
      return NextResponse.json(describePlan(true));
    }

    /**
     * Written row by row, with everything already written put back if one fails.
     * The inserts are removed rather than restored, since they had no previous
     * state to return to.
     */
    const updatedRows: BookingRow[] = [];
    const insertedIds: string[] = [];
    const cancelledIds: string[] = [];
    const rollback = async () => {
      for (const before of updatedRows) {
        const { error } = await admin
          .from('bookings')
          .update({
            booking_date: before.booking_date,
            booking_time: before.booking_time,
            booking_end_time: before.booking_end_time ?? null,
            estimated_end_time: (before.estimated_end_time as string | null) ?? null,
            processing_time_blocks: before.processing_time_blocks ?? null,
            status: before.status,
            ...(before.service_item_id != null
              ? { service_item_id: before.service_item_id }
              : { appointment_service_id: before.appointment_service_id }),
            service_variant_id: (before.service_variant_id as string | null) ?? null,
            service_name_snapshot: (before.service_name_snapshot as string | null) ?? null,
            service_variant_name_snapshot:
              (before.service_variant_name_snapshot as string | null) ?? null,
            booking_total_price_pence: (before.booking_total_price_pence as number | null) ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', before.id);
        if (error) console.error('Visit services rollback failed for booking', before.id, error);
      }
      if (insertedIds.length > 0) {
        const { error } = await admin.from('bookings').delete().in('id', insertedIds);
        if (error) console.error('Visit services rollback delete failed', error);
      }
    };

    const anchor = rows[0]!;
    /**
     * The visit's refund window follows its start, so an edit that moves it
     * re-pins the deadline exactly as the schedule endpoint does. Left alone
     * when only the services changed.
     */
    const cancellation = visitStartChanged
      ? await visitCancellationFields({
          admin,
          venueId: scopeVenueId,
          anchorRow: {
            service_item_id: (anchor.service_item_id as string | null) ?? null,
            appointment_service_id: (anchor.appointment_service_id as string | null) ?? null,
          },
          dateYmd: bookingDate,
          startHm: plan.startHm,
        })
      : null;

    for (const entry of plan.entries) {
      const endFields = bookingEndFieldsForStorage({
        dateYmd: bookingDate,
        startHHmm: entry.startHm,
        durationMinutes: entry.durationMinutes,
      });
      const blocks = blocksForEntry(entry);
      const svcRow = serviceRows.find((s) => String(s.id) === entry.serviceId);
      const variantRow = entry.variantId
        ? variantRows.find((v) => String(v.id) === entry.variantId)
        : null;

      if (entry.kind === 'add') {
        const insert: Record<string, unknown> = {
          venue_id: scopeVenueId,
          guest_id: anchor.guest_id,
          booking_date: bookingDate,
          booking_time: `${entry.startHm}:00`,
          booking_end_time: endFields.booking_end_time,
          estimated_end_time: endFields.estimated_end_time,
          party_size: 1,
          booking_model: anchor.booking_model,
          status: anchor.status,
          source: anchor.source,
          created_by_staff_id: staff.id,
          guest_email: anchor.guest_email,
          guest_first_name: anchor.guest_first_name,
          guest_last_name: anchor.guest_last_name,
          guest_phone: anchor.guest_phone,
          // A service added by staff is not a deposit-taking flow; the visit's
          // balance simply grows and is collected the usual way.
          deposit_amount_pence: null,
          deposit_status: 'Not Required',
          ...(cancellation ?? {
            cancellation_deadline: anchor.cancellation_deadline,
            cancellation_policy_snapshot: anchor.cancellation_policy_snapshot,
          }),
          group_booking_id: groupBookingId,
          person_label: null,
          service_variant_id: entry.variantId,
          processing_time_blocks: blocks ?? [],
          addons_total_price_pence: 0,
          addons_total_duration_minutes: 0,
          ...(usesServiceItems
            ? { calendar_id: calendarId, service_item_id: entry.serviceId }
            : { practitioner_id: calendarId, appointment_service_id: entry.serviceId }),
        };
        const { data: inserted, error: insErr } = await admin
          .from('bookings')
          .insert(insert)
          .select('id')
          .single();
        if (insErr || !inserted) {
          console.error('Visit service insert failed:', insErr);
          await rollback();
          return NextResponse.json({ error: 'Could not add that service' }, { status: 500 });
        }
        insertedIds.push(inserted.id as string);
        continue;
      }

      const row = rowById.get(entry.bookingId!)!;
      const update: Record<string, unknown> = {
        booking_date: bookingDate,
        booking_time: `${entry.startHm}:00`,
        booking_end_time: endFields.booking_end_time,
        estimated_end_time: endFields.estimated_end_time,
        updated_at: new Date().toISOString(),
        ...(blocks !== null ? { processing_time_blocks: blocks } : {}),
        ...(cancellation ?? {}),
        ...(calendarChanged
          ? row.calendar_id != null
            ? { calendar_id: calendarId }
            : { practitioner_id: calendarId }
          : {}),
      };

      if (entry.kind === 'swap') {
        /**
         * The visit keeps the price it was quoted. An appointment's price is
         * resolved live from the catalogue, so without pinning it here a swap
         * would silently re-price the booking, which is not what changing a
         * service is for. Only pinned when the old price is actually known.
         */
        if (
          row.booking_total_price_pence == null ||
          Number(row.booking_total_price_pence) <= 0
        ) {
          const previousTotal = await resolveBookingTotalPenceFromRow(admin, {
            booking_total_price_pence: row.booking_total_price_pence as number | null,
            service_variant_id: row.service_variant_id as string | null,
            addons_total_price_pence: row.addons_total_price_pence as number | null,
            venue_id: scopeVenueId,
            service_item_id: row.service_item_id as string | null,
            appointment_service_id: row.appointment_service_id as string | null,
            calendar_id: row.calendar_id as string | null,
            practitioner_id: row.practitioner_id as string | null,
          });
          if (previousTotal != null && previousTotal > 0) {
            update.booking_total_price_pence = previousTotal;
          }
        }
        if (usesServiceItems) {
          update.service_item_id = entry.serviceId;
        } else {
          update.appointment_service_id = entry.serviceId;
        }
        update.service_variant_id = entry.variantId;
        // `service_name_snapshot` is written by a trigger on INSERT only, and
        // every read prefers it, so a swapped row would keep saying the old
        // service's name forever.
        update.service_name_snapshot = svcRow?.name ?? entry.name;
        update.service_variant_name_snapshot = (variantRow?.name as string | null) ?? null;
      }

      const { data: updated, error: updErr } = await admin
        .from('bookings')
        .update(update)
        .eq('id', row.id)
        .eq('updated_at', row.updated_at)
        .select('id')
        .maybeSingle();
      if (updErr) {
        console.error('Visit service update failed:', updErr);
        await rollback();
        return NextResponse.json({ error: 'Could not change this visit' }, { status: 500 });
      }
      if (!updated) {
        await rollback();
        return NextResponse.json(
          {
            error: 'This visit was changed somewhere else. Refresh and try again.',
            code: 'stale_booking',
          },
          { status: 412 },
        );
      }
      updatedRows.push(row);
    }

    if (plan.removedRowIds.length > 0) {
      /**
       * Removed rows are cancelled rather than deleted: the payment picture
       * already leaves cancelled lines out of a visit's total, and the row keeps
       * its own history instead of vanishing from the guest's.
       */
      for (const id of plan.removedRowIds) {
        const before = rowById.get(id)!;
        const { error } = await admin
          .from('bookings')
          .update({
            status: 'Cancelled',
            cancelled_by_staff_id: staff.id,
            cancellation_actor_type: 'staff',
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('updated_at', before.updated_at);
        if (error) {
          console.error('Visit service removal failed:', error);
          await rollback();
          return NextResponse.json({ error: 'Could not remove that service' }, { status: 500 });
        }
        updatedRows.push(before);
        cancelledIds.push(id);
      }
      // A cancelled line must not leave a payment page that can still be paid.
      await cancelOpenDepositIntentForBookings(admin, {
        settledBookingIds: cancelledIds,
        venueId: scopeVenueId,
      });
    }

    if (visitStartChanged) {
      await resetVisitScheduledComms(admin, [
        ...visitBookingIds.filter((id) => !plan.removedRowIds.includes(id)),
        ...insertedIds,
      ]);
    }

    /**
     * The guest hears about a visit whose START moved, once, against its first
     * service, matching the schedule endpoint. A change to WHICH services the
     * visit holds does not notify on its own: the plan settles notification for
     * start moves only, and inventing a policy for service edits belongs with
     * whoever decides what that message should say.
     */
    if (
      visitStartChanged &&
      body.defer_modification_guest_notification !== true &&
      body.skip_booking_modification_guest_notification !== true
    ) {
      const notifyBookingId = plan.entries.find((e) => e.bookingId)?.bookingId ?? null;
      if (notifyBookingId) {
        after(async () => {
          try {
            const { executeBookingModificationGuestNotification } = await import(
              '@/lib/booking/send-booking-modification-guest-notification'
            );
            await executeBookingModificationGuestNotification(admin, scopeVenueId, notifyBookingId);
          } catch (commsErr) {
            console.error('Visit services notification failed:', commsErr);
          }
        });
      }
    }

    const { logBookingModifiedEvent } = await import('@/lib/booking/log-booking-modified-event');
    for (const entry of plan.entries) {
      if (!entry.bookingId || !entry.changed) continue;
      const before = rowById.get(entry.bookingId)!;
      await logBookingModifiedEvent(admin, {
        venue_id: scopeVenueId,
        booking_id: entry.bookingId,
        modification_actor: 'staff',
        before: {
          booking_date: before.booking_date,
          booking_time: String(before.booking_time).slice(0, 5),
          party_size: (before.party_size as number | null) ?? 1,
        },
        after: {
          booking_date: bookingDate,
          booking_time: entry.startHm,
          party_size: (before.party_size as number | null) ?? 1,
          booking_end_time: entry.endHm,
        },
      });
    }

    return NextResponse.json({
      ...describePlan(true),
      added_booking_ids: insertedIds,
    });
  } catch (err) {
    console.error('PATCH /api/venue/visits/[groupBookingId]/services failed:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
