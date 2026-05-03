import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import {
  aggregateBookingSignalsForGuests,
  calendarDateInTimeZone,
  fetchUpcomingGuestIdsOrdered,
  getVenueTimeZone,
  monthStartCalendarDateInTimeZone,
  parseGuestListQuery,
  addDaysCalendarDate,
  fetchGuestIdsForSpendSort,
  type GuestRowBase,
} from '@/lib/guests/guest-contacts-list';

function shapeGuestListRow(
  row: GuestRowBase,
  signals: {
    totalBookings: Map<string, number>;
    cancelled: Map<string, number>;
    upcoming: Map<string, number>;
    paidDepositPence: Map<string, number>;
    nextBookingDate: Map<string, string>;
    nextBookingTime: Map<string, string>;
  },
  includeCustomFieldValues: boolean,
) {
  const rawCf = (row as { custom_fields?: unknown }).custom_fields;
  const custom_fields =
    includeCustomFieldValues && rawCf && typeof rawCf === 'object' && !Array.isArray(rawCf)
      ? (rawCf as Record<string, unknown>)
      : undefined;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tags: Array.isArray(row.tags) ? row.tags : [],
    visit_count: row.visit_count ?? 0,
    no_show_count: row.no_show_count ?? 0,
    last_visit_date: row.last_visit_date ?? null,
    created_at: row.created_at,
    identifiability_tier: row.identifiability_tier ?? 'named',
    marketing_opt_out: Boolean((row as { marketing_opt_out?: boolean }).marketing_opt_out),
    marketing_consent: Boolean((row as { marketing_consent?: boolean }).marketing_consent),
    total_bookings: signals.totalBookings.get(row.id) ?? 0,
    cancelled_count: signals.cancelled.get(row.id) ?? 0,
    upcoming_booking_count: signals.upcoming.get(row.id) ?? 0,
    next_booking_date: signals.nextBookingDate.get(row.id) ?? null,
    next_booking_time: signals.nextBookingTime.get(row.id) ?? null,
    paid_deposit_pence: signals.paidDepositPence.get(row.id) ?? 0,
    ...(custom_fields ? { custom_fields } : {}),
  };
}

