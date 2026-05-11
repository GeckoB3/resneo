import { NextRequest, NextResponse, after } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { findOrCreateGuest } from '@/lib/guests';
import { sendBookingConfirmationNotifications } from '@/lib/communications/send-templated';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { generateConfirmToken, hashConfirmToken } from '@/lib/confirm-token';
import { normalizeToE164 } from '@/lib/phone/e164';
import { resolveVenueMode } from '@/lib/venue-mode';
import {
  attachVenueClockToAppointmentInput,
  fetchAppointmentInput,
  computeAppointmentAvailability,
  type PhantomBooking,
} from '@/lib/availability/appointment-engine';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import { resolveAppointmentServiceOnlineCharge } from '@/lib/appointments/appointment-service-payment';
import {
  applyVariantToAppointmentInput,
  resolveBookableServiceWithVariant,
} from '@/lib/appointments/service-variant';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import { snapshotProcessingTimeBlocksFromCatalog } from '@/lib/appointments/processing-time';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import { z } from 'zod';
import { cancellationDeadlineHoursBefore } from '@/lib/booking/cancellation-deadline';
import { generateGroupBookingId } from '@/lib/booking/group-booking';
import type { GroupAppointmentLine } from '@/lib/emails/types';
import { isUnifiedSchedulingVenue, venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { loadServiceEntityBookingWindow } from '@/lib/booking/entity-booking-window';
import { resolveCancellationNoticeHoursForCreate } from '@/lib/booking/resolve-cancellation-notice-hours';
import { isPublicOnlineBookingBlocked } from '@/lib/billing/subscription-entitlement';
import { nextResponseIfVenueRequiresAccountLoginForBooking } from '@/lib/booking/require-account-login-for-public-booking';
import { formatGuestDisplayName, normaliseGuestNamePart } from '@/lib/guests/name';

const personEntrySchema = z.object({
  person_label: z.string().min(1).max(100),
  practitioner_id: z.string().uuid(),
  appointment_service_id: z.string().uuid(),
  /** Optional sub-option for the parent service. */
  service_variant_id: z.string().uuid().optional(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  booking_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
});

const createGroupSchema = z.object({
  venue_id: z.string().uuid(),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.union([z.literal(''), z.string().email()]).optional(),
  phone: z.string().max(24).optional(),
  source: z.enum(['online', 'phone', 'walk-in', 'widget', 'booking_page']),
  people: z.array(personEntrySchema).min(1).max(10),
  dietary_notes: z.string().max(1000).optional(),
  marketing_consent: z.boolean().optional(),
});

/**
 * POST /api/booking/create-group
 * Creates multiple linked appointment bookings for a group (Fresha-style).
 * All bookings share a group_booking_id, single guest contact, single Stripe payment.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createGroupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      venue_id,
      first_name,
      last_name,
      email,
      phone,
      source,
      people,
      dietary_notes,
      marketing_consent: marketingConsentRaw,
    } = parsed.data;
    const authClient = await createClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user?.email) {
      return NextResponse.json(
        { error: 'Sign in is required for group bookings.' },
        { status: 401 },
      );
    }
    const customerEmail = (email?.trim() || user.email).toLowerCase();
    if (customerEmail !== user.email.toLowerCase().trim()) {
      return NextResponse.json(
        { error: 'Booking email must match the signed-in account for group bookings.' },
        { status: 403 },
      );
    }

    const phoneRaw = (phone ?? '').trim();
    let phoneE164: string | null = null;
    if (phoneRaw) {
      const n = normalizeToE164(phoneRaw, 'GB');
      if (!n) {
        return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
      }
      phoneE164 = n;
    }

    if (source === 'phone' && !phoneE164) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    const isOnlineLikeSource =
      source === 'online' || source === 'widget' || source === 'booking_page';
    if (isOnlineLikeSource && !customerEmail) {
      return NextResponse.json(
        { error: 'Email is required for online bookings.' },
        { status: 400 },
      );
    }
    const guestLinkOptions = {
      silentAuthSignup: true,
    };

    const marketingConsentForGuest =
      isOnlineLikeSource && marketingConsentRaw !== undefined ? marketingConsentRaw : undefined;

    const supabase = getSupabaseAdminClient();

    const { data: venue, error: venueErr } = await supabase
      .from('venues')
      .select(
        'id, name, stripe_connected_account_id, address, booking_rules, timezone, opening_hours, venue_opening_exceptions, email, reply_to_email, pricing_tier, plan_status, subscription_current_period_end, billing_access_source, require_account_login_for_bookings',
      )
      .eq('id', venue_id)
      .single();

    if (venueErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const loginDenied = await nextResponseIfVenueRequiresAccountLoginForBooking({
      requireAccountLogin: Boolean(
        (venue as { require_account_login_for_bookings?: boolean }).require_account_login_for_bookings,
      ),
      authSupabase: authClient,
      bookingEmail: customerEmail,
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
    const useUnifiedBookingRows = venueUsesUnifiedAppointmentData(
      venueMode.bookingModel,
      venueMode.enabledModels,
    );
    if (!isUnifiedSchedulingVenue(venueMode.bookingModel) && !useUnifiedBookingRows) {
      return NextResponse.json({ error: 'Group bookings are only available for appointment businesses' }, { status: 400 });
    }

    // Validate each person's slot, using phantom bookings for already-validated ones
    const validatedPeople: Array<{
      person_label: string;
      practitioner_id: string;
      appointment_service_id: string;
      service_variant_id: string | null;
      booking_date: string;
      booking_time: string;
      duration_minutes: number;
      buffer_minutes: number;
      deposit_pence: number;
      estimated_end_time: string | null;
      service_display_name: string;
      service_price_pence: number | null;
      processing_time_blocks: ProcessingTimeBlock[];
    }> = [];

    const phantoms: PhantomBooking[] = [];

    for (let i = 0; i < people.length; i++) {
      const person = people[i]!;
      const timeStr = person.booking_time.slice(0, 5);

      const input = await fetchAppointmentInput({
        supabase,
        venueId: venue_id,
        date: person.booking_date,
        practitionerId: person.practitioner_id,
        serviceId: person.appointment_service_id,
      });

      // Inject phantom bookings from earlier people in this group (overlap checks)
      input.phantomBookings = [...phantoms];

      let chosenVariant = null as Awaited<ReturnType<typeof loadActiveVariantForService>>;
      if (person.service_variant_id) {
        chosenVariant = await loadActiveVariantForService({
          admin: supabase,
          venueId: venue_id,
          serviceId: person.appointment_service_id,
          variantId: person.service_variant_id,
        });
        if (!chosenVariant) {
          return NextResponse.json(
            { error: `Invalid service_variant_id for ${person.person_label}` },
            { status: 400 },
          );
        }
        applyVariantToAppointmentInput({
          services: input.services,
          serviceId: person.appointment_service_id,
          variant: chosenVariant,
        });
      }

      const svcWindow = await loadServiceEntityBookingWindow(
        supabase,
        venue_id,
        venueMode.bookingModel,
        person.appointment_service_id,
      );
      attachVenueClockToAppointmentInput(
        input,
        venue as { timezone?: string | null; booking_rules?: unknown; opening_hours?: unknown },
        svcWindow,
      );
      const result = computeAppointmentAvailability(input);
      const prac = result.practitioners.find((p) => p.id === person.practitioner_id);
      const slotAvailable = prac?.slots.some(
        (s) => s.start_time === timeStr && s.service_id === person.appointment_service_id
      );

      if (!slotAvailable) {
        return NextResponse.json(
          { error: `Slot for ${person.person_label} at ${timeStr} is no longer available` },
          { status: 409 }
        );
      }

      const baseSvc = input.services.find((s) => s.id === person.appointment_service_id);
      const ps = input.practitionerServices.find(
        (row) => row.practitioner_id === person.practitioner_id && row.service_id === person.appointment_service_id,
      );
      const mergedSvc = baseSvc ? mergeAppointmentServiceWithPractitionerLink(baseSvc, ps) : undefined;
      const svc = mergedSvc ? resolveBookableServiceWithVariant(mergedSvc, chosenVariant) : undefined;
      const durationMins = svc?.duration_minutes ?? 30;
      const bufferMins = svc?.buffer_minutes ?? 0;
      let estimatedEndTime: string | null = null;
      let depositPence = 0;

      if (svc) {
        const [y, mo, d] = person.booking_date.split('-').map(Number);
        const [hh, mm] = timeStr.split(':').map(Number);
        const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0));
        endDate.setMinutes(endDate.getMinutes() + svc.duration_minutes);
        estimatedEndTime = endDate.toISOString();

        const online = svc ? resolveAppointmentServiceOnlineCharge(svc) : null;
        if (online != null && online.amountPence > 0) {
          depositPence = online.amountPence;
        }
      }

      const processingSnap =
        mergedSvc && svc
          ? snapshotProcessingTimeBlocksFromCatalog({ service: mergedSvc, variant: chosenVariant })
          : [];

      validatedPeople.push({
        person_label: person.person_label,
        practitioner_id: person.practitioner_id,
        appointment_service_id: person.appointment_service_id,
        service_variant_id: person.service_variant_id ?? null,
        booking_date: person.booking_date,
        booking_time: timeStr,
        duration_minutes: durationMins,
        buffer_minutes: bufferMins,
        deposit_pence: depositPence,
        estimated_end_time: estimatedEndTime,
        service_display_name: svc?.name ?? 'Treatment',
        service_price_pence: svc?.price_pence ?? null,
        processing_time_blocks: processingSnap,
      });

      phantoms.push({
        practitioner_id: person.practitioner_id,
        start_time: timeStr,
        duration_minutes: durationMins,
        buffer_minutes: bufferMins,
        processing_time_minutes: svc?.processing_time_minutes ?? 0,
        processing_time_blocks: svc?.processing_time_blocks ?? [],
      });
    }

    const { data: nameRows } = useUnifiedBookingRows
      ? await supabase.from('unified_calendars').select('id, name').eq('venue_id', venue_id)
      : await supabase.from('practitioners').select('id, name').eq('venue_id', venue_id);
    const prMap = new Map((nameRows ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
    const groupAppointmentLines: GroupAppointmentLine[] = validatedPeople.map((p) => {
      return {
        person_label: p.person_label,
        booking_date: p.booking_date,
        booking_time: p.booking_time,
        practitioner_name: prMap.get(p.practitioner_id) ?? 'Staff',
        service_name: p.service_display_name,
        price_display:
          p.service_price_pence != null ? `£${(p.service_price_pence / 100).toFixed(2)}` : null,
      };
    });

    const totalDepositPence = validatedPeople.reduce((sum, p) => sum + p.deposit_pence, 0);
    const requiresDeposit = totalDepositPence > 0;

    if (requiresDeposit && !venue.stripe_connected_account_id) {
      return NextResponse.json(
        { error: 'Venue has not set up payments; deposits are required for these services.' },
        { status: 400 }
      );
    }

    const emailNorm = customerEmail;
    const guestFirst = normaliseGuestNamePart(first_name);
    const guestLast = normaliseGuestNamePart(last_name);
    const { guest } = await findOrCreateGuest(
      supabase,
      venue_id,
      {
        first_name: guestFirst,
        last_name: guestLast,
        email: emailNorm,
        phone: phoneE164,
        marketing_consent: marketingConsentForGuest,
      },
      guestLinkOptions,
    );

    const groupBookingId = generateGroupBookingId();
    const bookingIds: string[] = [];

    const firstForNotice = validatedPeople[0]!;
    const groupCancellationNoticeHours = await resolveCancellationNoticeHoursForCreate({
      supabase,
      venueId: venue_id,
      effectiveModel: venueMode.bookingModel,
      serviceItemId: useUnifiedBookingRows ? firstForNotice.appointment_service_id : null,
      appointmentServiceId:
        venueMode.bookingModel === 'practitioner_appointment' ? firstForNotice.appointment_service_id : null,
    });

    for (const person of validatedPeople) {
      const refundWindowHours = await resolveCancellationNoticeHoursForCreate({
        supabase,
        venueId: venue_id,
        effectiveModel: venueMode.bookingModel,
        serviceItemId: useUnifiedBookingRows ? person.appointment_service_id : null,
        appointmentServiceId:
          venueMode.bookingModel === 'practitioner_appointment' ? person.appointment_service_id : null,
      });
      const timeForDb = person.booking_time + ':00';
      const deadline = cancellationDeadlineHoursBefore(person.booking_date, person.booking_time, refundWindowHours);
      const policySnapshot = {
        refund_window_hours: refundWindowHours,
        policy: `Full refund if cancelled ${refundWindowHours}+ hours before appointment start. No refund within ${refundWindowHours} hours of the appointment or for no-shows.`,
      };

      const insert: Record<string, unknown> = {
        venue_id,
        guest_id: guest.id,
        booking_date: person.booking_date,
        booking_time: timeForDb,
        party_size: 1,
        /** Must be set explicitly — defaults to `table_reservation`, which fails the area_required CHECK for non-table venues. */
        booking_model: useUnifiedBookingRows ? 'unified_scheduling' : 'practitioner_appointment',
        status: requiresDeposit ? 'Pending' : 'Booked',
        source,
        guest_email: guest.email,
        dietary_notes: dietary_notes?.trim() || null,
        guest_first_name: guestFirst,
        guest_last_name: guestLast,
        guest_phone: phoneE164,
        deposit_amount_pence: person.deposit_pence > 0 ? person.deposit_pence : null,
        deposit_status: person.deposit_pence > 0 ? 'Pending' : 'Not Required',
        cancellation_deadline: deadline,
        cancellation_policy_snapshot: policySnapshot,
        estimated_end_time: person.estimated_end_time,
        practitioner_id: useUnifiedBookingRows ? null : person.practitioner_id,
        appointment_service_id: useUnifiedBookingRows ? null : person.appointment_service_id,
        service_variant_id: person.service_variant_id,
        group_booking_id: groupBookingId,
        person_label: person.person_label,
        processing_time_blocks: person.processing_time_blocks,
        ...(useUnifiedBookingRows
          ? {
              calendar_id: person.practitioner_id,
              service_item_id: person.appointment_service_id,
            }
          : {}),
      };

      const { data: booking, error: bookErr } = await supabase
        .from('bookings')
        .insert(insert)
        .select('id')
        .single();

      if (bookErr) {
        console.error('Group booking insert failed:', bookErr);
        // Clean up already-created bookings
        if (bookingIds.length > 0) {
          await supabase.from('bookings').delete().in('id', bookingIds);
        }
        return NextResponse.json({ error: 'Failed to create group booking' }, { status: 500 });
      }

      bookingIds.push(booking.id);
    }

    let client_secret: string | null = null;

    if (requiresDeposit && totalDepositPence > 0 && venue.stripe_connected_account_id) {
      try {
        const paymentIntent = await stripe.paymentIntents.create(
          {
            amount: totalDepositPence,
            currency: 'gbp',
            metadata: {
              booking_id: bookingIds[0]!,
              group_booking_id: groupBookingId,
              booking_ids: bookingIds.join(','),
              venue_id,
            },
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
          .in('id', bookingIds);
      } catch (stripeErr) {
        console.error('Group PaymentIntent create failed:', stripeErr);
        await supabase.from('bookings').delete().in('id', bookingIds);
        return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
      }
    }

    if (!requiresDeposit && (guest.email || guest.phone)) {
      const manageToken = generateConfirmToken();
      const primaryBookingId = bookingIds[0]!;
      await supabase
        .from('bookings')
        .update({
          confirm_token_hash: hashConfirmToken(manageToken),
          updated_at: new Date().toISOString(),
        })
        .eq('id', primaryBookingId);

      const manageBookingLink = await createOrGetBookingShortLink({
        venueId: venue_id,
        bookingId: primaryBookingId,
        purpose: 'manage',
      });

      const firstPerson = validatedPeople[0]!;
      after(async () => {
        try {
          await sendBookingConfirmationNotifications(
            {
              id: primaryBookingId,
              guest_name: formatGuestDisplayName(guest.first_name, guest.last_name),
              guest_email: guest.email ?? null,
              guest_phone: guest.phone ?? null,
              booking_date: firstPerson.booking_date,
              booking_time: firstPerson.booking_time,
              party_size: validatedPeople.length,
              dietary_notes: null,
              deposit_amount_pence: null,
              deposit_status: 'Not Required',
              manage_booking_link: manageBookingLink,
              email_variant: 'appointment',
              group_appointments: groupAppointmentLines,
              practitioner_name: groupAppointmentLines[0]?.practitioner_name ?? null,
              appointment_service_name:
                groupAppointmentLines.length === 1 ? groupAppointmentLines[0]!.service_name : 'Group booking',
              appointment_price_display: null,
            },
            venueRowToEmailData({
              name: venue.name,
              address: venue.address ?? null,
              email: venue.email ?? null,
              reply_to_email: venue.reply_to_email ?? null,
            }),
            venue_id,
          );
        } catch (err) {
          console.error('[after] group confirmation email failed:', err);
        }
      });
    }

    return NextResponse.json(
      {
        group_booking_id: groupBookingId,
        booking_ids: bookingIds,
        requires_deposit: requiresDeposit,
        total_deposit_pence: totalDepositPence,
        client_secret: client_secret ?? undefined,
        stripe_account_id: requiresDeposit ? venue.stripe_connected_account_id : undefined,
        status: requiresDeposit ? 'Pending' : 'Booked',
        cancellation_notice_hours: groupCancellationNoticeHours,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('POST /api/booking/create-group failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
