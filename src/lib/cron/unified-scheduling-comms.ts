import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingEmailData } from '@/lib/emails/types';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import type { BookingModel } from '@/types/booking-models';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { enrichBookingEmailForAppointment } from '@/lib/emails/booking-email-enrichment';
import { getVenueCommunicationPolicies } from '@/lib/communications/policies';
import { sendPolicyMessage } from '@/lib/communications/outbound';
import { isCdeBookingRow } from '@/lib/booking/cde-booking';
import type { CronGuestInfo as GuestInfo, CronBookingRow as BookingRow } from '@/lib/cron/comms-types';

const TOLERANCE_MS = 15 * 60 * 1000;
const BOOKING_SELECT =
  'id, venue_id, guest_id, guest_email, booking_date, booking_time, party_size, special_requests, dietary_notes, deposit_amount_pence, deposit_status, cancellation_deadline, status, experience_event_id, class_instance_id, resource_id, suppress_import_comms, guest:guests(name, email, phone)';

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

function toVenueLocal(date: Date, tz: string): Date {
  const localeStr = date.toLocaleString('en-GB', { timeZone: tz });
  const [datePart, timePart] = localeStr.split(', ');
  const [d, m, y] = datePart!.split('/').map(Number);
  const [h, min, s] = timePart!.split(':').map(Number);
  return new Date(y!, m! - 1, d!, h!, min!, s!);
}

function localDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function bookingLocalMs(bookingDate: string, bookingTime: string): number {
  return new Date(`${bookingDate}T${bookingTime}`).getTime();
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

function deriveBookingModel(
  row: BookingRow,
  venuePrimaryModel: string | null | undefined,
): BookingModel {
  if (row.experience_event_id) return 'event_ticket';
  if (row.class_instance_id) return 'class_session';
  if (row.resource_id) return 'resource_booking';
  if (venuePrimaryModel === 'practitioner_appointment') {
    return 'practitioner_appointment';
  }
  return 'unified_scheduling';
}

function buildBookingData(
  row: BookingRow,
  venuePrimaryModel: string | null | undefined,
): BookingEmailData {
  return {
    id: row.id,
    guest_name: row.guest?.name ?? 'Guest',
    guest_email: row.guest_email ?? row.guest?.email ?? null,
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
  const nowLocal = toVenueLocal(new Date(), tz);
  const nowLocalMs = nowLocal.getTime();
  const targetMs = policy.hoursBefore * 60 * 60 * 1000;
  const windowStart = new Date(nowLocalMs + targetMs - TOLERANCE_MS);
  const windowEnd = new Date(nowLocalMs + targetMs + TOLERANCE_MS);
  const startDate = localDateStr(windowStart);
  const endDate = localDateStr(windowEnd);
  const dates = [startDate];
  if (endDate !== startDate) dates.push(endDate);

  const { data } = await opts.supabase
    .from('bookings')
    .select(BOOKING_SELECT)
    .eq('venue_id', opts.venue.id)
    .in('booking_date', dates)
    .in('status', ['Pending', 'Booked', 'Confirmed']);

  const venueData = venueRowToEmailData(opts.venue);
  for (const row of normalizeBookings(data ?? [])) {
    try {
      if (row.suppress_import_comms) continue;
      const isCde = isCdeBookingRow(row);
      if (opts.cdeOnly !== isCde) continue;

      const delta = bookingLocalMs(row.booking_date, row.booking_time) - nowLocalMs;
      if (delta < targetMs - TOLERANCE_MS || delta > targetMs + TOLERANCE_MS) {
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
      booking = await enrichBookingEmailForAppointment(opts.supabase, row.id, booking);

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
  const nowLocal = toVenueLocal(new Date(), tz);
  const nowLocalMs = nowLocal.getTime();
  const targetMs = policy.hoursAfter * 60 * 60 * 1000;
  const windowStart = new Date(nowLocalMs - targetMs - TOLERANCE_MS);
  const windowEnd = new Date(nowLocalMs - targetMs + TOLERANCE_MS);
  const startDate = localDateStr(windowStart);
  const endDate = localDateStr(windowEnd);
  const dates = [startDate];
  if (endDate !== startDate) dates.push(endDate);

  const { data } = await opts.supabase
    .from('bookings')
    .select(BOOKING_SELECT)
    .eq('venue_id', opts.venue.id)
    .in('booking_date', dates)
    .eq('status', 'Completed');

  const venueData = venueRowToEmailData(opts.venue);
  for (const row of normalizeBookings(data ?? [])) {
    try {
      if (row.suppress_import_comms) continue;
      const isCde = isCdeBookingRow(row);
      if (opts.cdeOnly !== isCde) continue;

      const delta = nowLocalMs - bookingLocalMs(row.booking_date, row.booking_time);
      if (delta < targetMs - TOLERANCE_MS || delta > targetMs + TOLERANCE_MS) {
        continue;
      }

      let booking = buildBookingData(row, opts.venue.booking_model);
      booking.manage_booking_link = await createOrGetBookingShortLink({
        venueId: row.venue_id,
        bookingId: row.id,
        purpose: 'manage',
      });
      booking = await enrichBookingEmailForAppointment(opts.supabase, row.id, booking);

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
    .select('id, name, address, phone, timezone, booking_model, email, reply_to_email')
    .in('booking_model', ['unified_scheduling', 'practitioner_appointment']);

  for (const venue of venues ?? []) {
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
