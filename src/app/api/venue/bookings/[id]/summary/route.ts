import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { resolveCdeBookingContext } from '@/lib/booking/cde-booking-context';
import { loadStaffBookingDetailBundle } from '@/lib/booking/load-booking-detail-bundle';
import { loadStaffAccessibleBooking } from '@/lib/booking/staff-booking-access';
import { resolveBookingServicePaymentRequirement } from '@/lib/booking/booking-service-payment-requirement';
import { loadVisitPaymentPicture, visitAnchorFromBooking } from '@/lib/booking/payment-summary';
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

    const bookingTimeStr =
      typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '';

    const [detailBundle, cde_context, service_payment_requirement] = await Promise.all([
      loadStaffBookingDetailBundle(staff.db, id, scopeVenueId, { includeTimeline: false }),
      resolveCdeBookingContext(
        staff.db,
        booking as Parameters<typeof resolveCdeBookingContext>[1],
      ),
      // The payment labels ("Paid in full" / deposit copy) render from the
      // first paint, so the summary must carry the payment mode too; without
      // it the label flashes deposit copy until the full GET lands.
      resolveBookingServicePaymentRequirement(
        staff.db,
        booking as { appointment_service_id?: string | null; service_item_id?: string | null },
      ),
    ]);

    if (!detailBundle) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const area_name = detailBundle.area_name;
    const service_variant_name = detailBundle.service_variant_name;
    const service_variant_price_pence = detailBundle.service_variant_price_pence;
    const guest = detailBundle.guest;
    const assignedTables = detailBundle.table_assignments;

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

    const addons = detailBundle.addons;

    // In-person payments (§6.6): everything derived LIVE (paid deposits +
    // ledger), never from the denormalised columns. VISIT-scoped (§5.7) —
    // Take payment settles every row sharing group_booking_id, so the balance
    // covers the whole visit; `booking_total_price_pence` stays this row's.
    const visit = await loadVisitPaymentPicture(
      staff.db,
      visitAnchorFromBooking(booking as Record<string, unknown>, {
        id,
        venueId: scopeVenueId,
      }),
      { venueId: scopeVenueId, anchorServiceVariantPricePence: service_variant_price_pence },
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
      addons,
      service_payment_requirement,
      booking_total_price_pence: visit.anchorTotalPence,
      amount_paid_pence: visit.amountPaidPence,
      payment_state: visit.paymentState,
      balance_due_pence: visit.balanceDuePence,
      visit_payment: {
        booking_count: visit.bookingIds.length,
        booking_ids: visit.bookingIds,
        total_pence: visit.totalPence,
        amount_paid_pence: visit.amountPaidPence,
        balance_due_pence: visit.balanceDuePence,
      },
    });
  } catch (err) {
    console.error('GET /api/venue/bookings/[id]/summary failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
