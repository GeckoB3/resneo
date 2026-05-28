import { NextRequest, NextResponse } from 'next/server';
import { VENUE_CATALOG_CACHE_CONTROL } from '@/lib/realtime/dashboard-sync-constants';
import { createClient } from '@/lib/supabase/server';
import {
  filterIdsToManagedCalendars,
  getVenueStaff,
  requireManagedCalendarIds,
} from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  hasBlockingBookingsRemovingServicesFromCalendarLegacy,
  hasBlockingBookingsRemovingServicesFromCalendarUnified,
  SERVICE_REMOVAL_BLOCKED_BY_BOOKINGS,
} from '@/lib/venue/service-calendar-removal';
import {
  buildEntityNotFoundMessage,
  buildUpcomingBookingsBlockMessage,
  hasUpcomingActiveBookingsForVenueAppointmentService,
  hasUpcomingActiveBookingsForVenueServiceItem,
} from '@/lib/venue/entity-delete-booking-guards';
import { z } from 'zod';
import type { ClassPaymentRequirement, PractitionerService, ServiceCustomScheduleStored } from '@/types/booking-models';
import { customWorkingHoursRequestSchema } from '@/lib/service-custom-schedule-zod';
import { isServiceCustomScheduleEmpty, parseCustomWorkingHoursFromDb } from '@/lib/service-custom-availability';
import { ensureUnifiedMirrorForPractitionerId } from '@/lib/class-instances/instructor-calendar-block';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';
import {
  loadVariantsForServices,
  replaceServiceVariants,
  variantsArraySchema,
} from '@/lib/venue/service-variants';
import { addonGroupLinksArraySchema } from '@/lib/addons/zod-schemas';
import { replaceServiceAddonGroupLinks } from '@/lib/venue/addon-groups';
import { loadAddonGroupsForServices } from '@/lib/addons/addon-resolution';
import {
  parseProcessingTimeBlocksFromDb,
  processingTimeBlocksSchema,
  validateProcessingTimeBlocks,
} from '@/lib/appointments/processing-time';

const staffMaySchema = {
  staff_may_customize_name: z.boolean().optional(),
  staff_may_customize_description: z.boolean().optional(),
  staff_may_customize_duration: z.boolean().optional(),
  staff_may_customize_buffer: z.boolean().optional(),
  staff_may_customize_price: z.boolean().optional(),
  staff_may_customize_deposit: z.boolean().optional(),
  staff_may_customize_colour: z.boolean().optional(),
};

const paymentRequirementSchema = z.enum(['none', 'deposit', 'full_payment']);

const customWorkingHoursSchema = customWorkingHoursRequestSchema;
const STAFF_SERVICE_FIELD_PERMISSIONS = {
  name: 'staff_may_customize_name',
  description: 'staff_may_customize_description',
  duration_minutes: 'staff_may_customize_duration',
  buffer_minutes: 'staff_may_customize_buffer',
  price_pence: 'staff_may_customize_price',
  deposit_pence: 'staff_may_customize_deposit',
  colour: 'staff_may_customize_colour',
} as const;

const serviceSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    duration_minutes: z.number().int().min(5).max(480),
    buffer_minutes: z.number().int().min(0).max(120).optional(),
    price_pence: z.number().int().min(0).optional(),
    deposit_pence: z.number().int().min(0).optional().nullable(),
    payment_requirement: paymentRequirementSchema.optional(),
    colour: z.string().max(20).optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
    max_advance_booking_days: z.number().int().min(1).max(365).optional(),
    min_booking_notice_hours: z.number().int().min(0).max(168).optional(),
    cancellation_notice_hours: z.number().int().min(0).max(168).optional(),
    allow_same_day_booking: z.boolean().optional(),
    custom_availability_enabled: z.boolean().optional(),
    custom_working_hours: customWorkingHoursSchema,
    processing_time_blocks: processingTimeBlocksSchema.optional(),
    ...staffMaySchema,
  })
  .superRefine((data, ctx) => {
    const req =
      data.payment_requirement ??
      (data.deposit_pence != null && data.deposit_pence > 0 ? 'deposit' : 'none');
    if (req === 'deposit') {
      const d = data.deposit_pence;
      if (d == null || d <= 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a deposit amount greater than zero',
          path: ['deposit_pence'],
        });
      }
    }
    if (req === 'full_payment') {
      const p = data.price_pence;
      if (p == null || p <= 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Set a price when charging full payment online',
          path: ['price_pence'],
        });
      }
    }
    if (data.custom_availability_enabled === true && isServiceCustomScheduleEmpty(data.custom_working_hours ?? null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'When custom availability is enabled, add at least one schedule rule.',
        path: ['custom_working_hours'],
      });
    }
    const pb = validateProcessingTimeBlocks(
      parseProcessingTimeBlocksFromDb(data.processing_time_blocks ?? []),
      data.duration_minutes,
    );
    if (!pb.ok) {
      ctx.addIssue({
        code: 'custom',
        message: pb.error ?? 'Invalid processing time',
        path: ['processing_time_blocks'],
      });
    }
  });

const servicePatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    duration_minutes: z.number().int().min(5).max(480).optional(),
    buffer_minutes: z.number().int().min(0).max(120).optional(),
    price_pence: z.number().int().min(0).optional(),
    deposit_pence: z.number().int().min(0).optional().nullable(),
    payment_requirement: paymentRequirementSchema.optional(),
    colour: z.string().max(20).optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
    max_advance_booking_days: z.number().int().min(1).max(365).optional(),
    min_booking_notice_hours: z.number().int().min(0).max(168).optional(),
    cancellation_notice_hours: z.number().int().min(0).max(168).optional(),
    allow_same_day_booking: z.boolean().optional(),
    custom_availability_enabled: z.boolean().optional(),
    custom_working_hours: customWorkingHoursSchema,
    processing_time_blocks: processingTimeBlocksSchema.optional(),
    ...staffMaySchema,
  })
  .superRefine((data, ctx) => {
    if (data.payment_requirement === 'deposit') {
      const d = data.deposit_pence;
      if (d == null || d <= 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a deposit amount greater than zero',
          path: ['deposit_pence'],
        });
      }
    }
    if (data.payment_requirement === 'full_payment') {
      const p = data.price_pence;
      if (p == null || p <= 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Set a price when charging full payment online',
          path: ['price_pence'],
        });
      }
    }
  });

function assertPatchCustomAvailabilityCoherent(params: {
  patch: z.infer<typeof servicePatchSchema>;
  currentRow: Record<string, unknown>;
}): { ok: true } | { ok: false; message: string } {
  const { patch, currentRow } = params;
  const curEnabled = Boolean(currentRow.custom_availability_enabled);
  const curHours = parseCustomWorkingHoursFromDb(currentRow.custom_working_hours) as ServiceCustomScheduleStored | null;

  const nextEnabled =
    patch.custom_availability_enabled !== undefined ? patch.custom_availability_enabled : curEnabled;

  const nextHours: ServiceCustomScheduleStored | null =
    patch.custom_working_hours !== undefined
      ? (patch.custom_working_hours as ServiceCustomScheduleStored | null)
      : curHours;

  if (nextEnabled && isServiceCustomScheduleEmpty(nextHours)) {
    return {
      ok: false,
      message: 'When custom availability is enabled, add at least one schedule rule.',
    };
  }
  return { ok: true };
}

