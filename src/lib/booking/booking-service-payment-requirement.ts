import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAppointmentPaymentRequirement } from '@/lib/appointments/appointment-service-payment';

/**
 * The payment mode of the service behind a booking row
 * ('full_payment' | 'deposit' | 'card_hold' | 'none'), or null when the booking
 * is not for an appointment service. Drives the staff detail surfaces' payment
 * labels ("Paid in full" / "Refund payment"), so the full booking GET and the
 * /summary first-paint payload must BOTH carry it: a payload without it falls
 * back to deposit copy and the label flashes while the panel loads.
 */
export async function resolveBookingServicePaymentRequirement(
  db: SupabaseClient,
  booking: { appointment_service_id?: string | null; service_item_id?: string | null },
): Promise<string | null> {
  const itemId = booking.service_item_id ?? null;
  const apptId = booking.appointment_service_id ?? null;
  const table = itemId ? 'service_items' : apptId ? 'appointment_services' : null;
  const serviceId = itemId ?? apptId;
  if (!table || !serviceId) return null;
  try {
    const { data: svc } = await db
      .from(table)
      .select('payment_requirement, deposit_pence')
      .eq('id', serviceId)
      .maybeSingle();
    if (!svc) return null;
    const row = svc as { payment_requirement?: string | null; deposit_pence?: number | null };
    return resolveAppointmentPaymentRequirement({
      payment_requirement: (row.payment_requirement ?? undefined) as Parameters<
        typeof resolveAppointmentPaymentRequirement
      >[0]['payment_requirement'],
      deposit_pence: row.deposit_pence ?? null,
    });
  } catch (e) {
    console.error('[resolveBookingServicePaymentRequirement] failed:', e);
    return null;
  }
}
