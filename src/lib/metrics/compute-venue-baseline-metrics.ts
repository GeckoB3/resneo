import type { SupabaseClient } from '@supabase/supabase-js';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import {
  isScheduleModificationPayload,
  type BookingModificationActor,
} from '@/lib/booking/log-booking-modified-event';
import type { VenueBaselineMetrics } from '@/lib/metrics/baseline-metrics-types';

const APPOINTMENT_MODELS = new Set(['practitioner_appointment', 'unified_scheduling']);
const MODIFICATION_MESSAGE_TYPES = ['booking_modification_email', 'booking_modification_sms'] as const;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function roundPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((1000 * numerator) / denominator) / 10;
}

function isAppointmentRow(row: Parameters<typeof inferBookingRowModel>[0]): boolean {
  return APPOINTMENT_MODELS.has(inferBookingRowModel(row));
}

export interface ComputeVenueBaselineMetricsOptions {
  /** When true, restrict booking-level metrics to appointment scheduling rows. */
  appointmentsOnly?: boolean;
}

/**
 * Computes P0.6 baseline metrics for a venue and date range (inclusive booking_date).
 */
export async function computeVenueBaselineMetrics(
  admin: SupabaseClient,
  venueId: string,
  from: string,
  to: string,
  options: ComputeVenueBaselineMetricsOptions = {},
): Promise<VenueBaselineMetrics> {
  const appointmentsOnly = options.appointmentsOnly ?? true;
  const scope = appointmentsOnly ? 'appointments' : 'all';
  const periodStartIso = `${from}T00:00:00.000Z`;
  const periodEndIso = `${to}T23:59:59.999Z`;

  const { data: bookingRows, error: bookingsErr } = await admin
    .from('bookings')
    .select(
      'id, guest_id, status, source, booking_date, booking_model, experience_event_id, class_instance_id, resource_id, event_session_id, calendar_id, service_item_id, practitioner_id, appointment_service_id, created_at, updated_at',
    )
    .eq('venue_id', venueId)
    .gte('booking_date', from)
    .lte('booking_date', to);

  if (bookingsErr) {
    console.error('[baseline-metrics] bookings query failed:', bookingsErr.message, { venueId, from, to });
    throw new Error('Failed to load bookings for baseline metrics');
  }

  const scopedBookings = (bookingRows ?? []).filter((r) =>
    appointmentsOnly ? isAppointmentRow(r) : true,
  );
  const scopedBookingIds = new Set(scopedBookings.map((r) => r.id as string));

  const nonWalkIn = scopedBookings.filter((r) => r.source !== 'walk-in');
  const noShowCount = nonWalkIn.filter((r) => r.status === 'No-Show').length;
  const eligibleStatuses = new Set(['No-Show', 'Seated', 'Completed']);
  const eligibleCount = nonWalkIn.filter((r) => eligibleStatuses.has(String(r.status))).length;

  const [{ data: modEvents, error: modErr }, { data: staffFlowEvents, error: staffFlowErr }] =
    await Promise.all([
      admin
        .from('events')
        .select('id, booking_id, payload, created_at')
        .eq('venue_id', venueId)
        .eq('event_type', 'booking_modified')
        .gte('created_at', periodStartIso)
        .lte('created_at', periodEndIso),
      admin
        .from('events')
        .select('id, booking_id, payload, created_at')
        .eq('venue_id', venueId)
        .eq('event_type', 'staff_booking_flow_completed')
        .gte('created_at', periodStartIso)
        .lte('created_at', periodEndIso),
    ]);

  if (modErr) console.error('[baseline-metrics] modification events failed:', modErr.message, { venueId });
  if (staffFlowErr) {
    console.error('[baseline-metrics] staff flow events failed:', staffFlowErr.message, { venueId });
  }

  const scheduleMods = (modEvents ?? []).filter((e) => {
    if (!scopedBookingIds.has(e.booking_id as string)) return false;
    const payload = (e.payload ?? {}) as { before?: unknown; after?: unknown };
    return isScheduleModificationPayload(payload as Parameters<typeof isScheduleModificationPayload>[0]);
  });

  const modBookingIds = [...new Set(scheduleMods.map((e) => e.booking_id as string))];
  let modificationNotificationsCount = 0;
  if (modBookingIds.length > 0) {
    const { data: commRows, error: commErr } = await admin
      .from('communication_logs')
      .select('booking_id, message_type, status')
      .in('booking_id', modBookingIds)
      .in('message_type', [...MODIFICATION_MESSAGE_TYPES]);
    if (commErr) {
      console.error('[baseline-metrics] communication_logs failed:', commErr.message, { venueId });
    } else {
      const notifiedBookings = new Set<string>();
      for (const row of commRows ?? []) {
        const status = String(row.status ?? '').toLowerCase();
        if (status === 'sent' || status === 'delivered') {
          notifiedBookings.add(row.booking_id as string);
        }
      }
      modificationNotificationsCount = notifiedBookings.size;
    }
  }

  let guestSelf = 0;
  let staffMod = 0;
  let unknownActor = 0;
  for (const e of scheduleMods) {
    const actor = (e.payload as { modification_actor?: BookingModificationActor } | null)
      ?.modification_actor;
    if (actor === 'guest') guestSelf += 1;
    else if (actor === 'staff') staffMod += 1;
    else unknownActor += 1;
  }
  const knownActorMods = guestSelf + staffMod;

  const cancelledWithGuest = scopedBookings.filter(
    (r) => r.status === 'Cancelled' && r.guest_id != null,
  );
  const cancelGuestIds = [...new Set(cancelledWithGuest.map((r) => r.guest_id as string))];

  const rebookGapsHours: number[] = [];
  let rebooked7 = 0;
  let rebooked30 = 0;

  if (cancelGuestIds.length > 0) {
    const { data: allGuestBookings, error: guestBookErr } = await admin
      .from('bookings')
      .select(
        'id, guest_id, status, created_at, booking_date, booking_model, experience_event_id, class_instance_id, resource_id, event_session_id, calendar_id, service_item_id, practitioner_id, appointment_service_id',
      )
      .eq('venue_id', venueId)
      .in('guest_id', cancelGuestIds)
      .gte('created_at', periodStartIso)
      .order('created_at', { ascending: true });

    if (guestBookErr) {
      console.error('[baseline-metrics] guest rebook query failed:', guestBookErr.message, { venueId });
    } else {
      const byGuest = new Map<string, Array<{ id: string; status: string; created_at: string }>>();
      for (const row of allGuestBookings ?? []) {
        if (appointmentsOnly && !isAppointmentRow(row)) continue;
        const gid = row.guest_id as string;
        const list = byGuest.get(gid) ?? [];
        list.push({
          id: row.id as string,
          status: String(row.status),
          created_at: String(row.created_at),
        });
        byGuest.set(gid, list);
      }

      for (const cancelRow of cancelledWithGuest) {
        const guestId = cancelRow.guest_id as string;
        const cancelAt = new Date(String(cancelRow.updated_at ?? cancelRow.created_at)).getTime();
        const later = (byGuest.get(guestId) ?? []).filter(
          (b) =>
            b.id !== cancelRow.id &&
            b.status !== 'Cancelled' &&
            new Date(b.created_at).getTime() > cancelAt,
        );
        if (later.length === 0) continue;
        const next = later[0]!;
        const gapMs = new Date(next.created_at).getTime() - cancelAt;
        const gapHours = gapMs / (1000 * 60 * 60);
        rebookGapsHours.push(gapHours);
        if (gapHours <= 7 * 24) rebooked7 += 1;
        if (gapHours <= 30 * 24) rebooked30 += 1;
      }
    }
  }

  const cancelCount = cancelledWithGuest.length;
  const staffDurations: number[] = [];
  const returningDurations: number[] = [];
  for (const e of staffFlowEvents ?? []) {
    const flowBookingId = (e as { booking_id?: string }).booking_id;
    if (appointmentsOnly && flowBookingId && !scopedBookingIds.has(flowBookingId)) continue;
    const payload = e.payload as { duration_ms?: number; returning_guest?: boolean } | null;
    const ms = payload?.duration_ms;
    if (typeof ms === 'number' && ms > 0 && ms < 30 * 60 * 1000) {
      staffDurations.push(ms);
      if (payload?.returning_guest === true) returningDurations.push(ms);
    }
  }

  const modificationsCount = scheduleMods.length;

  return {
    period: { from, to },
    scope,
    no_show: {
      no_show_count: noShowCount,
      eligible_count: eligibleCount,
      rate_pct: roundPct(noShowCount, eligibleCount),
    },
    reschedule: {
      modifications_count: modificationsCount,
      modification_notifications_count: modificationNotificationsCount,
      reschedule_via_email_rate_pct: roundPct(modificationNotificationsCount, modificationsCount),
      guest_self_reschedule_count: guestSelf,
      staff_reschedule_count: staffMod,
      unknown_actor_reschedule_count: unknownActor,
      guest_self_reschedule_rate_pct: roundPct(guestSelf, knownActorMods),
    },
    cancellation_rebook: {
      cancellations_with_guest: cancelCount,
      rebooked_within_7d: rebooked7,
      rebooked_within_30d: rebooked30,
      rebook_rate_7d_pct: roundPct(rebooked7, cancelCount),
      rebook_rate_30d_pct: roundPct(rebooked30, cancelCount),
      median_rebook_gap_hours:
        rebookGapsHours.length > 0
          ? Math.round((median(rebookGapsHours.map((h) => h)) ?? 0) * 10) / 10
          : null,
      p75_rebook_gap_hours:
        rebookGapsHours.length > 0
          ? Math.round((percentile(rebookGapsHours, 75) ?? 0) * 10) / 10
          : null,
    },
    staff_time_to_book: {
      sample_count: staffDurations.length,
      median_duration_ms: median(staffDurations),
      p75_duration_ms: percentile(staffDurations, 75),
      returning_guest: {
        sample_count: returningDurations.length,
        median_duration_ms: median(returningDurations),
      },
    },
    computed_at: new Date().toISOString(),
  };
}