function normalizeServicePaymentFields(data: {
  payment_requirement?: ClassPaymentRequirement;
  deposit_pence?: number | null;
}): { payment_requirement: ClassPaymentRequirement; deposit_pence: number | null } {
  const req =
    data.payment_requirement ??
    (data.deposit_pence != null && data.deposit_pence > 0 ? 'deposit' : 'none');
  if (req === 'none') return { payment_requirement: 'none', deposit_pence: null };
  if (req === 'deposit') return { payment_requirement: 'deposit', deposit_pence: data.deposit_pence ?? 0 };
  return { payment_requirement: 'full_payment', deposit_pence: null };
}

function mapServiceItemRowForDashboard(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    colour: row.colour ?? '#3B82F6',
    custom_availability_enabled: (row.custom_availability_enabled as boolean | undefined) ?? false,
    staff_may_customize_name: (row.staff_may_customize_name as boolean | undefined) ?? false,
    staff_may_customize_description: (row.staff_may_customize_description as boolean | undefined) ?? false,
    staff_may_customize_duration: (row.staff_may_customize_duration as boolean | undefined) ?? false,
    staff_may_customize_buffer: (row.staff_may_customize_buffer as boolean | undefined) ?? false,
    staff_may_customize_price: (row.staff_may_customize_price as boolean | undefined) ?? false,
    staff_may_customize_deposit: (row.staff_may_customize_deposit as boolean | undefined) ?? false,
    staff_may_customize_colour: (row.staff_may_customize_colour as boolean | undefined) ?? false,
  };
}

const STAFF_MAY_PERMISSION_KEYS = Object.keys(staffMaySchema) as (keyof typeof staffMaySchema)[];

function buildStaffEditableServicePatch(
  service: Record<string, unknown>,
  patch: Record<string, unknown>,
): { ok: true; updates: Record<string, unknown> } | { ok: false; error: string } {
  const updates: Record<string, unknown> = {};

  for (const [field, permission] of Object.entries(STAFF_SERVICE_FIELD_PERMISSIONS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    if (!Boolean(service[permission])) {
      return {
        ok: false,
        error: `You are not allowed to change ${field.replace(/_/g, ' ')} for this service.`,
      };
    }
    updates[field] = patch[field];
  }

  return { ok: true, updates };
}

/**
 * Calendar IDs from the client must be a string array. A single string or non-array
 * would make `.map` throw and surface as 500 — normalize here.
 * `undefined` when the field was omitted (PATCH: do not change links).
 */
function normalizePractitionerIdsInput(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (Array.isArray(raw)) {
    const ids = raw
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim());
    return [...new Set(ids)];
  }
  if (typeof raw === 'string' && raw.trim().length > 0) return [raw.trim()];
  return [];
}

/**
 * USE service links (`calendar_service_assignments`) reference `unified_calendars.id`. New calendars created via
 * `POST /api/venue/practitioners` are stored in `practitioners` when the venue primary is not `unified_scheduling`,
 * without a matching `unified_calendars` row — mirror those rows (same id) before validating links.
 */
async function ensureUnifiedMirrorsForAppointmentCalendarIds(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  calendarIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (calendarIds.length === 0) return { ok: true };
  for (const id of calendarIds) {
    const { data: existingUc } = await admin
      .from('unified_calendars')
      .select('id')
      .eq('venue_id', venueId)
      .eq('id', id)
      .maybeSingle();
    if (existingUc) continue;

    const { data: pr, error: prErr } = await admin
      .from('practitioners')
      .select(
        'id, name, staff_id, slug, working_hours, break_times, break_times_by_day, days_off, sort_order, is_active',
      )
      .eq('venue_id', venueId)
      .eq('id', id)
      .maybeSingle();
    if (prErr) {
      console.error('ensureUnifiedMirrorsForAppointmentCalendarIds: practitioners query failed:', prErr);
      return { ok: false, message: 'Could not verify calendars for this venue.' };
    }
    if (!pr) {
      return {
        ok: false,
        message:
          'One or more calendars are not valid for this venue. Refresh the page and try again, or pick calendars from the list.',
      };
    }
    const mirrored = await ensureUnifiedMirrorForPractitionerId(admin, venueId, pr as Parameters<
      typeof ensureUnifiedMirrorForPractitionerId
    >[2]);
    if (!mirrored) {
      return { ok: false, message: 'Could not sync a calendar for service links. Try again or contact support.' };
    }
  }
  return { ok: true };
}

async function assertCalendarIdsBelongToVenueUnified(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  calendarIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (calendarIds.length === 0) return { ok: true };
  const { data, error } = await admin
    .from('unified_calendars')
    .select('id')
    .eq('venue_id', venueId)
    .in('id', calendarIds);
  if (error) {
    console.error('appointment-services: verify unified_calendars failed:', error);
    return { ok: false, message: 'Could not verify calendars for this venue.' };
  }
  const allowed = new Set((data ?? []).map((r) => r.id as string));
  const missing = calendarIds.filter((id) => !allowed.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      message:
        'One or more calendars are not valid for this venue. Refresh the page and try again, or pick calendars from the list.',
    };
  }
  return { ok: true };
}

async function assertPractitionerIdsBelongToVenueLegacy(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  practitionerIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (practitionerIds.length === 0) return { ok: true };
  const { data, error } = await admin
    .from('practitioners')
    .select('id')
    .eq('venue_id', venueId)
    .in('id', practitionerIds);
  if (error) {
    console.error('appointment-services: verify practitioners failed:', error);
    return { ok: false, message: 'Could not verify calendars for this venue.' };
  }
  const allowed = new Set((data ?? []).map((r) => r.id as string));
  const missing = practitionerIds.filter((id) => !allowed.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      message:
        'One or more team members are not valid for this venue. Refresh the page and try again.',
    };
  }
  return { ok: true };
}

/** USE stores services in `service_items` when primary is unified_scheduling or it is enabled as a secondary. */
const venueUsesUnifiedServiceItems = venueUsesUnifiedAppointmentServiceData;

