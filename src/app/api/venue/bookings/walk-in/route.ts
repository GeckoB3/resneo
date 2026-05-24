import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { replaceBookingAssignments, syncTableStatusesForBooking } from '@/lib/table-management/lifecycle';
import { resolvePartySizeBoundsForVenueServices } from '@/lib/booking/party-size-bounds';
import { resolveVenueMode } from '@/lib/venue-mode';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { getDefaultAreaIdForVenue } from '@/lib/areas/resolve-default-area';
import { fetchEngineInput } from '@/lib/availability';
import { getDayOfWeek, resolveDuration, selectServiceForWalkInTime, timeToMinutes } from '@/lib/availability/engine';
import { z } from 'zod';
import { normalizeToE164 } from '@/lib/phone/e164';
import { normaliseGuestNamePart } from '@/lib/guests/name';
import { findOrCreateGuest } from '@/lib/guests';
import type { GuestRecord } from '@/lib/guests';

async function incrementGuestVisitAfterWalkIn(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  guestId: string,
  visitDate: string,
): Promise<void> {
  const { data: gv } = await admin.from('guests').select('visit_count').eq('id', guestId).maybeSingle();
  await admin
    .from('guests')
    .update({
      visit_count: (gv?.visit_count ?? 0) + 1,
      last_visit_date: visitDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', guestId);
}

async function resolveWalkInGuest(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  input: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null },
): Promise<{ ok: true; guest: GuestRecord; created: boolean } | { ok: false; message: string }> {
  try {
    const result = await findOrCreateGuest(admin, venueId, input);
    return { ok: true, guest: result.guest, created: result.created };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[walk-in] findOrCreateGuest failed:', err);
    return { ok: false, message };
  }
}

const walkInSchema = z.object({
  party_size: z.number().int().min(1).max(50),
  first_name: z.string().max(120).optional(),
  last_name: z.string().max(120).optional(),
  phone: z.string().max(24).optional(),
  dietary_notes: z.string().max(500).optional(),
  occasion: z.string().max(200).optional(),
  table_id: z.string().uuid().optional(),
  table_ids: z.array(z.string().uuid()).optional(),
  temporary_table_name: z.string().trim().min(1).max(50).optional(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  booking_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/).optional(),
  practitioner_id: z.string().uuid().optional(),
  appointment_service_id: z.string().uuid().optional(),
  email: z.union([z.literal(''), z.string().email()]).optional(),
  /** Override venue-derived cover time for table walk-ins (minutes at the table). */
  duration_minutes: z.number().int().min(15).max(300).optional(),
  /** When no `table_ids` are sent, scopes service inference, suggestions, and temporary tables to this dining area. */
  area_id: z.string().uuid().optional(),
});

function isUuid(value: string | null): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function venueLocalDateTime(timezone: string): { date: string; hours: number; minutes: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hours: Number(get('hour')),
    minutes: Number(get('minute')),
  };
}

function extractTime(value: string): string {
  if (value.includes('T')) {
    return (value.split('T')[1] ?? '').slice(0, 5);
  }
  return value.slice(0, 5);
}

