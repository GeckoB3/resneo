import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { calendarDateInTimeZone, getVenueTimeZone } from '@/lib/guests/guest-contacts-list';
import { z } from 'zod';
import { normalizeToE164 } from '@/lib/phone/e164';
import { normaliseGuestTagsInput } from '@/lib/guests/tags';
import { inferBookingRowModel, bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import { validateAndCoerceCustomFields, mergeCustomFieldsJson } from '@/lib/guests/custom-field-validation';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';
import type { CustomClientFieldDefinition } from '@/types/contacts';

const patchSchema = z
  .object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    email: z.string().email().max(255).optional().or(z.literal('')),
    phone: z.string().max(24).optional().or(z.literal('')),
    tags: z.array(z.string()).optional(),
    customer_profile_notes: z.string().max(8000).nullable().optional(),
    custom_fields: z.record(z.string(), z.unknown()).optional(),
    marketing_opt_out: z.boolean().optional(),
    marketing_consent: z.boolean().optional(),
    /** Contact address (client-address services); empty string clears a field. */
    address_line1: z.string().max(200).optional(),
    address_line2: z.string().max(200).optional(),
    address_city: z.string().max(100).optional(),
    address_postcode: z.string().max(20).optional(),
  })
  .refine(
    (d) =>
      d.first_name !== undefined ||
      d.last_name !== undefined ||
      d.email !== undefined ||
      d.phone !== undefined ||
      d.tags !== undefined ||
      d.customer_profile_notes !== undefined ||
      d.custom_fields !== undefined ||
      d.marketing_opt_out !== undefined ||
      d.marketing_consent !== undefined ||
      d.address_line1 !== undefined ||
      d.address_line2 !== undefined ||
      d.address_city !== undefined ||
      d.address_postcode !== undefined,
    { message: 'At least one field required' },
  );

function bookingTimeShort(t: string | null | undefined): string {
  if (!t || typeof t !== 'string') return '';
  return t.slice(0, 5);
}

function partySizeShort(ps: number | null): string {
  if (ps == null || !Number.isFinite(ps)) return '-';
  return String(ps);
}

function isoDateFromTimestamp(iso: string): string {
  return iso.slice(0, 10);
}

