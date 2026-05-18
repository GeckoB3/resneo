import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { findOrCreateGuest } from '@/lib/guests';
import { nextResponseIfVenueRequiresAccountLoginForBooking } from '@/lib/booking/require-account-login-for-public-booking';
import { sendBookingConfirmationNotifications } from '@/lib/communications/send-templated';
import { computeAvailability, fetchEngineInput } from '@/lib/availability';
import { AVAILABILITY_SETUP_REQUIRED_MESSAGE } from '@/lib/availability/availability-errors';
import { generateConfirmToken, hashConfirmToken } from '@/lib/confirm-token';
import { z } from 'zod';
import { normalizeToE164 } from '@/lib/phone/e164';

import { autoAssignTable } from '@/lib/table-availability';
import { resolveVenueMode } from '@/lib/venue-mode';
import { syncTableStatusesForBooking } from '@/lib/table-management/lifecycle';
import { resolveDurationAndBufferForTableAssignment } from '@/lib/table-management/booking-table-duration';
import { isStrictTableAssignOnOnlineCreate } from '@/lib/table-management/auto-assign-policy';
import { resolvePartySizeBoundsForVenueServices } from '@/lib/booking/party-size-bounds';
import {
  attachVenueClockToAppointmentInput,
  fetchAppointmentInput,
  computeAppointmentAvailability,
} from '@/lib/availability/appointment-engine';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import { snapshotProcessingTimeBlocksFromCatalog } from '@/lib/appointments/processing-time';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import { resolveAppointmentServiceOnlineCharge } from '@/lib/appointments/appointment-service-payment';
import {
  applyVariantToAppointmentInput,
  resolveBookableServiceWithVariant,
} from '@/lib/appointments/service-variant';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import { fetchEventInput, computeEventAvailability } from '@/lib/availability/event-ticket-engine';
import { fetchClassInput, computeClassAvailability } from '@/lib/availability/class-session-engine';
import {
  fetchResourceInput,
  computeResourceAvailability,
  isResourceBookingStartInPast,
} from '@/lib/availability/resource-booking-engine';
import { cancellationDeadlineHoursBefore } from '@/lib/booking/cancellation-deadline';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { resolveCancellationNoticeHoursForCreate } from '@/lib/booking/resolve-cancellation-notice-hours';
import { isGuestBookingDateAllowed, loadServiceEntityBookingWindow } from '@/lib/booking/entity-booking-window';
import {
  hasNonTableBookingPayload,
  inferSecondaryBookingModelFromPayload,
  venueExposesBookingModel,
} from '@/lib/booking/enabled-models';
import type { BookingModel, ClassPaymentRequirement } from '@/types/booking-models';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import type { BookingEmailData } from '@/lib/emails/types';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { logBookingOp } from '@/lib/observability/booking-ops-log';
import { venueWideBlocksRejectBookingWindow } from '@/lib/availability/venue-wide-business-hours';
import { fetchVenueOpeningHoursAndWideBlocksForDate } from '@/lib/availability/venue-wide-blocks-fetch';
import { getResourceBookingEmailLabels } from '@/lib/booking/resource-booking-email-labels';
import { DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES } from '@/lib/booking/resource-booking-defaults';
import { listActiveAreasForVenue } from '@/lib/areas/resolve-default-area';
import { isPublicOnlineBookingBlocked } from '@/lib/billing/subscription-entitlement';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { sumAvailableClassCreditsForClassType } from '@/lib/class-commerce/available-class-credits';
import { consumeClassCreditsForBooking } from '@/lib/class-commerce/consume-class-credits';
import { formatGuestDisplayName, normaliseGuestNamePart } from '@/lib/guests/name';

const createBookingSchema = z.object({
  venue_id: z.string().uuid(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  booking_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
  party_size: z.number().int().min(1).max(50),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().min(1).max(24),
  dietary_notes: z.string().max(1000).optional(),
  occasion: z.string().max(200).optional(),
  source: z.enum(['online', 'phone', 'walk-in', 'widget', 'booking_page']),
  service_id: z.string().uuid().optional(),
  /** Dining area (table_reservation); required when the venue has more than one active area. */
  area_id: z.string().uuid().optional(),
  // Model B: appointment fields
  practitioner_id: z.string().uuid().optional(),
  appointment_service_id: z.string().uuid().optional(),
  /** Optional sub-option for the appointment service (variant duration / price overrides). */
  service_variant_id: z.string().uuid().optional(),
  // Model C: event ticket fields
  experience_event_id: z.string().uuid().optional(),
  ticket_lines: z.array(z.object({
    ticket_type_id: z.string().uuid(),
    label: z.string(),
    quantity: z.number().int().min(1),
    unit_price_pence: z.number().int().min(0),
  })).optional(),
  // Model D: class session fields
  class_instance_id: z.string().uuid().optional(),
  /** When true (class_session only), authenticated user pays with venue class credits instead of Stripe. */
  pay_with_class_credits: z.boolean().optional(),
  // Model E: resource fields
  resource_id: z.string().uuid().optional(),
  booking_end_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/).optional(),
  /** USE: book a materialised event/class session (capacity enforced server-side). */
  event_session_id: z.string().uuid().optional(),
  capacity_used: z.number().int().min(1).max(50).optional(),
  /** Public online/widget/booking_page: venue marketing consent from booking form. */
  marketing_consent: z.boolean().optional(),
  /** §7.7: set when the booking was routed through a venue collective page (attribution only). */
  collective_id: z.string().uuid().optional(),
});

/**
 * POST /api/booking/create
 * Public. Creates guest (or matches), creates booking. If deposit required for source,
 * creates Stripe PaymentIntent on venue's connected account and returns client_secret.
 */
