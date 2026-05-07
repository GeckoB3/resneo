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
import { z } from 'zod';
import { isUnifiedSchedulingVenue, venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { isGuestBookingDateAllowed, loadServiceEntityBookingWindow } from '@/lib/booking/entity-booking-window';
import { isPublicOnlineBookingBlocked } from '@/lib/billing/subscription-entitlement';

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

    const { venue_id, booking_date, practitioner_id, service_id, variant_id, start_time, phantoms } = parsed.data;
    const supabase = getSupabaseAdminClient();

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
      isPublicOnlineBookingBlocked({
        pricing_tier: (venue as { pricing_tier?: string | null }).pricing_tier,
        plan_status: (venue as { plan_status?: string | null }).plan_status,
        subscription_current_period_end: (venue as { subscription_current_period_end?: string | null })
          .subscription_current_period_end,
        billing_access_source: (venue as { billing_access_source?: string | null }).billing_access_source,
      })
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

    attachVenueClockToAppointmentInput(
      input,
      venue as { timezone?: string | null; booking_rules?: unknown; opening_hours?: unknown },
      serviceWindow,
    );

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
