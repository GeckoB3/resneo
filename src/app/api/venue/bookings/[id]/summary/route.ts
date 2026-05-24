import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { resolveCdeBookingContext } from '@/lib/booking/cde-booking-context';
import { loadStaffAccessibleBooking } from '@/lib/booking/staff-booking-access';
import type { BookingModel } from '@/types/booking-models';

/**
 * GET /api/venue/bookings/[id]/summary — lightweight payload for first paint / prefetch.
 * Omits events, communications, and combination notes (filled by full GET).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { id } = await params;

    const loaded = await loadStaffAccessibleBooking(staff, id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const { booking, ownerVenueId: scopeVenueId } = loaded.ctx;

    const bookingAreaId = (booking as { area_id?: string | null }).area_id;
    const bookingVariantId = (booking as { service_variant_id?: string | null }).service_variant_id;
    const bookingTimeStr =
      typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';

    const [areaResult, variantResult, guestResult, tableAssignmentsResult, cde_context] =
      await Promise.all([
        bookingAreaId
          ? staff.db
              .from('areas')
              .select('name')
              .eq('id', bookingAreaId)
              .eq('venue_id', scopeVenueId)
              .maybeSingle()
          : Promise.resolve({ data: null as { name?: string } | null }),
        bookingVariantId
          ? staff.db
              .from('service_variants')
              .select('name, price_pence')
              .eq('id', bookingVariantId)
              .eq('venue_id', scopeVenueId)
              .maybeSingle()
          : Promise.resolve({ data: null as { name?: string; price_pence?: number | null } | null }),
        staff.db
          .from('guests')
          .select(
            'id, first_name, last_name, email, phone, visit_count, last_visit_date, tags, customer_profile_notes',
          )
          .eq('id', booking.guest_id)
          .single(),
        staff.db
          .from('booking_table_assignments')
          .select('table_id, table:venue_tables(id, name)')
          .eq('booking_id', id),
        resolveCdeBookingContext(
          staff.db,
          booking as Parameters<typeof resolveCdeBookingContext>[1],
        ),
      ]);

    const area_name = (areaResult.data as { name?: string } | null)?.name ?? null;

    let service_variant_name: string | null = null;
    let service_variant_price_pence: number | null = null;
    const sv = variantResult.data;
    if (sv) {
      service_variant_name = (sv as { name?: string }).name ?? null;
      service_variant_price_pence = (sv as { price_pence?: number | null }).price_pence ?? null;
    }

    const guest = guestResult.data;
    const tableAssignments = tableAssignmentsResult.data;

    const assignedTables = (tableAssignments ?? []).map((a: { table_id: string; table: unknown }) => {
      const tbl = a.table as { id: string; name: string } | null;
      return { id: tbl?.id ?? a.table_id, name: tbl?.name ?? 'Unknown' };
    });

    const inferred_booking_model = inferBookingRowModel(
      booking as {
        booking_model?: string | null;
        experience_event_id?: string | null;
        class_instance_id?: string | null;
        resource_id?: string | null;
        event_session_id?: string | null;
        calendar_id?: string | null;
        service_item_id?: string | null;
        practitioner_id?: string | null;
        appointment_service_id?: string | null;
      },
    );

    return NextResponse.json({
      ...booking,
      area_name,
      booking_time: bookingTimeStr,
      guest: guest ?? null,
      events: [],
      communications: [],
      table_assignments: assignedTables,
      combination_staff_notes: null,
      cde_context,
      inferred_booking_model: inferred_booking_model as BookingModel,
      service_variant_name,
      service_variant_price_pence,
    });
  } catch (err) {
    console.error('GET /api/venue/bookings/[id]/summary failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