/** Whole calendar days from date A to date B (A <= B), using YYYY-MM-DD strings. */
function wholeDaysBetweenDates(fromDate: string, toDate: string): number {
  const a = new Date(`${fromDate}T12:00:00.000Z`);
  const b = new Date(`${toDate}T12:00:00.000Z`);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

/**
 * GET /api/venue/guests/[guestId] - guest profile, stats, bookings, communications (venue staff).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { guestId } = await params;
    const bhLimitRaw = Number.parseInt(request.nextUrl.searchParams.get('booking_history_limit') ?? '75', 10);
    const bookingHistoryLimit = Math.min(100, Math.max(1, Number.isFinite(bhLimitRaw) ? bhLimitRaw : 75));

    const { data: guest, error: gErr } = await staff.db
      .from('guests')
      .select(
        'id, venue_id, first_name, last_name, email, phone, tags, visit_count, no_show_count, last_visit_date, customer_profile_notes, created_at, updated_at, marketing_opt_out, marketing_consent, marketing_consent_at, custom_fields, address_line1, address_line2, address_city, address_postcode',
      )
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (gErr || !guest) {
      return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    }

    const venueId = staff.venue_id;

    const [
      { count: totalBookingsCount, error: totalCountErr },
      { count: cancellations, error: cancelCountErr },
      { count: noShows, error: noShowCountErr },
      { data: paidDeposits, error: depositErr },
      { data: firstVisitRows, error: firstVisitErr },
      { data: lastVisitRows, error: lastVisitErr },
    ] = await Promise.all([
      staff.db
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('guest_id', guestId)
        .eq('venue_id', venueId),
      staff.db
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('guest_id', guestId)
        .eq('venue_id', venueId)
        .eq('status', 'Cancelled'),
      staff.db
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('guest_id', guestId)
        .eq('venue_id', venueId)
        .eq('status', 'No-Show'),
      staff.db
        .from('bookings')
        .select('deposit_amount_pence')
        .eq('guest_id', guestId)
        .eq('venue_id', venueId)
        .eq('deposit_status', 'Paid'),
      staff.db
        .from('bookings')
        .select('booking_date')
        .eq('guest_id', guestId)
        .eq('venue_id', venueId)
        .not('booking_date', 'is', null)
        .order('booking_date', { ascending: true })
        .limit(1),
      staff.db
        .from('bookings')
        .select('booking_date')
        .eq('guest_id', guestId)
        .eq('venue_id', venueId)
        .not('booking_date', 'is', null)
        .order('booking_date', { ascending: false })
        .limit(1),
    ]);

    const statsErr =
      totalCountErr ?? cancelCountErr ?? noShowCountErr ?? depositErr ?? firstVisitErr ?? lastVisitErr;
    if (statsErr) {
      console.error('GET guest stats failed:', statsErr);
      return NextResponse.json({ error: 'Failed to load guest stats' }, { status: 500 });
    }

    const cancellationsCount = cancellations ?? 0;
    const totalBookingsExcludingCancelled = Math.max(0, (totalBookingsCount ?? 0) - cancellationsCount);
    let depositTotalPence = 0;
    for (const row of paidDeposits ?? []) {
      const pence = (row as { deposit_amount_pence?: number | null }).deposit_amount_pence;
      if (typeof pence === 'number' && Number.isFinite(pence)) {
        depositTotalPence += pence;
      }
    }
    const firstVisit =
      (firstVisitRows?.[0] as { booking_date?: string | null } | undefined)?.booking_date ?? null;
    const lastVisit =
      (lastVisitRows?.[0] as { booking_date?: string | null } | undefined)?.booking_date ?? null;

    const { data: recentRaw, error: rbErr } = await staff.db
      .from('bookings')
      .select(
        'id, booking_date, booking_time, party_size, status, deposit_status, deposit_amount_pence, booking_model, estimated_end_time, booking_end_time, service_id, area_id, practitioner_id, appointment_service_id, calendar_id, service_item_id, service_variant_id, experience_event_id, class_instance_id, resource_id, event_session_id',
      )
      .eq('guest_id', guestId)
      .eq('venue_id', staff.venue_id)
      .order('booking_date', { ascending: false })
      .order('booking_time', { ascending: false })
      .limit(bookingHistoryLimit);

    if (rbErr) {
      console.error('GET guest recent bookings failed:', rbErr);
      return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 });
    }

    const recent = recentRaw ?? [];
    const practitionerIds = [...new Set(recent.map((r) => r.practitioner_id).filter(Boolean))] as string[];
    const serviceIds = [...new Set(recent.map((r) => r.appointment_service_id).filter(Boolean))] as string[];
    const calendarIds = [...new Set(recent.map((r) => (r as { calendar_id?: string | null }).calendar_id).filter(Boolean))] as string[];
    const serviceItemIds = [...new Set(recent.map((r) => (r as { service_item_id?: string | null }).service_item_id).filter(Boolean))] as string[];
    const eventIds = [...new Set(recent.map((r) => (r as { experience_event_id?: string | null }).experience_event_id).filter(Boolean))] as string[];
    const classInstIds = [...new Set(recent.map((r) => (r as { class_instance_id?: string | null }).class_instance_id).filter(Boolean))] as string[];
    const resourceIds = [...new Set(recent.map((r) => (r as { resource_id?: string | null }).resource_id).filter(Boolean))] as string[];
    const areaIds = [...new Set(recent.map((r) => (r as { area_id?: string | null }).area_id).filter(Boolean))] as string[];

    const prMap = new Map<string, string>();
    const svcMap = new Map<string, string>();
    const calMap = new Map<string, string>();
    const siMap = new Map<string, string>();
    const evMap = new Map<string, string>();
    const resMap = new Map<string, string>();
    const areaMap = new Map<string, string>();
    const classLabelMap = new Map<string, string>();

    if (practitionerIds.length > 0) {
      const { data: prs } = await staff.db.from('practitioners').select('id, name').in('id', practitionerIds);
      for (const p of prs ?? []) {
        prMap.set((p as { id: string }).id, (p as { name: string }).name);
      }
    }
    if (serviceIds.length > 0) {
      const { data: svcs } = await staff.db.from('appointment_services').select('id, name').in('id', serviceIds);
      for (const s of svcs ?? []) {
        svcMap.set((s as { id: string }).id, (s as { name: string }).name);
      }
    }
    if (calendarIds.length > 0) {
      const { data: cals } = await staff.db.from('unified_calendars').select('id, name').in('id', calendarIds);
      for (const c of cals ?? []) {
        calMap.set((c as { id: string }).id, (c as { name: string }).name);
      }
    }
    if (serviceItemIds.length > 0) {
      const { data: sis } = await staff.db.from('service_items').select('id, name').in('id', serviceItemIds);
      for (const s of sis ?? []) {
        siMap.set((s as { id: string }).id, (s as { name: string }).name);
      }
    }
    if (eventIds.length > 0) {
      const { data: evs } = await staff.db.from('experience_events').select('id, name').in('id', eventIds);
      for (const e of evs ?? []) {
        evMap.set((e as { id: string }).id, (e as { name: string }).name);
      }
    }
    if (resourceIds.length > 0) {
      const { data: vrs } = await staff.db.from('unified_calendars').select('id, name').in('id', resourceIds);
      for (const v of vrs ?? []) {
        resMap.set((v as { id: string }).id, (v as { name: string }).name);
      }
    }
    if (areaIds.length > 0) {
      const { data: areas } = await staff.db.from('areas').select('id, name').in('id', areaIds);
      for (const a of areas ?? []) {
        areaMap.set((a as { id: string }).id, (a as { name: string }).name);
      }
    }
    if (classInstIds.length > 0) {
      const { data: instRows } = await staff.db
        .from('class_instances')
        .select('id, class_type_id')
        .in('id', classInstIds);
      const typeIds = [...new Set((instRows ?? []).map((r) => (r as { class_type_id?: string }).class_type_id).filter(Boolean))] as string[];
      const typeMap = new Map<string, string>();
      if (typeIds.length > 0) {
        const { data: types } = await staff.db.from('class_types').select('id, name').in('id', typeIds);
        for (const t of types ?? []) {
          typeMap.set((t as { id: string }).id, (t as { name: string }).name);
        }
      }
      for (const row of instRows ?? []) {
        const id = (row as { id: string }).id;
        const ct = (row as { class_type_id?: string }).class_type_id;
        classLabelMap.set(id, ct ? typeMap.get(ct) ?? 'Class' : 'Class');
      }
    }

    const booking_history = recent.map((r) => {
      const row = r as {
        id: string;
        booking_date: string;
        booking_time: string;
        party_size: number | null;
        status: string;
        deposit_status: string | null;
        deposit_amount_pence?: number | null;
        booking_model?: string | null;
        estimated_end_time?: string | null;
        booking_end_time?: string | null;
        service_id?: string | null;
        area_id?: string | null;
        practitioner_id: string | null;
        appointment_service_id: string | null;
        calendar_id?: string | null;
        service_item_id?: string | null;
        service_variant_id?: string | null;
        experience_event_id?: string | null;
        class_instance_id?: string | null;
        resource_id?: string | null;
        event_session_id?: string | null;
      };
      const model = inferBookingRowModel(row);
      const practitioner_name = row.practitioner_id ? prMap.get(row.practitioner_id) ?? null : null;
      const service_name = row.appointment_service_id ? svcMap.get(row.appointment_service_id) ?? null : null;
      const calendar_name = row.calendar_id ? calMap.get(row.calendar_id) ?? null : null;
      const service_item_name = row.service_item_id ? siMap.get(row.service_item_id) ?? null : null;

      let detail_label = '';
      if (model === 'event_ticket' && row.experience_event_id) {
        detail_label = evMap.get(row.experience_event_id) ?? 'Event';
      } else if (model === 'class_session' && row.class_instance_id) {
        detail_label = classLabelMap.get(row.class_instance_id) ?? 'Class';
      } else if (model === 'resource_booking' && row.resource_id) {
        detail_label = resMap.get(row.resource_id) ?? 'Resource';
      } else if (model === 'unified_scheduling') {
        const parts = [calendar_name, service_item_name].filter(Boolean);
        detail_label = parts.length > 0 ? parts.join(' · ') : 'Appointment';
      } else if (model === 'practitioner_appointment') {
        const parts = [practitioner_name, service_name].filter(Boolean);
        detail_label = parts.length > 0 ? parts.join(' · ') : 'Appointment';
      } else {
        detail_label =
          partySizeShort(row.party_size) === '-' ? 'Table reservation' : `Table · ${partySizeShort(row.party_size)} guests`;
      }

      return {
        id: row.id,
        booking_date: row.booking_date,
        booking_time: bookingTimeShort(row.booking_time),
        party_size: row.party_size,
        status: row.status,
        deposit_status: row.deposit_status,
        deposit_amount_pence:
          typeof row.deposit_amount_pence === 'number' && Number.isFinite(row.deposit_amount_pence)
            ? row.deposit_amount_pence
            : null,
        booking_model: model,
        kind_label: bookingModelShortLabel(model),
        detail_label,
        practitioner_name,
        service_name,
        practitioner_id: row.practitioner_id,
        appointment_service_id: row.appointment_service_id,
        calendar_id: row.calendar_id ?? null,
        calendar_name,
        service_item_id: row.service_item_id ?? null,
        service_variant_id: row.service_variant_id ?? null,
        service_id: row.service_id ?? null,
        area_id: row.area_id ?? null,
        area_name: row.area_id ? areaMap.get(row.area_id) ?? null : null,
        estimated_end_time: row.estimated_end_time ?? null,
        booking_end_time: row.booking_end_time ?? null,
        experience_event_id: row.experience_event_id ?? null,
        class_instance_id: row.class_instance_id ?? null,
        resource_id: row.resource_id ?? null,
        event_session_id: row.event_session_id ?? null,
      };
    });

    const { data: bookingIdRows } = await staff.db
      .from('bookings')
      .select('id')
      .eq('guest_id', guestId)
      .eq('venue_id', staff.venue_id)
      .limit(300);

    const bookingIdsForComms = (bookingIdRows ?? [])
      .map((b) => (b as { id?: string }).id)
      .filter((id): id is string => typeof id === 'string');

    const commsOrParts: string[] = [`guest_id.eq.${guestId}`];
    if (bookingIdsForComms.length > 0) {
      commsOrParts.push(`booking_id.in.(${bookingIdsForComms.join(',')})`);
    }
    const { data: commRows, error: commErr } = await staff.db
      .from('communications')
      .select('id, message_type, channel, status, created_at, booking_id, guest_id')
      .eq('venue_id', staff.venue_id)
      .or(commsOrParts.join(','))
      .order('created_at', { ascending: false })
      .limit(100);

    if (commErr) {
      console.error('GET guest communications failed:', commErr);
      return NextResponse.json({ error: 'Failed to load communications' }, { status: 500 });
    }

    const communications = (commRows ?? []).map((c) => {
      const row = c as {
        id: string;
        message_type: string;
        channel: string;
        status: string;
        created_at: string;
        booking_id: string | null;
        guest_id: string | null;
      };
      return {
        id: row.id,
        message_type: row.message_type,
        channel: row.channel,
        status: row.status,
        created_at: row.created_at,
        booking_id: row.booking_id,
        guest_id: row.guest_id,
      };
    });

    const tags = Array.isArray((guest as { tags?: string[] }).tags)
      ? (guest as { tags: string[] }).tags
      : [];

    const { data: fieldDefs, error: cfErr } = await staff.db
      .from('custom_client_fields')
      .select('id, venue_id, field_name, field_key, field_type, is_active, created_at')
      .eq('venue_id', staff.venue_id)
      .order('created_at', { ascending: true });

    if (cfErr) {
      console.error('GET guest custom field defs failed:', cfErr);
      return NextResponse.json({ error: 'Failed to load custom field definitions' }, { status: 500 });
    }

    const custom_field_definitions = (fieldDefs ?? []) as CustomClientFieldDefinition[];

    const rawCf = (guest as { custom_fields?: unknown }).custom_fields;
    const custom_fields =
      rawCf && typeof rawCf === 'object' && !Array.isArray(rawCf) ? (rawCf as Record<string, unknown>) : {};

    const tz = await getVenueTimeZone(staff.db, staff.venue_id);
    const todayCal = calendarDateInTimeZone(new Date(), tz);
    const createdDate = isoDateFromTimestamp((guest as { created_at: string }).created_at);
    const lastVisitDate = (guest as { last_visit_date?: string | null }).last_visit_date ?? null;
    const days_since_last_visit =
      lastVisitDate && lastVisitDate <= todayCal ? wholeDaysBetweenDates(lastVisitDate, todayCal) : null;
    const days_as_customer = wholeDaysBetweenDates(createdDate, todayCal);

    return NextResponse.json({
      guest: {
        id: guest.id,
        first_name: (guest as { first_name?: string | null }).first_name ?? null,
        last_name: (guest as { last_name?: string | null }).last_name ?? null,
        email: guest.email,
        phone: guest.phone,
        tags,
        visit_count: (guest as { visit_count?: number }).visit_count ?? 0,
        no_show_count: (guest as { no_show_count?: number }).no_show_count ?? 0,
        last_visit_date: (guest as { last_visit_date?: string | null }).last_visit_date ?? null,
        customer_profile_notes: (guest as { customer_profile_notes?: string | null }).customer_profile_notes ?? null,
        created_at: (guest as { created_at?: string }).created_at,
        updated_at: (guest as { updated_at?: string }).updated_at,
        marketing_opt_out: Boolean((guest as { marketing_opt_out?: boolean }).marketing_opt_out),
        marketing_consent: Boolean((guest as { marketing_consent?: boolean }).marketing_consent),
        marketing_consent_at: (guest as { marketing_consent_at?: string | null }).marketing_consent_at ?? null,
        custom_fields,
        address_line1: (guest as { address_line1?: string | null }).address_line1 ?? null,
        address_line2: (guest as { address_line2?: string | null }).address_line2 ?? null,
        address_city: (guest as { address_city?: string | null }).address_city ?? null,
        address_postcode: (guest as { address_postcode?: string | null }).address_postcode ?? null,
      },
      stats: {
        total_bookings: totalBookingsExcludingCancelled,
        cancellations: cancellationsCount,
        no_shows: noShows ?? 0,
        total_deposit_pence_paid: depositTotalPence,
        first_visit_date: firstVisit,
        last_visit_date: lastVisit,
        days_since_last_visit,
        days_as_customer,
      },
      booking_history,
      communications,
      custom_field_definitions,
    });
  } catch (err) {
    console.error('GET /api/venue/guests/[guestId] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/venue/guests/[guestId] - update guest (venue staff).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { guestId } = await params;
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: existing, error: exErr } = await staff.db
      .from('guests')
      .select(
        'id, marketing_opt_out, marketing_consent, marketing_consent_at, custom_fields',
      )
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (exErr || !existing) {
      return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    }

    const prev = existing as {
      marketing_opt_out: boolean;
      marketing_consent: boolean;
      marketing_consent_at: string | null;
      custom_fields: unknown;
    };

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (parsed.data.first_name !== undefined) {
      const t = parsed.data.first_name.trim();
      update.first_name = t === '' ? null : t;
    }
    if (parsed.data.last_name !== undefined) {
      const t = parsed.data.last_name.trim();
      update.last_name = t === '' ? null : t;
    }
    if (parsed.data.email !== undefined) {
      const e = parsed.data.email.trim();
      update.email = e === '' ? null : e.toLowerCase();
    }
    if (parsed.data.phone !== undefined) {
      const raw = parsed.data.phone.trim();
      if (raw === '') {
        update.phone = null;
      } else {
        const e164 = normalizeToE164(raw);
        if (!e164) {
          return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
        }
        update.phone = e164;
      }
    }
    if (parsed.data.tags !== undefined) {
      update.tags = normaliseGuestTagsInput(parsed.data.tags);
    }
    if (parsed.data.customer_profile_notes !== undefined) {
      const t = parsed.data.customer_profile_notes;
      update.customer_profile_notes = t === null || t.trim() === '' ? null : t.trim();
    }
    for (const key of ['address_line1', 'address_line2', 'address_city', 'address_postcode'] as const) {
      const v = parsed.data[key];
      if (v !== undefined) {
        const t = v.trim();
        update[key] = t === '' ? null : t;
      }
    }

    let nextOptOut = Boolean(prev.marketing_opt_out);
    let nextConsent = Boolean(prev.marketing_consent);
    let nextConsentAt: string | null = prev.marketing_consent_at;

    if (parsed.data.marketing_opt_out !== undefined) {
      nextOptOut = parsed.data.marketing_opt_out;
      update.marketing_opt_out = nextOptOut;
    }
    if (parsed.data.marketing_consent !== undefined) {
      nextConsent = parsed.data.marketing_consent;
      update.marketing_consent = nextConsent;
      if (nextConsent) {
        nextConsentAt = new Date().toISOString();
        update.marketing_consent_at = nextConsentAt;
      } else {
        nextConsentAt = null;
        update.marketing_consent_at = null;
      }
    }

    if (parsed.data.custom_fields !== undefined) {
      const { data: defs, error: defErr } = await staff.db
        .from('custom_client_fields')
        .select('id, venue_id, field_name, field_key, field_type, is_active, created_at')
        .eq('venue_id', staff.venue_id);

      if (defErr) {
        console.error('PATCH guest custom field defs failed:', defErr);
        return NextResponse.json({ error: 'Failed to load custom field definitions' }, { status: 500 });
      }

      const definitions = (defs ?? []) as CustomClientFieldDefinition[];
      const existingCf =
        prev.custom_fields && typeof prev.custom_fields === 'object' && !Array.isArray(prev.custom_fields)
          ? (prev.custom_fields as Record<string, unknown>)
          : {};

      const validated = validateAndCoerceCustomFields(parsed.data.custom_fields, definitions);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }

      update.custom_fields = mergeCustomFieldsJson(existingCf, validated.value);
    }

    const marketingChanged =
      parsed.data.marketing_opt_out !== undefined || parsed.data.marketing_consent !== undefined;

    const dataKeys = Object.keys(update).filter((k) => k !== 'updated_at');
    if (dataKeys.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data: updated, error: upErr } = await staff.db
      .from('guests')
      .update(update)
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .select(
        'id, first_name, last_name, email, phone, tags, visit_count, no_show_count, last_visit_date, customer_profile_notes, created_at, updated_at, marketing_opt_out, marketing_consent, marketing_consent_at, custom_fields',
      )
      .single();

    if (upErr) {
      console.error('PATCH /api/venue/guests/[guestId] failed:', upErr);
      return NextResponse.json({ error: 'Failed to update guest' }, { status: 500 });
    }

    if (marketingChanged) {
      await staff.db.from('guest_marketing_consent_events').insert({
        venue_id: staff.venue_id,
        guest_id: guestId,
        actor_staff_id: staff.id,
        marketing_consent: nextConsent,
        marketing_opt_out: nextOptOut,
      });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: guestId,
      actor_staff_id: staff.id,
      event_type: 'guest_profile_updated',
      metadata: {
        keys: dataKeys.filter((k) => k !== 'updated_at'),
        marketing_changed: marketingChanged,
      },
    });

    return NextResponse.json({ guest: updated });
  } catch (err) {
    console.error('PATCH /api/venue/guests/[guestId] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