const OWNER_VENUE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/venue/appointment-services - list appointment services for the venue.
 * Optional `?owner_venue_id=` loads the linked owner venue catalogue (requires edit grant). */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const ownerVenueParam = request.nextUrl.searchParams.get('owner_venue_id');
    const scope = await resolveLinkedStaffCatalogScope(
      admin,
      staff.venue_id,
      ownerVenueParam && OWNER_VENUE_UUID_RE.test(ownerVenueParam) ? ownerVenueParam : null,
    );
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const catalogVenueId = scope.venueId;

    const useUnified = await venueUsesUnifiedServiceItems(admin, catalogVenueId);

    if (useUnified) {
      const [servicesRes, calRes] = await Promise.all([
        admin
          .from('service_items')
          .select('*')
          .eq('venue_id', catalogVenueId)
          .order('sort_order', { ascending: true }),
        admin.from('unified_calendars').select('id').eq('venue_id', catalogVenueId),
      ]);

      if (servicesRes.error) {
        console.error('GET /api/venue/appointment-services (service_items) failed:', servicesRes.error);
        return NextResponse.json({ error: 'Failed to fetch services' }, { status: 500 });
      }

      const calIds = (calRes.data ?? []).map((c) => c.id as string);
      const linksRes =
        calIds.length > 0
          ? await admin.from('calendar_service_assignments').select('*').in('calendar_id', calIds)
          : { data: [] as Record<string, unknown>[], error: null };

      if (linksRes.error) {
        console.error('GET /api/venue/appointment-services calendar_service_assignments failed:', linksRes.error);
        return NextResponse.json({ error: 'Failed to fetch service links' }, { status: 500 });
      }

      const practitioner_services = (linksRes.data ?? []).map((r) => {
        const row = r as {
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
          custom_name: null,
          custom_description: null,
          custom_buffer_minutes: null,
          custom_deposit_pence: null,
          custom_colour: null,
        };
      });

      const services = (servicesRes.data ?? []).map((s) => mapServiceItemRowForDashboard(s as Record<string, unknown>));

      const serviceIds = services.map((s) => s.id as string);
      const [variantMap, addonGroupMap] = await Promise.all([
        loadVariantsForServices({
          admin,
          venueId: catalogVenueId,
          schema: 'service_item',
          parentIds: serviceIds,
        }),
        loadAddonGroupsForServices({
          admin,
          venueId: catalogVenueId,
          schema: 'service_item',
          parentIds: serviceIds,
          includeHidden: true,
          includeInactive: true,
        }),
      ]);
      const servicesWithVariants = services.map((s) => ({
        ...s,
        variants: variantMap.get(s.id as string) ?? [],
        addon_groups: addonGroupMap.get(s.id as string) ?? [],
      }));

      return NextResponse.json(
        {
          services: servicesWithVariants,
          practitioner_services,
        },
        { headers: { 'Cache-Control': VENUE_CATALOG_CACHE_CONTROL } },
      );
    }

    const [servicesRes, linksRes] = await Promise.all([
      admin
        .from('appointment_services')
        .select('*')
        .eq('venue_id', catalogVenueId)
        .order('sort_order', { ascending: true }),
      admin
        .from('practitioner_services')
        .select('*, practitioner:practitioners!inner(venue_id)')
        .eq('practitioner.venue_id', catalogVenueId),
    ]);

    if (servicesRes.error) {
      console.error('GET /api/venue/appointment-services failed:', servicesRes.error);
      return NextResponse.json({ error: 'Failed to fetch services' }, { status: 500 });
    }
    if (linksRes.error) {
      console.error('GET /api/venue/appointment-services practitioner_services failed:', linksRes.error);
      return NextResponse.json({ error: 'Failed to fetch service links' }, { status: 500 });
    }

    const practitioner_services = linksRes.data ?? [];

    const services = (servicesRes.data ?? []) as Array<Record<string, unknown>>;
    const serviceIds = services.map((s) => s.id as string);
    const [variantMap, addonGroupMap] = await Promise.all([
      loadVariantsForServices({
        admin,
        venueId: catalogVenueId,
        schema: 'appointment_service',
        parentIds: serviceIds,
      }),
      loadAddonGroupsForServices({
        admin,
        venueId: catalogVenueId,
        schema: 'appointment_service',
        parentIds: serviceIds,
        includeHidden: true,
        includeInactive: true,
      }),
    ]);
    const servicesWithVariants = services.map((s) => ({
      ...s,
      variants: variantMap.get(s.id as string) ?? [],
      addon_groups: addonGroupMap.get(s.id as string) ?? [],
    }));

    return NextResponse.json(
      {
        services: servicesWithVariants,
        practitioner_services,
      },
      { headers: { 'Cache-Control': VENUE_CATALOG_CACHE_CONTROL } },
    );
  } catch (err) {
    console.error('GET /api/venue/appointment-services failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/appointment-services - create an appointment service (admin or staff on managed calendars). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const parsed = serviceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const normalizedParentProcessing =
      validateProcessingTimeBlocks(
        parseProcessingTimeBlocksFromDb(parsed.data.processing_time_blocks ?? []),
        parsed.data.duration_minutes,
      )
        .normalized ?? [];

    const variantsRaw = (body as { variants?: unknown }).variants;
    const variantsProvided = variantsRaw !== undefined;
    let parsedVariants: z.infer<typeof variantsArraySchema> = [];
    if (variantsProvided) {
      const variantsParsed = variantsArraySchema.safeParse(variantsRaw);
      if (!variantsParsed.success) {
        return NextResponse.json(
          { error: 'Invalid variants', details: variantsParsed.error.flatten() },
          { status: 400 },
        );
      }
      parsedVariants = variantsParsed.data;
    }

    const addonLinksRaw = (body as { addon_group_links?: unknown }).addon_group_links;
    const addonLinksProvided = addonLinksRaw !== undefined;
    let parsedAddonLinks: z.infer<typeof addonGroupLinksArraySchema> = [];
    if (addonLinksProvided) {
      const linksParsed = addonGroupLinksArraySchema.safeParse(addonLinksRaw);
      if (!linksParsed.success) {
        return NextResponse.json(
          { error: 'Invalid addon_group_links', details: linksParsed.error.flatten() },
          { status: 400 },
        );
      }
      parsedAddonLinks = linksParsed.data;
    }

    if (staff.role !== 'admin') {
      if (
        Object.prototype.hasOwnProperty.call(body, 'custom_availability_enabled') ||
        Object.prototype.hasOwnProperty.call(body, 'custom_working_hours')
      ) {
        return NextResponse.json(
          { error: 'Only venue admins can set per-service availability hours.' },
          { status: 403 },
        );
      }
      if (variantsProvided) {
        return NextResponse.json(
          { error: 'Only venue admins can manage service variants.' },
          { status: 403 },
        );
      }
      if (addonLinksProvided) {
        return NextResponse.json(
          { error: 'Only venue admins can manage add-ons.' },
          { status: 403 },
        );
      }
    }

    const admin = getSupabaseAdminClient();
    const useUnified = await venueUsesUnifiedServiceItems(admin, staff.venue_id);
    const practitionerIdsForLinks = normalizePractitionerIdsInput(body.practitioner_ids) ?? [];

    if (staff.role !== 'admin') {
      const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: 403 });
      }
      if (practitionerIdsForLinks.length === 0) {
        return NextResponse.json(
          { error: 'Choose at least one calendar column to offer this service on.' },
          { status: 400 },
        );
      }
      const { rejectedIds } = filterIdsToManagedCalendars(scope.managedCalendarIds, practitionerIdsForLinks);
      if (rejectedIds.length > 0) {
        return NextResponse.json(
          { error: 'You can only link services to calendars assigned to your account.' },
          { status: 403 },
        );
      }
    }

    if (useUnified) {
      if (practitionerIdsForLinks.length > 0) {
        const mirrorOk = await ensureUnifiedMirrorsForAppointmentCalendarIds(
          admin,
          staff.venue_id,
          practitionerIdsForLinks,
        );
        if (!mirrorOk.ok) {
          return NextResponse.json({ error: mirrorOk.message }, { status: 400 });
        }
        const calCheck = await assertCalendarIdsBelongToVenueUnified(admin, staff.venue_id, practitionerIdsForLinks);
        if (!calCheck.ok) {
          return NextResponse.json({ error: calCheck.message }, { status: 400 });
        }
      }
      const pay = normalizeServicePaymentFields({
        payment_requirement: parsed.data.payment_requirement,
        deposit_pence: parsed.data.deposit_pence,
      });
      const staffMayAllTrue = staff.role !== 'admin';
      const insertRow = {
        venue_id: staff.venue_id,
        created_by_staff_id: staff.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        item_type: 'service' as const,
        duration_minutes: parsed.data.duration_minutes,
        buffer_minutes: parsed.data.buffer_minutes ?? 0,
        processing_time_minutes: 0,
        processing_time_blocks: normalizedParentProcessing,
        price_pence: parsed.data.price_pence ?? null,
        payment_requirement: pay.payment_requirement,
        deposit_pence: pay.deposit_pence,
        price_type: 'fixed' as const,
        colour: parsed.data.colour ?? '#3B82F6',
        is_active: parsed.data.is_active ?? true,
        sort_order: parsed.data.sort_order ?? 0,
        staff_may_customize_name: staffMayAllTrue ? true : (parsed.data.staff_may_customize_name ?? false),
        staff_may_customize_description: staffMayAllTrue ? true : (parsed.data.staff_may_customize_description ?? false),
        staff_may_customize_duration: staffMayAllTrue ? true : (parsed.data.staff_may_customize_duration ?? false),
        staff_may_customize_buffer: staffMayAllTrue ? true : (parsed.data.staff_may_customize_buffer ?? false),
        staff_may_customize_price: staffMayAllTrue ? true : (parsed.data.staff_may_customize_price ?? false),
        staff_may_customize_deposit: staffMayAllTrue ? true : (parsed.data.staff_may_customize_deposit ?? false),
        staff_may_customize_colour: staffMayAllTrue ? true : (parsed.data.staff_may_customize_colour ?? false),
        max_advance_booking_days: parsed.data.max_advance_booking_days ?? 90,
        min_booking_notice_hours: parsed.data.min_booking_notice_hours ?? 1,
        cancellation_notice_hours: parsed.data.cancellation_notice_hours ?? 48,
        allow_same_day_booking: parsed.data.allow_same_day_booking ?? true,
        ...(staff.role === 'admin'
          ? {
              custom_availability_enabled: parsed.data.custom_availability_enabled ?? false,
              custom_working_hours:
                parsed.data.custom_availability_enabled === true
                  ? (parsed.data.custom_working_hours ?? null)
                  : null,
            }
          : {}),
      };
      const { data, error } = await admin.from('service_items').insert(insertRow).select().single();

      if (error) {
        console.error('POST /api/venue/appointment-services (service_items) failed:', error);
        return NextResponse.json(
          { error: 'Failed to create service.', details: error.message },
          { status: 500 },
        );
      }

      if (practitionerIdsForLinks.length > 0) {
        const links = practitionerIdsForLinks.map((calendarId: string) => ({
          calendar_id: calendarId,
          service_item_id: data.id as string,
        }));
        const { error: linkErr } = await admin.from('calendar_service_assignments').insert(links);
        if (linkErr) {
          console.error('POST /api/venue/appointment-services calendar_service_assignments failed:', linkErr);
          await admin.from('service_items').delete().eq('id', data.id).eq('venue_id', staff.venue_id);
          return NextResponse.json({ error: 'Failed to link service to calendars' }, { status: 500 });
        }
      }

      let savedVariants: Awaited<ReturnType<typeof replaceServiceVariants>> | null = null;
      if (variantsProvided) {
        savedVariants = await replaceServiceVariants({
          admin,
          venueId: staff.venue_id,
          parent: { kind: 'service_item', service_item_id: data.id as string },
          variants: parsedVariants,
        });
        if (!savedVariants.ok) {
          await admin.from('service_items').delete().eq('id', data.id).eq('venue_id', staff.venue_id);
          return NextResponse.json({ error: savedVariants.error }, { status: 500 });
        }
      }

      if (addonLinksProvided) {
        const linkRes = await replaceServiceAddonGroupLinks({
          admin,
          venueId: staff.venue_id,
          parent: { kind: 'service_item', service_item_id: data.id as string },
          links: parsedAddonLinks,
        });
        if (!linkRes.ok) {
          await admin.from('service_items').delete().eq('id', data.id).eq('venue_id', staff.venue_id);
          return NextResponse.json({ error: linkRes.error }, { status: 500 });
        }
      }

      const addonGroupMap = await loadAddonGroupsForServices({
        admin,
        venueId: staff.venue_id,
        schema: 'service_item',
        parentIds: [data.id as string],
        includeHidden: true,
        includeInactive: true,
      });

      const dashboardRow = mapServiceItemRowForDashboard(data as Record<string, unknown>);
      return NextResponse.json(
        {
          ...dashboardRow,
          variants: savedVariants?.ok ? savedVariants.variants : [],
          addon_groups: addonGroupMap.get(data.id as string) ?? [],
        },
        { status: 201 },
      );
    }

    if (practitionerIdsForLinks.length > 0) {
      const pCheck = await assertPractitionerIdsBelongToVenueLegacy(admin, staff.venue_id, practitionerIdsForLinks);
      if (!pCheck.ok) {
        return NextResponse.json({ error: pCheck.message }, { status: 400 });
      }
    }

    const pay = normalizeServicePaymentFields({
      payment_requirement: parsed.data.payment_requirement,
      deposit_pence: parsed.data.deposit_pence,
    });
    const { payment_requirement: _pr0, deposit_pence: _dp0, ...restCreate } = parsed.data;
    const insertRow = {
      venue_id: staff.venue_id,
      created_by_staff_id: staff.id,
      ...restCreate,
      buffer_minutes: parsed.data.buffer_minutes ?? 0,
      processing_time_blocks: normalizedParentProcessing,
      payment_requirement: pay.payment_requirement,
      deposit_pence: pay.deposit_pence,
      max_advance_booking_days: parsed.data.max_advance_booking_days ?? 90,
      min_booking_notice_hours: parsed.data.min_booking_notice_hours ?? 1,
      cancellation_notice_hours: parsed.data.cancellation_notice_hours ?? 48,
      allow_same_day_booking: parsed.data.allow_same_day_booking ?? true,
    };
    const { data, error } = await admin.from('appointment_services').insert(insertRow).select().single();

    if (error) {
      console.error('POST /api/venue/appointment-services failed:', error);
      return NextResponse.json(
        { error: 'Failed to create service.', details: error.message },
        { status: 500 },
      );
    }

    if (practitionerIdsForLinks.length > 0) {
      const links = practitionerIdsForLinks.map((pid: string) => ({
        practitioner_id: pid,
        service_id: data.id,
      }));
      const { error: linkErr } = await admin.from('practitioner_services').insert(links);
      if (linkErr) {
        console.error('POST /api/venue/appointment-services practitioner_services failed:', linkErr);
        await admin.from('appointment_services').delete().eq('id', data.id).eq('venue_id', staff.venue_id);
        return NextResponse.json({ error: 'Failed to link service to calendars' }, { status: 500 });
      }
    }

    let savedVariantsLegacy: Awaited<ReturnType<typeof replaceServiceVariants>> | null = null;
    if (variantsProvided) {
      savedVariantsLegacy = await replaceServiceVariants({
        admin,
        venueId: staff.venue_id,
        parent: { kind: 'appointment_service', appointment_service_id: data.id as string },
        variants: parsedVariants,
      });
      if (!savedVariantsLegacy.ok) {
        await admin.from('appointment_services').delete().eq('id', data.id).eq('venue_id', staff.venue_id);
        return NextResponse.json({ error: savedVariantsLegacy.error }, { status: 500 });
      }
    }

    if (addonLinksProvided) {
      const linkRes = await replaceServiceAddonGroupLinks({
        admin,
        venueId: staff.venue_id,
        parent: { kind: 'appointment_service', appointment_service_id: data.id as string },
        links: parsedAddonLinks,
      });
      if (!linkRes.ok) {
        await admin.from('appointment_services').delete().eq('id', data.id).eq('venue_id', staff.venue_id);
        return NextResponse.json({ error: linkRes.error }, { status: 500 });
      }
    }

    const addonGroupMapLegacy = await loadAddonGroupsForServices({
      admin,
      venueId: staff.venue_id,
      schema: 'appointment_service',
      parentIds: [data.id as string],
      includeHidden: true,
      includeInactive: true,
    });

    return NextResponse.json(
      {
        ...(data as Record<string, unknown>),
        variants: savedVariantsLegacy?.ok ? savedVariantsLegacy.variants : [],
        addon_groups: addonGroupMapLegacy.get(data.id as string) ?? [],
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/venue/appointment-services failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/appointment-services - admin: full edit; staff: assigned calendars only. */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const {
      id,
      practitioner_ids: rawPractitionerIds,
      variants: variantsRaw,
      addon_group_links: addonLinksRaw,
      ...rest
    } = body;
    const practitioner_ids = normalizePractitionerIdsInput(rawPractitionerIds);
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const parsed = servicePatchSchema.safeParse(rest);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const variantsProvided = variantsRaw !== undefined;
    let parsedVariants: z.infer<typeof variantsArraySchema> = [];
    if (variantsProvided) {
      const variantsParsed = variantsArraySchema.safeParse(variantsRaw);
      if (!variantsParsed.success) {
        return NextResponse.json(
          { error: 'Invalid variants', details: variantsParsed.error.flatten() },
          { status: 400 },
        );
      }
      parsedVariants = variantsParsed.data;
    }

    const addonLinksProvided = addonLinksRaw !== undefined;
    let parsedAddonLinks: z.infer<typeof addonGroupLinksArraySchema> = [];
    if (addonLinksProvided) {
      const linksParsed = addonGroupLinksArraySchema.safeParse(addonLinksRaw);
      if (!linksParsed.success) {
        return NextResponse.json(
          { error: 'Invalid addon_group_links', details: linksParsed.error.flatten() },
          { status: 400 },
        );
      }
      parsedAddonLinks = linksParsed.data;
    }

    if (staff.role !== 'admin') {
      if (
        Object.prototype.hasOwnProperty.call(rest, 'custom_availability_enabled') ||
        Object.prototype.hasOwnProperty.call(rest, 'custom_working_hours')
      ) {
        return NextResponse.json(
          { error: 'Only venue admins can set per-service availability hours.' },
          { status: 403 },
        );
      }
      for (const key of STAFF_MAY_PERMISSION_KEYS) {
        if (Object.prototype.hasOwnProperty.call(rest, key)) {
          return NextResponse.json(
            { error: 'Only venue admins can change staff permission settings for services.' },
            { status: 403 },
          );
        }
      }
      if (variantsProvided) {
        return NextResponse.json(
          { error: 'Only venue admins can manage service variants.' },
          { status: 403 },
        );
      }
      if (addonLinksProvided) {
        return NextResponse.json(
          { error: 'Only venue admins can manage add-ons.' },
          { status: 403 },
        );
      }
    }

    const admin = getSupabaseAdminClient();
    const useUnified = await venueUsesUnifiedServiceItems(admin, staff.venue_id);

    if (useUnified) {
      const { data: serviceRow, error: serviceErr } = await admin
        .from('service_items')
        .select('*')
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();

      if (serviceErr || !serviceRow) {
        return NextResponse.json({ error: 'Service not found' }, { status: 404 });
      }

      if (staff.role !== 'admin') {
        const creatorId = (serviceRow as { created_by_staff_id?: string | null }).created_by_staff_id ?? null;
        if (creatorId !== staff.id) {
          return NextResponse.json(
            { error: 'Only the team member who created this service can change its definition.' },
            { status: 403 },
          );
        }
      }

      const customCoherent = assertPatchCustomAvailabilityCoherent({
        patch: parsed.data,
        currentRow: serviceRow as Record<string, unknown>,
      });
      if (!customCoherent.ok) {
        return NextResponse.json({ error: customCoherent.message }, { status: 400 });
      }

      let managedScope: Awaited<ReturnType<typeof requireManagedCalendarIds>> | null = null;
      let requestedManagedCalendarIds = practitioner_ids;
      let updatePayload: Record<string, unknown> = { ...parsed.data };

      if (staff.role !== 'admin') {
        managedScope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
        if (!managedScope.ok) {
          return NextResponse.json({ error: managedScope.error }, { status: 403 });
        }

        const filteredPatch = buildStaffEditableServicePatch(serviceRow as Record<string, unknown>, updatePayload);
        if (!filteredPatch.ok) {
          return NextResponse.json({ error: filteredPatch.error }, { status: 403 });
        }
        updatePayload = filteredPatch.updates;

        if (requestedManagedCalendarIds !== undefined) {
          const { allowedIds, rejectedIds } = filterIdsToManagedCalendars(
            managedScope.managedCalendarIds,
            requestedManagedCalendarIds,
          );
          if (rejectedIds.length > 0) {
            return NextResponse.json(
              { error: 'You can only change service links on calendars assigned to your account.' },
              { status: 403 },
            );
          }
          requestedManagedCalendarIds = allowedIds;
        }
      }

      if (requestedManagedCalendarIds !== undefined && requestedManagedCalendarIds.length > 0) {
        const mirrorOk = await ensureUnifiedMirrorsForAppointmentCalendarIds(
          admin,
          staff.venue_id,
          requestedManagedCalendarIds,
        );
        if (!mirrorOk.ok) {
          return NextResponse.json({ error: mirrorOk.message }, { status: 400 });
        }
        const calCheck = await assertCalendarIdsBelongToVenueUnified(admin, staff.venue_id, requestedManagedCalendarIds);
        if (!calCheck.ok) {
          return NextResponse.json({ error: calCheck.message }, { status: 400 });
        }
      }

      const { data: existingLinks, error: existingErr } = await admin
        .from('calendar_service_assignments')
        .select('*')
        .eq('service_item_id', id);

      if (existingErr) {
        console.error('PATCH /api/venue/appointment-services (existing calendar links):', existingErr.message);
        return NextResponse.json({ error: 'Could not verify service calendar links.' }, { status: 500 });
      }

      if (requestedManagedCalendarIds !== undefined) {
        const currentLinks = (existingLinks ?? []) as Array<Record<string, unknown>>;
        const currentCalendarIds = currentLinks.map((r) => r.calendar_id as string);
        const currentManagedIds =
          staff.role === 'admin'
            ? currentCalendarIds
            : currentCalendarIds.filter((cid) => managedScope?.ok && managedScope.managedCalendarIds.includes(cid));
        const removedCalendars = currentManagedIds.filter((cid) => !requestedManagedCalendarIds.includes(cid));

        for (const cid of removedCalendars) {
          const check = await hasBlockingBookingsRemovingServicesFromCalendarUnified(admin, {
            venueId: staff.venue_id,
            calendarId: cid,
            serviceItemIds: [id],
          });
          if (check.error) {
            return NextResponse.json({ error: check.error }, { status: 500 });
          }
          if (check.blocked) {
            return NextResponse.json({ error: SERVICE_REMOVAL_BLOCKED_BY_BOOKINGS }, { status: 409 });
          }
        }

        const preservedOutsideScope =
          staff.role === 'admin'
            ? []
            : currentLinks.filter((r) => !managedScope?.ok || !managedScope.managedCalendarIds.includes(r.calendar_id as string));
        const preserveByCalendar = new Map(currentLinks.map((r) => [r.calendar_id as string, r] as const));
        const finalLinks = [
          ...preservedOutsideScope,
          ...requestedManagedCalendarIds.map((calendarId) => {
            const prev = preserveByCalendar.get(calendarId);
            return {
              calendar_id: calendarId,
              service_item_id: id,
              custom_duration_minutes: (prev?.custom_duration_minutes as number | null | undefined) ?? null,
              custom_price_pence: (prev?.custom_price_pence as number | null | undefined) ?? null,
            };
          }),
        ];

        await admin.from('calendar_service_assignments').delete().eq('service_item_id', id);
        if (finalLinks.length > 0) {
          const { error: linkErr } = await admin.from('calendar_service_assignments').insert(finalLinks);
          if (linkErr) {
            console.error('PATCH /api/venue/appointment-services calendar_service_assignments failed:', linkErr);
            return NextResponse.json({ error: 'Failed to update service links' }, { status: 500 });
          }
        }
      }

      if (parsed.data.payment_requirement !== undefined) {
        const norm = normalizeServicePaymentFields({
          payment_requirement: parsed.data.payment_requirement,
          deposit_pence: parsed.data.deposit_pence,
        });
        updatePayload.payment_requirement = norm.payment_requirement;
        updatePayload.deposit_pence = norm.deposit_pence;
      } else if (parsed.data.deposit_pence !== undefined) {
        const dp = parsed.data.deposit_pence ?? 0;
        updatePayload.payment_requirement = dp > 0 ? 'deposit' : 'none';
        updatePayload.deposit_pence = dp > 0 ? dp : null;
      }

      if (staff.role === 'admin' && parsed.data.custom_availability_enabled === false) {
        updatePayload.custom_working_hours = null;
      }

      const rowDurU = (serviceRow as { duration_minutes?: number }).duration_minutes ?? 30;
      const effectiveDurU =
        typeof updatePayload.duration_minutes === 'number' ? updatePayload.duration_minutes : rowDurU;
      const rowBlocksU = parseProcessingTimeBlocksFromDb(
        (serviceRow as { processing_time_blocks?: unknown }).processing_time_blocks,
      );
      const effectiveBlocksU =
        updatePayload.processing_time_blocks !== undefined
          ? (updatePayload.processing_time_blocks as import('@/types/booking-models').ProcessingTimeBlock[])
          : rowBlocksU;
      const procCheckU = validateProcessingTimeBlocks(effectiveBlocksU, effectiveDurU);
      if (!procCheckU.ok) {
        return NextResponse.json({ error: procCheckU.error }, { status: 400 });
      }
      if (Object.prototype.hasOwnProperty.call(updatePayload, 'processing_time_blocks')) {
        updatePayload.processing_time_blocks = procCheckU.normalized ?? [];
      }

      let savedRow = serviceRow as Record<string, unknown>;
      if (Object.keys(updatePayload).length > 0) {
        const { data, error } = await admin
          .from('service_items')
          .update(updatePayload)
          .eq('id', id)
          .eq('venue_id', staff.venue_id)
          .select()
          .single();

        if (error) {
          console.error('PATCH /api/venue/appointment-services (service_items) failed:', error);
          return NextResponse.json({ error: 'Failed to update service' }, { status: 500 });
        }
        savedRow = (data as Record<string, unknown>) ?? savedRow;
      } else if (requestedManagedCalendarIds === undefined && !variantsProvided && !addonLinksProvided) {
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
      }

      let savedVariants: Awaited<ReturnType<typeof replaceServiceVariants>> | null = null;
      if (variantsProvided) {
        savedVariants = await replaceServiceVariants({
          admin,
          venueId: staff.venue_id,
          parent: { kind: 'service_item', service_item_id: id as string },
          variants: parsedVariants,
        });
        if (!savedVariants.ok) {
          return NextResponse.json({ error: savedVariants.error }, { status: 500 });
        }
      }

      if (addonLinksProvided) {
        const linkRes = await replaceServiceAddonGroupLinks({
          admin,
          venueId: staff.venue_id,
          parent: { kind: 'service_item', service_item_id: id as string },
          links: parsedAddonLinks,
        });
        if (!linkRes.ok) {
          return NextResponse.json({ error: linkRes.error }, { status: 500 });
        }
      }

      const [variantMap, addonGroupMap] = await Promise.all([
        loadVariantsForServices({
          admin,
          venueId: staff.venue_id,
          schema: 'service_item',
          parentIds: [id as string],
        }),
        loadAddonGroupsForServices({
          admin,
          venueId: staff.venue_id,
          schema: 'service_item',
          parentIds: [id as string],
          includeHidden: true,
          includeInactive: true,
        }),
      ]);

      return NextResponse.json({
        ...mapServiceItemRowForDashboard(savedRow),
        variants: variantMap.get(id as string) ?? [],
        addon_groups: addonGroupMap.get(id as string) ?? [],
      });
    }

    const { data: serviceRow, error: serviceErr } = await admin
      .from('appointment_services')
      .select('*')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (serviceErr || !serviceRow) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    if (staff.role !== 'admin') {
      const creatorId = (serviceRow as { created_by_staff_id?: string | null }).created_by_staff_id ?? null;
      if (creatorId !== staff.id) {
        return NextResponse.json(
          { error: 'Only the team member who created this service can change its definition.' },
          { status: 403 },
        );
      }
    }

    const legacyCustomCoherent = assertPatchCustomAvailabilityCoherent({
      patch: parsed.data,
      currentRow: serviceRow as Record<string, unknown>,
    });
    if (!legacyCustomCoherent.ok) {
      return NextResponse.json({ error: legacyCustomCoherent.message }, { status: 400 });
    }

    let managedScope: Awaited<ReturnType<typeof requireManagedCalendarIds>> | null = null;
    let requestedPractitionerIds = practitioner_ids;
    let patchPayload: Record<string, unknown> = { ...parsed.data };

    if (staff.role !== 'admin') {
      managedScope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
      if (!managedScope.ok) {
        return NextResponse.json({ error: managedScope.error }, { status: 403 });
      }

      const filteredPatch = buildStaffEditableServicePatch(serviceRow as Record<string, unknown>, patchPayload);
      if (!filteredPatch.ok) {
        return NextResponse.json({ error: filteredPatch.error }, { status: 403 });
      }
      patchPayload = filteredPatch.updates;

      if (requestedPractitionerIds !== undefined) {
        const { allowedIds, rejectedIds } = filterIdsToManagedCalendars(
          managedScope.managedCalendarIds,
          requestedPractitionerIds,
        );
        if (rejectedIds.length > 0) {
          return NextResponse.json(
            { error: 'You can only change service links on calendars assigned to your account.' },
            { status: 403 },
          );
        }
        requestedPractitionerIds = allowedIds;
      }
    }

    if (requestedPractitionerIds !== undefined && requestedPractitionerIds.length > 0) {
      const pCheck = await assertPractitionerIdsBelongToVenueLegacy(admin, staff.venue_id, requestedPractitionerIds);
      if (!pCheck.ok) {
        return NextResponse.json({ error: pCheck.message }, { status: 400 });
      }
    }

    const { data: existingLinks, error: existingErr } = await admin
      .from('practitioner_services')
      .select('*')
      .eq('service_id', id);

    if (existingErr) {
      console.error('PATCH /api/venue/appointment-services (existing practitioner links):', existingErr.message);
      return NextResponse.json({ error: 'Could not verify service calendar links.' }, { status: 500 });
    }

    if (requestedPractitionerIds !== undefined) {
      const currentLinks = (existingLinks ?? []) as PractitionerService[];
      const currentPractitionerIds = currentLinks.map((r) => r.practitioner_id);
      const currentManagedIds =
        staff.role === 'admin'
          ? currentPractitionerIds
          : currentPractitionerIds.filter((pid) => managedScope?.ok && managedScope.managedCalendarIds.includes(pid));
      const removedPractitioners = currentManagedIds.filter((pid) => !requestedPractitionerIds.includes(pid));

      for (const pid of removedPractitioners) {
        const check = await hasBlockingBookingsRemovingServicesFromCalendarLegacy(admin, {
          venueId: staff.venue_id,
          practitionerId: pid,
          appointmentServiceIds: [id],
        });
        if (check.error) {
          return NextResponse.json({ error: check.error }, { status: 500 });
        }
        if (check.blocked) {
          return NextResponse.json({ error: SERVICE_REMOVAL_BLOCKED_BY_BOOKINGS }, { status: 409 });
        }
      }

      const preservedOutsideScope =
        staff.role === 'admin'
          ? []
          : currentLinks.filter((r) => !managedScope?.ok || !managedScope.managedCalendarIds.includes(r.practitioner_id));
      const preserveByPractitioner = new Map(currentLinks.map((r) => [r.practitioner_id, r] as const));
      const finalLinks = [
        ...preservedOutsideScope,
        ...requestedPractitionerIds.map((pid) => {
          const prev = preserveByPractitioner.get(pid);
          return {
            practitioner_id: pid,
            service_id: id,
            custom_price_pence: prev?.custom_price_pence ?? null,
            custom_duration_minutes: prev?.custom_duration_minutes ?? null,
            custom_name: prev?.custom_name ?? null,
            custom_description: prev?.custom_description ?? null,
            custom_buffer_minutes: prev?.custom_buffer_minutes ?? null,
            custom_deposit_pence: prev?.custom_deposit_pence ?? null,
            custom_colour: prev?.custom_colour ?? null,
          };
        }),
      ];

      await admin.from('practitioner_services').delete().eq('service_id', id);
      if (finalLinks.length > 0) {
        const { error: linkErr } = await admin.from('practitioner_services').insert(finalLinks);
        if (linkErr) {
          console.error('PATCH /api/venue/appointment-services practitioner_services failed:', linkErr);
          return NextResponse.json({ error: 'Failed to update service links' }, { status: 500 });
        }
      }
    }

    if (parsed.data.payment_requirement !== undefined) {
      const norm = normalizeServicePaymentFields({
        payment_requirement: parsed.data.payment_requirement,
        deposit_pence: parsed.data.deposit_pence,
      });
      patchPayload.payment_requirement = norm.payment_requirement;
      patchPayload.deposit_pence = norm.deposit_pence;
    } else if (parsed.data.deposit_pence !== undefined) {
      const dp = parsed.data.deposit_pence ?? 0;
      patchPayload.payment_requirement = dp > 0 ? 'deposit' : 'none';
      patchPayload.deposit_pence = dp > 0 ? dp : null;
    }

    if (staff.role === 'admin' && parsed.data.custom_availability_enabled === false) {
      patchPayload.custom_working_hours = null;
    }

    const rowDurL = (serviceRow as { duration_minutes?: number }).duration_minutes ?? 30;
    const effectiveDurL =
      typeof patchPayload.duration_minutes === 'number' ? patchPayload.duration_minutes : rowDurL;
    const rowBlocksL = parseProcessingTimeBlocksFromDb(
      (serviceRow as { processing_time_blocks?: unknown }).processing_time_blocks,
    );
    const effectiveBlocksL =
      patchPayload.processing_time_blocks !== undefined
        ? (patchPayload.processing_time_blocks as import('@/types/booking-models').ProcessingTimeBlock[])
        : rowBlocksL;
    const procCheckL = validateProcessingTimeBlocks(effectiveBlocksL, effectiveDurL);
    if (!procCheckL.ok) {
      return NextResponse.json({ error: procCheckL.error }, { status: 400 });
    }
    if (Object.prototype.hasOwnProperty.call(patchPayload, 'processing_time_blocks')) {
      patchPayload.processing_time_blocks = procCheckL.normalized ?? [];
    }

    let savedRow = serviceRow as Record<string, unknown>;
    if (Object.keys(patchPayload).length > 0) {
      const { data, error } = await admin
        .from('appointment_services')
        .update(patchPayload)
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .select()
        .single();

      if (error) {
        console.error('PATCH /api/venue/appointment-services failed:', error);
        return NextResponse.json({ error: 'Failed to update service' }, { status: 500 });
      }
      savedRow = (data as Record<string, unknown>) ?? savedRow;
    } else if (requestedPractitionerIds === undefined && !variantsProvided && !addonLinksProvided) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    let savedVariantsLegacy: Awaited<ReturnType<typeof replaceServiceVariants>> | null = null;
    if (variantsProvided) {
      savedVariantsLegacy = await replaceServiceVariants({
        admin,
        venueId: staff.venue_id,
        parent: { kind: 'appointment_service', appointment_service_id: id as string },
        variants: parsedVariants,
      });
      if (!savedVariantsLegacy.ok) {
        return NextResponse.json({ error: savedVariantsLegacy.error }, { status: 500 });
      }
    }

    if (addonLinksProvided) {
      const linkRes = await replaceServiceAddonGroupLinks({
        admin,
        venueId: staff.venue_id,
        parent: { kind: 'appointment_service', appointment_service_id: id as string },
        links: parsedAddonLinks,
      });
      if (!linkRes.ok) {
        return NextResponse.json({ error: linkRes.error }, { status: 500 });
      }
    }

    const [variantMapLegacy, addonGroupMapLegacy] = await Promise.all([
      loadVariantsForServices({
        admin,
        venueId: staff.venue_id,
        schema: 'appointment_service',
        parentIds: [id as string],
      }),
      loadAddonGroupsForServices({
        admin,
        venueId: staff.venue_id,
        schema: 'appointment_service',
        parentIds: [id as string],
        includeHidden: true,
        includeInactive: true,
      }),
    ]);

    return NextResponse.json({
      ...savedRow,
      variants: variantMapLegacy.get(id as string) ?? [],
      addon_groups: addonGroupMapLegacy.get(id as string) ?? [],
    });
  } catch (err) {
    console.error('PATCH /api/venue/appointment-services failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/appointment-services - delete a service (admin, or staff if only on managed calendars). */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const preferUnified = await venueUsesUnifiedServiceItems(admin, staff.venue_id);

    // Locate the service in whichever table actually holds it. Hybrid venues (primary
    // 'appointment' with 'unified_scheduling' enabled as a secondary, or vice versa) may have
    // services in either `service_items` or the legacy `appointment_services` table, so picking
    // the table from `useUnified` alone produced spurious "Service not found" errors when the
    // row lived in the other table.
    const [unifiedLookup, legacyLookup] = await Promise.all([
      admin
        .from('service_items')
        .select('id, created_by_staff_id')
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle(),
      admin
        .from('appointment_services')
        .select('id, created_by_staff_id')
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle(),
    ]);

    if (unifiedLookup.error && legacyLookup.error) {
      console.error('DELETE /api/venue/appointment-services lookup failed:', {
        unified: unifiedLookup.error,
        legacy: legacyLookup.error,
      });
      return NextResponse.json(
        { error: 'Could not verify the service. Please try again.' },
        { status: 500 },
      );
    }

    const unifiedRow = unifiedLookup.data as { created_by_staff_id?: string | null } | null;
    const legacyRow = legacyLookup.data as { created_by_staff_id?: string | null } | null;

    if (!unifiedRow && !legacyRow) {
      return NextResponse.json(
        { error: buildEntityNotFoundMessage('service') },
        { status: 404 },
      );
    }

    // If both tables hold a row with this id (rare; only during migrations), respect the venue's
    // current preference so we delete the row the dashboard is reading from.
    const useUnified =
      unifiedRow && legacyRow ? preferUnified : Boolean(unifiedRow);
    const row = useUnified ? unifiedRow : legacyRow;
    const createdByStaffId = row?.created_by_staff_id ?? null;

    const venueGuard = useUnified
      ? await hasUpcomingActiveBookingsForVenueServiceItem(admin, staff.venue_id, id)
      : await hasUpcomingActiveBookingsForVenueAppointmentService(admin, staff.venue_id, id);
    if (venueGuard.error) {
      return NextResponse.json({ error: venueGuard.error }, { status: 500 });
    }
    if (venueGuard.blocked) {
      return NextResponse.json(
        {
          error: buildUpcomingBookingsBlockMessage('service', venueGuard.bookingCount),
          booking_count: venueGuard.bookingCount,
        },
        { status: 409 },
      );
    }

    if (staff.role !== 'admin') {
      if ((createdByStaffId ?? null) !== staff.id) {
        return NextResponse.json(
          { error: 'Only the team member who created this service can delete it.' },
          { status: 403 },
        );
      }
      const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: 403 });
      }

      if (useUnified) {
        const { data: links, error: linksErr } = await admin
          .from('calendar_service_assignments')
          .select('calendar_id')
          .eq('service_item_id', id);
        if (linksErr) {
          console.error('DELETE appointment-services (links):', linksErr);
          return NextResponse.json({ error: 'Could not verify service calendar links.' }, { status: 500 });
        }
        const calIds = [...new Set((links ?? []).map((r) => (r as { calendar_id: string }).calendar_id))];
        if (calIds.some((cid) => !scope.managedCalendarIds.includes(cid))) {
          return NextResponse.json(
            {
              error:
                'You can only delete services that are not linked to calendars outside your account. Ask an admin to adjust links first.',
            },
            { status: 403 },
          );
        }
      } else {
        const { data: links, error: linksErr } = await admin
          .from('practitioner_services')
          .select('practitioner_id')
          .eq('service_id', id);
        if (linksErr) {
          console.error('DELETE appointment-services (practitioner links):', linksErr);
          return NextResponse.json({ error: 'Could not verify service calendar links.' }, { status: 500 });
        }
        const pids = [...new Set((links ?? []).map((r) => (r as { practitioner_id: string }).practitioner_id))];
        if (pids.some((pid) => !scope.managedCalendarIds.includes(pid))) {
          return NextResponse.json(
            {
              error:
                'You can only delete services that are not linked to calendars outside your account. Ask an admin to adjust links first.',
            },
            { status: 403 },
          );
        }
      }
    }

    const table = useUnified ? 'service_items' : 'appointment_services';
    const { error } = await admin.from(table).delete().eq('id', id).eq('venue_id', staff.venue_id);

    if (error) {
      console.error('DELETE /api/venue/appointment-services failed:', error);
      return NextResponse.json({ error: 'Failed to delete service' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/appointment-services failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
