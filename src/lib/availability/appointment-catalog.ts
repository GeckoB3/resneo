/**
 * Date-independent service + staff catalog for Model B guest booking (service/stylist pickers).
 * `unified_scheduling` uses unified_calendars + service_items + calendar_service_assignments.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppointmentService,
  BookingModel,
  ClassPaymentRequirement,
  Practitioner,
  PractitionerService,
  ServiceVariant,
} from '@/types/booking-models';
import { normalizeEnabledModels } from '@/lib/booking/enabled-models';
import { venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { entityBookingWindowFromRow } from '@/lib/booking/entity-booking-window';
import { getOfferedAppointmentServicesForPractitioner } from '@/lib/availability/appointment-engine';
import { unifiedCalendarRowToPractitioner } from '@/lib/availability/unified-calendar-mapper';
import { parseCustomWorkingHoursFromDb } from '@/lib/service-custom-availability';
import { loadVariantsForServices } from '@/lib/venue/service-variants';
import { parseProcessingTimeBlocksFromDb } from '@/lib/appointments/processing-time';
import { loadAddonGroupsForServices } from '@/lib/addons/addon-resolution';
import type { AppointmentCatalogAddonGroup } from '@/types/booking-models';

export interface AppointmentCatalogVariant {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  price_pence: number | null;
  deposit_pence: number | null;
  sort_order: number;
  /** Salon-style gaps inside duration; guest still sees total duration only. */
  processing_time_blocks?: import('@/types/booking-models').ProcessingTimeBlock[];
}

export interface AppointmentCatalogPractitioner {
  id: string;
  name: string;
  services: Array<{
    id: string;
    name: string;
    description?: string | null;
    duration_minutes: number;
    buffer_minutes: number;
    price_pence: number | null;
    deposit_pence: number | null;
    payment_requirement?: ClassPaymentRequirement;
    /** Hours before start for deposit refund; from service row. */
    cancellation_notice_hours: number;
    /** Active sub-options. When non-empty the booking flow must collect a variant choice. */
    variants?: AppointmentCatalogVariant[];
    /** Optional add-on groups (active + visible-online) the booker can stack on the service. */
    addon_groups?: AppointmentCatalogAddonGroup[];
    /** Salon-style internal processing gaps (single-offering services). */
    processing_time_blocks?: import('@/types/booking-models').ProcessingTimeBlock[];
  }>;
}

function variantToCatalog(v: ServiceVariant): AppointmentCatalogVariant {
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    duration_minutes: v.duration_minutes,
    buffer_minutes: v.buffer_minutes,
    price_pence: v.price_pence,
    deposit_pence: v.deposit_pence,
    sort_order: v.sort_order,
    processing_time_blocks: v.processing_time_blocks ?? [],
  };
}

function serviceItemRowToAppointmentService(row: Record<string, unknown>): AppointmentService {
  return {
    id: row.id as string,
    venue_id: row.venue_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    duration_minutes: row.duration_minutes as number,
    buffer_minutes: (row.buffer_minutes as number) ?? 0,
    processing_time_minutes: (row.processing_time_minutes as number) ?? 0,
    price_pence: (row.price_pence as number | null) ?? null,
    payment_requirement: (row.payment_requirement as ClassPaymentRequirement | undefined) ?? undefined,
    deposit_pence: (row.deposit_pence as number | null) ?? null,
    colour: (row.colour as string) ?? '#3B82F6',
    is_active: row.is_active !== false,
    sort_order: (row.sort_order as number) ?? 0,
    created_at: (row.created_at as string) ?? new Date().toISOString(),
    max_advance_booking_days: entityBookingWindowFromRow(row).max_advance_booking_days,
    min_booking_notice_hours: entityBookingWindowFromRow(row).min_booking_notice_hours,
    cancellation_notice_hours: entityBookingWindowFromRow(row).cancellation_notice_hours,
    allow_same_day_booking: entityBookingWindowFromRow(row).allow_same_day_booking,
    custom_availability_enabled: Boolean(row.custom_availability_enabled),
    custom_working_hours: parseCustomWorkingHoursFromDb(row.custom_working_hours),
    processing_time_blocks: parseProcessingTimeBlocksFromDb((row as { processing_time_blocks?: unknown }).processing_time_blocks),
  };
}

