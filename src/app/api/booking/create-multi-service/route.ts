import { NextRequest, NextResponse, after } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { findOrCreateGuest } from '@/lib/guests';
import {
  CLIENT_ADDRESS_REQUIRED_ERROR,
  bookingLocationInsertFields,
  clientAddressRequestFields,
  hasCompleteClientAddress,
  resolveServiceLocation,
} from '@/lib/booking/service-location';
import { sendBookingConfirmationNotifications } from '@/lib/communications/send-templated';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { generateConfirmToken, hashConfirmToken } from '@/lib/confirm-token';
import { normalizeToE164 } from '@/lib/phone/e164';
import { resolveVenueMode } from '@/lib/venue-mode';
import {
  attachVenueClockToAppointmentInput,
  fetchAppointmentInput,
  validateExactAppointmentStart,
  type PhantomBooking,
} from '@/lib/availability/appointment-engine';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import { resolveAppointmentServiceOnlineChargeWithAddons } from '@/lib/appointments/appointment-service-payment';
import { loadAddonsForBooking } from '@/lib/addons/addon-resolution';
import { validateAddonSelections } from '@/lib/addons/addon-selection-validation';
import { buildAddonSnapshots, totalsFromSnapshots, type BookingAddonSnapshot } from '@/lib/addons/snapshot-addons';
import { bookingAddonSelectionArraySchema } from '@/lib/addons/zod-schemas';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';
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
import { timeToMinutes, minutesToTime } from '@/lib/availability';
import { isUnifiedSchedulingVenue, venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { loadServiceEntityBookingWindow } from '@/lib/booking/entity-booking-window';
import { resolveCancellationNoticeHoursForCreate } from '@/lib/booking/resolve-cancellation-notice-hours';
import { isPublicOnlineBookingBlocked } from '@/lib/billing/subscription-entitlement';
import { nextResponseIfVenueRequiresAccountLoginForBooking } from '@/lib/booking/require-account-login-for-public-booking';
import { formatGuestDisplayName, normaliseGuestNamePart } from '@/lib/guests/name';
import {
  enforceBookingCompliance,
  complianceUnmetMessage,
  COMPLIANCE_REQUIREMENT_UNMET,
} from '@/lib/compliance/enforce-booking';
import {
  captureBookingComplianceSubmissions,
  linkBookingComplianceRecords,
} from '@/lib/compliance/booking-capture';
import { complianceBookingSubmissionsSchema } from '@/lib/compliance/zod-schemas';

const serviceEntrySchema = z.object({
  service_id: z.string().uuid(),
  practitioner_id: z.string().uuid(),
  start_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
  /** Optional sub-option for the parent service. */
  service_variant_id: z.string().uuid().optional(),
  /** Optional add-ons stacked on this segment's service. */
  addons: bookingAddonSelectionArraySchema.optional(),
});

const createMultiServiceSchema = z.object({
  venue_id: z.string().uuid(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.union([z.literal(''), z.string().email()]).optional(),
  phone: z.string().max(24).optional(),
  source: z.enum(['online', 'phone', 'walk-in', 'widget', 'booking_page']),
  services: z.array(serviceEntrySchema).min(1).max(4),
  dietary_notes: z.string().max(1000).optional(),
  occasion: z.string().max(200).optional(),
  marketing_consent: z.boolean().optional(),
  /** §7.7: set when the booking was routed through a venue collective page. */
  collective_id: z.string().uuid().optional(),
  /** Combined page: the offering that produced this booking (attribution). */
  collective_service_item_id: z.string().uuid().optional(),
  /** Compliance forms completed inline during booking (§9.3) + the draft id used for any file uploads. */
  compliance_submissions: complianceBookingSubmissionsSchema.optional(),
  compliance_draft_id: z.string().uuid().optional(),
  /** Client-address services: where staff travel to (mandatory for public sources). */
  ...clientAddressRequestFields,
});

/**
 * POST /api/booking/create-multi-service
 * One guest, one practitioner, consecutive services (Model B), linked by group_booking_id.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createMultiServiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const {
      venue_id,
      booking_date,
      first_name,
      last_name,
      email,
      phone,
      source,
      services: rawServices,
      dietary_notes,
      occasion,
      marketing_consent: marketingConsentRaw,
      collective_id,
      collective_service_item_id,
    } = parsed.data;

    const phoneRaw = (phone ?? '').trim();
    let phoneE164: string | null = null;
    if (phoneRaw) {
      const n = normalizeToE164(phoneRaw, 'GB');
      if (!n) {
        return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
      }
      phoneE164 = n;
    }

    const isOnlineLikeSource =
      source === 'online' || source === 'widget' || source === 'booking_page';
    if (isOnlineLikeSource && !String(email ?? '').trim()) {
      return NextResponse.json(
        { error: 'Email is required for online bookings.' },
        { status: 400 },
      );
    }
    const customerEmail = String(email ?? '').trim().toLowerCase();
    const guestLinkOptions = {
      silentAuthSignup: isOnlineLikeSource && Boolean(customerEmail),
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

    const authClient = await createClient();
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
      return NextResponse.json({ error: 'Multi-service bookings are only for appointment businesses' }, { status: 400 });
    }

    const practitionerId = rawServices[0]!.practitioner_id;
    if (!rawServices.every((s) => s.practitioner_id === practitionerId)) {
      return NextResponse.json({ error: 'All services must be with the same practitioner' }, { status: 400 });
    }

    const sorted = [...rawServices].sort(
      (a, b) => timeToMinutes(a.start_time.slice(0, 5)) - timeToMinutes(b.start_time.slice(0, 5)),
    );

    type ValidatedSeg = {
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
      addon_snapshots: BookingAddonSnapshot[];
      addons_total_price_pence: number;
      addons_total_duration_minutes: number;
    };

    const validated: ValidatedSeg[] = [];
    const phantoms: PhantomBooking[] = [];
    const useUnifiedForAddons = await venueUsesUnifiedAppointmentServiceData(supabase, venue_id);
    const addonSchema = useUnifiedForAddons ? 'service_item' : 'appointment_service';

    for (let i = 0; i < sorted.length; i++) {
      const seg = sorted[i]!;
      const timeStr = seg.start_time.slice(0, 5);

      const input = await fetchAppointmentInput({
        supabase,
        venueId: venue_id,
        date: booking_date,
        practitionerId,
        serviceId: seg.service_id,
      });
      input.phantomBookings = [...phantoms];

      let chosenVariant = null as Awaited<ReturnType<typeof loadActiveVariantForService>>;
      if (seg.service_variant_id) {
        chosenVariant = await loadActiveVariantForService({
          admin: supabase,
          venueId: venue_id,
          serviceId: seg.service_id,
          variantId: seg.service_variant_id,
        });
        if (!chosenVariant) {
          return NextResponse.json(
            { error: 'Invalid service_variant_id for this service' },
            { status: 400 },
          );
        }
        applyVariantToAppointmentInput({
          services: input.services,
          serviceId: seg.service_id,
          variant: chosenVariant,
        });
      }

      // Validate this segment's add-ons BEFORE the slot check.
      let segAddonSnapshots: BookingAddonSnapshot[] = [];
      let segAddonTotals = { total_price_pence: 0, total_duration_minutes: 0 };
      if (seg.addons && seg.addons.length > 0) {
        const { groups, groupsById } = await loadAddonsForBooking({
          admin: supabase,
          venueId: venue_id,
          schema: addonSchema,
          parentId: seg.service_id,
          includeHidden:
            source !== 'online' && source !== 'widget' && source !== 'booking_page',
        });
        const validation = validateAddonSelections({
          selections: seg.addons,
          groupsForService: groups,
          source:
            source === 'online' || source === 'widget' || source === 'booking_page'
              ? 'public'
              : 'staff',
        });
        if (!validation.ok) {
          return NextResponse.json(
            { error: 'INVALID_ADDON_SELECTION', details: validation.errors },
            { status: 400 },
          );
        }
        segAddonSnapshots = buildAddonSnapshots({
          selected: validation.resolvedAddons,
          groupsById,
          segmentIndex: i,
        });
        segAddonTotals = totalsFromSnapshots(segAddonSnapshots);
      }

      // Resolve the authoritative service (variant + practitioner overrides), then fold
      // add-on minutes onto it and write that exact duration back into the engine input so
      // the slot/consecutive check fits the full wall-clock the booking will occupy.
      const baseSvc = input.services.find((s) => s.id === seg.service_id);
      const ps = input.practitionerServices.find(
        (row) => row.practitioner_id === practitionerId && row.service_id === seg.service_id,
      );
      const mergedSvc = baseSvc ? mergeAppointmentServiceWithPractitionerLink(baseSvc, ps) : undefined;
      const svc = mergedSvc ? resolveBookableServiceWithVariant(mergedSvc, chosenVariant) : undefined;
      const resolvedBaseDuration = svc?.duration_minutes ?? 30;
      const durationMins = resolvedBaseDuration + segAddonTotals.total_duration_minutes;
      const bufferMins = svc?.buffer_minutes ?? 0;
      if (segAddonTotals.total_duration_minutes > 0) {
        const idx = input.services.findIndex((s) => s.id === seg.service_id);
        if (idx >= 0) {
          input.services[idx] = { ...input.services[idx]!, duration_minutes: durationMins };
        }
      }

      const svcWindow = await loadServiceEntityBookingWindow(supabase, venue_id, venueMode.bookingModel, seg.service_id);
      attachVenueClockToAppointmentInput(
        input,
        venue as { timezone?: string | null; booking_rules?: unknown; opening_hours?: unknown },
        svcWindow,
      );
      const exact = validateExactAppointmentStart(input, practitionerId, seg.service_id, timeStr);
      if (!exact.ok) {
        return NextResponse.json(
          { error: exact.reason ?? `Slot at ${timeStr} is not available` },
          { status: 409 },
        );
      }

      if (i > 0) {
        const prev = validated[i - 1]!;
        const expectedStartM =
          timeToMinutes(prev.booking_time) + prev.duration_minutes + prev.buffer_minutes;
        const actualM = timeToMinutes(timeStr);
        if (expectedStartM !== actualM) {
          return NextResponse.json(
            {
              error: 'Services must be consecutive (each start = previous end + buffer)',
              expected_start: minutesToTime(expectedStartM),
            },
            { status: 400 },
          );
        }
      }

      let estimatedEndTime: string | null = null;
      let depositPence = 0;
      if (svc) {
        const [y, mo, d] = booking_date.split('-').map(Number);
        const [hh, mm] = timeStr.split(':').map(Number);
        const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0));
        // durationMins includes add-on minutes; use it (not svc.duration_minutes) for the end time.
        endDate.setMinutes(endDate.getMinutes() + durationMins);
        estimatedEndTime = endDate.toISOString();
        // Full payment rolls add-on price into the charge; deposit stays on base+variant.
        const online = resolveAppointmentServiceOnlineChargeWithAddons({
          svc,
          addons_total_price_pence: segAddonTotals.total_price_pence,
        });
        if (online != null && online.amountPence > 0) {
          depositPence = online.amountPence;
        }
      }

      const processingSnap =
        mergedSvc && svc
          ? snapshotProcessingTimeBlocksFromCatalog({ service: mergedSvc, variant: chosenVariant })
          : [];

      validated.push({
        practitioner_id: practitionerId,
        appointment_service_id: seg.service_id,
        service_variant_id: seg.service_variant_id ?? null,
        booking_date,
        booking_time: timeStr,
        duration_minutes: durationMins,
        buffer_minutes: bufferMins,
        deposit_pence: depositPence,
        estimated_end_time: estimatedEndTime,
        service_display_name: svc?.name ?? 'Treatment',
        service_price_pence: svc?.price_pence ?? null,
        processing_time_blocks: processingSnap,
        addon_snapshots: segAddonSnapshots,
        addons_total_price_pence: segAddonTotals.total_price_pence,
        addons_total_duration_minutes: segAddonTotals.total_duration_minutes,
      });

      phantoms.push({
        practitioner_id: practitionerId,
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
    const prMap = new Map(
      (nameRows ?? []).map((p: { id: string; name: string }) => [p.id, p.name]),
    );

    const groupAppointmentLines: GroupAppointmentLine[] = validated.map((p) => ({
      person_label: '',
      booking_date: p.booking_date,
      booking_time: p.booking_time,
      practitioner_name: prMap.get(p.practitioner_id) ?? 'Staff',
      service_name: p.service_display_name,
      price_display: p.service_price_pence != null ? `£${(p.service_price_pence / 100).toFixed(2)}` : null,
    }));

    const totalDepositPence = validated.reduce((sum, p) => sum + p.deposit_pence, 0);
    const requiresDeposit = totalDepositPence > 0;

    if (requiresDeposit && !venue.stripe_connected_account_id) {
      return NextResponse.json(
        { error: 'Venue has not set up payments; deposits are required for these services.' },
        { status: 400 },
      );
    }

    // Per-segment service delivery location: any client-address service in the chain
    // makes the address mandatory for public sources; each booking row snapshots its
    // own service's location.
    const segmentLocations = new Map<string, Awaited<ReturnType<typeof resolveServiceLocation>>>();
    for (const seg of validated) {
      if (segmentLocations.has(seg.appointment_service_id)) continue;
      segmentLocations.set(
        seg.appointment_service_id,
        await resolveServiceLocation(supabase, venue_id, {
          serviceItemId: useUnifiedBookingRows ? seg.appointment_service_id : null,
          appointmentServiceId: useUnifiedBookingRows ? null : seg.appointment_service_id,
        }),
      );
    }
    const clientAddressInput = {
      client_address_line1: parsed.data.client_address_line1,
      client_address_line2: parsed.data.client_address_line2,
      client_address_city: parsed.data.client_address_city,
      client_address_postcode: parsed.data.client_address_postcode,
    };
    const anyClientAddressService = [...segmentLocations.values()].some(
      (l) => l.locationType === 'client_address',
    );
    if (anyClientAddressService && isOnlineLikeSource && !hasCompleteClientAddress(clientAddressInput)) {
      return NextResponse.json({ error: CLIENT_ADDRESS_REQUIRED_ERROR }, { status: 400 });
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
        ...(anyClientAddressService && clientAddressInput.client_address_line1?.trim()
          ? {
              address: {
                line1: clientAddressInput.client_address_line1,
                line2: clientAddressInput.client_address_line2 ?? null,
                city: clientAddressInput.client_address_city ?? null,
                postcode: clientAddressInput.client_address_postcode ?? null,
              },
            }
          : {}),
      },
      guestLinkOptions,
    );

    // Capture any compliance forms the guest completed inline (§9.3, Phase 2b) BEFORE the
    // gate, so a just-completed mandatory form satisfies it. booking_id is backfilled below.
    let complianceRecordIds: string[] = [];
    if (parsed.data.compliance_submissions && parsed.data.compliance_submissions.length > 0) {
      const cap = await captureBookingComplianceSubmissions(supabase, {
        venueId: venue_id,
        guestId: guest.id,
        draftId: parsed.data.compliance_draft_id ?? null,
        submissions: parsed.data.compliance_submissions,
        captureIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip'),
        captureUserAgent: request.headers.get('user-agent'),
      });
      if (!cap.ok) {
        return NextResponse.json(
          { error: cap.error, ...(cap.fieldErrors ? { field_errors: cap.fieldErrors } : {}) },
          { status: cap.status },
        );
      }
      complianceRecordIds = cap.recordIds;
    }

    // Compliance gate per segment (§5.1, audit C2). Mirrors the single-booking and
    // group-create flows: all segments share one guest, so a single record satisfies
    // every segment requiring that type. Runs before any insert so a blocked booking
    // creates nothing. Online-like sources block on block_online/block_all; staff
    // sources (phone/walk-in) block only on block_all.
    const msComplianceContext = isOnlineLikeSource ? 'online' : 'staff';
    const msBlockedDetails: Array<{
      service_id: string;
      compliance_type_id: string;
      compliance_type_name: string;
      enforcement: string;
      state: string;
    }> = [];
    const msBlockedUnmet: Array<{
      compliance_type_id: string;
      compliance_type_name: string;
      enforcement: string;
      state: string;
    }> = [];
    for (const seg of validated) {
      const segCheck = await enforceBookingCompliance(supabase, {
        venueId: venue_id,
        guestId: guest.id,
        appointmentServiceId: useUnifiedBookingRows ? null : seg.appointment_service_id,
        serviceItemId: useUnifiedBookingRows ? seg.appointment_service_id : null,
        bookingDate: seg.booking_date,
        bookingTime: seg.booking_time + ':00',
        context: msComplianceContext,
      });
      if (segCheck.blocked) {
        for (const d of segCheck.details) {
          msBlockedDetails.push({ service_id: seg.appointment_service_id, ...d });
          msBlockedUnmet.push(d);
        }
      }
    }
    if (msBlockedUnmet.length > 0) {
      return NextResponse.json(
        {
          error: COMPLIANCE_REQUIREMENT_UNMET,
          message: complianceUnmetMessage(msBlockedUnmet, msComplianceContext),
          details: msBlockedDetails,
        },
        { status: 409 },
      );
    }

    const groupBookingId = generateGroupBookingId();
    const bookingIds: string[] = [];

    const refundWindowHours = await resolveCancellationNoticeHoursForCreate({
      supabase,
      venueId: venue_id,
      effectiveModel: venueMode.bookingModel,
      serviceItemId: useUnifiedBookingRows ? validated[0]!.appointment_service_id : null,
      appointmentServiceId:
        venueMode.bookingModel === 'practitioner_appointment' ? validated[0]!.appointment_service_id : null,
    });

    const firstStart = validated[0]!.booking_time;
    const deadline = cancellationDeadlineHoursBefore(booking_date, firstStart, refundWindowHours);
    const policySnapshot = {
      refund_window_hours: refundWindowHours,
      policy: `Full refund if cancelled ${refundWindowHours}+ hours before appointment start. No refund within ${refundWindowHours} hours of the appointment or for no-shows.`,
    };

    // §7.7: attribute to a venue collective only when this venue is genuinely
    // an active member, so a forged collective_id cannot be attached.
    let collectiveIdForInsert: string | null = null;
    let collectiveServiceItemIdForInsert: string | null = null;
    if (collective_id) {
      const { data: membership } = await supabase
        .from('venue_collective_members')
        .select('id')
        .eq('collective_id', collective_id)
        .eq('venue_id', venue_id)
        .eq('status', 'active')
        .maybeSingle();
      if (membership) {
        collectiveIdForInsert = collective_id;
        collectiveServiceItemIdForInsert = collective_service_item_id ?? null;
      }
    }

    for (const seg of validated) {
      const timeForDb = seg.booking_time + ':00';
      const insert: Record<string, unknown> = {
        venue_id,
        guest_id: guest.id,
        booking_date: seg.booking_date,
        booking_time: timeForDb,
        party_size: 1,
        /** Must be set explicitly — defaults to `table_reservation`, which fails the area_required CHECK for non-table venues. */
        booking_model: useUnifiedBookingRows ? 'unified_scheduling' : 'practitioner_appointment',
        status: requiresDeposit ? 'Pending' : 'Booked',
        source,
        guest_email: guest.email,
        dietary_notes: dietary_notes?.trim() || null,
        occasion: occasion?.trim() || null,
        guest_first_name: guestFirst,
        guest_last_name: guestLast,
        guest_phone: phoneE164,
        deposit_amount_pence: seg.deposit_pence > 0 ? seg.deposit_pence : null,
        deposit_status: seg.deposit_pence > 0 ? 'Pending' : 'Not Required',
        cancellation_deadline: deadline,
        cancellation_policy_snapshot: policySnapshot,
        estimated_end_time: seg.estimated_end_time,
        practitioner_id: useUnifiedBookingRows ? null : seg.practitioner_id,
        appointment_service_id: useUnifiedBookingRows ? null : seg.appointment_service_id,
        service_variant_id: seg.service_variant_id,
        group_booking_id: groupBookingId,
        person_label: null,
        collective_id: collectiveIdForInsert,
        collective_service_item_id: collectiveServiceItemIdForInsert,
        processing_time_blocks: seg.processing_time_blocks,
        addons_total_price_pence: seg.addons_total_price_pence,
        addons_total_duration_minutes: seg.addons_total_duration_minutes,
        ...(useUnifiedBookingRows
          ? {
              calendar_id: seg.practitioner_id,
              service_item_id: seg.appointment_service_id,
            }
          : {}),
        ...(() => {
          const loc = segmentLocations.get(seg.appointment_service_id);
          return loc ? bookingLocationInsertFields(loc.locationType, clientAddressInput) : {};
        })(),
      };

      const { data: booking, error: bookErr } = await supabase
        .from('bookings')
        .insert(insert)
        .select('id')
        .single();

      if (bookErr) {
        console.error('Multi-service booking insert failed:', bookErr);
        if (bookingIds.length > 0) {
          await supabase.from('bookings').delete().in('id', bookingIds);
        }
        return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
      }

      if (seg.addon_snapshots.length > 0) {
        const addonRows = seg.addon_snapshots.map((s) => ({ ...s, booking_id: booking.id }));
        const { error: addErr } = await supabase.from('booking_addons').insert(addonRows);
        if (addErr) {
          console.error('Multi-service booking_addons insert failed:', addErr);
          await supabase.from('bookings').delete().in('id', [...bookingIds, booking.id]);
          return NextResponse.json({ error: 'Failed to save add-ons for booking' }, { status: 500 });
        }
      }

      bookingIds.push(booking.id);
    }

    // Attach any inline-captured compliance records to the (first) booking of the group.
    if (complianceRecordIds.length > 0 && bookingIds[0]) {
      await linkBookingComplianceRecords(supabase, {
        venueId: venue_id,
        recordIds: complianceRecordIds,
        bookingId: bookingIds[0],
      });
    }

    let client_secret: string | null = null;

    if (requiresDeposit && totalDepositPence > 0 && venue.stripe_connected_account_id) {
      try {
        const primaryId = bookingIds[0]!;
        const paymentIntent = await stripe.paymentIntents.create(
          {
            amount: totalDepositPence,
            currency: 'gbp',
            metadata: {
              booking_id: primaryId,
              booking_ids: bookingIds.join(','),
              group_booking_id: groupBookingId,
              venue_id,
            },
            automatic_payment_methods: { enabled: true },
          },
          { stripeAccount: venue.stripe_connected_account_id },
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
        console.error('Multi-service PaymentIntent create failed:', stripeErr);
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

      after(async () => {
        try {
          await sendBookingConfirmationNotifications(
            {
              id: primaryBookingId,
              guest_name: formatGuestDisplayName(guest.first_name, guest.last_name),
              guest_email: guest.email ?? null,
              guest_phone: guest.phone ?? null,
              booking_date: validated[0]!.booking_date,
              booking_time: validated[0]!.booking_time,
              party_size: 1,
              dietary_notes: dietary_notes?.trim() || null,
              deposit_amount_pence: null,
              deposit_status: 'Not Required',
              manage_booking_link: manageBookingLink,
              email_variant: 'appointment',
              booking_model: 'unified_scheduling',
              group_appointments: groupAppointmentLines,
              practitioner_name: groupAppointmentLines[0]?.practitioner_name ?? null,
              appointment_service_name:
                groupAppointmentLines.length === 1
                  ? groupAppointmentLines[0]!.service_name
                  : 'Multi-service appointment',
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
          console.error('[after] multi-service confirmation email failed:', err);
        }
      });
    }

    return NextResponse.json(
      {
        group_booking_id: groupBookingId,
        booking_ids: bookingIds,
        primary_booking_id: bookingIds[0],
        requires_deposit: requiresDeposit,
        total_deposit_pence: totalDepositPence,
        client_secret: client_secret ?? undefined,
        stripe_account_id: requiresDeposit ? venue.stripe_connected_account_id : undefined,
        status: requiresDeposit ? 'Pending' : 'Booked',
        cancellation_notice_hours: refundWindowHours,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/booking/create-multi-service failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
