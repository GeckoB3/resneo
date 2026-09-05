import { NextRequest, NextResponse, after } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { cancelAbandonedPaymentIntent } from '@/lib/booking/cancel-abandoned-payment-intent';
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
  MAX_APPOINTMENT_CORE_DURATION_MINUTES,
  MIN_APPOINTMENT_CORE_DURATION_MINUTES,
} from '@/lib/availability/appointment-engine';
import { isCollectiveId, resolveCombinedBookingTarget } from '@/lib/linked-accounts/collective-booking-bridge';
import { recordStaffCollectiveCrossVenueCreate } from '@/lib/linked-accounts/collective-staff-audit';
import { MAX_SERVICES_PER_VISIT } from '@/lib/booking/service-chain';
import {
  createAppointmentSlotRecheck,
  SLOT_TAKEN_RESPONSE,
  type AppointmentSlotRecheck,
} from '@/lib/booking/revalidate-appointment-slot';
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
import { bookingEndFieldsForStorage } from '@/lib/booking/booking-end-time';
import { generateGroupBookingId } from '@/lib/booking/group-booking';
import type { GroupAppointmentLine } from '@/lib/emails/types';
import { timeToMinutes, minutesToTime } from '@/lib/availability';
import { isUnifiedSchedulingVenue, venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import {
  isGuestBookingDateAllowed,
  isStaffWalkInBookingDateAllowed,
  loadServiceEntityBookingWindow,
} from '@/lib/booking/entity-booking-window';
import { resolveCancellationNoticeHoursForCreate } from '@/lib/booking/resolve-cancellation-notice-hours';
import { resolveStaffVisitChargeDiscretion } from '@/lib/booking/staff-visit-charge-discretion';
import { nextResponseIfPublicBookingBlockedForRequest } from '@/lib/booking/light-plan-public-block';
import { nextResponseIfVenueRequiresAccountLoginForBooking } from '@/lib/booking/require-account-login-for-public-booking';
import { formatGuestDisplayName, normaliseGuestNamePart } from '@/lib/guests/name';
import {
  enforceBookingCompliance,
  type ComplianceDetailBrief,
  complianceUnmetMessage,
  COMPLIANCE_REQUIREMENT_UNMET,
} from '@/lib/compliance/enforce-booking';
import {
  captureBookingComplianceSubmissions,
  linkBookingComplianceRecords,
} from '@/lib/compliance/booking-capture';
import { complianceBookingSubmissionsSchema } from '@/lib/compliance/zod-schemas';
import {
  resolveCaptureMode,
  createCardHoldCustomer,
  createCardHoldSetupIntent,
  insertCardHoldRows,
} from '@/lib/booking/card-hold-capture';
import { buildCardHoldTermsSnapshot, renderCardHoldConsentText } from '@/lib/booking/card-hold-terms';

const serviceEntrySchema = z.object({
  service_id: z.string().uuid(),
  practitioner_id: z.string().uuid(),
  start_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
  /** Optional sub-option for the parent service. */
  service_variant_id: z.string().uuid().optional(),
  /** Optional add-ons stacked on this segment's service. */
  addons: bookingAddonSelectionArraySchema.optional(),
  /**
   * Staff custom duration for this segment (the dashboard's per-service
   * override), honoured only for the `phone` / `walk-in` sources like the
   * single-booking staff route. Public callers cannot shorten a service.
   */
  duration_minutes: z
    .number()
    .int()
    .min(MIN_APPOINTMENT_CORE_DURATION_MINUTES)
    .max(MAX_APPOINTMENT_CORE_DURATION_MINUTES)
    .optional(),
});

const createMultiServiceSchema = z.object({
  venue_id: z.string().uuid(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.union([z.literal(''), z.string().email()]).optional(),
  phone: z.string().max(24).optional(),
  source: z.enum(['online', 'phone', 'walk-in', 'widget', 'booking_page']),
  /**
   * Staff discretion over money, honoured only for the `phone` / `walk-in`
   * sources and ignored outright for public ones. See
   * `resolveStaffVisitChargeDiscretion`.
   */
  require_deposit: z.boolean().optional(),
  require_card_hold: z.boolean().optional(),
  services: z.array(serviceEntrySchema).min(1).max(MAX_SERVICES_PER_VISIT),
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
      venue_id: requestedVenueId,
      booking_date,
      first_name,
      last_name,
      email,
      phone,
      source,
      require_deposit,
      require_card_hold,
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
    // Staff may take a visit without collecting anything; public sources always
    // charge what the catalog says. Applied per segment below, so a mixed chain
    // waives as one visit (one guest, one decision).
    const staffCharges = resolveStaffVisitChargeDiscretion({
      source,
      require_deposit,
      require_card_hold,
    });
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

    /**
     * Combined booking page (plan §22): `venue_id` is the collective and every
     * `service_id` is an OFFERING id. Each segment resolves, through its
     * calendar, to the owning venue and that venue's source service, carrying
     * the collective's own length. The single-booking `create` route and
     * `validate-appointment-slot` already did this; this one did not, so a
     * visit of two or more services on a combined page failed with
     * "Venue not found" once the picker let guests choose several at once.
     */
    type SegmentEntry = (typeof rawServices)[number] & {
      collective_service_item_id: string | null;
      collective_duration_override: number | null;
    };
    let venue_id = requestedVenueId;
    let services: SegmentEntry[] = rawServices.map((s) => ({
      ...s,
      collective_service_item_id: null,
      collective_duration_override: null,
    }));
    let collectiveIdFromVenue: string | null = null;
    if (await isCollectiveId(supabase, requestedVenueId)) {
      const resolved: SegmentEntry[] = [];
      let owningVenueId: string | null = null;
      for (const s of rawServices) {
        const target = await resolveCombinedBookingTarget(supabase, {
          collectiveId: requestedVenueId,
          offeringId: s.service_id,
          calendarId: s.practitioner_id,
        });
        if (!target || (owningVenueId && target.venueId !== owningVenueId)) {
          return NextResponse.json(
            { error: 'This booking option is no longer available.' },
            { status: 409 },
          );
        }
        owningVenueId = target.venueId;
        resolved.push({
          ...s,
          service_id: target.sourceServiceId,
          collective_service_item_id: s.service_id,
          collective_duration_override: target.durationMinutes,
        });
      }
      services = resolved;
      venue_id = owningVenueId!;
      collectiveIdFromVenue = requestedVenueId;
    }
    const effectiveCollectiveId = collectiveIdFromVenue ?? collective_id ?? null;

    const { data: venue, error: venueErr } = await supabase
      .from('venues')
      .select(
        'id, name, stripe_connected_account_id, address, booking_rules, timezone, opening_hours, venue_opening_exceptions, email, reply_to_email, pricing_tier, plan_status, subscription_current_period_end, billing_access_source, require_account_login_for_bookings, feature_flags, booking_page_config',
      )
      .eq('id', venue_id)
      .single();

    if (venueErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    // Bearer-capable, not cookie-only: with createClient() a mobile Bearer
    // caller resolved as signed OUT here, so no app could book at any venue
    // with require_account_login_for_bookings on. The same file already
    // resolves the user with createRouteHandlerClient further down; one
    // request must not answer under two auth models (P0-12).
    const authClient = await createRouteHandlerClient(request);
    const loginDenied = await nextResponseIfVenueRequiresAccountLoginForBooking({
      requireAccountLogin: Boolean(
        (venue as { require_account_login_for_bookings?: boolean }).require_account_login_for_bookings,
      ),
      authSupabase: authClient,
      bookingEmail: customerEmail,
    });
    if (loginDenied) return loginDenied;

    // Staff of the venue, or of a partner linked to it with booking rights, are
    // not the public: their session lets a blocked venue's diary keep working.
    const publicBlocked = await nextResponseIfPublicBookingBlockedForRequest(
      {
        pricing_tier: (venue as { pricing_tier?: string | null }).pricing_tier,
        plan_status: (venue as { plan_status?: string | null }).plan_status,
        subscription_current_period_end: (venue as { subscription_current_period_end?: string | null })
          .subscription_current_period_end,
        billing_access_source: (venue as { billing_access_source?: string | null }).billing_access_source,
      },
      { request, admin: supabase },
      venue_id,
    );
    if (publicBlocked) return publicBlocked;

    const venueMode = await resolveVenueMode(supabase, venue_id);
    const useUnifiedBookingRows = venueUsesUnifiedAppointmentData(
      venueMode.bookingModel,
      venueMode.enabledModels,
    );
    if (!isUnifiedSchedulingVenue(venueMode.bookingModel) && !useUnifiedBookingRows) {
      return NextResponse.json({ error: 'Multi-service bookings are only for appointment businesses' }, { status: 400 });
    }

    const practitionerId = services[0]!.practitioner_id;
    if (!services.every((s) => s.practitioner_id === practitionerId)) {
      return NextResponse.json({ error: 'All services must be with the same practitioner' }, { status: 400 });
    }

    const sorted = [...services].sort(
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
      /** No-show fee (pence) when this service's requirement is 'card_hold' (spec 7.1). */
      card_hold_fee_pence: number | null;
      estimated_end_time: string | null;
      booking_end_time: string | null;
      service_display_name: string;
      service_price_pence: number | null;
      processing_time_blocks: ProcessingTimeBlock[];
      addon_snapshots: BookingAddonSnapshot[];
      addons_total_price_pence: number;
      addons_total_duration_minutes: number;
      /** Combined page: the offering this row was booked through. */
      collective_service_item_id: string | null;
    };

    const validated: ValidatedSeg[] = [];
    /** C3 interim — one per segment, all re-run before the first insert. */
    const visitSlotRechecks: AppointmentSlotRecheck[] = [];
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

      // The collective may sell the offering at its own length; reserve that,
      // not the source service's. Applied before the variant and add-ons, so
      // anything chosen on top still stacks.
      if (seg.collective_duration_override != null) {
        const ovIdx = input.services.findIndex((s) => s.id === seg.service_id);
        if (ovIdx >= 0) {
          input.services[ovIdx] = { ...input.services[ovIdx]!, duration_minutes: seg.collective_duration_override };
        }
      }

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
      /**
       * Always load the linked groups, so a REQUIRED group (`min_select`) is
       * enforced even when the client omits `addons` entirely. Gating this whole
       * block on the client having sent something meant a service that cannot be
       * booked on its own without choosing an option could be booked without one
       * simply by being a segment of a multi-service visit, arriving with no
       * add-on, no charge and the segment chain laid out short. The
       * single-service route has always done it this way.
       */
      const { groups, groupsById } = await loadAddonsForBooking({
        admin: supabase,
        venueId: venue_id,
        schema: addonSchema,
        parentId: seg.service_id,
        includeHidden:
          source !== 'online' && source !== 'widget' && source !== 'booking_page',
      });
      if (groups.length > 0) {
        const validation = validateAddonSelections({
          selections: seg.addons ?? [],
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
      const staffCustomDuration =
        source === 'phone' || source === 'walk-in' ? seg.duration_minutes ?? null : null;
      const resolvedBaseDuration = staffCustomDuration ?? svc?.duration_minutes ?? 30;
      const durationMins = resolvedBaseDuration + segAddonTotals.total_duration_minutes;
      const bufferMins = svc?.buffer_minutes ?? 0;
      if (segAddonTotals.total_duration_minutes > 0 || staffCustomDuration != null) {
        const idx = input.services.findIndex((s) => s.id === seg.service_id);
        if (idx >= 0) {
          input.services[idx] = { ...input.services[idx]!, duration_minutes: durationMins };
        }
        if (staffCustomDuration != null) {
          // The engine re-applies the practitioner's own duration when it
          // merges the link; a staff override has to win over that too.
          input.practitionerServices = input.practitionerServices.map((row) =>
            row.practitioner_id === practitionerId && row.service_id === seg.service_id
              ? { ...row, custom_duration_minutes: null }
              : row,
          );
        }
      }

      const svcWindow = await loadServiceEntityBookingWindow(supabase, venue_id, venueMode.bookingModel, seg.service_id);
      attachVenueClockToAppointmentInput(
        input,
        venue as { timezone?: string | null; booking_rules?: unknown; opening_hours?: unknown },
        svcWindow,
      );

      /**
       * SA-H7. The window was loaded and attached, but never actually asked.
       * `attachVenueClockToAppointmentInput` sets `allowSameDayBooking` on the
       * input and the engine assigns it and never reads it again, so the only
       * real enforcement is this helper, which `booking/create` calls and this
       * route did not.
       *
       * ~~Both this route and `create-group` are anonymous public flows.~~
       * **That premise was wrong and the first version of this gate was an
       * unconditional guest check because of it.** This route is also where the
       * staff mobile app creates every multi-service visit, with `source` of
       * `phone` or `walk-in`. A walk-in is by definition today, so on a venue
       * with `allow_same_day_booking: false` the guest rule refused the counter
       * booking staff were standing there taking.
       *
       * The split mirrors `api/venue/bookings` exactly, so a visit and a single
       * booking now answer the same way: only `walk-in` skips the same-day
       * rule. A staff PHONE booking still gets the guest rule, which is what
       * singles do; whether that is right is a product question, but it is not
       * one this route should answer differently from its sibling.
       *
       * Checked per segment, because the window belongs to the service and a
       * visit can mix services with different windows. One segment out of
       * window refuses the visit, which is the only coherent answer when they
       * all share a date.
       *
       * Uses the timezone the attach just resolved, so this asks about the same
       * calendar day the engine is working in.
       */
      const msDateAllowed =
        source === 'walk-in'
          ? isStaffWalkInBookingDateAllowed(booking_date, svcWindow, input.venueTimezone ?? 'Europe/London')
          : isGuestBookingDateAllowed(booking_date, svcWindow, input.venueTimezone ?? 'Europe/London');
      if (!msDateAllowed) {
        return NextResponse.json(
          { error: 'This date is not available for booking' },
          { status: 400 },
        );
      }

      const exact = validateExactAppointmentStart(input, practitionerId, seg.service_id, timeStr);
      if (!exact.ok) {
        return NextResponse.json(
          { error: exact.reason ?? `Slot at ${timeStr} is not available` },
          { status: 409 },
        );
      }
      // C3 interim — a visit validates every segment up front and writes them
      // in a later loop, so each segment's slot can be taken in between.
      // `exact` mode: a visit books off-grid starts, so the grid check would
      // refuse starts this route legitimately allows.
      visitSlotRechecks.push(
        createAppointmentSlotRecheck({
          supabase,
          venueId: venue_id,
          date: booking_date,
          practitionerId,
          serviceId: seg.service_id,
          timeHm: timeStr,
          input,
          mode: 'exact',
        }),
      );

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
      let segBookingEndTime: string | null = null;
      let depositPence = 0;
      let segCardHoldFeePence: number | null = null;
      if (svc) {
        // durationMins includes add-on minutes; use it (not svc.duration_minutes)
        // for the end time. Both end columns come from one helper so the engine
        // (which trusts `booking_end_time`) and the UI cannot disagree.
        const endFields = bookingEndFieldsForStorage({
          dateYmd: booking_date,
          startHHmm: timeStr,
          durationMinutes: durationMins,
        });
        estimatedEndTime = endFields.estimated_end_time;
        segBookingEndTime = endFields.booking_end_time;
        // Full payment rolls add-on price into the charge; deposit stays on base+variant.
        const online = resolveAppointmentServiceOnlineChargeWithAddons({
          svc,
          addons_total_price_pence: segAddonTotals.total_price_pence,
        });
        if (online != null && online.amountPence > 0) {
          if (online.chargeLabel === 'card_hold') {
            // Card hold (spec 7.1): fixed fee, no money due at booking for this row.
            // Staff may waive per booking (D6), walk-ins included.
            if (staffCharges.holdCards) {
              segCardHoldFeePence = online.amountPence;
            }
          } else if (staffCharges.chargeDeposits) {
            // Covers `deposit` and `full_payment` alike: staff take money in
            // person or not at all, and a waived visit must confirm on the spot.
            depositPence = online.amountPence;
          }
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
        card_hold_fee_pence: segCardHoldFeePence,
        estimated_end_time: estimatedEndTime,
        booking_end_time: segBookingEndTime,
        service_display_name: svc?.name ?? 'Treatment',
        service_price_pence: svc?.price_pence ?? null,
        processing_time_blocks: processingSnap,
        addon_snapshots: segAddonSnapshots,
        addons_total_price_pence: segAddonTotals.total_price_pence,
        addons_total_duration_minutes: segAddonTotals.total_duration_minutes,
        collective_service_item_id: seg.collective_service_item_id,
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
    // Capture unit = every row of this bundle (spec 7.0/D7): per-service card-hold
    // fees make per-row hold rows; mixed bundles use payment_with_setup.
    const totalCardHoldFeePence = validated.reduce((sum, p) => sum + (p.card_hold_fee_pence ?? 0), 0);
    const hasCardHold = validated.some((p) => p.card_hold_fee_pence != null);
    const hasPaymentStep = requiresDeposit || hasCardHold;

    if (hasPaymentStep && !venue.stripe_connected_account_id) {
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
        serviceIds: validated.map((seg) => seg.appointment_service_id),
        // Per-visit forms (validity 0) expire at the end of the appointment's day. One
        // record has to satisfy every segment, so anchor it to the LAST segment date
        // (booking_date is YYYY-MM-DD, so the string max is the latest date).
        visitDate: validated.reduce<string | null>(
          (latest, seg) => (latest === null || seg.booking_date > latest ? seg.booking_date : latest),
          null,
        ),
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
    // Staff are never blocked (plan §5); their unmet requirements are merged by type and
    // returned as `compliance_warnings` so the confirmation screen can prompt for capture.
    const msComplianceWarnings = new Map<string, ComplianceDetailBrief>();
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
      for (const w of segCheck.warnings) {
        if (!msComplianceWarnings.has(w.compliance_type_id)) msComplianceWarnings.set(w.compliance_type_id, w);
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
    if (effectiveCollectiveId) {
      const { data: membership } = await supabase
        .from('venue_collective_members')
        .select('id')
        .eq('collective_id', effectiveCollectiveId)
        .eq('venue_id', venue_id)
        .eq('status', 'active')
        .maybeSingle();
      if (membership) {
        collectiveIdForInsert = effectiveCollectiveId;
      }
    }

    // C3 interim — re-check every segment immediately before the first insert.
    // A visit is written whole or not at all, so one taken segment refuses the
    // lot. Narrows the race, does not close it.
    for (const recheck of visitSlotRechecks) {
      if (!(await recheck.stillAvailable())) {
        return NextResponse.json(SLOT_TAKEN_RESPONSE, { status: 409 });
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
        status: hasPaymentStep ? 'Pending' : 'Booked',
        source,
        guest_email: guest.email,
        dietary_notes: dietary_notes?.trim() || null,
        occasion: occasion?.trim() || null,
        guest_first_name: guestFirst,
        guest_last_name: guestLast,
        guest_phone: phoneE164,
        // Card-hold rows await the card save like deposit rows await payment (spec 7.1):
        // deposit_status Pending with deposit_amount_pence NULL.
        deposit_amount_pence: seg.deposit_pence > 0 ? seg.deposit_pence : null,
        deposit_status:
          seg.deposit_pence > 0 || seg.card_hold_fee_pence != null ? 'Pending' : 'Not Required',
        cancellation_deadline: deadline,
        cancellation_policy_snapshot: policySnapshot,
        estimated_end_time: seg.estimated_end_time,
        booking_end_time: seg.booking_end_time,
        practitioner_id: useUnifiedBookingRows ? null : seg.practitioner_id,
        appointment_service_id: useUnifiedBookingRows ? null : seg.appointment_service_id,
        service_variant_id: seg.service_variant_id,
        group_booking_id: groupBookingId,
        person_label: null,
        // A member venue's own service booked through the staff form carries no
        // offering and is a plain booking in its venue: no attribution on that row.
        collective_id:
          collectiveIdForInsert && !(collectiveIdFromVenue && seg.collective_service_item_id == null)
            ? collectiveIdForInsert
            : null,
        collective_service_item_id:
          collectiveIdForInsert && !(collectiveIdFromVenue && seg.collective_service_item_id == null)
            ? seg.collective_service_item_id ?? collective_service_item_id ?? null
            : null,
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

    // Capture mode over the whole bundle (spec 7.0/D7): 'none'/'payment' behave
    // exactly as before; 'setup' saves the card with no charge; 'payment_with_setup'
    // charges the money AND vaults the card on one PaymentIntent.
    const captureMode = resolveCaptureMode(
      validated.map((seg, i) => ({
        bookingId: bookingIds[i]!,
        chargePence: seg.deposit_pence,
        cardHoldFeePence: seg.card_hold_fee_pence,
      })),
    );
    const cardHoldRowInputs = validated.flatMap((seg, i) =>
      seg.card_hold_fee_pence != null
        ? [{ bookingId: bookingIds[i]!, feePence: seg.card_hold_fee_pence }]
        : [],
    );

    let client_secret: string | null = null;

    if (captureMode === 'payment' && requiresDeposit && totalDepositPence > 0 && venue.stripe_connected_account_id) {
      // Tracked so the catch can kill the intent too (plan 8.1): abandoning
      // the bookings while the PI stays confirmable would let a guest pay
      // money against rows that no longer exist.
      let createdPaymentIntentId: string | null = null;
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
        createdPaymentIntentId = paymentIntent.id;
        client_secret = paymentIntent.client_secret;

        const { error: linkErr } = await supabase
          .from('bookings')
          .update({
            stripe_payment_intent_id: paymentIntent.id,
            updated_at: new Date().toISOString(),
          })
          .in('id', bookingIds);
        if (linkErr) throw new Error(`PI linkage write failed: ${linkErr.message}`);
      } catch (stripeErr) {
        console.error('Multi-service PaymentIntent create failed:', stripeErr);
        await cancelAbandonedPaymentIntent(createdPaymentIntentId, venue.stripe_connected_account_id, {
          groupBookingId,
        });
        await supabase.from('bookings').delete().in('id', bookingIds);
        return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
      }
    } else if (
      (captureMode === 'setup' || captureMode === 'payment_with_setup') &&
      venue.stripe_connected_account_id
    ) {
      const stripeAccountId = venue.stripe_connected_account_id;
      let cardHoldCustomerId: string | null = null;
      // Mixed-mode PI, tracked for catch cleanup (plan 8.1): the old catch
      // deleted the bookings and the customer but left the PI confirmable.
      let createdPaymentIntentId: string | null = null;
      try {
        // Dedicated booking-scoped Customer for the capture unit (D2).
        const customer = await createCardHoldCustomer({
          leadBookingId: bookingIds[0]!,
          venueId: venue_id,
          stripeConnectedAccountId: stripeAccountId,
          email: guest.email ?? (emailNorm || null),
          name: formatGuestDisplayName(guest.first_name, guest.last_name),
        });
        cardHoldCustomerId = customer.id;

        if (captureMode === 'setup') {
          // No money due: SetupIntent only (spec 7.0).
          const setupIntent = await createCardHoldSetupIntent({
            customerId: customer.id,
            leadBookingId: bookingIds[0]!,
            venueId: venue_id,
            stripeConnectedAccountId: stripeAccountId,
          });
          await insertCardHoldRows(supabase, cardHoldRowInputs, {
            venueId: venue_id,
            stripeConnectedAccountId: stripeAccountId,
            stripeCustomerId: customer.id,
            stripeSetupIntentId: setupIntent.id,
            termsSnapshot: buildCardHoldTermsSnapshot(venue.name, totalCardHoldFeePence, refundWindowHours),
          });
          client_secret = setupIntent.client_secret;
        } else {
          // Mixed bundle (D7): today's PaymentIntent gains customer +
          // setup_future_usage + card-only so one confirmation charges the money
          // AND vaults the card (spec 7.0). Card-hold rows share the unit PI id;
          // their hold rows carry no SetupIntent.
          const paymentIntent = await stripe.paymentIntents.create(
            {
              amount: totalDepositPence,
              currency: 'gbp',
              customer: customer.id,
              setup_future_usage: 'off_session',
              payment_method_types: ['card'],
              metadata: {
                booking_id: bookingIds[0]!,
                booking_ids: bookingIds.join(','),
                group_booking_id: groupBookingId,
                venue_id,
              },
            },
            { stripeAccount: stripeAccountId },
          );
          createdPaymentIntentId = paymentIntent.id;
          client_secret = paymentIntent.client_secret;

          const { error: linkErr } = await supabase
            .from('bookings')
            .update({
              stripe_payment_intent_id: paymentIntent.id,
              updated_at: new Date().toISOString(),
            })
            .in('id', bookingIds);
          if (linkErr) throw new Error(`PI linkage write failed: ${linkErr.message}`);

          await insertCardHoldRows(supabase, cardHoldRowInputs, {
            venueId: venue_id,
            stripeConnectedAccountId: stripeAccountId,
            stripeCustomerId: customer.id,
            stripeSetupIntentId: null,
            termsSnapshot: buildCardHoldTermsSnapshot(venue.name, totalCardHoldFeePence, refundWindowHours),
          });
        }
      } catch (stripeErr) {
        console.error('Multi-service card hold setup failed:', stripeErr);
        await cancelAbandonedPaymentIntent(createdPaymentIntentId, stripeAccountId, {
          groupBookingId,
        });
        await supabase.from('bookings').delete().in('id', bookingIds);
        if (cardHoldCustomerId) {
          try {
            await stripe.customers.del(cardHoldCustomerId, { stripeAccount: stripeAccountId });
          } catch (cleanupErr) {
            console.error('Card hold customer cleanup failed:', cleanupErr);
          }
        }
        return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
      }
    }

    if (captureMode === 'none' && (guest.email || guest.phone)) {
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
              booking_page_config: venue.booking_page_config ?? null,
            }),
            venue_id,
          );
        } catch (err) {
          console.error('[after] multi-service confirmation email failed:', err);
        }
      });
    }

    // A member venue's staff booking for the collective onto a partner's calendar:
    // record the cross-venue write and tell the owner, as the staff create route does.
    // Registered with `after` like the emails above: a promise merely left running
    // when the response goes out may never finish on a serverless host.
    if (collectiveIdFromVenue) {
      const owningVenueId = venue_id;
      after(() => recordStaffCollectiveCrossVenueCreate({ admin: supabase, request, owningVenueId, bookingIds }));
    }

    return NextResponse.json(
      {
        group_booking_id: groupBookingId,
        booking_ids: bookingIds,
        primary_booking_id: bookingIds[0],
        ...(msComplianceContext === 'staff' && msComplianceWarnings.size > 0
          ? { compliance_warnings: [...msComplianceWarnings.values()] }
          : {}),
        // requires_deposit is true whenever a payment step must render (spec §18):
        // setup mode carries the SetupIntent secret in the existing client_secret field.
        requires_deposit: hasPaymentStep,
        payment_mode: captureMode === 'none' ? ('payment' as const) : captureMode,
        card_hold_fee_pence: hasCardHold ? totalCardHoldFeePence : null,
        // The exact consent line the server snapshotted (§7.5); the payment step
        // displays this string so shown text and dispute evidence cannot drift.
        card_hold_consent_text:
          hasCardHold && totalCardHoldFeePence > 0
            ? renderCardHoldConsentText(venue.name, totalCardHoldFeePence, refundWindowHours)
            : undefined,
        total_deposit_pence: totalDepositPence,
        client_secret: client_secret ?? undefined,
        stripe_account_id: hasPaymentStep ? venue.stripe_connected_account_id : undefined,
        status: hasPaymentStep ? 'Pending' : 'Booked',
        cancellation_notice_hours: refundWindowHours,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/booking/create-multi-service failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