async function fetchUnifiedAppointmentCatalog(
  supabase: SupabaseClient,
  venueId: string,
  options?: { practitionerSlug?: string; includeHiddenAddons?: boolean },
): Promise<{ practitioners: AppointmentCatalogPractitioner[] }> {
  const calQuery = supabase
    .from('unified_calendars')
    .select('*')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .order('sort_order');

  const { data: calendarRows, error: calErr } = await calQuery;
  if (calErr) {
    console.warn('[fetchUnifiedAppointmentCatalog] unified_calendars:', calErr.message);
  }
  let calendars = (calendarRows ?? []) as Record<string, unknown>[];
  if (options?.practitionerSlug) {
    const slug = options.practitionerSlug.trim().toLowerCase();
    calendars = calendars.filter((c) => ((c.slug as string) ?? '').toLowerCase() === slug);
  }

  if (calendars.length === 0) {
    return { practitioners: [] };
  }

  const calendarIds = calendars.map((c) => c.id as string);

  const [servicesRes, assignRes] = await Promise.all([
    supabase
      .from('service_items')
      .select('*')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('calendar_service_assignments')
      .select('id, calendar_id, service_item_id, custom_duration_minutes, custom_price_pence')
      .in('calendar_id', calendarIds),
  ]);

  const services = ((servicesRes.data ?? []) as Record<string, unknown>[]).map(serviceItemRowToAppointmentService);
  const practitionerServices: PractitionerService[] = (assignRes.data ?? []).map((a) => {
    const row = a as {
      id: string;
      calendar_id: string;
      service_item_id: string;
      custom_duration_minutes: number | null;
      custom_price_pence: number | null;
    };
    return {
      id: row.id,
      practitioner_id: row.calendar_id,
      service_id: row.service_item_id,
      custom_duration_minutes: row.custom_duration_minutes,
      custom_price_pence: row.custom_price_pence,
    };
  });

  const [variantMap, addonGroupMap] = await Promise.all([
    loadVariantsForServices({
      admin: supabase,
      venueId,
      schema: 'service_item',
      parentIds: services.map((s) => s.id),
    }),
    loadAddonGroupsForServices({
      admin: supabase,
      venueId,
      schema: 'service_item',
      parentIds: services.map((s) => s.id),
      includeHidden: options?.includeHiddenAddons === true,
      includeInactive: false,
    }),
  ]);

  const practitioners: Practitioner[] = calendars.map((row) => unifiedCalendarRowToPractitioner(row));
  const result: AppointmentCatalogPractitioner[] = [];

  for (const practitioner of practitioners) {
    if (!practitioner.is_active) continue;
    const offeredServices = getOfferedAppointmentServicesForPractitioner(practitioner, services, practitionerServices);
    if (offeredServices.length === 0) continue;

    result.push({
      id: practitioner.id,
      name: practitioner.name,
      services: offeredServices.map((svc) => ({
        id: svc.id,
        name: svc.name,
        description: svc.description ?? null,
        duration_minutes: svc.duration_minutes,
        buffer_minutes: svc.buffer_minutes ?? 0,
        price_pence: svc.price_pence,
        deposit_pence: svc.deposit_pence,
        payment_requirement: svc.payment_requirement,
        cancellation_notice_hours: entityBookingWindowFromRow(svc as unknown as Record<string, unknown>).cancellation_notice_hours,
        variants: (variantMap.get(svc.id) ?? []).filter((v) => v.is_active).map(variantToCatalog),
        addon_groups: addonGroupMap.get(svc.id) ?? [],
        processing_time_blocks: svc.processing_time_blocks ?? [],
      })),
    });
  }

  return { practitioners: result };
}

export async function fetchAppointmentCatalog(
  supabase: SupabaseClient,
  venueId: string,
  options?: { practitionerSlug?: string; includeHiddenAddons?: boolean },
): Promise<{ practitioners: AppointmentCatalogPractitioner[] }> {
  const { data: venueRow } = await supabase
    .from('venues')
    .select('booking_model, enabled_models')
    .eq('id', venueId)
    .maybeSingle();
  const primary = ((venueRow as { booking_model?: string } | null)?.booking_model as BookingModel) ?? 'table_reservation';
  const enabled = normalizeEnabledModels(
    (venueRow as { enabled_models?: unknown } | null)?.enabled_models,
    primary,
  );
  if (venueUsesUnifiedAppointmentData(primary, enabled)) {
    return fetchUnifiedAppointmentCatalog(supabase, venueId, options);
  }

  const [practitionersRes, allServicesRes, psRes] = await Promise.all([
    supabase
      .from('practitioners')
      .select('*')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('appointment_services')
      .select('*')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('practitioner_services').select('*, practitioners!inner(venue_id)').eq('practitioners.venue_id', venueId),
  ]);

  let practitioners = (practitionersRes.data ?? []) as Practitioner[];
  const services = (allServicesRes.data ?? []) as AppointmentService[];
  const practitionerServices = (psRes.data ?? []) as PractitionerService[];

  if (options?.practitionerSlug) {
    const slug = options.practitionerSlug.trim().toLowerCase();
    practitioners = practitioners.filter(
      (p) => p.is_active && (p.slug ?? '').toLowerCase() === slug,
    );
  }

  const [variantMap, addonGroupMap] = await Promise.all([
    loadVariantsForServices({
      admin: supabase,
      venueId,
      schema: 'appointment_service',
      parentIds: services.map((s) => s.id),
    }),
    loadAddonGroupsForServices({
      admin: supabase,
      venueId,
      schema: 'appointment_service',
      parentIds: services.map((s) => s.id),
      includeHidden: options?.includeHiddenAddons === true,
      includeInactive: false,
    }),
  ]);

  const result: AppointmentCatalogPractitioner[] = [];

  for (const practitioner of practitioners) {
    if (!practitioner.is_active) continue;
    const offeredServices = getOfferedAppointmentServicesForPractitioner(practitioner, services, practitionerServices);
    if (offeredServices.length === 0) continue;

    result.push({
      id: practitioner.id,
      name: practitioner.name,
      services: offeredServices.map((svc) => ({
        id: svc.id,
        name: svc.name,
        description: svc.description ?? null,
        duration_minutes: svc.duration_minutes,
        buffer_minutes: svc.buffer_minutes ?? 0,
        price_pence: svc.price_pence,
        deposit_pence: svc.deposit_pence,
        payment_requirement: svc.payment_requirement,
        cancellation_notice_hours: entityBookingWindowFromRow(svc as unknown as Record<string, unknown>).cancellation_notice_hours,
        variants: (variantMap.get(svc.id) ?? []).filter((v) => v.is_active).map(variantToCatalog),
        addon_groups: addonGroupMap.get(svc.id) ?? [],
        processing_time_blocks: svc.processing_time_blocks ?? [],
      })),
    });
  }

  return { practitioners: result };
}