/**
 * GET /api/venue/guests - paginated guest list (venue staff).
 * Query: search, tags, sort, filter (all|identified|anonymous), status (all|upcoming|lapsed|new_this_month|vip), page, limit.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const params = parseGuestListQuery(request.nextUrl.searchParams);
    const { search, tags, sort, filter, lifecycle, page, limit, include_custom_fields } = params;

    const guestListSelect = include_custom_fields
      ? 'id, name, email, phone, tags, visit_count, no_show_count, last_visit_date, created_at, identifiability_tier, marketing_opt_out, marketing_consent, custom_fields'
      : 'id, name, email, phone, tags, visit_count, no_show_count, last_visit_date, created_at, identifiability_tier, marketing_opt_out, marketing_consent';
    const from = page * limit;
    const to = from + limit - 1;

    const tz = await getVenueTimeZone(staff.db, staff.venue_id);
    const today = calendarDateInTimeZone(new Date(), tz);
    const monthStart = monthStartCalendarDateInTimeZone(new Date(), tz);
    const lapsedCut = addDaysCalendarDate(today, -90);

    const buildBaseGuestQuery = () => {
      let query = staff.db
        .from('guests')
        .select(guestListSelect as never, { count: 'exact' })
        .eq('venue_id', staff.venue_id);

      if (filter === 'identified') {
        query = query.eq('identifiability_tier', 'identified');
      } else if (filter === 'anonymous') {
        query = query.eq('identifiability_tier', 'anonymous');
      } else {
        query = query.in('identifiability_tier', ['identified', 'named']);
      }

      if (tags.length) {
        query = query.contains('tags', tags);
      }

      if (search) {
        const p = `%${search}%`;
        query = query.or(`name.ilike.${p},email.ilike.${p},phone.ilike.${p}`);
      }

      if (lifecycle === 'lapsed') {
        query = query.not('last_visit_date', 'is', null).lte('last_visit_date', lapsedCut);
      } else if (lifecycle === 'new_this_month') {
        query = query.gte('created_at', `${monthStart}T00:00:00`);
      } else if (lifecycle === 'vip') {
        query = query.contains('tags', ['vip']);
      }

      return query;
    };

    const applySort = (
      query: ReturnType<typeof buildBaseGuestQuery>,
      sortKey: string,
    ): ReturnType<typeof buildBaseGuestQuery> => {
      switch (sortKey) {
        case 'name_asc':
          return query.order('name', { ascending: true, nullsFirst: false });
        case 'name_desc':
          return query.order('name', { ascending: false, nullsFirst: false });
        case 'last_visit_desc':
          return query.order('last_visit_date', { ascending: false, nullsFirst: true });
        case 'last_visit_asc':
          return query.order('last_visit_date', { ascending: true, nullsFirst: true });
        case 'visit_count_desc':
          return query.order('visit_count', { ascending: false });
        case 'created_desc':
          return query.order('created_at', { ascending: false });
        default:
          return query.order('last_visit_date', { ascending: false, nullsFirst: true });
      }
    };

    /** Paid deposits (high → low): reorder a capped id set server-side. */
    if (sort === 'paid_deposit_desc') {
      const { ids: pool, capped: poolCapped } = await fetchGuestIdsForSpendSort(staff, params, tz);
      if (pool.length === 0) {
        return NextResponse.json({
          guests: [],
          total: 0,
          page,
          limit,
          total_count: 0,
          meta: { spend_sort_capped: poolCapped },
        });
      }
      const { paidDepositPence } = await aggregateBookingSignalsForGuests(
        staff.db,
        staff.venue_id,
        pool,
        today,
      );
      const sortedPool = [...pool].sort((a, b) => {
        const pa = paidDepositPence.get(a) ?? 0;
        const pb = paidDepositPence.get(b) ?? 0;
        if (pb !== pa) return pb - pa;
        return a.localeCompare(b);
      });
      const total = sortedPool.length;
      const pageIds = sortedPool.slice(from, to + 1);
      if (pageIds.length === 0) {
        return NextResponse.json({
          guests: [],
          total,
          page,
          limit,
          total_count: total,
          meta: { spend_sort_capped: poolCapped },
        });
      }
      const { data: rows, error } = await staff.db
        .from('guests')
        .select(guestListSelect as never)
        .eq('venue_id', staff.venue_id)
        .in('id', pageIds);
      if (error) {
        console.error('GET /api/venue/guests (spend page) failed:', error);
        return NextResponse.json({ error: 'Failed to load guests' }, { status: 500 });
      }
      const rowList = (rows ?? []) as unknown as GuestRowBase[];
      const byId = new Map(rowList.map((r) => [r.id, r]));
      const orderedRows = pageIds.map((id) => byId.get(id)).filter(Boolean) as GuestRowBase[];
      const ids = orderedRows.map((r) => r.id);
      const { totalBookings, cancelled, upcoming, paidDepositPence: dep, nextBookingDate: nbd1, nextBookingTime: nbt1 } =
        await aggregateBookingSignalsForGuests(staff.db, staff.venue_id, ids, today);
      const guests = orderedRows.map((row) =>
        shapeGuestListRow(
          row,
          { totalBookings, cancelled, upcoming, paidDepositPence: dep, nextBookingDate: nbd1, nextBookingTime: nbt1 },
          include_custom_fields,
        ),
      );
      return NextResponse.json({
        guests,
        total,
        page,
        limit,
        total_count: total,
        meta: { spend_sort_capped: poolCapped },
      });
    }

    if (lifecycle === 'upcoming') {
      const orderedRaw = await fetchUpcomingGuestIdsOrdered(staff.db, staff.venue_id, today);
      const orderedIds = orderedRaw.slice(0, 500);
      if (orderedIds.length === 0) {
        return NextResponse.json({
          guests: [],
          total: 0,
          page,
          limit,
          total_count: 0,
          meta: { upcoming_window_capped: orderedRaw.length > 500 },
        });
      }

      let q = staff.db
        .from('guests')
        .select(guestListSelect as never)
        .eq('venue_id', staff.venue_id)
        .in('id', orderedIds);

      if (filter === 'identified') {
        q = q.eq('identifiability_tier', 'identified');
      } else if (filter === 'anonymous') {
        q = q.eq('identifiability_tier', 'anonymous');
      } else {
        q = q.in('identifiability_tier', ['identified', 'named']);
      }
      if (tags.length) {
        q = q.contains('tags', tags);
      }
      if (search) {
        const p = `%${search}%`;
        q = q.or(`name.ilike.${p},email.ilike.${p},phone.ilike.${p}`);
      }

      const { data: matchRows, error: mErr } = await q;
      if (mErr) {
        console.error('GET /api/venue/guests upcoming filter failed:', mErr);
        return NextResponse.json({ error: 'Failed to load guests' }, { status: 500 });
      }
      const orderIndex = new Map(orderedIds.map((id, i) => [id, i]));
      const matchList = (matchRows ?? []) as unknown as GuestRowBase[];
      const sorted = [...matchList].sort(
        (a, b) => (orderIndex.get(a.id) ?? 999) - (orderIndex.get(b.id) ?? 999),
      );
      const total = sorted.length;
      const slice = sorted.slice(from, to + 1);
      const ids = slice.map((r) => r.id);
      const { totalBookings, cancelled, upcoming, paidDepositPence, nextBookingDate, nextBookingTime } = await aggregateBookingSignalsForGuests(
        staff.db,
        staff.venue_id,
        ids,
        today,
      );
      const guests = slice.map((row) =>
        shapeGuestListRow(row, { totalBookings, cancelled, upcoming, paidDepositPence, nextBookingDate, nextBookingTime }, include_custom_fields),
      );
      return NextResponse.json({
        guests,
        total,
        page,
        limit,
        total_count: total,
        meta: { upcoming_window_capped: orderedRaw.length > 500 },
      });
    }

    let query = buildBaseGuestQuery();
    query = applySort(query, sort);
    query = query.order('id', { ascending: true });
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('GET /api/venue/guests failed:', error);
      return NextResponse.json({ error: 'Failed to load guests' }, { status: 500 });
    }

    const rows = (data ?? []) as unknown as GuestRowBase[];
    const ids = rows.map((r) => r.id);

    const { totalBookings, cancelled, upcoming, paidDepositPence, nextBookingDate, nextBookingTime } = await aggregateBookingSignalsForGuests(
      staff.db,
      staff.venue_id,
      ids,
      today,
    );

    const guests = rows.map((row) =>
      shapeGuestListRow(row, { totalBookings, cancelled, upcoming, paidDepositPence, nextBookingDate, nextBookingTime }, include_custom_fields),
    );

    return NextResponse.json({
      guests,
      total: count ?? guests.length,
      page,
      limit,
      total_count: count ?? guests.length,
    });
  } catch (err) {
    console.error('GET /api/venue/guests failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
