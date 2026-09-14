import type { SupabaseClient } from '@supabase/supabase-js';
import type { DbMappingRow } from '@/lib/import/apply-mappings';
import { calendarDurationMinutes, calendarPricePence } from '@/lib/booking/calendar-service-terms';

/** True when the booking CSV mapping wires `targetField` to a column (or split part). */
export function isBookingImportFieldMapped(mappings: DbMappingRow[], targetField: string): boolean {
  for (const m of mappings) {
    if (m.action === 'map' && m.target_field === targetField) return true;
    if (m.action === 'split' && m.split_config?.parts?.some((p) => p.field === targetField)) return true;
  }
  return false;
}

export interface ServiceCommercialDefaults {
  durationMinutes: number;
  pricePence: number | null;
  depositPence: number | null;
}

export async function fetchUnifiedServiceCommercialDefaults(
  admin: SupabaseClient,
  venueId: string,
  calendarId: string,
  serviceItemId: string,
): Promise<ServiceCommercialDefaults | null> {
  const { data: si, error } = await admin
    .from('service_items')
    .select('id, venue_id, duration_minutes, price_pence, deposit_pence')
    .eq('id', serviceItemId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error || !si) return null;

  const { data: csa } = await admin
    .from('calendar_service_assignments')
    .select('custom_duration_minutes, custom_price_pence')
    .eq('calendar_id', calendarId)
    .eq('service_item_id', serviceItemId)
    .maybeSingle();

  const row = csa as { custom_duration_minutes?: number | null; custom_price_pence?: number | null } | null;

  const base = si as { duration_minutes: number; price_pence: number | null; deposit_pence: number | null };

  return {
    durationMinutes: calendarDurationMinutes(base.duration_minutes, row),
    pricePence: calendarPricePence(base.price_pence, row),
    depositPence: base.deposit_pence,
  };
}

export async function fetchPractitionerServiceCommercialDefaults(
  admin: SupabaseClient,
  venueId: string,
  practitionerId: string,
  appointmentServiceId: string,
): Promise<ServiceCommercialDefaults | null> {
  const { data: svc, error } = await admin
    .from('appointment_services')
    .select('id, venue_id, duration_minutes, price_pence, deposit_pence')
    .eq('id', appointmentServiceId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error || !svc) return null;

  const { data: ps } = await admin
    .from('practitioner_services')
    .select('custom_duration_minutes, custom_price_pence, custom_deposit_pence')
    .eq('practitioner_id', practitionerId)
    .eq('service_id', appointmentServiceId)
    .maybeSingle();

  const row = ps as {
    custom_duration_minutes?: number | null;
    custom_price_pence?: number | null;
    custom_deposit_pence?: number | null;
  } | null;

  const base = svc as { duration_minutes: number; price_pence: number | null; deposit_pence: number | null };

  return {
    durationMinutes: calendarDurationMinutes(base.duration_minutes, row),
    pricePence: calendarPricePence(base.price_pence, row),
    depositPence: row?.custom_deposit_pence ?? base.deposit_pence,
  };
}
