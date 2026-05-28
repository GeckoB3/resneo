import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingEmailData } from '@/lib/emails/types';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import type { BookingModel } from '@/types/booking-models';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import { getVenueCommunicationPolicies } from '@/lib/communications/policies';
import { sendPolicyMessage } from '@/lib/communications/outbound';
import { isCdeBookingRow } from '@/lib/booking/cde-booking';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import type { CronGuestInfo as GuestInfo, CronBookingRow as BookingRow } from '@/lib/cron/comms-types';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import {
  CRON_COMMS_TOLERANCE_MS,
  bookingCivilDatesForPostVisitWindow,
  bookingCivilDatesForReminderWindow,
  msSinceBookingStartUtc,
  msUntilBookingStartUtc,
} from '@/lib/cron/comms-timing';

const BOOKING_APPOINTMENT_FK_COLUMNS =
  'event_session_id, calendar_id, service_item_id, practitioner_id, appointment_service_id';

const BOOKING_SELECT_BASE =
  `id, venue_id, guest_id, booking_model, guest_email, booking_date, booking_time, party_size, special_requests, dietary_notes, deposit_amount_pence, deposit_status, cancellation_deadline, status, experience_event_id, class_instance_id, resource_id, ${BOOKING_APPOINTMENT_FK_COLUMNS}, guest:guests(first_name, last_name, email, phone)`;
const BOOKING_SELECT_WITH_SUPPRESS =
  `id, venue_id, guest_id, booking_model, guest_email, booking_date, booking_time, party_size, special_requests, dietary_notes, deposit_amount_pence, deposit_status, cancellation_deadline, status, experience_event_id, class_instance_id, resource_id, suppress_import_comms, ${BOOKING_APPOINTMENT_FK_COLUMNS}, guest:guests(first_name, last_name, email, phone)`;

export interface UnifiedCommsResults {
  unified_reminder_1: number;
  unified_reminder_2: number;
  unified_post_visit: number;
  errors: number;
}

export interface SecondaryModelCommsResults {
  cde_reminder_1: number;
  cde_reminder_2: number;
  cde_post_visit: number;
  errors: number;
}

function normalizeBookings(rows: unknown[]): BookingRow[] {
  return rows.map((entry) => {
    const row = entry as Record<string, unknown>;
    const rawGuest = row.guest;
    let guest: GuestInfo | null = null;
    if (Array.isArray(rawGuest) && rawGuest.length > 0) {
      guest = rawGuest[0] as GuestInfo;
    } else if (rawGuest && typeof rawGuest === 'object' && !Array.isArray(rawGuest)) {
      guest = rawGuest as GuestInfo;
    }
    return { ...row, guest } as BookingRow;
  });
}

async function fetchCronBookings(opts: {
  supabase: SupabaseClient;
  venueId: string;
  dates: string[];
  statuses: string[];
}): Promise<BookingRow[]> {
  const buildQuery = (select: string) => {
    const query = opts.supabase
      .from('bookings')
      .select(select)
      .eq('venue_id', opts.venueId)
      .in('booking_date', opts.dates);

    if (opts.statuses.length === 1) {
      return query.eq('status', opts.statuses[0]!);
    }
    return query.in('status', opts.statuses);
  };

  const result = await buildQuery(BOOKING_SELECT_WITH_SUPPRESS);
  if (!result.error) {
    return normalizeBookings(result.data ?? []);
  }

  const errorText = `${result.error.message ?? ''} ${result.error.details ?? ''}`.toLowerCase();
  if (!errorText.includes('suppress_import_comms')) {
    throw result.error;
  }

  console.warn(
    '[scheduled-comms] bookings.suppress_import_comms not available; retrying without import suppression column',
  );
  const fallback = await buildQuery(BOOKING_SELECT_BASE);
  if (fallback.error) {
    throw fallback.error;
  }
  return normalizeBookings(fallback.data ?? []);
}

