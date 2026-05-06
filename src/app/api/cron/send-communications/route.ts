import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { enrichBookingEmailForAppointment } from '@/lib/emails/booking-email-enrichment';
import type { BookingEmailData } from '@/lib/emails/types';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { isCdeBookingRow } from '@/lib/booking/cde-booking';
import { runUnifiedSchedulingComms, runSecondaryModelScheduledComms } from '@/lib/cron/unified-scheduling-comms';
import { getVenueCommunicationPolicies } from '@/lib/communications/policies';
import { sendPolicyMessage } from '@/lib/communications/outbound';
import type { CronGuestInfo as GuestInfo, CronBookingRow as BookingRow } from '@/lib/cron/comms-types';

export async function GET(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const results = {
    reminders_56h: 0,
    day_of_reminders: 0,
    post_visit: 0,
    unified_reminder_1: 0,
    unified_reminder_2: 0,
    unified_post_visit: 0,
    cde_reminder_1: 0,
    cde_reminder_2: 0,
    cde_post_visit: 0,
    errors: 0,
  };

  const supabase = getSupabaseAdminClient();

  try {
    const unifiedResults = {
      unified_reminder_1: 0,
      unified_reminder_2: 0,
      unified_post_visit: 0,
      errors: 0,
    };
    const secondaryResults = {
      cde_reminder_1: 0,
      cde_reminder_2: 0,
      cde_post_visit: 0,
      errors: 0,
    };

    const [r1, r2, r3, u1, cdeRun] = await Promise.allSettled([
      sendConfirmOrCancelPrompts(results),
      sendPreVisitReminders(results),
      sendPostVisitThankYous(results),
      runUnifiedSchedulingComms(supabase, unifiedResults),
      runSecondaryModelScheduledComms(supabase, secondaryResults),
    ]);

    results.unified_reminder_1 = unifiedResults.unified_reminder_1;
    results.unified_reminder_2 = unifiedResults.unified_reminder_2;
    results.unified_post_visit = unifiedResults.unified_post_visit;
    results.errors += unifiedResults.errors;

    results.cde_reminder_1 = secondaryResults.cde_reminder_1;
    results.cde_reminder_2 = secondaryResults.cde_reminder_2;
    results.cde_post_visit = secondaryResults.cde_post_visit;
    results.errors += secondaryResults.errors;

    for (const result of [r1, r2, r3, u1, cdeRun]) {
      if (result.status === 'rejected') {
        console.error('[send-communications] sub-task failed:', result.reason);
        results.errors++;
      }
    }
  } catch (error) {
    console.error('[send-communications] top-level error:', error);
    results.errors++;
  }

  return NextResponse.json({ ok: true, ...results });
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

const BOOKING_SELECT =
  'id, venue_id, guest_id, guest_email, booking_date, booking_time, party_size, special_requests, dietary_notes, deposit_amount_pence, deposit_status, cancellation_deadline, status, experience_event_id, class_instance_id, resource_id, guest:guests(name, email, phone)';

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

function buildBookingData(row: BookingRow): BookingEmailData {
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
  };
}

