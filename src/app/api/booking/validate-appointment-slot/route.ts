import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import {
  attachVenueClockToAppointmentInput,
  fetchAppointmentInput,
  validateExactAppointmentStart,
  type PhantomBooking,
} from '@/lib/availability/appointment-engine';
import { applyVariantToAppointmentInput } from '@/lib/appointments/service-variant';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import { loadAddonsForBooking } from '@/lib/addons/addon-resolution';
import { validateAddonSelections } from '@/lib/addons/addon-selection-validation';
import { bookingAddonSelectionArraySchema } from '@/lib/addons/zod-schemas';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';
import { z } from 'zod';
import { isUnifiedSchedulingVenue, venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { isGuestBookingDateAllowed, loadServiceEntityBookingWindow } from '@/lib/booking/entity-booking-window';
import { publicBookingBlockedForRequest } from '@/lib/booking/light-plan-public-block';
import {
  loadActiveWaitlistOfferForGuestAccess,
  validateBookingAgainstWaitlistOffer,
} from '@/lib/booking/validate-waitlist-offer-access';
import {
  isCollectiveId,
  resolveCombinedBookingTarget,
} from '@/lib/linked-accounts/collective-booking-bridge';

const phantomSchema = z.object({
  practitioner_id: z.string().uuid(),
  start_time: z.string(),
  duration_minutes: z.number().int().min(1),
  buffer_minutes: z.number().int().min(0),
});

const bodySchema = z.object({
  venue_id: z.string().uuid(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  practitioner_id: z.string().uuid(),
  service_id: z.string().uuid(),
  /** When the parent service has variants, the chosen variant id (drives duration/price). */
  variant_id: z.string().uuid().optional(),
  start_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
  phantoms: z.array(phantomSchema).optional(),
  waitlist_offer_id: z.string().uuid().optional(),
  /** Optional add-ons that extend the appointment duration. */
  addons: bookingAddonSelectionArraySchema.optional(),
});

/**
 * POST /api/booking/validate-appointment-slot
 * Checks a single exact start time (for multi-service consecutive slots).
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
    }

    const { booking_date, practitioner_id, variant_id, start_time, phantoms, waitlist_offer_id, addons } = parsed.data;
    let { venue_id, service_id } = parsed.data;
    const supabase = getSupabaseAdminClient();

    /**
     * Combined booking page (plan §22): the customer flow targets the synthetic
     * collective venue, so `venue_id` IS the collective id and `service_id` is an
     * OFFERING id, neither of which exists in `venues` / the owner's catalogue.
     *
     * Every other route on that journey resolves this (`appointment-catalog`,
     * `appointment-calendar`, `availability`, `create`, `create-multi-service`);
     * this one did not, so `resolveVenueMode` found no venue and answered "Not an
     * appointment venue". That broke "Add another service" on every combined
     * page, and with it the confirm step, because `validateMultiServiceChain`
     * calls this endpoint once per segment.
     */
    let collectiveDurationOverride: number | null = null;
    if (await isCollectiveId(supabase, venue_id)) {
      const target = await resolveCombinedBookingTarget(supabase, {
        collectiveId: venue_id,
        offeringId: service_id,
        calendarId: practitioner_id,
      });
      if (!target) {
        return NextResponse.json(
          { ok: false, error: 'This booking option is no longer available.' },
          { status: 409 },
        );
      }
      venue_id = target.venueId;
      service_id = target.sourceServiceId;
      // The collective may sell the offering at its own length; reserve that, not
      // the source service's, or the slot is checked against the wrong span.
      collectiveDurationOverride = target.durationMinutes;
    }

    const venueMode = await resolveVenueMode(supabase, venue_id);
    if (
      !isUnifiedSchedulingVenue(venueMode.bookingModel) &&
      !venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels)
    ) {
      return NextResponse.json({ ok: false, error: 'Not an appointment venue' }, { status: 400 });
    }

    const { data: venue } = await supabase
      .from('venues')
      .select(
        'timezone, booking_rules, opening_hours, venue_opening_exceptions, pricing_tier, plan_status, subscription_current_period_end, billing_access_source',
      )
      .eq('id', venue_id)
      .single();

    if (!venue) {
      return NextResponse.json({ ok: false, error: 'Venue not found' }, { status: 404 });
    }

    if (
      await publicBookingBlockedForRequest(
        {
          pricing_tier: (venue as { pricing_tier?: string | null }).pricing_tier,
          plan_status: (venue as { plan_status?: string | null }).plan_status,
          subscription_current_period_end: (venue as { subscription_current_period_end?: string | null })
            .subscription_current_period_end,
          billing_access_source: (venue as { billing_access_source?: string | null }).billing_access_source,
        },
        { request, admin: supabase },
        venue_id,
      )
    ) {
      return NextResponse.json({ ok: false, error: 'Online booking is temporarily unavailable for this venue.' });
    }

    const serviceWindow = await loadServiceEntityBookingWindow(supabase, venue_id, venueMode.bookingModel, service_id);

    const tz =
      typeof (venue as { timezone?: string | null }).timezone === 'string' &&
      String((venue as { timezone?: string | null }).timezone).trim() !== ''
        ? String((venue as { timezone?: string | null }).timezone).trim()
        : 'Europe/London';
    if (!isGuestBookingDateAllowed(booking_date, serviceWindow, tz)) {
      return NextResponse.json({ ok: false, error: 'This date is not available for booking' });
    }

    const input = await fetchAppointmentInput({
      supabase,
      venueId: venue_id,
      date: booking_date,
      practitionerId: practitioner_id,
      serviceId: service_id,
    });
    input.phantomBookings = (phantoms ?? []) as PhantomBooking[];

    /**
     * Applied before the variant and add-on adjustments below, mirroring the
     * create route: the collective's effective duration replaces the source
     * service's, and anything chosen on top of it still stacks.
     */
    if (collectiveDurationOverride != null) {
      const idx = input.services.findIndex((s) => s.id === service_id);
      if (idx >= 0) {
        input.services[idx] = {
          ...input.services[idx]!,
          duration_minutes: collectiveDurationOverride,
        };
      }
    }

    if (variant_id) {
      const variant = await loadActiveVariantForService({
        admin: supabase,
        venueId: venue_id,
        serviceId: service_id,
        variantId: variant_id,
      });
      if (!variant) {
        return NextResponse.json({ ok: false, error: 'Invalid variant_id for this service' });
      }
      applyVariantToAppointmentInput({ services: input.services, serviceId: service_id, variant });
    }

    if (addons && addons.length > 0) {
      const useUnified = await venueUsesUnifiedAppointmentServiceData(supabase, venue_id);
      const schema = useUnified ? 'service_item' : 'appointment_service';
      const { groups } = await loadAddonsForBooking({
        admin: supabase,
        venueId: venue_id,
        schema,
        parentId: service_id,
        includeHidden: false,
      });
      const validation = validateAddonSelections({
        selections: addons,
        groupsForService: groups,
        source: 'public',
      });
      if (!validation.ok) {
        return NextResponse.json({
          ok: false,
          error: 'INVALID_ADDON_SELECTION',
          details: validation.errors,
        });
      }
      let delta = 0;
      for (const a of validation.resolvedAddons) delta += a.additional_duration_minutes;
      if (delta > 0) {
        const idx = input.services.findIndex((s) => s.id === service_id);
        if (idx >= 0) {
          input.services[idx] = {
            ...input.services[idx]!,
            duration_minutes: input.services[idx]!.duration_minutes + delta,
          };
        }
      }
    }

    attachVenueClockToAppointmentInput(
      input,
      venue as { timezone?: string | null; booking_rules?: unknown; opening_hours?: unknown },
      serviceWindow,
    );

    if (waitlist_offer_id) {
      const offer = await loadActiveWaitlistOfferForGuestAccess(supabase, waitlist_offer_id, venue_id);
      if (!offer) {
        return NextResponse.json({ ok: false, error: 'This waitlist offer is no longer valid.' });
      }
      const timeStr = start_time.slice(0, 5);
      const offerValidation = validateBookingAgainstWaitlistOffer(offer, {
        bookingDate: booking_date,
        bookingTimeHm: timeStr,
        practitionerOrCalendarId: practitioner_id,
        appointmentServiceId: service_id,
      });
      if (!offerValidation.ok) {
        return NextResponse.json({ ok: false, error: offerValidation.message });
      }
      input.skipPastSlotFilter = true;
    }

    const timeStr = start_time.slice(0, 5);
    const result = validateExactAppointmentStart(input, practitioner_id, service_id, timeStr);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason ?? 'Unavailable' });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/booking/validate-appointment-slot failed:', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
