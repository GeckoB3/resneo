import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bookingDatetime,
  resolveRequirements,
  type ResolverRecord,
  type ResolverRequirement,
} from '@/lib/compliance/resolve-requirements';
import { COMPLIANCE_EXPIRING_SOON_DAYS } from '@/lib/compliance/constants';

/** Read a `name` from a Supabase to-one join (object or single-element array). */
function joinName(join: { name?: string } | { name?: string }[] | null | undefined): string {
  const t = Array.isArray(join) ? join[0] : join;
  return t?.name ?? 'Compliance record';
}

/**
 * Aggregated data for the venue compliance dashboard (spec §3.5): records expiring
 * soon, upcoming bookings missing a required record, and pending form links.
 * Batch-loads requirements + records (3 queries) and resolves in-memory via the
 * pure resolver — avoids per-booking round-trips.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UPCOMING_BOOKING_WINDOW_DAYS = 14;
const ACTIVE_BOOKING_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

export interface ExpiringRecordRow {
  id: string;
  guest_id: string;
  guest_name: string;
  compliance_type_id: string;
  compliance_type_name: string;
  expires_at: string;
  result: string | null;
}

export interface MissingBookingRow {
  booking_id: string;
  guest_id: string | null;
  guest_name: string;
  booking_date: string;
  booking_time: string | null;
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  state: string;
}

export interface AwaitingLinkRow {
  id: string;
  guest_id: string;
  guest_name: string;
  compliance_type_id: string;
  compliance_type_name: string;
  sent_via: string | null;
  sent_at: string | null;
  expires_at: string;
}

export interface ComplianceDashboardData {
  expiring_soon: ExpiringRecordRow[];
  missing_for_bookings: MissingBookingRow[];
  awaiting_submission: AwaitingLinkRow[];
}

type GuestJoin = { first_name?: string | null; last_name?: string | null; name?: string | null } | null;

function guestName(g: GuestJoin): string {
  const j = Array.isArray(g) ? g[0] : g;
  const full = [j?.first_name, j?.last_name].filter(Boolean).join(' ').trim();
  return full || j?.name?.trim() || 'Guest';
}

export async function loadComplianceDashboard(
  admin: SupabaseClient,
  venueId: string,
  now: Date = new Date(),
): Promise<ComplianceDashboardData> {
  const nowIso = now.toISOString();
  const expiringHorizonIso = new Date(now.getTime() + COMPLIANCE_EXPIRING_SOON_DAYS * MS_PER_DAY).toISOString();
  const bookingHorizonDate = new Date(now.getTime() + UPCOMING_BOOKING_WINDOW_DAYS * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const todayDate = nowIso.slice(0, 10);

  const [expiringRes, awaitingRes, bookingsRes] = await Promise.all([
    admin
      .from('compliance_records')
      .select('id, guest_id, compliance_type_id, expires_at, result, compliance_types!inner(name), guests!inner(first_name, last_name, name)')
      .eq('venue_id', venueId)
      .eq('status', 'completed')
      .is('voided_at', null)
      .not('expires_at', 'is', null)
      .gt('expires_at', nowIso)
      .lte('expires_at', expiringHorizonIso)
      .order('expires_at', { ascending: true })
      .limit(200),
    admin
      .from('compliance_form_links')
      .select('id, guest_id, compliance_type_id, sent_via, sent_at, expires_at, compliance_types!inner(name), guests!inner(first_name, last_name, name)')
      .eq('venue_id', venueId)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(200),
    admin
      .from('bookings')
      .select('id, guest_id, booking_date, booking_time, appointment_service_id, service_item_id, guests(first_name, last_name, name)')
      .eq('venue_id', venueId)
      .gte('booking_date', todayDate)
      .lte('booking_date', bookingHorizonDate)
      .in('status', ACTIVE_BOOKING_STATUSES)
      .limit(500),
  ]);

  const expiring_soon: ExpiringRecordRow[] = (expiringRes.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      guest_id: row.guest_id as string,
      guest_name: guestName(row.guests as GuestJoin),
      compliance_type_id: row.compliance_type_id as string,
      compliance_type_name: joinName(row.compliance_types as Parameters<typeof joinName>[0]),
      expires_at: row.expires_at as string,
      result: (row.result as string | null) ?? null,
    };
  });

  const awaiting_submission: AwaitingLinkRow[] = (awaitingRes.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      guest_id: row.guest_id as string,
      guest_name: guestName(row.guests as GuestJoin),
      compliance_type_id: row.compliance_type_id as string,
      compliance_type_name: joinName(row.compliance_types as Parameters<typeof joinName>[0]),
      sent_via: (row.sent_via as string | null) ?? null,
      sent_at: (row.sent_at as string | null) ?? null,
      expires_at: row.expires_at as string,
    };
  });

  const missing_for_bookings = await resolveMissingForBookings(admin, venueId, bookingsRes.data ?? [], now);

  return { expiring_soon, missing_for_bookings, awaiting_submission };
}

async function resolveMissingForBookings(
  admin: SupabaseClient,
  venueId: string,
  bookingRows: unknown[],
  now: Date,
): Promise<MissingBookingRow[]> {
  const bookings = bookingRows
    .map((b) => b as Record<string, unknown>)
    .filter((b) => b.appointment_service_id || b.service_item_id);
  if (bookings.length === 0) return [];

  const apptServiceIds = [...new Set(bookings.map((b) => b.appointment_service_id).filter(Boolean))] as string[];
  const serviceItemIds = [...new Set(bookings.map((b) => b.service_item_id).filter(Boolean))] as string[];
  const guestIds = [...new Set(bookings.map((b) => b.guest_id).filter(Boolean))] as string[];

  // Batch-load requirements for every involved service (both polymorphic columns).
  const reqQueries: Array<PromiseLike<{ data: unknown[] | null }>> = [];
  if (apptServiceIds.length > 0) {
    reqQueries.push(
      admin
        .from('service_compliance_requirements')
        .select('id, compliance_type_id, enforcement, lock_period_hours, appointment_service_id, compliance_types!inner(name, is_active)')
        .eq('venue_id', venueId)
        .in('appointment_service_id', apptServiceIds),
    );
  }
  if (serviceItemIds.length > 0) {
    reqQueries.push(
      admin
        .from('service_compliance_requirements')
        .select('id, compliance_type_id, enforcement, lock_period_hours, service_item_id, compliance_types!inner(name, is_active)')
        .eq('venue_id', venueId)
        .in('service_item_id', serviceItemIds),
    );
  }
  const reqResults = await Promise.all(reqQueries);
  const reqRows = reqResults.flatMap((r) => r.data ?? []) as Record<string, unknown>[];
  if (reqRows.length === 0) return [];

  // Index requirements by service id (whichever column is set).
  const reqsByService = new Map<string, ResolverRequirement[]>();
  const typeIds = new Set<string>();
  for (const row of reqRows) {
    const svcId = (row.appointment_service_id ?? row.service_item_id) as string;
    const typeJoin = row.compliance_types as { name?: string; is_active?: boolean } | { name?: string; is_active?: boolean }[] | null;
    const t = Array.isArray(typeJoin) ? typeJoin[0] : typeJoin;
    const req: ResolverRequirement = {
      id: row.id as string,
      compliance_type_id: row.compliance_type_id as string,
      compliance_type_name: t?.name ?? 'Compliance record',
      enforcement: row.enforcement as ResolverRequirement['enforcement'],
      lock_period_hours: (row.lock_period_hours as number | null) ?? null,
      type_is_active: t?.is_active ?? true,
    };
    const list = reqsByService.get(svcId) ?? [];
    list.push(req);
    reqsByService.set(svcId, list);
    typeIds.add(req.compliance_type_id);
  }

  // Batch-load the guests' records for the involved types.
  const recordsByGuest = new Map<string, ResolverRecord[]>();
  if (guestIds.length > 0 && typeIds.size > 0) {
    const { data: recRows } = await admin
      .from('compliance_records')
      .select(
        'id, guest_id, compliance_type_id, status, expires_at, voided_at, captured_at, result, captured_by_staff_id, compliance_types!inner(result_type)',
      )
      .eq('venue_id', venueId)
      .in('guest_id', guestIds)
      .in('compliance_type_id', [...typeIds]);
    for (const r of (recRows ?? []) as Record<string, unknown>[]) {
      const typeJoin = r.compliance_types as { result_type?: string } | { result_type?: string }[] | null;
      const t = Array.isArray(typeJoin) ? typeJoin[0] : typeJoin;
      const rec: ResolverRecord = {
        id: r.id as string,
        compliance_type_id: r.compliance_type_id as string,
        status: r.status as ResolverRecord['status'],
        expires_at: r.expires_at ? new Date(r.expires_at as string) : null,
        voided_at: r.voided_at ? new Date(r.voided_at as string) : null,
        captured_at: r.captured_at ? new Date(r.captured_at as string) : new Date(0),
        result: (r.result as string | null) ?? null,
        captured_by_staff_id: (r.captured_by_staff_id as string | null) ?? null,
        result_type: (t?.result_type as ResolverRecord['result_type']) ?? 'completed',
      };
      const gid = r.guest_id as string;
      const list = recordsByGuest.get(gid) ?? [];
      list.push(rec);
      recordsByGuest.set(gid, list);
    }
  }

  const out: MissingBookingRow[] = [];
  for (const b of bookings) {
    const svcId = (b.appointment_service_id ?? b.service_item_id) as string;
    const reqs = reqsByService.get(svcId);
    if (!reqs || reqs.length === 0) continue;
    const guestId = (b.guest_id as string | null) ?? null;
    const records = guestId ? recordsByGuest.get(guestId) ?? [] : [];
    const resolved = resolveRequirements(
      reqs,
      records,
      bookingDatetime(b.booking_date as string, (b.booking_time as string | null) ?? null),
      now,
    );
    for (const r of resolved) {
      if (r.state === 'missing' || r.state === 'expired') {
        out.push({
          booking_id: b.id as string,
          guest_id: guestId,
          guest_name: guestName(b.guests as GuestJoin),
          booking_date: b.booking_date as string,
          booking_time: (b.booking_time as string | null) ?? null,
          compliance_type_id: r.requirement.compliance_type_id,
          compliance_type_name: r.requirement.compliance_type_name,
          enforcement: r.requirement.enforcement,
          state: r.state,
        });
      }
    }
  }

  // Soonest bookings first.
  out.sort((a, b) => `${a.booking_date}${a.booking_time ?? ''}`.localeCompare(`${b.booking_date}${b.booking_time ?? ''}`));
  return out;
}