async function sendConfirmOrCancelPrompts(results: {
  reminders_56h: number;
  errors: number;
}) {
  const supabase = getSupabaseAdminClient();
  const now = new Date();
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, address, phone, timezone, booking_model, email, reply_to_email');

  if (!venues?.length) return;

  for (const venue of venues) {
    try {
      if (isUnifiedSchedulingVenue((venue as { booking_model?: string }).booking_model)) {
        continue;
      }

      const policies = await getVenueCommunicationPolicies(venue.id);
      const policy = policies.table.confirm_or_cancel_prompt;
      if (!policy.enabled || policy.hoursBefore == null) continue;

      const tz = venue.timezone ?? 'Europe/London';
      const nowLocal = toVenueLocal(now, tz);
      const nowLocalMs = nowLocal.getTime();
      const toleranceMs = 15 * 60 * 1000;
      const targetMs = policy.hoursBefore * 60 * 60 * 1000;
      const windowStart = new Date(nowLocalMs + targetMs - toleranceMs);
      const windowEnd = new Date(nowLocalMs + targetMs + toleranceMs);
      const startDate = localDateStr(windowStart);
      const endDate = localDateStr(windowEnd);
      const dates = [startDate];
      if (endDate !== startDate) dates.push(endDate);

      const { data: bookings } = await supabase
        .from('bookings')
        .select(BOOKING_SELECT)
        .eq('venue_id', venue.id)
        .in('booking_date', dates)
        .in('status', ['Pending', 'Booked', 'Confirmed']);

      if (!bookings?.length) continue;

      const venueData = venueRowToEmailData(venue);
      for (const bookingRow of normalizeBookings(bookings)) {
        try {
          if (isCdeBookingRow(bookingRow)) continue;

          const delta = bookingLocalMs(
            bookingRow.booking_date,
            bookingRow.booking_time,
          ) - nowLocalMs;
          if (delta < targetMs - toleranceMs || delta > targetMs + toleranceMs) {
            continue;
          }

          let booking = buildBookingData(bookingRow);
          const [manageLink, confirmLink] = await Promise.all([
            createOrGetBookingShortLink({
              venueId: bookingRow.venue_id,
              bookingId: bookingRow.id,
              purpose: 'manage',
            }),
            createOrGetBookingShortLink({
              venueId: bookingRow.venue_id,
              bookingId: bookingRow.id,
              purpose: 'confirm',
            }),
          ]);
          booking.manage_booking_link = manageLink;
          booking.confirm_cancel_link = confirmLink;
          booking = await enrichBookingEmailForAppointment(supabase, bookingRow.id, booking);

          let sentAny = false;
          if (policy.channels.includes('email')) {
            const email = await sendPolicyMessage({
              venueId: venue.id,
              booking,
              venue: venueData,
              messageKey: 'confirm_or_cancel_prompt',
              channel: 'email',
              mode: 'dedupe',
              confirmLink: booking.confirm_cancel_link ?? null,
              cancelLink: booking.confirm_cancel_link ?? null,
            });
            sentAny = sentAny || email.sent;
          }
          if (policy.channels.includes('sms')) {
            const sms = await sendPolicyMessage({
              venueId: venue.id,
              booking,
              venue: venueData,
              messageKey: 'confirm_or_cancel_prompt',
              channel: 'sms',
              mode: 'dedupe',
              confirmLink: booking.confirm_cancel_link ?? null,
              cancelLink: booking.confirm_cancel_link ?? null,
            });
            sentAny = sentAny || sms.sent;
          }

          if (sentAny) results.reminders_56h++;
        } catch (error) {
          console.error('[confirm-cancel-reminder] booking failed:', bookingRow.id, error);
          results.errors++;
        }
      }
    } catch (error) {
      console.error('[confirm-cancel-reminder] venue failed:', venue.id, error);
      results.errors++;
    }
  }
}

async function sendPreVisitReminders(results: {
  day_of_reminders: number;
  errors: number;
}) {
  const supabase = getSupabaseAdminClient();
  const now = new Date();
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, address, phone, timezone, booking_model, email, reply_to_email');

  if (!venues?.length) return;

  for (const venue of venues) {
    try {
      if (isUnifiedSchedulingVenue((venue as { booking_model?: string }).booking_model)) {
        continue;
      }

      const policies = await getVenueCommunicationPolicies(venue.id);
      const policy = policies.table.pre_visit_reminder;
      if (!policy.enabled || policy.hoursBefore == null) continue;

      const tz = venue.timezone ?? 'Europe/London';
      const nowLocal = toVenueLocal(now, tz);
      const nowLocalMs = nowLocal.getTime();
      const toleranceMs = 15 * 60 * 1000;
      const targetMs = policy.hoursBefore * 60 * 60 * 1000;
      const windowStart = new Date(nowLocalMs + targetMs - toleranceMs);
      const windowEnd = new Date(nowLocalMs + targetMs + toleranceMs);
      const startDate = localDateStr(windowStart);
      const endDate = localDateStr(windowEnd);
      const dates = [startDate];
      if (endDate !== startDate) dates.push(endDate);

      const { data: bookings } = await supabase
        .from('bookings')
        .select(BOOKING_SELECT)
        .eq('venue_id', venue.id)
        .in('booking_date', dates)
        .in('status', ['Pending', 'Booked', 'Confirmed']);

      if (!bookings?.length) continue;

      const venueData = venueRowToEmailData(venue);
      for (const bookingRow of normalizeBookings(bookings)) {
        try {
          if (isCdeBookingRow(bookingRow)) continue;

          const delta = bookingLocalMs(
            bookingRow.booking_date,
            bookingRow.booking_time,
          ) - nowLocalMs;
          if (delta < targetMs - toleranceMs || delta > targetMs + toleranceMs) {
            continue;
          }

          let booking = buildBookingData(bookingRow);
          const [manageLinkPv, confirmLinkPv] = await Promise.all([
            createOrGetBookingShortLink({
              venueId: bookingRow.venue_id,
              bookingId: bookingRow.id,
              purpose: 'manage',
            }),
            createOrGetBookingShortLink({
              venueId: bookingRow.venue_id,
              bookingId: bookingRow.id,
              purpose: 'confirm',
            }),
          ]);
          booking.manage_booking_link = manageLinkPv;
          booking.confirm_cancel_link = confirmLinkPv;
          booking = await enrichBookingEmailForAppointment(supabase, bookingRow.id, booking);

          let sentAny = false;
          if (policy.channels.includes('email')) {
            const email = await sendPolicyMessage({
              venueId: venue.id,
              booking,
              venue: venueData,
              messageKey: 'pre_visit_reminder',
              channel: 'email',
              mode: 'dedupe',
            });
            sentAny = sentAny || email.sent;
          }
          if (policy.channels.includes('sms')) {
            const sms = await sendPolicyMessage({
              venueId: venue.id,
              booking,
              venue: venueData,
              messageKey: 'pre_visit_reminder',
              channel: 'sms',
              mode: 'dedupe',
            });
            sentAny = sentAny || sms.sent;
          }

          if (sentAny) results.day_of_reminders++;
        } catch (error) {
          console.error('[pre-visit-reminder] booking failed:', bookingRow.id, error);
          results.errors++;
        }
      }
    } catch (error) {
      console.error('[pre-visit-reminder] venue failed:', venue.id, error);
      results.errors++;
    }
  }
}