/** Appointment FKs on a row stored as `table_reservation` (legacy mis-tag) at an appointment venue. */
function rowHasAppointmentProductFks(row: BookingRow): boolean {
  return Boolean(
    row.event_session_id ||
    (row.calendar_id && row.service_item_id) ||
    (row.practitioner_id && row.appointment_service_id),
  );
}

function deriveBookingModel(
  row: BookingRow,
  venuePrimaryModel: string | null | undefined,
): BookingModel {
  const stored = row.booking_model;
  if (
    stored === 'table_reservation' &&
    isUnifiedSchedulingVenue(venuePrimaryModel) &&
    rowHasAppointmentProductFks(row)
  ) {
    if (row.event_session_id || (row.calendar_id && row.service_item_id)) {
      return 'unified_scheduling';
    }
    if (row.practitioner_id && row.appointment_service_id) {
      return 'practitioner_appointment';
    }
  }
  return inferBookingRowModel({
    booking_model: row.booking_model,
    experience_event_id: row.experience_event_id,
    class_instance_id: row.class_instance_id,
    resource_id: row.resource_id,
    event_session_id: row.event_session_id,
    calendar_id: row.calendar_id,
    service_item_id: row.service_item_id,
    practitioner_id: row.practitioner_id,
    appointment_service_id: row.appointment_service_id,
  });
}

function isUnifiedAppointmentBookingRow(
  row: BookingRow,
  venuePrimaryModel: string | null | undefined,
): boolean {
  const model = deriveBookingModel(row, venuePrimaryModel);
  return model === 'unified_scheduling' || model === 'practitioner_appointment';
}

function modelListIncludes(raw: unknown, model: BookingModel): boolean {
  return Array.isArray(raw) && raw.includes(model);
}

function venueSupportsUnifiedSchedulingComms(venue: {
  booking_model?: string | null;
  enabled_models?: unknown;
  active_booking_models?: unknown;
  pricing_tier?: string | null;
}): boolean {
  if (isAppointmentPlanTier(venue.pricing_tier)) return true;
  if (venue.booking_model === 'practitioner_appointment' || venue.booking_model === 'unified_scheduling') {
    return true;
  }
  return (
    modelListIncludes(venue.enabled_models, 'unified_scheduling') ||
    modelListIncludes(venue.active_booking_models, 'unified_scheduling') ||
    modelListIncludes(venue.active_booking_models, 'practitioner_appointment')
  );
}

function buildBookingData(
  row: BookingRow,
  venuePrimaryModel: string | null | undefined,
): BookingEmailData {
  return {
    id: row.id,
    guest_name: formatGuestDisplayName(row.guest?.first_name, row.guest?.last_name),
    guest_email: row.guest?.email ?? row.guest_email ?? null,
    guest_phone: row.guest?.phone ?? null,
    booking_date: row.booking_date,
    booking_time: row.booking_time.slice(0, 5),
    party_size: row.party_size,
    special_requests: row.special_requests,
    dietary_notes: row.dietary_notes,
    deposit_amount_pence: row.deposit_amount_pence,
    deposit_status: row.deposit_status,
    refund_cutoff: row.cancellation_deadline,
    booking_model: deriveBookingModel(row, venuePrimaryModel),
  };
}

