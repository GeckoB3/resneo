import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import type { BookingEmailData } from '@/lib/emails/types';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { isCdeBookingRow } from '@/lib/booking/cde-booking';
import { runUnifiedSchedulingComms, runSecondaryModelScheduledComms } from '@/lib/cron/unified-scheduling-comms';
import {
  fetchVenueClosureBlocksForDates,
  reminderSuppressedByClosure,
} from '@/lib/cron/reminder-closure-suppression';
import { sendPolicyMessage } from '@/lib/communications/outbound';
import {
  markReviewRequestSent,
  shouldIncludeReviewRequest,
  venueWithoutReviewRequest,
} from '@/lib/reviews/review-request-eligibility';
import {
  getVenueCommunicationPolicies,
  inferCommunicationLaneFromBookingModel,
  type VenueCommunicationPolicies,
} from '@/lib/communications/policies';
import type { BookingModel } from '@/types/booking-models';
import type { CronGuestInfo as GuestInfo, CronBookingRow as BookingRow } from '@/lib/cron/comms-types';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { sendCustomerPush } from '@/lib/communications/customer-push-notification';
import { reminderPushBody } from '@/lib/communications/customer-push-body';
import {
  CRON_COMMS_TOLERANCE_MS,
  bookingCivilDatesForPostVisitWindow,
  bookingCivilDatesForReminderWindow,
  msSinceBookingStartUtc,
  msUntilBookingStartUtc,
} from '@/lib/cron/comms-timing';

export const GET = withCronRunLogging('send-communications', handleGet);

async function handleGet(request: NextRequest) {
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

const BOOKING_SELECT =
  'id, venue_id, guest_id, booking_model, guest_email, booking_date, booking_time, party_size, special_requests, dietary_notes, deposit_amount_pence, deposit_status, cancellation_deadline, status, experience_event_id, class_instance_id, resource_id, guest:guests(first_name, last_name, email, phone)';

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
  const bm = row.booking_model;
  return {
    id: row.id,
    guest_name: formatGuestDisplayName(row.guest?.first_name, row.guest?.last_name),
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
    ...(bm ? { booking_model: bm as BookingModel } : {}),
  };
}

function isTableBookingRow(row: BookingRow): boolean {
  return (row.booking_model ?? 'table_reservation') === 'table_reservation';
}

/** Civil dates that might contain bookings needing this reminder, across both comms lanes (hybrid venues). */
function unionReminderCivilDates(opts: {
  policies: VenueCommunicationPolicies;
  messageKey: 'confirm_or_cancel_prompt' | 'pre_visit_reminder';
  venueTimeZone: string;
  toleranceMs: number;
  nowMs: number;
}): string[] | null {
  const set = new Set<string>();
  for (const lane of ['table', 'appointments_other'] as const) {
    const policy = opts.policies[lane][opts.messageKey];
    if (!policy.enabled || policy.hoursBefore == null) continue;
    bookingCivilDatesForReminderWindow({
      venueTimeZone: opts.venueTimeZone,
      hoursBefore: policy.hoursBefore,
      toleranceMs: opts.toleranceMs,
      nowMs: opts.nowMs,
    }).forEach((d) => set.add(d));
  }
  return set.size === 0 ? null : [...set];
}

function unionPostVisitCivilDates(opts: {
  policies: VenueCommunicationPolicies;
  venueTimeZone: string;
  toleranceMs: number;
  nowMs: number;
}): string[] | null {
  const set = new Set<string>();
  for (const lane of ['table', 'appointments_other'] as const) {
    const policy = opts.policies[lane].post_visit_thankyou;
    if (!policy.enabled || policy.hoursAfter == null || !policy.channels.includes('email')) continue;
    bookingCivilDatesForPostVisitWindow({
      venueTimeZone: opts.venueTimeZone,
      hoursAfter: policy.hoursAfter,
      toleranceMs: opts.toleranceMs,
      nowMs: opts.nowMs,
    }).forEach((d) => set.add(d));
  }
  return set.size === 0 ? null : [...set];
}