/** Wall-clock end time (HH:MM:SS) from a start time and duration; does not enforce bookable slots. */
function addMinutesToBookingEnd(startHhMmSs: string, addMins: number): string {
  const [h, m] = startHhMmSs.slice(0, 5).split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + addMins;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

function estimatedEndIsoFromDuration(bookingDate: string, startHhMmSs: string, durationMinutes: number): string | null {
  const [year, month, day] = bookingDate.split('-').map(Number);
  const [hour, minute] = startHhMmSs.slice(0, 5).split(':').map(Number);
  if (!year || !month || !day || hour == null || minute == null) return null;
  const startUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const endDate = new Date(startUtc + durationMinutes * 60 * 1000);
  return Number.isNaN(endDate.getTime()) ? null : endDate.toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const bookingDate = searchParams.get('date');
    const bookingTime = searchParams.get('time');
    const partySizeRaw = Number(searchParams.get('party_size'));
    const areaId = searchParams.get('area_id');

    if (!bookingDate || !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || !bookingTime) {
      return NextResponse.json({ error: 'date and time are required' }, { status: 400 });
    }
    if (!Number.isInteger(partySizeRaw) || partySizeRaw < 1 || partySizeRaw > 50) {
      return NextResponse.json({ error: 'party_size must be between 1 and 50' }, { status: 400 });
    }
    if (areaId != null && areaId !== '' && !isUuid(areaId)) {
      return NextResponse.json({ error: 'Invalid area_id' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const resolvedAreaId = areaId && isUuid(areaId) ? areaId : await getDefaultAreaIdForVenue(admin, staff.venue_id);
    if (!resolvedAreaId) {
      return NextResponse.json({ error: 'Availability setup is required before creating walk-ins' }, { status: 503 });
    }

    const time = bookingTime.length === 5 ? `${bookingTime}:00` : bookingTime;
    const service = await inferTableWalkInService(
      admin,
      staff.venue_id,
      resolvedAreaId,
      bookingDate,
      time,
      partySizeRaw,
    );

    return NextResponse.json({
      service_id: service.serviceId,
      duration_minutes: service.durationMinutes,
      estimated_end_time: service.estimatedEndTime,
    });
  } catch (err) {
    console.error('GET /api/venue/bookings/walk-in failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function createTemporaryWalkInTable({
  admin,
  venueId,
  areaId,
  bookingId,
  name,
  partySize,
}: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  venueId: string;
  areaId: string;
  bookingId: string;
  name: string;
  partySize: number;
}): Promise<string> {
  const { data: latestTable } = await admin
    .from('venue_tables')
    .select('sort_order')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSortOrder = Number(latestTable?.sort_order ?? 0) + 1;
  const { data, error } = await admin
    .from('venue_tables')
    .insert({
      venue_id: venueId,
      area_id: areaId,
      name,
      min_covers: 1,
      max_covers: Math.max(1, partySize),
      shape: 'rectangle',
      table_type: 'Regular',
      sort_order: nextSortOrder,
      server_section: 'Temporary',
      is_active: true,
      is_temporary: true,
      temporary_booking_id: bookingId,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    if (error?.code === '23505') {
      throw new Error('A table with this name already exists. Use a unique temporary table name.');
    }
    throw new Error(error?.message ?? 'Failed to create temporary table');
  }

  return data.id as string;
}

async function inferTableWalkInAreaId(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  tableIds: string[],
): Promise<string | null> {
  if (tableIds.length > 0) {
    const { data: tableRows, error } = await admin
      .from('venue_tables')
      .select('area_id')
      .eq('venue_id', venueId)
      .in('id', tableIds)
      .limit(1);
    if (error) {
      console.error('Walk-in table area lookup failed:', error);
    }
    const areaId = (tableRows?.[0] as { area_id?: string | null } | undefined)?.area_id;
    if (areaId) return areaId;
  }

  return getDefaultAreaIdForVenue(admin, venueId);
}

async function inferTableWalkInService(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  areaId: string,
  bookingDate: string,
  bookingTime: string,
  partySize: number,
): Promise<{ serviceId: string | null; estimatedEndTime: string | null; durationMinutes: number }> {
  try {
    const engineInput = await fetchEngineInput({
      supabase: admin,
      venueId,
      date: bookingDate,
      partySize,
      areaId,
    });
    const dayOfWeek = getDayOfWeek(bookingDate);
    const service = selectServiceForWalkInTime(engineInput, venueId, bookingDate, bookingTime);

    if (!service) {
      return { serviceId: null, estimatedEndTime: null, durationMinutes: 90 };
    }

    const durationMinutes = resolveDuration(engineInput.durations, service.id, partySize, dayOfWeek);
    return {
      serviceId: service.id,
      estimatedEndTime: estimatedEndIsoFromDuration(bookingDate, bookingTime, durationMinutes),
      durationMinutes,
    };
  } catch (error) {
    console.error('Walk-in table service inference failed:', error);
    return { serviceId: null, estimatedEndTime: null, durationMinutes: 90 };
  }
}

/**
 * POST /api/venue/bookings/walk-in
 * Quick add walk-in: source walk-in, status Seated, no deposit.
 * Body: { party_size, name? }. Uses today's date and current venue-local time.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = walkInSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      party_size,
      first_name: rawFirst,
      last_name: rawLast,
      phone,
      email: rawEmail,
      dietary_notes,
      occasion,
      table_id,
      table_ids: rawTableIds,
      temporary_table_name: temporaryTableName,
      booking_date,
      booking_time,
    } = parsed.data;

    const firstName = normaliseGuestNamePart(rawFirst);
    const lastName = normaliseGuestNamePart(rawLast);

    let phoneE164: string | null = null;
    if (phone?.trim()) {
      const n = normalizeToE164(phone.trim(), 'GB');
      if (!n) {
        return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
      }
      phoneE164 = n;
    }

    const admin = getSupabaseAdminClient();
    const venueMode = await resolveVenueMode(admin, staff.venue_id);
    /** Walk-ins are served immediately; staff attendance is confirmed at creation (no extra UI step). */
    const staffAttendanceAt = new Date().toISOString();

    // --- Model B: Appointment walk-in ---
    if (isUnifiedSchedulingVenue(venueMode.bookingModel)) {
      const { practitioner_id, appointment_service_id } = parsed.data;
      if (!practitioner_id || !appointment_service_id) {
        return NextResponse.json(
          { error: 'practitioner_id and appointment_service_id are required for appointment walk-ins' },
          { status: 400 },
        );
      }

      const { data: pracCheck } = await admin
        .from('practitioners')
        .select('id')
        .eq('id', practitioner_id)
        .eq('venue_id', staff.venue_id)
        .eq('is_active', true)
        .single();
      if (!pracCheck) {
        return NextResponse.json({ error: 'Practitioner not found or inactive' }, { status: 400 });
      }

      const { data: venueRow } = await admin
        .from('venues')
        .select('timezone')
        .eq('id', staff.venue_id)
        .single();
      const tz = venueRow?.timezone ?? 'Europe/London';
      const localNow = venueLocalDateTime(tz);
      const today = parsed.data.booking_date ?? localNow.date;
      const exactTime = `${String(localNow.hours).padStart(2, '0')}:${String(localNow.minutes).padStart(2, '0')}:00`;
      const walkInTime = parsed.data.booking_time
        ? (parsed.data.booking_time.length === 5 ? `${parsed.data.booking_time}:00` : parsed.data.booking_time)
        : exactTime;

      const { data: svc } = await admin
        .from('appointment_services')
        .select('duration_minutes')
        .eq('id', appointment_service_id)
        .eq('venue_id', staff.venue_id)
        .single();
      if (!svc) {
        return NextResponse.json({ error: 'Appointment service not found' }, { status: 400 });
      }
      const durationMins = svc.duration_minutes;

      // Walk-ins use the venue-local moment of confirmation, not the public availability grid.
      const bookingEndTime = addMinutesToBookingEnd(walkInTime, durationMins);
      const emailNorm = rawEmail?.trim() ? rawEmail.trim().toLowerCase() : null;
      const estimatedEndIso = estimatedEndIsoFromDuration(today, walkInTime, durationMins);

      const guestResolved = await resolveWalkInGuest(admin, staff.venue_id, {
        first_name: firstName,
        last_name: lastName,
        email: emailNorm,
        phone: phoneE164,
      });
      if (!guestResolved.ok) {
        return NextResponse.json(
          { error: 'Failed to create guest', details: guestResolved.message },
          { status: 500 },
        );
      }
      const { guest: apptGuest, created: apptGuestCreated } = guestResolved;

      const { data: apptBooking, error: apptBookErr } = await admin
        .from('bookings')
        .insert({
          venue_id: staff.venue_id,
          guest_id: apptGuest.id,
          booking_date: today,
          booking_time: walkInTime,
          booking_end_time: bookingEndTime,
          party_size: 1,
          /** Must be set explicitly — column defaults to `table_reservation`, which fails the area_required CHECK for non-table venues. */
          booking_model: venueMode.bookingModel,
          status: 'Seated',
          source: 'walk-in',
          deposit_status: 'Not Required',
          dietary_notes: dietary_notes?.trim() || null,
          occasion: occasion?.trim() || null,
          practitioner_id,
          appointment_service_id,
          estimated_end_time: estimatedEndIso,
          staff_attendance_confirmed_at: staffAttendanceAt,
          guest_first_name: firstName,
          guest_last_name: lastName,
          guest_phone: phoneE164,
        })
        .select('id, booking_date, booking_time, booking_end_time, party_size, status, source')
        .single();

      if (apptBookErr) {
        console.error('Walk-in appointment insert failed:', apptBookErr);
        if (apptGuestCreated) {
          await admin.from('guests').delete().eq('id', apptGuest.id).eq('venue_id', staff.venue_id);
        }
        return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
      }

      await incrementGuestVisitAfterWalkIn(admin, apptGuest.id, today);

      return NextResponse.json(apptBooking, { status: 201 });
    }

    // --- Model A: Table walk-in ---
    const { min: minPartyWalkIn, max: maxPartyWalkIn } = await resolvePartySizeBoundsForVenueServices(
      admin,
      staff.venue_id,
    );
    if (party_size < minPartyWalkIn || party_size > maxPartyWalkIn) {
      return NextResponse.json(
        { error: `Party size must be between ${minPartyWalkIn} and ${maxPartyWalkIn}` },
        { status: 400 },
      );
    }

    const { data: venueSettings } = await admin
      .from('venues')
      .select('timezone, table_management_enabled')
      .eq('id', staff.venue_id)
      .single();
    const timezone = venueSettings?.timezone ?? 'Europe/London';
    const coversOnly = !(venueSettings?.table_management_enabled);
    const localNow = venueLocalDateTime(timezone);
    const today = booking_date ?? localNow.date;
    const exactTime = `${String(localNow.hours).padStart(2, '0')}:${String(localNow.minutes).padStart(2, '0')}:00`;
    const bookingTime = booking_time ? (booking_time.length === 5 ? `${booking_time}:00` : booking_time) : exactTime;

    const requestedTemporaryTableName = temporaryTableName?.trim();
    if (requestedTemporaryTableName && (rawTableIds?.length || table_id)) {
      return NextResponse.json({ error: 'Choose either existing tables or a temporary table, not both' }, { status: 400 });
    }

    const resolvedTableIds = rawTableIds ?? (table_id ? [table_id] : []);
    let areaId = await inferTableWalkInAreaId(admin, staff.venue_id, resolvedTableIds);
    if (
      resolvedTableIds.length === 0 &&
      parsed.data.area_id &&
      isUuid(parsed.data.area_id)
    ) {
      const { data: areaRow } = await admin
        .from('areas')
        .select('id')
        .eq('id', parsed.data.area_id)
        .eq('venue_id', staff.venue_id)
        .eq('is_active', true)
        .maybeSingle();
      if (areaRow?.id) {
        areaId = areaRow.id as string;
      }
    }
    if (!areaId) {
      return NextResponse.json({ error: 'Availability setup is required before creating walk-ins' }, { status: 503 });
    }
    const tableWalkInService = await inferTableWalkInService(
      admin,
      staff.venue_id,
      areaId,
      today,
      bookingTime,
      party_size,
    );
    const walkInDurationMinutes =
      parsed.data.duration_minutes ?? tableWalkInService.durationMinutes;
    const walkInEstimatedEndIso = estimatedEndIsoFromDuration(
      today,
      bookingTime,
      walkInDurationMinutes,
    );

    if (resolvedTableIds.length > 0 && !coversOnly) {
      const { data: tableChecks } = await admin
        .from('venue_tables')
        .select('id, max_covers')
        .eq('venue_id', staff.venue_id)
        .in('id', resolvedTableIds);

      if (!tableChecks || tableChecks.length !== resolvedTableIds.length) {
        return NextResponse.json({ error: 'Table not found or does not belong to this venue' }, { status: 400 });
      }

      const combinedCapacity = tableChecks.reduce((total, table) => total + (table.max_covers ?? 0), 0);
      if (party_size > combinedCapacity) {
        return NextResponse.json({ error: `Party of ${party_size} exceeds selected table capacity (max ${combinedCapacity})` }, { status: 400 });
      }

      const bookingStartMinutes = timeToMinutes(bookingTime);
      const bookingEndMinutes = bookingStartMinutes + walkInDurationMinutes;

      const { data: existingAssignments } = await admin
        .from('booking_table_assignments')
        .select('booking_id, bookings!inner(booking_date, booking_time, estimated_end_time, status)')
        .in('table_id', resolvedTableIds)
        .eq('bookings.booking_date', today);
      const hasBookingConflict = (existingAssignments ?? []).some((assignment: {
        bookings:
          | {
              booking_date: string | null;
              booking_time: string | null;
              estimated_end_time: string | null;
              status: string | null;
            }
          | Array<{
              booking_date: string | null;
              booking_time: string | null;
              estimated_end_time: string | null;
              status: string | null;
            }>
          | null;
      }) => {
        const details = Array.isArray(assignment.bookings) ? assignment.bookings[0] : assignment.bookings;
        if (!details || !details.booking_time || !details.status) return false;
        if (!['Pending', 'Booked', 'Confirmed', 'Seated'].includes(details.status)) return false;
        const existingStart = timeToMinutes(extractTime(details.booking_time));
        let existingEnd = details.estimated_end_time
          ? timeToMinutes(extractTime(details.estimated_end_time))
          : existingStart + 90;
        if (existingEnd <= existingStart) {
          existingEnd += 24 * 60;
        }
        return bookingStartMinutes < existingEnd && bookingEndMinutes > existingStart;
      });
      if (hasBookingConflict) {
        return NextResponse.json({ error: 'Selected table is already occupied at that time' }, { status: 409 });
      }

      const dayStart = `${today}T00:00:00.000Z`;
      const dayEnd = `${today}T23:59:59.999Z`;
      const { data: existingBlocks } = await admin
        .from('table_blocks')
        .select('start_at, end_at')
        .in('table_id', resolvedTableIds)
        .lt('start_at', dayEnd)
        .gt('end_at', dayStart);
      const hasBlockConflict = (existingBlocks ?? []).some((block: { start_at: string; end_at: string }) => {
        const existingStart = timeToMinutes(new Date(block.start_at).toISOString().slice(11, 16));
        let existingEnd = timeToMinutes(new Date(block.end_at).toISOString().slice(11, 16));
        if (existingEnd <= existingStart) {
          existingEnd += 24 * 60;
        }
        return bookingStartMinutes < existingEnd && bookingEndMinutes > existingStart;
      });
      if (hasBlockConflict) {
        return NextResponse.json({ error: 'Selected table is blocked at that time' }, { status: 409 });
      }
    }

    const tableGuestResolved = await resolveWalkInGuest(admin, staff.venue_id, {
      first_name: firstName,
      last_name: lastName,
      email: null,
      phone: phoneE164,
    });
    if (!tableGuestResolved.ok) {
      return NextResponse.json(
        { error: 'Failed to create guest', details: tableGuestResolved.message },
        { status: 500 },
      );
    }
    const { guest: walkInGuest, created: tableGuestCreated } = tableGuestResolved;

    const { data: booking, error: bookErr } = await admin
      .from('bookings')
      .insert({
        venue_id: staff.venue_id,
        guest_id: walkInGuest.id,
        booking_date: today,
        booking_time: bookingTime,
        party_size,
        booking_model: 'table_reservation',
        status: 'Seated',
        source: 'walk-in',
        area_id: areaId,
        service_id: tableWalkInService.serviceId,
        estimated_end_time: walkInEstimatedEndIso,
        deposit_status: 'Not Required',
        deposit_amount_pence: null,
        dietary_notes: dietary_notes?.trim() || null,
        occasion: occasion?.trim() || null,
        staff_attendance_confirmed_at: staffAttendanceAt,
        guest_first_name: firstName,
        guest_last_name: lastName,
        guest_phone: phoneE164,
      })
      .select('id, booking_date, booking_time, party_size, status, source')
      .single();

    if (bookErr) {
      console.error('Walk-in booking insert failed:', bookErr);
      if (tableGuestCreated) {
        await admin.from('guests').delete().eq('id', walkInGuest.id).eq('venue_id', staff.venue_id);
      }
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
    }

    let assignedTableIds = resolvedTableIds;
    if (requestedTemporaryTableName && !coversOnly) {
      try {
        const temporaryTableId = await createTemporaryWalkInTable({
          admin,
          venueId: staff.venue_id,
          areaId,
          bookingId: booking.id,
          name: requestedTemporaryTableName,
          partySize: party_size,
        });
        assignedTableIds = [temporaryTableId];
      } catch (error) {
        console.error('Temporary walk-in table creation failed:', error);
        await admin.from('bookings').delete().eq('id', booking.id).eq('venue_id', staff.venue_id);
        if (tableGuestCreated) {
          await admin.from('guests').delete().eq('id', walkInGuest.id).eq('venue_id', staff.venue_id);
        }
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Failed to create temporary table' },
          { status: 500 },
        );
      }
    }

    if (assignedTableIds.length > 0) {
      await replaceBookingAssignments(admin, booking.id, assignedTableIds, staff.id);
      await syncTableStatusesForBooking(admin, booking.id, assignedTableIds, 'Seated', staff.id);
    }

    await incrementGuestVisitAfterWalkIn(admin, walkInGuest.id, today);

    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/bookings/walk-in failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