async function runLaneReminder(opts: {
  supabase: SupabaseClient;
  venue: {
    id: string;
    name: string;
    address: string | null;
    phone?: string | null;
    timezone?: string | null;
    booking_model?: string | null;
  };
  messageKey: 'confirm_or_cancel_prompt' | 'pre_visit_reminder';
  resultsKey: 'unified_reminder_1' | 'unified_reminder_2' | 'cde_reminder_1' | 'cde_reminder_2';
  results: UnifiedCommsResults | SecondaryModelCommsResults;
  cdeOnly: boolean;
}) {
  const policy =
    (await getVenueCommunicationPolicies(opts.venue.id)).appointments_other[
      opts.messageKey
    ];
  if (!policy.enabled || policy.hoursBefore == null) return;

  const tz = opts.venue.timezone ?? 'Europe/London';
  const nowMs = Date.now();
  const targetMs = policy.hoursBefore * 60 * 60 * 1000;
  const dates = bookingCivilDatesForReminderWindow({
    venueTimeZone: tz,
    hoursBefore: policy.hoursBefore,
    toleranceMs: CRON_COMMS_TOLERANCE_MS,
    nowMs,
  });

  const rows = await fetchCronBookings({
    supabase: opts.supabase,
    venueId: opts.venue.id,
    dates,
    statuses: ['Pending', 'Booked', 'Confirmed'],
  });

  const venueData = venueRowToEmailData(opts.venue);
  for (const row of rows) {
    try {
      if (row.suppress_import_comms) continue;
      const isCde = isCdeBookingRow(row);
      if (opts.cdeOnly !== isCde) continue;
      if (!opts.cdeOnly && !isUnifiedAppointmentBookingRow(row, opts.venue.booking_model)) continue;

      const delta = msUntilBookingStartUtc(row.booking_date, row.booking_time, tz, nowMs);
      if (delta < targetMs - CRON_COMMS_TOLERANCE_MS || delta > targetMs + CRON_COMMS_TOLERANCE_MS) {
        continue;
      }

      let booking = buildBookingData(row, opts.venue.booking_model);
      const [manageLink, confirmLink] = await Promise.all([
        createOrGetBookingShortLink({
          venueId: row.venue_id,
          bookingId: row.id,
          purpose: 'manage',
        }),
        createOrGetBookingShortLink({
          venueId: row.venue_id,
          bookingId: row.id,
          purpose: 'confirm',
        }),
      ]);
      booking.manage_booking_link = manageLink;
      booking.confirm_cancel_link = confirmLink;
      booking = await enrichBookingEmailForComms(opts.supabase, row.id, booking);

      let sentAny = false;
      if (policy.channels.includes('email')) {
        const email = await sendPolicyMessage({
          venueId: opts.venue.id,
          booking,
          venue: venueData,
          messageKey: opts.messageKey,
          channel: 'email',
          mode: 'dedupe',
          confirmLink: booking.confirm_cancel_link ?? null,
          cancelLink: booking.confirm_cancel_link ?? null,
        });
        sentAny = sentAny || email.sent;
      }
      if (policy.channels.includes('sms')) {
        const sms = await sendPolicyMessage({
          venueId: opts.venue.id,
          booking,
          venue: venueData,
          messageKey: opts.messageKey,
          channel: 'sms',
          mode: 'dedupe',
          confirmLink: booking.confirm_cancel_link ?? null,
          cancelLink: booking.confirm_cancel_link ?? null,
        });
        sentAny = sentAny || sms.sent;
      }

      if (sentAny) {
        (
          opts.results as unknown as Record<
            'unified_reminder_1' | 'unified_reminder_2' | 'cde_reminder_1' | 'cde_reminder_2',
            number
          >
        )[opts.resultsKey]++;
      }
    } catch (error) {
      console.error('[lane reminder] booking failed:', row.id, error);
      opts.results.errors++;
    }
  }
}