async function sendPostVisitThankYous(results: {
  post_visit: number;
  errors: number;
}) {
  const supabase = getSupabaseAdminClient();
  const now = new Date();
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, address, phone, timezone, booking_model, email, reply_to_email');

  if (!venues?.length) return;

  for (const venue of venues) {
    try {
      if (isUnifiedSchedulingVenue((venue as { booking_model?: string }).booking_model)) {
        continue;
      }

      const policies = await getVenueCommunicationPolicies(venue.id);
      const policy = policies.table.post_visit_thankyou;
      if (!policy.enabled || policy.hoursAfter == null || !policy.channels.includes('email')) {
        continue;
      }

      const tz = venue.timezone ?? 'Europe/London';
      const nowLocal = toVenueLocal(now, tz);
      const nowLocalMs = nowLocal.getTime();
      const toleranceMs = 15 * 60 * 1000;
      const targetMs = policy.hoursAfter * 60 * 60 * 1000;
      const windowStart = new Date(nowLocalMs - targetMs - toleranceMs);
      const windowEnd = new Date(nowLocalMs - targetMs + toleranceMs);
      const startDate = localDateStr(windowStart);
      const endDate = localDateStr(windowEnd);
      const dates = [startDate];
      if (endDate !== startDate) dates.push(endDate);

      const { data: bookings } = await supabase
        .from('bookings')
        .select(BOOKING_SELECT)
        .eq('venue_id', venue.id)
        .in('booking_date', dates)
        .eq('status', 'Completed');

      if (!bookings?.length) continue;

      const venueData = venueRowToEmailData(venue);
      for (const bookingRow of normalizeBookings(bookings)) {
        try {
          if (isCdeBookingRow(bookingRow)) continue;

          const delta = nowLocalMs - bookingLocalMs(
            bookingRow.booking_date,
            bookingRow.booking_time,
          );
          if (delta < targetMs - toleranceMs || delta > targetMs + toleranceMs) {
            continue;
          }

          let booking = buildBookingData(bookingRow);
          booking.manage_booking_link = await createOrGetBookingShortLink({
            venueId: bookingRow.venue_id,
            bookingId: bookingRow.id,
            purpose: 'manage',
          });
          booking = await enrichBookingEmailForAppointment(supabase, bookingRow.id, booking);

          const email = await sendPolicyMessage({
            venueId: venue.id,
            booking,
            venue: venueData,
            messageKey: 'post_visit_thankyou',
            channel: 'email',
            mode: 'dedupe',
            rebookLink: venueData.booking_page_url ?? null,
          });
          if (email.sent) results.post_visit++;
        } catch (error) {
          console.error('[post-visit] booking failed:', bookingRow.id, error);
          results.errors++;
        }
      }
    } catch (error) {
      console.error('[post-visit] venue failed:', venue.id, error);
      results.errors++;
    }
  }
}
