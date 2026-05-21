import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getVenueStaff, requireManagedCalendarAccess } from '@/lib/venue-auth';
import { validateAppointmentModificationInterval } from '@/lib/booking/validate-appointment-modification';
import {
  linkedGrantAllowsMutation,
  loadStaffAccessibleBooking,
} from '@/lib/booking/staff-booking-access';

const bodySchema = z.object({
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  booking_time: z.string().min(4).max(12),
  practitioner_id: z.string().uuid(),
  appointment_service_id: z.string().uuid().optional().nullable(),
  service_item_id: z.string().uuid().optional().nullable(),
  duration_minutes: z.number().int().min(15).max(14 * 60).optional().nullable(),
  booking_end_time: z.string().optional().nullable(),
  service_variant_id: z.string().uuid().optional().nullable(),
  allow_manual_overlap: z.boolean().optional(),
});

/**
 * POST /api/venue/bookings/[id]/validate-appointment-modification
 * Dry-run appointment interval validation for staff modify UI (same engine as PATCH).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const loaded = await loadStaffAccessibleBooking(staff, id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const {
      booking,
      ownerVenueId: scopeVenueId,
      isOwnVenue,
      linkedGrant,
    } = loaded.ctx;

    const isAppointment = Boolean(booking.practitioner_id || booking.calendar_id);
    if (!isAppointment) {
      return NextResponse.json({ ok: false, error: 'Not an appointment booking' }, { status: 400 });
    }

    if (staff.role !== 'admin') {
      if (isOwnVenue) {
        const access = await requireManagedCalendarAccess(
          admin,
          scopeVenueId,
          staff,
          parsed.data.practitioner_id,
          'You can only validate changes on calendars assigned to your account.',
        );
        if (!access.ok) {
          return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
        }
      } else if (!linkedGrantAllowsMutation(linkedGrant, false)) {
        return NextResponse.json(
          { error: 'This link does not allow editing the other venue’s bookings.' },
          { status: 403 },
        );
      }
    }

    const svcId =
      (parsed.data.appointment_service_id as string | null | undefined) ??
      (parsed.data.service_item_id as string | null | undefined) ??
      (booking.appointment_service_id as string | null) ??
      (booking.service_item_id as string | null);

    if (!svcId) {
      return NextResponse.json(
        { ok: false, error: 'Cannot validate appointment: missing service on booking or request' },
        { status: 400 },
      );
    }

    const timeStr =
      parsed.data.booking_time.length >= 5 ? parsed.data.booking_time.slice(0, 5) : parsed.data.booking_time;

    const result = await validateAppointmentModificationInterval({
      admin,
      venueId: scopeVenueId,
      bookingId: id,
      newDate: parsed.data.booking_date,
      timeStr,
      practId: parsed.data.practitioner_id,
      svcId,
      durationMinutes: parsed.data.duration_minutes,
      bookingEndTime: parsed.data.booking_end_time,
      serviceVariantId: parsed.data.service_variant_id,
      bookingServiceVariantId: (booking as { service_variant_id?: string | null }).service_variant_id ?? null,
      bookingProcessingSnapshot: (booking as { processing_time_blocks?: unknown }).processing_time_blocks,
      allowManualOverlap: parsed.data.allow_manual_overlap === true,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST validate-appointment-modification failed:', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
