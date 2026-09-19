import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  buildExportTable,
  countExportRows,
  isYmd,
  loadExportVenue,
  type ExportKind,
  type ExportRange,
} from '@/lib/export/venue-data-export';
import { isExportFormat, writeExportFile, type ExportFormat } from '@/lib/export/export-writers';

/**
 * GET /api/venue/export?type=bookings|contacts|services&format=csv|xlsx|pdf&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The whole-venue export behind Settings → Reports → Export your data. `type=guests` is the old
 * name for contacts and still works. Leave `from` and `to` out for everything the venue holds.
 * Add `count=1` to get `{ count }` for the range instead of a file, which is how the page says
 * "142 appointments" before anyone downloads anything.
 *
 * Admins only (PB-19): every file carries clients' emails and phone numbers.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const kind = parseKind(searchParams.get('type'));
    if (!kind) {
      return NextResponse.json({ error: 'type must be "bookings", "contacts" or "services"' }, { status: 400 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const formatParam = searchParams.get('format') ?? 'csv';
    if (!isExportFormat(formatParam)) {
      return NextResponse.json({ error: 'format must be "csv", "xlsx" or "pdf"' }, { status: 400 });
    }
    const format: ExportFormat = formatParam;

    const range = parseRange(searchParams.get('from'), searchParams.get('to'));
    if (range === 'invalid') {
      return NextResponse.json({ error: 'from and to must be dates (YYYY-MM-DD), with from on or before to' }, { status: 400 });
    }

    const venue = await loadExportVenue(staff.db, staff.venue_id);

    if (searchParams.get('count') === '1') {
      const count = await countExportRows(kind, staff.db, venue, range);
      return NextResponse.json({ count }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const table = await buildExportTable(kind, { db: staff.db, admin: getSupabaseAdminClient() }, venue, range);
    const file = writeExportFile(table, format, { venue, range });
    return new NextResponse(file.body as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
        'X-Export-Rows': String(table.rows.length),
      },
    });
  } catch (err) {
    console.error('GET /api/venue/export failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function parseKind(value: string | null): ExportKind | null {
  switch (value) {
    case 'bookings':
      return 'bookings';
    case 'contacts':
    case 'guests':
      return 'contacts';
    case 'services':
      return 'services';
    default:
      return null;
  }
}

function parseRange(from: string | null, to: string | null): ExportRange | null | 'invalid' {
  if (!from && !to) return null;
  if (!isYmd(from) || !isYmd(to) || from > to) return 'invalid';
  return { from, to };
}