async function runLanePostVisit(opts: {
  supabase: SupabaseClient;
  venue: {
    id: string;
    name: string;
    address: string | null;
    phone?: string | null;
    timezone?: string | null;
    booking_model?: string | null;
  };
  resultsKey: 'unified_post_visit' | 'cde_post_visit';
  results: UnifiedCommsResults | SecondaryModelCommsResults;
  cdeOnly: boolean;
}) {
  const policy =
    (await getVenueCommunicationPolicies(opts.venue.id)).appointments_other
      .post_visit_thankyou;
  if (!policy.enabled || policy.hoursAfter == null || !policy.channels.includes('email')) {
    return;
  }

  const tz = opts.venue.timezone ?? 'Europe/London';
  const nowMs = Date.now();
  const targetMs = policy.hoursAfter * 60 * 60 * 1000;
  const dates = bookingCivilDatesForPostVisitWindow({
    venueTimeZone: tz,
    hoursAfter: policy.hoursAfter,
    toleranceMs: CRON_COMMS_TOLERANCE_MS,
    nowMs,
  });

  const rows = await fetchCronBookings({
    supabase: opts.supabase,
    venueId: opts.venue.id,
    dates,
    statuses: ['Completed'],
  });

  const venueData = venueRowToEmailData(opts.venue);
  for (const row of rows) {
    try {
      if (row.suppress_import_comms) continue;
      const isCde = isCdeBookingRow(row);
      if (opts.cdeOnly !== isCde) continue;
      if (!opts.cdeOnly && !isUnifiedAppointmentBookingRow(row, opts.venue.booking_model)) continue;

      const delta = msSinceBookingStartUtc(row.booking_date, row.booking_time, tz, nowMs);
      if (delta < targetMs - CRON_COMMS_TOLERANCE_MS || delta > targetMs + CRON_COMMS_TOLERANCE_MS) {
        continue;
      }

      let booking = buildBookingData(row, opts.venue.booking_model);
      booking.manage_booking_link = await createOrGetBookingShortLink({
        venueId: row.venue_id,
        bookingId: row.id,
        purpose: 'manage',
      });
      booking = await enrichBookingEmailForComms(opts.supabase, row.id, booking);

      const email = await sendPolicyMessage({
        venueId: opts.venue.id,
        booking,
        venue: venueData,
        messageKey: 'post_visit_thankyou',
        channel: 'email',
        mode: 'dedupe',
        rebookLink: venueData.booking_page_url ?? null,
      });
      if (email.sent) {
        (
          opts.results as unknown as Record<'unified_post_visit' | 'cde_post_visit', number>
        )[opts.resultsKey]++;
      }
    } catch (error) {
      console.error('[lane post-visit] booking failed:', row.id, error);
      opts.results.errors++;
    }
  }
}

export async function runUnifiedSchedulingComms(
  supabase: SupabaseClient,
  results: UnifiedCommsResults,
): Promise<void> {
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, address, phone, timezone, booking_model, pricing_tier, enabled_models, active_booking_models, email, reply_to_email');

  for (const venue of venues ?? []) {
    if (!venueSupportsUnifiedSchedulingComms(venue)) continue;

    await runLaneReminder({
      supabase,
      venue,
      messageKey: 'confirm_or_cancel_prompt',
      resultsKey: 'unified_reminder_1',
      results,
      cdeOnly: false,
    });
    await runLaneReminder({
      supabase,
      venue,
      messageKey: 'pre_visit_reminder',
      resultsKey: 'unified_reminder_2',
      results,
      cdeOnly: false,
    });
    await runLanePostVisit({
      supabase,
      venue,
      resultsKey: 'unified_post_visit',
      results,
      cdeOnly: false,
    });
  }
}

export async function runSecondaryModelScheduledComms(
  supabase: SupabaseClient,
  results: SecondaryModelCommsResults,
): Promise<void> {
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, address, phone, timezone, booking_model, email, reply_to_email');

  for (const venue of venues ?? []) {
    await runLaneReminder({
      supabase,
      venue,
      messageKey: 'confirm_or_cancel_prompt',
      resultsKey: 'cde_reminder_1',
      results,
      cdeOnly: true,
    });
    await runLaneReminder({
      supabase,
      venue,
      messageKey: 'pre_visit_reminder',
      resultsKey: 'cde_reminder_2',
      results,
      cdeOnly: true,
    });
    await runLanePostVisit({
      supabase,
      venue,
      resultsKey: 'cde_post_visit',
      results,
      cdeOnly: true,
    });
  }
}
