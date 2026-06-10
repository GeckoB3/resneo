import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { bookingModelShortLabel, inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    if (type === 'bookings') {
      const { data: bookings, error } = await staff.db
        .from('bookings')
        .select(`
          id,
          booking_date,
          booking_time,
          party_size,
          status,
          deposit_status,
          deposit_amount_pence,
          stripe_payment_intent_id,
          source,
          dietary_notes,
          occasion,
          created_at,
          experience_event_id,
          class_instance_id,
          resource_id,
          event_session_id,
          calendar_id,
          service_item_id,
          practitioner_id,
          appointment_service_id,
          guests (
            name,
            email,
            phone
          )
        `)
        .eq('venue_id', staff.venue_id)
        .order('booking_date', { ascending: false });

      if (error) {
        console.error('Export bookings error:', error);
        return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
      }

      const headers = [
        'Booking ID',
        'Date',
        'Time',
        'Party Size',
        'Status',
        'Deposit Status',
        'Deposit Amount (£)',
        'Stripe Payment Intent',
        'Source',
        'Guest Name',
        'Guest Email',
        'Guest Phone',
        'Dietary Notes',
        'Occasion',
        'Created At',
      ];

      const rows = (bookings ?? []).map((b) => {
        const guest = Array.isArray(b.guests) ? b.guests[0] : b.guests;
        const timeRaw = typeof b.booking_time === 'string' ? b.booking_time : '';
        const timeDisplay = timeRaw.length >= 5 ? timeRaw.slice(0, 5) : timeRaw;
        const pence = b.deposit_amount_pence as number | null | undefined;
        const depositGbp =
          pence != null && Number.isFinite(pence) ? (pence / 100).toFixed(2) : '';
        const row = b as Record<string, unknown>;
        const inferred = inferBookingRowModel({
          experience_event_id: row.experience_event_id as string | null | undefined,
          class_instance_id: row.class_instance_id as string | null | undefined,
          resource_id: row.resource_id as string | null | undefined,
          event_session_id: row.event_session_id as string | null | undefined,
          calendar_id: row.calendar_id as string | null | undefined,
          service_item_id: row.service_item_id as string | null | undefined,
          practitioner_id: row.practitioner_id as string | null | undefined,
          appointment_service_id: row.appointment_service_id as string | null | undefined,
        });
        const typeLabel = bookingModelShortLabel(inferred);
        return [
          b.id,
          b.booking_date,
          timeDisplay,
          typeLabel,
          b.party_size,
          b.status,
          b.deposit_status ?? '',
          depositGbp,
          b.stripe_payment_intent_id ?? '',
          b.source ?? '',
          (guest as { name?: string } | null)?.name ?? '',
          (guest as { email?: string } | null)?.email ?? '',
          (guest as { phone?: string } | null)?.phone ?? '',
          b.dietary_notes ?? '',
          b.occasion ?? '',
          b.created_at,
        ];
      });

      const csv = buildCsv(headers, rows);
      const today = new Date().toISOString().slice(0, 10);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="bookings-${today}.csv"`,
        },
      });
    }

    if (type === 'guests') {
      if (!requireAdmin(staff)) {
        return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
      }
      const { data: guests, error } = await staff.db
        .from('guests')
        .select(`
          id,
          name,
          email,
          phone,
          visit_count,
          no_show_count,
          last_visit_date,
          created_at,
          tags
        `)
        .eq('venue_id', staff.venue_id)
        .order('name');

      if (error) {
        console.error('Export guests error:', error);
        return NextResponse.json({ error: 'Failed to fetch guests' }, { status: 500 });
      }

      // Count bookings per guest
      const { data: bookingCounts } = await staff.db
        .from('bookings')
        .select('guest_id')
        .eq('venue_id', staff.venue_id);

      const countMap: Record<string, number> = {};
      for (const b of bookingCounts ?? []) {
        if (b.guest_id) countMap[b.guest_id] = (countMap[b.guest_id] ?? 0) + 1;
      }

      const headers = [
        'Guest ID',
        'Name',
        'Email',
        'Phone',
        'Tags',
        'Visit count (seated)',
        'No-show count',
        'Last visit',
        'Total bookings',
        'First seen',
      ];
      const rows = (guests ?? []).map((g) => {
        const tags = Array.isArray((g as { tags?: string[] }).tags)
          ? (g as { tags: string[] }).tags.join('; ')
          : '';
        return [
          g.id,
          g.name ?? '',
          g.email ?? '',
          g.phone ?? '',
          tags,
          (g as { visit_count?: number }).visit_count ?? 0,
          (g as { no_show_count?: number }).no_show_count ?? 0,
          (g as { last_visit_date?: string | null }).last_visit_date ?? '',
          countMap[g.id] ?? 0,
          g.created_at,
        ];
      });

      const csv = buildCsv(headers, rows);
      const today = new Date().toISOString().slice(0, 10);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="guests-${today}.csv"`,
        },
      });
    }

    return NextResponse.json({ error: 'type must be "bookings" or "guests"' }, { status: 400 });
  } catch (err) {
    console.error('GET /api/venue/export failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
