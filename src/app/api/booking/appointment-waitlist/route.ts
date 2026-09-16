import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { normalizeToE164 } from '@/lib/phone/e164';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { normaliseGuestNamePart } from '@/lib/guests/name';
import {
  assertAppointmentsFeatureEnabled,
  featureFlagDisabledResponse,
  parseVenueFeatureFlags,
} from '@/lib/feature-flags';
import { validateGuestWaitlistTimeInput } from '@/lib/booking/waitlist-time-window';
import { isCollectiveId } from '@/lib/linked-accounts/collective-booking-bridge';
import { resolveCollectiveWaitlistTarget } from '@/lib/linked-accounts/collective-waitlist';

const joinSchema = z.object({
  venue_id: z.string().uuid(),
  service_id: z.string().uuid(),
  desired_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferred_window: z.enum(['all_day', 'time_range']),
  desired_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  desired_time_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  practitioner_id: z.string().uuid().optional(),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  guest_email: z.string().trim().email(),
  guest_phone: z.string().min(1).max(24),
  notes: z.string().max(500).optional(),
});

/** POST /api/booking/appointment-waitlist — guest joins appointment schedule waitlist */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    // The collective page (D43): the entry is filed at the member venue that can offer the time.
    let venueId = parsed.data.venue_id;
    let serviceId = parsed.data.service_id;
    let practitionerId = parsed.data.practitioner_id ?? null;
    if (await isCollectiveId(supabase, venueId)) {
      const target = await resolveCollectiveWaitlistTarget(supabase, {
        collectiveId: venueId,
        offeringId: serviceId,
        calendarId: practitionerId,
      });
      if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });
      venueId = target.venueId;
      serviceId = target.serviceId;
      practitionerId = target.calendarId;
    }
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId, request);
    if (blocked) return blocked;

    const { data: venueRow } = await supabase
      .from('venues')
      .select('feature_flags')
      .eq('id', venueId)
      .maybeSingle();
    const venueFlags = parseVenueFeatureFlags(
      (venueRow as { feature_flags?: unknown } | null)?.feature_flags,
    );
    try {
      assertAppointmentsFeatureEnabled('waitlist_v2', venueFlags);
    } catch {
      return featureFlagDisabledResponse('waitlist_v2');
    }

    const guestPhoneE164 = normalizeToE164(parsed.data.guest_phone, 'GB');
    if (!guestPhoneE164) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }

    const guestFirst = normaliseGuestNamePart(parsed.data.first_name);
    const guestLast = normaliseGuestNamePart(parsed.data.last_name);

    const { data: unifiedService } = await supabase
      .from('service_items')
      .select('id')
      .eq('id', serviceId)
      .eq('venue_id', venueId)
      .maybeSingle();

    const appointmentServiceId = unifiedService ? null : serviceId;
    const serviceItemId = unifiedService ? serviceId : null;

    if (!unifiedService) {
      const { data: legacyService } = await supabase
        .from('appointment_services')
        .select('id')
        .eq('id', serviceId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!legacyService) {
        return NextResponse.json({ error: 'Invalid service for this venue' }, { status: 400 });
      }
    }

    const { count } = await supabase
      .from('waitlist_entries')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('desired_date', parsed.data.desired_date)
      .eq('guest_phone', guestPhoneE164)
      .eq('waitlist_kind', 'appointment')
      .eq('status', 'waiting');

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'You are already on the waitlist for this date.' },
        { status: 409 },
      );
    }

    const timeParsed = validateGuestWaitlistTimeInput({
      preferred_window: parsed.data.preferred_window,
      desired_time: parsed.data.desired_time,
      desired_time_end: parsed.data.desired_time_end,
    });
    if (!timeParsed.ok) {
      return NextResponse.json({ error: timeParsed.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('waitlist_entries')
      .insert({
        venue_id: venueId,
        waitlist_kind: 'appointment',
        appointment_service_id: appointmentServiceId,
        service_item_id: serviceItemId,
        practitioner_id: practitionerId,
        desired_date: parsed.data.desired_date,
        desired_time: timeParsed.desired_time,
        desired_time_end: timeParsed.desired_time_end,
        party_size: 1,
        guest_first_name: guestFirst,
        guest_last_name: guestLast,
        guest_email: parsed.data.guest_email.trim().toLowerCase(),
        guest_phone: guestPhoneE164,
        notes: parsed.data.notes || null,
      })
      .select('id, status')
      .single();

    if (error) {
      console.error('POST /api/booking/appointment-waitlist failed:', error);
      return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 });
    }

    return NextResponse.json(
      {
        waitlist_id: data.id,
        message:
          'You have been added to the waitlist. We will contact you if an appointment becomes available.',
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/booking/appointment-waitlist failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