export async function POST(request: NextRequest) {
  let venueIdForLog: string | undefined;
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(ip, 'booking-create', 8, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests. Try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const body = await request.json();
    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    venueIdForLog = parsed.data.venue_id;

    const {
      venue_id,
      booking_date,
      booking_time,
      party_size,
      first_name,
      last_name,
      email,
      phone,
      dietary_notes,
      occasion,
      source,
      service_id: requestServiceId,
    } = parsed.data;

    const phoneE164 = normalizeToE164(phone, 'GB');
    if (!phoneE164) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }

    const isOnlineLikeSource =
      source === 'online' || source === 'widget' || source === 'booking_page';
    if (isOnlineLikeSource && !String(email ?? '').trim()) {
      return NextResponse.json(
        { error: 'Email is required for online bookings.' },
        { status: 400 },
      );
    }
    const guestLinkOptions = {
      silentAuthSignup: isOnlineLikeSource && Boolean(String(email ?? '').trim()),
    };

    const marketingConsentForGuest =
      isOnlineLikeSource && parsed.data.marketing_consent !== undefined
        ? parsed.data.marketing_consent
        : undefined;

    const supabase = getSupabaseAdminClient();

    const { data: venue, error: venueErr } = await supabase
      .from('venues')
      .select(
        'id, name, stripe_connected_account_id, booking_rules, deposit_config, timezone, table_management_enabled, show_table_in_confirmation, address, opening_hours, venue_opening_exceptions, email, reply_to_email, logo_url, cover_photo_url, website_url, pricing_tier, plan_status, subscription_current_period_end, billing_access_source, require_account_login_for_bookings',
      )
      .eq('id', venue_id)
      .single();

    if (venueErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const authClient = await createClient();
    const loginDenied = await nextResponseIfVenueRequiresAccountLoginForBooking({
      requireAccountLogin: Boolean(
        (venue as { require_account_login_for_bookings?: boolean }).require_account_login_for_bookings,
      ),
      authSupabase: authClient,
      bookingEmail: email,
    });
    if (loginDenied) return loginDenied;

    if (
      isPublicOnlineBookingBlocked({
        pricing_tier: (venue as { pricing_tier?: string | null }).pricing_tier,
        plan_status: (venue as { plan_status?: string | null }).plan_status,
        subscription_current_period_end: (venue as { subscription_current_period_end?: string | null })
          .subscription_current_period_end,
        billing_access_source: (venue as { billing_access_source?: string | null }).billing_access_source,
      })
    ) {
      return NextResponse.json(
        { error: 'Online booking is temporarily unavailable for this venue.' },
        { status: 403 },
      );
    }

    const venueMode = await resolveVenueMode(supabase, venue_id);

    // Dispatch to model-specific create handlers (B, C, D, E)
    if (venueMode.bookingModel !== 'table_reservation') {
      const inferredSecondary = inferSecondaryBookingModelFromPayload(parsed.data, venueMode.enabledModels);
      const effectiveModel = inferredSecondary ?? venueMode.bookingModel;
      return handleNonTableBooking(
        request,
        supabase,
        venue,
        venueMode,
        parsed.data,
        phoneE164,
        effectiveModel,
        guestLinkOptions,
      );
    }

    const secondaryModel = inferSecondaryBookingModelFromPayload(parsed.data, venueMode.enabledModels);
    if (secondaryModel) {
      return handleNonTableBooking(
        request,
        supabase,
        venue,
        venueMode,
        parsed.data,
        phoneE164,
        secondaryModel,
        guestLinkOptions,
      );
    }
    if (hasNonTableBookingPayload(parsed.data)) {
      return NextResponse.json(
        { error: 'This booking type is not enabled for this venue' },
        { status: 400 },
      );
    }

    if (venueMode.availabilityEngine !== 'service') {
      return NextResponse.json({ error: AVAILABILITY_SETUP_REQUIRED_MESSAGE }, { status: 503 });
    }

    const areas = await listActiveAreasForVenue(supabase, venue_id);
    const requestAreaId = parsed.data.area_id ?? null;
    let resolvedAreaId: string | null = requestAreaId;
    if (areas.length > 1) {
      if (!resolvedAreaId) {
        return NextResponse.json({ error: 'area_id is required for this venue' }, { status: 400 });
      }
      if (!areas.some((a) => a.id === resolvedAreaId)) {
        return NextResponse.json({ error: 'Invalid area_id' }, { status: 400 });
      }
    } else if (areas.length === 1) {
      resolvedAreaId = areas[0]!.id;
    } else {
      return NextResponse.json({ error: AVAILABILITY_SETUP_REQUIRED_MESSAGE }, { status: 503 });
    }

    const { min: minParty, max: maxParty } = await resolvePartySizeBoundsForVenueServices(
      supabase,
      venue_id,
      resolvedAreaId,
    );
    if (party_size < minParty || party_size > maxParty) {
      return NextResponse.json(
        { error: `Party size must be between ${minParty} and ${maxParty}` },
        { status: 400 }
      );
    }

    const timeForDb = booking_time.length === 5 ? booking_time + ':00' : booking_time;
    const timeStr = timeForDb.slice(0, 5);

    let resolvedServiceId: string | null = requestServiceId ?? null;
    let estimatedEndTime: string | null = null;
    let requiresDeposit = false;
    let depositAmountPence: number | null = null;

    const engineInput = await fetchEngineInput({
      supabase,
      venueId: venue_id,
      date: booking_date,
      partySize: party_size,
      areaId: resolvedAreaId,
    });

    const results = computeAvailability(engineInput);
    const allSlots = results.flatMap((r) => r.slots);
    const slot = allSlots.find(
      (s) =>
        s.start_time === timeStr &&
        (!requestServiceId || s.service_id === requestServiceId) &&
        (!s.area_id || s.area_id === resolvedAreaId),
    );

    if (!slot || slot.available_covers < party_size) {
      const alternatives = allSlots
        .filter((s) => s.available_covers >= party_size)
        .slice(0, 3)
        .map((s) => ({ time: s.start_time, service: s.service_name, service_id: s.service_id }));

      return NextResponse.json(
        { error: 'This time slot is no longer available', alternatives },
        { status: 409 }
      );
    }

    resolvedServiceId = slot.service_id;
    const { durationMinutes, bufferMinutes } = await resolveDurationAndBufferForTableAssignment(
      supabase,
      engineInput,
      booking_date,
      party_size,
      resolvedServiceId,
    );
    const [y, mo, d] = booking_date.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0));
    endDate.setMinutes(endDate.getMinutes() + durationMinutes);
    estimatedEndTime = endDate.toISOString();

    const isOnlineSource = source === 'online' || source === 'widget' || source === 'booking_page';
    const onlineDepositApplies = isOnlineSource && slot.deposit_required;

    if (onlineDepositApplies) {
      requiresDeposit = true;
      const totalGbp = slot.deposit_amount ?? 0;
      depositAmountPence = Math.round(totalGbp * 100);
    }

    if (requiresDeposit && !venue.stripe_connected_account_id) {
      return NextResponse.json(
        { error: 'Venue has not set up payments; deposits are required for this booking type.' },
        { status: 400 }
      );
    }

    const guestFirst = normaliseGuestNamePart(first_name);
    const guestLast = normaliseGuestNamePart(last_name);

    const { guest } = await findOrCreateGuest(
      supabase,
      venue_id,
      {
        first_name: guestFirst,
        last_name: guestLast,
        email: email || null,
        phone: phoneE164,
        marketing_consent: marketingConsentForGuest,
      },
      guestLinkOptions,
    );

    const refundWindowHoursTable = await resolveCancellationNoticeHoursForCreate({
      supabase,
      venueId: venue_id,
      effectiveModel: 'table_reservation',
      tableServiceId: resolvedServiceId,
    });
    const cancellation_deadline = cancellationDeadlineHoursBefore(booking_date, booking_time, refundWindowHoursTable);

    const cancellationPolicySnapshot = {
      refund_window_hours: refundWindowHoursTable,
      policy: `Full refund if cancelled ${refundWindowHoursTable}+ hours before reservation. No refund within ${refundWindowHoursTable} hours or for no-shows.`,
    };

    const bookingInsert: Record<string, unknown> = {
      venue_id,
      guest_id: guest.id,
      booking_date,
      booking_time: timeForDb,
      party_size,
      status: requiresDeposit ? 'Pending' : 'Booked',
      source,
      dietary_notes: dietary_notes || null,
      occasion: occasion || null,
      guest_email: email || null,
      guest_first_name: guestFirst,
      guest_last_name: guestLast,
      guest_phone: phoneE164,
      deposit_amount_pence: depositAmountPence,
      deposit_status: requiresDeposit ? 'Pending' : 'Not Required',
      cancellation_deadline,
      cancellation_policy_snapshot: cancellationPolicySnapshot,
      service_id: resolvedServiceId,
      estimated_end_time: estimatedEndTime,
      area_id: resolvedAreaId,
    };

    const { data: booking, error: bookErr } = await supabase
      .from('bookings')
      .insert(bookingInsert)
      .select('id, status, deposit_status')
      .single();

    if (bookErr) {
      console.error('Booking insert failed:', bookErr);
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
    }

    let tableAssignmentUnassigned = false;
    if (venueMode.tableManagementEnabled && estimatedEndTime) {
      const assigned = await autoAssignTable(
        supabase,
        venue_id,
        booking.id,
        booking_date,
        timeStr,
        durationMinutes,
        bufferMinutes,
        party_size,
      );
      if (assigned) {
        await syncTableStatusesForBooking(
          supabase,
          booking.id,
          assigned.table_ids,
          booking.status,
          null
        );
      } else {
        tableAssignmentUnassigned = true;
        if (isStrictTableAssignOnOnlineCreate() && isOnlineSource) {
          await supabase.from('bookings').delete().eq('id', booking.id);
          return NextResponse.json(
            {
              error:
                'No table could be assigned for this time. Please choose another slot or contact the venue.',
            },
            { status: 503 },
          );
        }
      }
    }

    let client_secret: string | null = null;

    if (requiresDeposit && depositAmountPence != null && depositAmountPence > 0 && venue.stripe_connected_account_id) {
      try {
        const paymentIntent = await stripe.paymentIntents.create(
          {
            amount: depositAmountPence,
            currency: 'gbp',
            metadata: { booking_id: booking.id, venue_id },
            automatic_payment_methods: { enabled: true },
          },
          { stripeAccount: venue.stripe_connected_account_id }
        );
        client_secret = paymentIntent.client_secret;

        await supabase
          .from('bookings')
          .update({
            stripe_payment_intent_id: paymentIntent.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', booking.id);
      } catch (stripeErr) {
        console.error('PaymentIntent create failed:', stripeErr);
        await supabase.from('bookings').delete().eq('id', booking.id);
        return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
      }
    }

    if (!requiresDeposit) {
      const manageToken = generateConfirmToken();
      await supabase
        .from('bookings')
        .update({
          confirm_token_hash: hashConfirmToken(manageToken),
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id);
      const manageBookingLink = await createOrGetBookingShortLink({
        venueId: venue_id,
        bookingId: booking.id,
        purpose: 'manage',
      });
      if (guest.email || guest.phone) {
        after(async () => {
          try {
            const displayName = formatGuestDisplayName(guest.first_name, guest.last_name);
            const { email, sms } = await sendBookingConfirmationNotifications(
              {
                id: booking.id,
                guest_name: displayName,
                guest_email: guest.email ?? null,
                guest_phone: guest.phone ?? null,
                booking_date,
                booking_time,
                party_size,
                dietary_notes: dietary_notes ?? null,
                deposit_amount_pence: depositAmountPence ?? null,
                deposit_status: requiresDeposit ? 'Pending' : 'Not Required',
                manage_booking_link: manageBookingLink,
              },
              venueRowToEmailData({
                name: venue.name as string,
                address: (venue.address as string | null) ?? null,
                email: (venue as { email?: string | null }).email ?? null,
                reply_to_email: (venue as { reply_to_email?: string | null }).reply_to_email ?? null,
                logo_url: (venue as { logo_url?: string | null }).logo_url ?? null,
                cover_photo_url: (venue as { cover_photo_url?: string | null }).cover_photo_url ?? null,
                website_url: (venue as { website_url?: string | null }).website_url ?? null,
                timezone: (venue as { timezone?: string | null }).timezone ?? null,
              }),
              venue.id,
            );
            if (!email.sent) console.warn('[after] confirmation email not sent:', email.reason);
            if (!sms.sent && sms.reason !== 'skipped' && sms.reason !== 'no_phone') {
              console.warn('[after] confirmation SMS not sent:', sms.reason);
            }
          } catch (err) {
            console.error('[after] confirmation notifications failed:', err);
          }
        });
      }
    }

    logBookingOp({
      operation: 'create',
      venue_id: venue_id,
      booking_id: booking.id,
      booking_model: 'table_reservation',
    });

    return NextResponse.json(
      {
        booking_id: booking.id,
        requires_deposit: requiresDeposit,
        client_secret: client_secret ?? undefined,
        stripe_account_id: requiresDeposit ? venue.stripe_connected_account_id : undefined,
        status: booking.status,
        ...(tableAssignmentUnassigned ? { table_assignment_unassigned: true as const } : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    if (venueIdForLog) {
      logBookingOp({
        operation: 'error',
        venue_id: venueIdForLog,
        error: err instanceof Error ? err.message : String(err),
      });
    } else {
      console.error('POST /api/booking/create failed:', err);
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Models B–E: unified non-table booking handler
// ---------------------------------------------------------------------------

async function handleNonTableBooking(
  request: NextRequest,
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  venue: Record<string, unknown>,
  venueMode: Awaited<ReturnType<typeof resolveVenueMode>>,
  data: z.infer<typeof createBookingSchema>,
  phoneE164: string,
  effectiveModel: BookingModel,
  guestLinkOptions: { silentAuthSignup: boolean },
) {
  const {
    venue_id,
    booking_date,
    booking_time,
    party_size,
    first_name,
    last_name,
    email,
    dietary_notes,
    occasion,
    source,
    practitioner_id, appointment_service_id, service_variant_id,
    experience_event_id, ticket_lines,
    class_instance_id,
    pay_with_class_credits,
    resource_id, booking_end_time,
    event_session_id,
    capacity_used,
    collective_id,
  } = data;

  const routeAuthClient = await createRouteHandlerClient(request);
  const {
    data: { user: routeAuthUser },
  } = await routeAuthClient.auth.getUser();

  let pendingClassCreditRedemption: { userId: string; credits: number; classTypeId: string } | null = null;

  if (pay_with_class_credits && effectiveModel !== 'class_session') {
    return NextResponse.json(
      { error: 'pay_with_class_credits is only valid for class session bookings.' },
      { status: 400 },
    );
  }

  const isOnlineLikeSource =
    source === 'online' || source === 'widget' || source === 'booking_page';
  if (isOnlineLikeSource && !String(email ?? '').trim()) {
    return NextResponse.json(
      { error: 'Email is required for online bookings.' },
      { status: 400 },
    );
  }

  const marketingConsentForGuest =
    isOnlineLikeSource && data.marketing_consent !== undefined ? data.marketing_consent : undefined;

  const timeForDb = booking_time.length === 5 ? booking_time + ':00' : booking_time;
  const timeStr = timeForDb.slice(0, 5);

  if (!venueExposesBookingModel(venueMode.bookingModel, venueMode.enabledModels, effectiveModel)) {
    return NextResponse.json(
      { error: 'This booking type is not enabled for this venue' },
      { status: 400 },
    );
  }

  const venueWideHours = await fetchVenueOpeningHoursAndWideBlocksForDate(supabase, venue_id, booking_date);

  // ---- Validate slot availability per model ----
  let estimatedEndTime: string | null = null;
  let depositAmountPence: number | null = null;
  let requiresDeposit = false;
  let resourcePaymentRequirement: ClassPaymentRequirement | null = null;
  let appointmentEmailExtras: Partial<BookingEmailData> = {};
  let unifiedSessionAnchor: { calendar_id: string; service_item_id: string | null } | null = null;
  let appointmentProcessingSnapshot: ProcessingTimeBlock[] | null = null;

  const SESSION_CAPACITY_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

  if (event_session_id && effectiveModel !== 'unified_scheduling') {
    return NextResponse.json(
      { error: 'event_session_id is only supported for unified_scheduling venues' },
      { status: 400 },
    );
  }

  if (effectiveModel === 'unified_scheduling' && event_session_id) {
    const needSeats = capacity_used ?? party_size;
    const { data: session, error: sesErr } = await supabase
      .from('event_sessions')
      .select(
        'id, venue_id, calendar_id, session_date, start_time, end_time, capacity_override, is_cancelled, service_item_id',
      )
      .eq('id', event_session_id)
      .maybeSingle();

    if (sesErr || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    const sess = session as {
      venue_id: string;
      calendar_id: string;
      session_date: string;
      start_time: string;
      end_time: string;
      capacity_override: number | null;
      is_cancelled: boolean;
      service_item_id: string | null;
    };
    if (sess.is_cancelled) {
      return NextResponse.json({ error: 'This session is not available' }, { status: 409 });
    }
    if (sess.venue_id !== venue_id) {
      return NextResponse.json({ error: 'Session does not belong to this venue' }, { status: 400 });
    }
    if (sess.session_date !== booking_date) {
      return NextResponse.json({ error: 'Session date does not match booking date' }, { status: 400 });
    }
    const sessionStart = String(sess.start_time).slice(0, 5);
    if (sessionStart !== timeStr) {
      return NextResponse.json({ error: 'Booking time does not match session start' }, { status: 400 });
    }

    const { data: calRow } = await supabase
      .from('unified_calendars')
      .select('capacity, name')
      .eq('id', sess.calendar_id)
      .eq('venue_id', venue_id)
      .maybeSingle();
    const cap = sess.capacity_override ?? (calRow as { capacity?: number } | null)?.capacity ?? 0;
    if (cap < 1) {
      return NextResponse.json({ error: 'Session has no capacity' }, { status: 409 });
    }

    const { data: bookedRows } = await supabase
      .from('bookings')
      .select('capacity_used')
      .eq('venue_id', venue_id)
      .eq('event_session_id', event_session_id)
      .in('status', SESSION_CAPACITY_STATUSES);

    let used = 0;
    for (const r of bookedRows ?? []) {
      used += (r as { capacity_used?: number }).capacity_used ?? 1;
    }
    if (used + needSeats > cap) {
      return NextResponse.json({ error: 'This session is fully booked' }, { status: 409 });
    }

    const [y, mo, d] = booking_date.split('-').map(Number);
    const endHm = String(sess.end_time).slice(0, 5);
    const [eh, em] = endHm.split(':').map(Number);
    estimatedEndTime = new Date(Date.UTC(y!, mo! - 1, d!, eh!, em!, 0)).toISOString();

    let svcName: string | null = null;
    let priceDisplay: string | null = null;
    let depositPence: number | null = null;
    if (sess.service_item_id) {
      const { data: si } = await supabase
        .from('service_items')
        .select('name, price_pence, deposit_pence, payment_requirement')
        .eq('id', sess.service_item_id)
        .eq('venue_id', venue_id)
        .maybeSingle();
      svcName = (si as { name?: string } | null)?.name ?? null;
      const pp = (si as { price_pence?: number | null } | null)?.price_pence;
      priceDisplay = pp != null ? `£${(pp / 100).toFixed(2)}` : null;
      depositPence = (si as { deposit_pence?: number | null } | null)?.deposit_pence ?? null;
      const payReq = (si as { payment_requirement?: ClassPaymentRequirement | null } | null)
        ?.payment_requirement;
      const online = resolveAppointmentServiceOnlineCharge({
        payment_requirement: payReq ?? undefined,
        price_pence: pp ?? 0,
        deposit_pence: depositPence ?? 0,
      });
      if (online != null && online.amountPence > 0) {
        requiresDeposit = true;
        depositAmountPence = online.amountPence * needSeats;
      }
    }

    appointmentEmailExtras = {
      email_variant: 'appointment',
      booking_model: 'unified_scheduling',
      practitioner_name: (calRow as { name?: string } | null)?.name ?? null,
      appointment_service_name: svcName,
      appointment_price_display: priceDisplay,
    };

    unifiedSessionAnchor = { calendar_id: sess.calendar_id, service_item_id: sess.service_item_id };

    const venueWideErr = venueWideBlocksRejectBookingWindow(
      venueWideHours.openingHours,
      booking_date,
      sessionStart,
      endHm,
      venueWideHours.blocks,
    );
    if (venueWideErr) {
      return NextResponse.json({ error: venueWideErr }, { status: 400 });
    }
  } else if (isUnifiedSchedulingVenue(effectiveModel)) {
    if (!practitioner_id || !appointment_service_id) {
      return NextResponse.json({ error: 'practitioner_id and appointment_service_id are required' }, { status: 400 });
    }
    const serviceWindow = await loadServiceEntityBookingWindow(
      supabase,
      venue_id,
      venueMode.bookingModel,
      appointment_service_id,
    );
    const tz =
      typeof (venue as { timezone?: string | null }).timezone === 'string' &&
      String((venue as { timezone?: string | null }).timezone).trim() !== ''
        ? String((venue as { timezone?: string | null }).timezone).trim()
        : 'Europe/London';
    if (!isGuestBookingDateAllowed(booking_date, serviceWindow, tz)) {
      return NextResponse.json({ error: 'This date is not available for booking' }, { status: 400 });
    }
    const input = await fetchAppointmentInput({ supabase, venueId: venue_id, date: booking_date, practitionerId: practitioner_id, serviceId: appointment_service_id });

    let chosenVariant = null as Awaited<ReturnType<typeof loadActiveVariantForService>>;
    if (service_variant_id) {
      chosenVariant = await loadActiveVariantForService({
        admin: supabase,
        venueId: venue_id,
        serviceId: appointment_service_id,
        variantId: service_variant_id,
      });
      if (!chosenVariant) {
        return NextResponse.json(
          { error: 'Invalid service_variant_id for this service' },
          { status: 400 },
        );
      }
      applyVariantToAppointmentInput({
        services: input.services,
        serviceId: appointment_service_id,
        variant: chosenVariant,
      });
    }

    attachVenueClockToAppointmentInput(
      input,
      venue as { timezone?: string | null; booking_rules?: unknown; opening_hours?: unknown },
      serviceWindow,
    );
    const result = computeAppointmentAvailability(input);
    const prac = result.practitioners.find((p) => p.id === practitioner_id);
    const slotAvailable = prac?.slots.some((s) => s.start_time === timeStr && s.service_id === appointment_service_id);
    if (!slotAvailable) {
      return NextResponse.json({ error: 'This appointment slot is no longer available' }, { status: 409 });
    }
    const baseSvc = input.services.find((s) => s.id === appointment_service_id);
    const ps = input.practitionerServices.find(
      (row) => row.practitioner_id === practitioner_id && row.service_id === appointment_service_id,
    );
    const mergedSvc = baseSvc ? mergeAppointmentServiceWithPractitionerLink(baseSvc, ps) : undefined;
    const svc = mergedSvc ? resolveBookableServiceWithVariant(mergedSvc, chosenVariant) : undefined;
    const practRow = input.practitioners.find((p) => p.id === practitioner_id);
    appointmentEmailExtras = {
      email_variant: 'appointment',
      booking_model: 'unified_scheduling',
      practitioner_name: practRow?.name ?? null,
      appointment_service_name: svc?.name ?? null,
      appointment_price_display:
        svc?.price_pence != null ? `£${(svc.price_pence / 100).toFixed(2)}` : null,
    };
    if (svc) {
      const [y, mo, d] = booking_date.split('-').map(Number);
      const [hh, mm] = timeStr.split(':').map(Number);
      const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0));
      endDate.setMinutes(endDate.getMinutes() + svc.duration_minutes);
      estimatedEndTime = endDate.toISOString();

      // Model B: online charge from service payment mode (none / deposit / full payment).
      const online = resolveAppointmentServiceOnlineCharge(svc);
      if (online != null && online.amountPence > 0) {
        requiresDeposit = true;
        depositAmountPence = online.amountPence;
      }
    }
    if (mergedSvc && svc) {
      appointmentProcessingSnapshot = snapshotProcessingTimeBlocksFromCatalog({
        service: mergedSvc,
        variant: chosenVariant,
      });
    }
  } else if (effectiveModel === 'event_ticket') {
    if (!experience_event_id) {
      return NextResponse.json({ error: 'experience_event_id is required' }, { status: 400 });
    }
    const tz =
      typeof (venue as { timezone?: string | null }).timezone === 'string' &&
      String((venue as { timezone?: string | null }).timezone).trim() !== ''
        ? String((venue as { timezone?: string | null }).timezone).trim()
        : 'Europe/London';
    const input = await fetchEventInput({ supabase, venueId: venue_id, date: booking_date });
    const result = computeEventAvailability(input, { venueTimezone: tz });
    const event = result.find((e) => e.event_id === experience_event_id);
    if (!event || event.remaining_capacity < party_size) {
      return NextResponse.json({ error: 'This event is fully booked or unavailable' }, { status: 409 });
    }
    const venueWideErrEvent = venueWideBlocksRejectBookingWindow(
      venueWideHours.openingHours,
      booking_date,
      event.start_time.slice(0, 5),
      event.end_time.slice(0, 5),
      venueWideHours.blocks,
    );
    if (venueWideErrEvent) {
      return NextResponse.json({ error: venueWideErrEvent }, { status: 400 });
    }
    const ticketTotal = (ticket_lines && ticket_lines.length > 0)
      ? ticket_lines.reduce((sum, tl) => sum + tl.quantity * tl.unit_price_pence, 0)
      : 0;
    const eventPayReq = event.payment_requirement ?? 'none';
    const eventDepPerPerson = event.deposit_amount_pence ?? 0;
    if (eventPayReq === 'full_payment' && ticketTotal > 0) {
      requiresDeposit = true;
      depositAmountPence = ticketTotal;
    } else if (eventPayReq === 'deposit' && eventDepPerPerson > 0) {
      requiresDeposit = true;
      depositAmountPence = eventDepPerPerson * party_size;
    }
    const ticketTotalDisplay =
      ticketTotal > 0 ? `£${(ticketTotal / 100).toFixed(2)}` : null;
    appointmentEmailExtras = {
      email_variant: 'appointment',
      booking_model: 'event_ticket',
      appointment_service_name: event.event_name,
      practitioner_name: null,
      appointment_price_display: ticketTotalDisplay,
    };
  } else if (effectiveModel === 'class_session') {
    if (!class_instance_id) {
      return NextResponse.json({ error: 'class_instance_id is required' }, { status: 400 });
    }
    const isPublicGuestSource = source === 'online' || source === 'widget' || source === 'booking_page';
    const input = await fetchClassInput({
      supabase,
      venueId: venue_id,
      date: booking_date,
      forPublicBooking: isPublicGuestSource,
    });
    const result = computeClassAvailability(input);
    const cls = result.find((c) => c.instance_id === class_instance_id);
    if (!cls || cls.remaining < party_size) {
      return NextResponse.json({ error: 'This class is full or unavailable' }, { status: 409 });
    }
    // computeClassAvailability already applies venue-wide closures / amended hours for the date.
    // Scheduled class sessions intentionally bypass the venue's weekly opening hours (an evening
    // class on a venue that closes at 5pm is still bookable if staff scheduled it).
    const classPayReq = cls.payment_requirement;
    const priceP = cls.price_pence ?? 0;
    const depPer = cls.deposit_amount_pence ?? 0;
    if (classPayReq === 'full_payment' && priceP > 0) {
      requiresDeposit = true;
      depositAmountPence = priceP * party_size;
    } else if (classPayReq === 'deposit' && depPer > 0) {
      requiresDeposit = true;
      depositAmountPence = depPer * party_size;
    }
    const classPriceDisplay =
      cls.price_pence != null ? `£${((cls.price_pence * party_size) / 100).toFixed(2)}` : null;
    appointmentEmailExtras = {
      email_variant: 'appointment',
      booking_model: 'class_session',
      appointment_service_name: cls.class_name,
      practitioner_name: null,
      appointment_price_display: classPriceDisplay,
    };

    if (pay_with_class_credits) {
      if (!routeAuthUser?.id || !routeAuthUser.email) {
        return NextResponse.json({ error: 'Sign in to pay with class credits.' }, { status: 401 });
      }
      const emailNorm = String(email ?? '').trim().toLowerCase();
      const authEmail = routeAuthUser.email.trim().toLowerCase();
      if (!emailNorm || emailNorm !== authEmail) {
        return NextResponse.json(
          { error: 'Use the same email as your signed-in account to redeem class credits.' },
          { status: 403 },
        );
      }
      const priceP = cls.price_pence ?? 0;
      if (priceP <= 0) {
        return NextResponse.json({ error: 'Class credits cannot be used for free classes.' }, { status: 400 });
      }
      const avail = await sumAvailableClassCreditsForClassType(supabase, {
        userId: routeAuthUser.id,
        venueId: venue_id,
        classTypeId: cls.class_type_id,
      });
      if (avail < party_size) {
        return NextResponse.json(
          {
            error: 'Not enough class credits for this booking.',
            credits_available: avail,
            credits_required: party_size,
          },
          { status: 409 },
        );
      }
      requiresDeposit = false;
      depositAmountPence = null;
      pendingClassCreditRedemption = {
        userId: routeAuthUser.id,
        credits: party_size,
        classTypeId: cls.class_type_id,
      };
    }
  } else if (effectiveModel === 'resource_booking') {
    if (!resource_id || !booking_end_time) {
      return NextResponse.json({ error: 'resource_id and booking_end_time are required' }, { status: 400 });
    }
    const venueTzResource =
      typeof (venue as { timezone?: string | null }).timezone === 'string' &&
      String((venue as { timezone?: string | null }).timezone).trim() !== ''
        ? String((venue as { timezone?: string | null }).timezone).trim()
        : 'Europe/London';
    if (isResourceBookingStartInPast(booking_date, timeStr, venueTzResource)) {
      return NextResponse.json(
        { error: 'Choose a start time in the future for today.' },
        { status: 400 },
      );
    }
    const endTimeStr = booking_end_time.length === 5 ? booking_end_time + ':00' : booking_end_time;
    const durationMinutes = (
      ((parseInt(endTimeStr.slice(0, 2)) * 60) + parseInt(endTimeStr.slice(3, 5))) -
      ((parseInt(timeStr.slice(0, 2)) * 60) + parseInt(timeStr.slice(3, 5)))
    );
    const input = await fetchResourceInput({ supabase, venueId: venue_id, date: booking_date, resourceId: resource_id });
    const result = computeResourceAvailability(input, durationMinutes);
    const res = result.find((r) => r.id === resource_id);
    const slotAvailable = res?.slots.some((s) => s.start_time === timeStr);
    if (!slotAvailable) {
      return NextResponse.json({ error: 'This resource slot is no longer available' }, { status: 409 });
    }
    const endForVenue = (booking_end_time.length === 5 ? booking_end_time : booking_end_time.slice(0, 5)).slice(0, 5);
    const venueWideErrRes = venueWideBlocksRejectBookingWindow(
      venueWideHours.openingHours,
      booking_date,
      timeStr,
      endForVenue,
      venueWideHours.blocks,
    );
    if (venueWideErrRes) {
      return NextResponse.json({ error: venueWideErrRes }, { status: 400 });
    }
    const numSlots = Math.ceil(
      durationMinutes / (res?.slot_interval_minutes ?? DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES),
    );
    const totalPricePence = (res?.price_per_slot_pence ?? 0) * numSlots;
    const payReq = res?.payment_requirement ?? 'none';
    resourcePaymentRequirement = payReq;
    const depConfigured = res?.deposit_amount_pence ?? 0;
    if (payReq === 'full_payment' && totalPricePence > 0) {
      requiresDeposit = true;
      depositAmountPence = totalPricePence;
    } else if (payReq === 'deposit' && depConfigured > 0) {
      requiresDeposit = true;
      depositAmountPence = depConfigured;
    }
    const resourceLabels = await getResourceBookingEmailLabels(supabase, resource_id);
    const resourcePriceDisplay =
      depositAmountPence != null && depositAmountPence > 0
        ? `£${(depositAmountPence / 100).toFixed(2)}`
        : totalPricePence > 0 && payReq === 'none'
          ? `£${(totalPricePence / 100).toFixed(2)} (pay at venue)`
          : null;
    appointmentEmailExtras = {
      email_variant: 'appointment',
      booking_model: 'resource_booking',
      appointment_service_name: resourceLabels.resourceName ?? res?.name ?? 'Resource',
      practitioner_name: resourceLabels.hostCalendarName,
      appointment_price_display: resourcePriceDisplay,
    };
  }

  if (requiresDeposit && !(venue.stripe_connected_account_id as string | null)) {
    return NextResponse.json(
      { error: 'Venue has not set up payments; payment is required for this booking.' },
      { status: 400 }
    );
  }

  const guestFirst = normaliseGuestNamePart(first_name);
  const guestLast = normaliseGuestNamePart(last_name);

  const { guest } = await findOrCreateGuest(
    supabase,
    venue_id,
    {
      first_name: guestFirst,
      last_name: guestLast,
      email: email || null,
      phone: phoneE164,
      marketing_consent: marketingConsentForGuest,
    },
    guestLinkOptions,
  );

  const refundWindowHours = await resolveCancellationNoticeHoursForCreate({
    supabase,
    venueId: venue_id,
    effectiveModel,
    appointmentServiceId: appointment_service_id ?? null,
    serviceItemId:
      effectiveModel === 'unified_scheduling'
        ? (event_session_id ? unifiedSessionAnchor?.service_item_id ?? null : appointment_service_id ?? null)
        : null,
    experienceEventId: experience_event_id ?? null,
    classInstanceId: class_instance_id ?? null,
    resourceCalendarId: resource_id ?? null,
    eventSessionServiceItemId: unifiedSessionAnchor?.service_item_id ?? null,
  });

  const cancellation_deadline = cancellationDeadlineHoursBefore(booking_date, booking_time, refundWindowHours);
  const cancellationPolicySnapshot = {
    refund_window_hours: refundWindowHours,
    policy: `Full refund if cancelled ${refundWindowHours}+ hours before your booking start time. No refund within ${refundWindowHours} hours of the start or for no-shows.`,
  };

  const bookingInsert: Record<string, unknown> = {
    venue_id,
    guest_id: guest.id,
    booking_date,
    booking_time: timeForDb,
    party_size,
    /** Align with effectiveModel; default `table_reservation` would violate bookings_area_required_for_table_reservation when area_id is unset. */
    booking_model: effectiveModel,
    status: requiresDeposit ? 'Pending' : 'Booked',
    source,
    dietary_notes: dietary_notes || null,
    occasion: occasion || null,
    guest_email: email || null,
    guest_first_name: guestFirst,
    guest_last_name: guestLast,
    guest_phone: phoneE164,
    deposit_amount_pence: depositAmountPence,
    deposit_status: requiresDeposit ? 'Pending' : 'Not Required',
    cancellation_deadline,
    cancellation_policy_snapshot: cancellationPolicySnapshot,
    estimated_end_time: estimatedEndTime,
    // Model-specific anchors
    practitioner_id: practitioner_id ?? null,
    appointment_service_id: appointment_service_id ?? null,
    service_variant_id: service_variant_id ?? null,
    experience_event_id: experience_event_id ?? null,
    class_instance_id: class_instance_id ?? null,
    resource_id: resource_id ?? null,
    calendar_id: resource_id ? resource_id : null,
    booking_end_time: booking_end_time ? (booking_end_time.length === 5 ? booking_end_time + ':00' : booking_end_time) : null,
    event_session_id: event_session_id ?? null,
    capacity_used: capacity_used ?? party_size,
  };

  if (effectiveModel === 'unified_scheduling') {
    if (event_session_id && unifiedSessionAnchor) {
      bookingInsert.calendar_id = unifiedSessionAnchor.calendar_id;
      bookingInsert.service_item_id = unifiedSessionAnchor.service_item_id;
      bookingInsert.practitioner_id = null;
      bookingInsert.appointment_service_id = null;
      bookingInsert.capacity_used = capacity_used ?? party_size;
    } else {
      bookingInsert.calendar_id = practitioner_id ?? null;
      bookingInsert.service_item_id = appointment_service_id ?? null;
      bookingInsert.practitioner_id = null;
      bookingInsert.appointment_service_id = null;
    }
  }

  if (effectiveModel === 'resource_booking') {
    bookingInsert.resource_payment_requirement = resourcePaymentRequirement;
  }

  if (effectiveModel === 'unified_scheduling' && !event_session_id) {
    bookingInsert.processing_time_blocks = appointmentProcessingSnapshot ?? [];
  }

  // §7.7: attribute the booking to a venue collective when it was routed
  // through one — but only if this venue is genuinely an active member, so a
  // forged collective_id cannot tag bookings to an unrelated collective.
  if (collective_id) {
    const { data: membership } = await supabase
      .from('venue_collective_members')
      .select('id')
      .eq('collective_id', collective_id)
      .eq('venue_id', venue_id)
      .eq('status', 'active')
      .maybeSingle();
    if (membership) bookingInsert.collective_id = collective_id;
  }

  const { data: booking, error: bookErr } = await supabase
    .from('bookings')
    .insert(bookingInsert)
    .select('id, status, deposit_status')
    .single();

  if (bookErr) {
    console.error('Booking insert failed:', bookErr);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }

  if (pendingClassCreditRedemption) {
    const consumed = await consumeClassCreditsForBooking({
      admin: supabase,
      userId: pendingClassCreditRedemption.userId,
      venueId: venue_id,
      credits: pendingClassCreditRedemption.credits,
      bookingId: booking.id,
      idempotencyKey: `redeem_booking:${booking.id}`,
      classTypeId: pendingClassCreditRedemption.classTypeId,
    });
    if (!consumed.ok) {
      console.error('[booking/create] class credit redeem failed', consumed);
      await supabase.from('bookings').delete().eq('id', booking.id);
      return NextResponse.json(
        { error: 'Could not apply class credits. Refresh and try again.' },
        { status: 409 },
      );
    }
  }

  // Insert ticket lines for event/class bookings
  if (ticket_lines && ticket_lines.length > 0) {
    const lines = ticket_lines.map((tl) => ({
      booking_id: booking.id,
      ticket_type_id: tl.ticket_type_id,
      label: tl.label,
      quantity: tl.quantity,
      unit_price_pence: tl.unit_price_pence,
    }));
    await supabase.from('booking_ticket_lines').insert(lines);
  }

  // Stripe payment intent
  let client_secret: string | null = null;

  if (requiresDeposit && depositAmountPence != null && depositAmountPence > 0 && (venue.stripe_connected_account_id as string)) {
    try {
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: depositAmountPence,
          currency: 'gbp',
          metadata: { booking_id: booking.id, venue_id },
          automatic_payment_methods: { enabled: true },
        },
        { stripeAccount: venue.stripe_connected_account_id as string }
      );
      client_secret = paymentIntent.client_secret;

      await supabase
        .from('bookings')
        .update({ stripe_payment_intent_id: paymentIntent.id, updated_at: new Date().toISOString() })
        .eq('id', booking.id);
    } catch (stripeErr) {
      console.error('PaymentIntent create failed:', stripeErr);
      await supabase.from('bookings').delete().eq('id', booking.id);
      return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
    }
  }

  // Send confirmation for non-deposit bookings
  if (!requiresDeposit) {
    const manageToken = generateConfirmToken();
    await supabase
      .from('bookings')
      .update({ confirm_token_hash: hashConfirmToken(manageToken), updated_at: new Date().toISOString() })
      .eq('id', booking.id);

    const manageBookingLink = await createOrGetBookingShortLink({
      venueId: venue_id,
      bookingId: booking.id,
      purpose: 'manage',
    });

    if (guest.email || guest.phone) {
      after(async () => {
        try {
          const displayName = formatGuestDisplayName(guest.first_name, guest.last_name);
          const { email, sms } = await sendBookingConfirmationNotifications(
            {
              id: booking.id,
              guest_name: displayName,
              guest_email: guest.email ?? null,
              guest_phone: guest.phone ?? phoneE164,
              booking_date,
              booking_time,
              party_size,
              dietary_notes: dietary_notes ?? null,
              deposit_amount_pence: depositAmountPence ?? null,
              deposit_status: requiresDeposit ? 'Pending' : 'Not Required',
              manage_booking_link: manageBookingLink,
              ...appointmentEmailExtras,
            },
            venueRowToEmailData({
              name: venue.name as string,
              address: (venue.address as string | null) ?? null,
              email: (venue as { email?: string | null }).email ?? null,
              reply_to_email: (venue as { reply_to_email?: string | null }).reply_to_email ?? null,
              logo_url: (venue as { logo_url?: string | null }).logo_url ?? null,
              cover_photo_url: (venue as { cover_photo_url?: string | null }).cover_photo_url ?? null,
              website_url: (venue as { website_url?: string | null }).website_url ?? null,
              timezone: (venue as { timezone?: string | null }).timezone ?? null,
            }),
            venue_id,
          );
          if (!email.sent) console.warn('[after] confirmation email not sent:', email.reason);
          if (!sms.sent && sms.reason !== 'skipped' && sms.reason !== 'no_phone') {
            console.warn('[after] confirmation SMS not sent:', sms.reason);
          }
        } catch (err) {
          console.error('[after] confirmation notifications failed:', err);
        }
      });
    }
  }

  logBookingOp({
    operation: 'create',
    venue_id,
    booking_id: booking.id,
    booking_model: effectiveModel,
  });

  return NextResponse.json(
    {
      booking_id: booking.id,
      requires_deposit: requiresDeposit,
      deposit_amount_pence: depositAmountPence ?? 0,
      client_secret: client_secret ?? undefined,
      stripe_account_id: requiresDeposit ? (venue.stripe_connected_account_id as string) : undefined,
      status: booking.status,
      cancellation_notice_hours: refundWindowHours,
    },
    { status: 201 }
  );
}