async function sendConfirmOrCancelPrompts(results: {
  reminders_56h: number;
  errors: number;
}) {
  const supabase = getSupabaseAdminClient();
  const now = new Date();
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, address, phone, timezone, booking_model, email, reply_to_email, google_review_url, review_request_enabled');

  if (!venues?.length) return;

  for (const venue of venues) {
    try {
      if (isUnifiedSchedulingVenue((venue as { booking_model?: string }).booking_model)) {
        continue;
      }

      const policies = await getVenueCommunicationPolicies(venue.id);
      const tz = venue.timezone ?? 'Europe/London';
      const nowMs = now.getTime();
      const toleranceMs = CRON_COMMS_TOLERANCE_MS;
      const dates = unionReminderCivilDates({
        policies,
        messageKey: 'confirm_or_cancel_prompt',
        venueTimeZone: tz,
        toleranceMs,
        nowMs,
      });
      if (!dates?.length) continue;

      const { data: bookings } = await supabase
        .from('bookings')
        .select(BOOKING_SELECT)
        .eq('venue_id', venue.id)
        .in('booking_date', dates)
        .in('status', ['Pending', 'Booked', 'Confirmed']);

      if (!bookings?.length) continue;

      /**
       * SA-M2, same rule as the unified lane. This branch serves table venues,
       * which the appointments audit did not scope, but a restaurant closing a
       * day and still texting reminders is the identical bug. Applied here
       * rather than reasoned about: if this path has no live venues it is
       * simply inert, which is cheaper than being wrong about it.
       */
      const closureBlocks = await fetchVenueClosureBlocksForDates(supabase, venue.id, dates);

      const venueData = venueRowToEmailData(venue);
      for (const bookingRow of normalizeBookings(bookings)) {
        try {
          if (isCdeBookingRow(bookingRow)) continue;
          if (!isTableBookingRow(bookingRow)) continue;

          const lane = inferCommunicationLaneFromBookingModel(
            bookingRow.booking_model ?? (venue as { booking_model?: string }).booking_model,
          );
          const policy = policies[lane].confirm_or_cancel_prompt;
          if (!policy.enabled || policy.hoursBefore == null) continue;

          const targetMs = policy.hoursBefore * 60 * 60 * 1000;
          const delta = msUntilBookingStartUtc(
            bookingRow.booking_date,
            bookingRow.booking_time,
            tz,
            nowMs,
          );
          if (delta < targetMs - toleranceMs || delta > targetMs + toleranceMs) continue;

          // After the window match, before the send: no communication_logs row
          // is written, so the dedupe slot stays free (see the lib header).
          if (reminderSuppressedByClosure({
            bookingDate: bookingRow.booking_date,
            bookingTime: bookingRow.booking_time,
            blocks: closureBlocks,
          })) {
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
          booking = await enrichBookingEmailForComms(supabase, bookingRow.id, booking);

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
    .select('id, name, address, phone, timezone, booking_model, email, reply_to_email, google_review_url, review_request_enabled');

  if (!venues?.length) return;

  for (const venue of venues) {
    try {
      if (isUnifiedSchedulingVenue((venue as { booking_model?: string }).booking_model)) {
        continue;
      }

      const policies = await getVenueCommunicationPolicies(venue.id);
      const tz = venue.timezone ?? 'Europe/London';
      const nowMs = now.getTime();
      const toleranceMs = CRON_COMMS_TOLERANCE_MS;
      const dates = unionReminderCivilDates({
        policies,
        messageKey: 'pre_visit_reminder',
        venueTimeZone: tz,
        toleranceMs,
        nowMs,
      });
      if (!dates?.length) continue;

      const { data: bookings } = await supabase
        .from('bookings')
        .select(BOOKING_SELECT)
        .eq('venue_id', venue.id)
        .in('booking_date', dates)
        .in('status', ['Pending', 'Booked', 'Confirmed']);

      if (!bookings?.length) continue;

      /** SA-M2; see the note on the confirm/cancel lane above. */
      const closureBlocks = await fetchVenueClosureBlocksForDates(supabase, venue.id, dates);

      const venueData = venueRowToEmailData(venue);
      for (const bookingRow of normalizeBookings(bookings)) {
        try {
          if (isCdeBookingRow(bookingRow)) continue;
          if (!isTableBookingRow(bookingRow)) continue;

          const lane = inferCommunicationLaneFromBookingModel(
            bookingRow.booking_model ?? (venue as { booking_model?: string }).booking_model,
          );
          const policy = policies[lane].pre_visit_reminder;
          if (!policy.enabled || policy.hoursBefore == null) continue;

          const targetMs = policy.hoursBefore * 60 * 60 * 1000;
          const delta = msUntilBookingStartUtc(
            bookingRow.booking_date,
            bookingRow.booking_time,
            tz,
            nowMs,
          );
          if (delta < targetMs - toleranceMs || delta > targetMs + toleranceMs) continue;

          if (reminderSuppressedByClosure({
            bookingDate: bookingRow.booking_date,
            bookingTime: bookingRow.booking_time,
            blocks: closureBlocks,
          })) {
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
          booking = await enrichBookingEmailForComms(supabase, bookingRow.id, booking);

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

          /*
            The customer's own push (P5-2), after the email and SMS.

            NOT counted in `day_of_reminders`, and not gated on `sentAny`. The
            counter is what the cron reports as work done, and a push is a
            courtesy on top of the message that carries the obligation; letting
            it inflate the count would make a run where every email failed look
            like a run that worked. Nor is it gated on the email having gone:
            `sendCustomerPush` consults the customer's own preference matrix,
            which is a different question from the venue's channel policy above.
          */
          const push = await sendCustomerPush({
            bookingId: bookingRow.id,
            // `BOOKING_SELECT` already fetched it, and passing it saves the
            // sender a booking read per reminder. The only optimisation here
            // worth making, on the one call site that runs in a loop.
            guestId: bookingRow.guest_id,
            event: 'reminder',
            body: reminderPushBody({
              venueName: venueData.name,
              bookingDate: booking.booking_date,
              bookingTime: booking.booking_time,
            }),
          });
          if (!push.sent) {
            // Expected to be `no_tokens` everywhere until a customer build
            // registers a device with `audience: 'customer'`. Logged so that
            // state is distinguishable from suppressing these by mistake.
            console.log('[customer-push] reminder not sent', {
              bookingId: bookingRow.id,
              reason: push.reason,
            });
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
    .select('id, name, address, phone, timezone, booking_model, email, reply_to_email, google_review_url, review_request_enabled');

  if (!venues?.length) return;

  for (const venue of venues) {
    try {
      if (isUnifiedSchedulingVenue((venue as { booking_model?: string }).booking_model)) {
        continue;
      }

      const policies = await getVenueCommunicationPolicies(venue.id);
      const tz = venue.timezone ?? 'Europe/London';
      const nowMs = now.getTime();
      const toleranceMs = CRON_COMMS_TOLERANCE_MS;
      const dates = unionPostVisitCivilDates({
        policies,
        venueTimeZone: tz,
        toleranceMs,
        nowMs,
      });
      if (!dates?.length) continue;

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
          if (!isTableBookingRow(bookingRow)) continue;

          const lane = inferCommunicationLaneFromBookingModel(
            bookingRow.booking_model ?? (venue as { booking_model?: string }).booking_model,
          );
          const policy = policies[lane].post_visit_thankyou;
          if (!policy.enabled || policy.hoursAfter == null || !policy.channels.includes('email')) {
            continue;
          }

          const targetMs = policy.hoursAfter * 60 * 60 * 1000;
          const delta = msSinceBookingStartUtc(
            bookingRow.booking_date,
            bookingRow.booking_time,
            tz,
            nowMs,
          );
          if (delta < targetMs - toleranceMs || delta > targetMs + toleranceMs) continue;

          let booking = buildBookingData(bookingRow);
          booking.manage_booking_link = await createOrGetBookingShortLink({
            venueId: bookingRow.venue_id,
            bookingId: bookingRow.id,
            purpose: 'manage',
          });
          booking = await enrichBookingEmailForComms(supabase, bookingRow.id, booking);

          // Six-month cap, suppressing the review block rather than the email.
          const askForReview = await shouldIncludeReviewRequest(supabase, {
            venue: venueData,
            guestId: bookingRow.guest_id ?? null,
            nowMs,
          });

          const email = await sendPolicyMessage({
            venueId: venue.id,
            booking,
            venue: askForReview ? venueData : venueWithoutReviewRequest(venueData),
            messageKey: 'post_visit_thankyou',
            channel: 'email',
            mode: 'dedupe',
            rebookLink: venueData.booking_page_url ?? null,
          });
          if (email.sent && askForReview && bookingRow.guest_id) {
            await markReviewRequestSent(supabase, bookingRow.guest_id);
          }
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
