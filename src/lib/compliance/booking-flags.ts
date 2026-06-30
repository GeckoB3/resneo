import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bookingDatetime,
  resolveRequirements,
  type ResolverRecord,
  type ResolverRequirement,
} from '@/lib/compliance/resolve-requirements';

/**
 * Per-booking compliance status for at-a-glance indicators on the calendar bars
 * and the bookings list (so staff can see "this appointment needs a PPD patch
 * test" without opening anything). Batch-resolves requirements + records for a
 * set of bookings in a few queries via the pure resolver — no per-booking trips.
 *
 * Only bookings whose service actually carries a requirement appear in the result;
 * everything else is omitted so the client shows no indicator.
 */

/** Active statuses worth flagging — a cancelled/no-show booking needs no nudge. */
const FLAGGABLE_STATUSES = new Set(['Pending', 'Booked', 'Confirmed', 'Seated', 'Completed']);

export interface BookingComplianceFlag {
  /** `unmet` = at least one required record is missing/expired; `satisfied` = all on file. */
  state: 'satisfied' | 'unmet';
  /** True when an unmet requirement blocks booking (block_online / block_all). */
  blocking: boolean;
  /** Type names — the unmet ones when `unmet`, otherwise all required types (for the tooltip). */
  labels: string[];
}

function readName(join: { name?: string } | { name?: string }[] | null | undefined): string {
  const t = Array.isArray(join) ? join[0] : join;
  return t?.name ?? 'Compliance record';
}

function readActive(join: { is_active?: boolean } | { is_active?: boolean }[] | null | undefined): boolean {
  const t = Array.isArray(join) ? join[0] : join;
  return t?.is_active ?? true;
}

/**
 * Resolve compliance flags for the given booking ids (venue-scoped). Returns a
 * map keyed by booking id; bookings without requirements are absent.
 */
export async function loadBookingComplianceFlags(
  admin: SupabaseClient,
  venueId: string,
  bookingIds: string[],
  now: Date = new Date(),
): Promise<Record<string, BookingComplianceFlag>> {
  const ids = [...new Set(bookingIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const { data: bookingRows } = await admin
    .from('bookings')
    .select('id, guest_id, booking_date, booking_time, status, appointment_service_id, service_item_id')
    .eq('venue_id', venueId)
    .in('id', ids);

  const bookings = ((bookingRows ?? []) as Array<Record<string, unknown>>).filter(
    (b) =>
      FLAGGABLE_STATUSES.has((b.status as string) ?? '') &&
      (b.appointment_service_id || b.service_item_id) &&
      b.guest_id,
  );
  if (bookings.length === 0) return {};

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
  const reqRows = reqResults.flatMap((r) => r.data ?? []) as Array<Record<string, unknown>>;
  if (reqRows.length === 0) return {};

  const reqsByService = new Map<string, ResolverRequirement[]>();
  const typeIds = new Set<string>();
  for (const row of reqRows) {
    const svcId = (row.appointment_service_id ?? row.service_item_id) as string;
    const req: ResolverRequirement = {
      id: row.id as string,
      compliance_type_id: row.compliance_type_id as string,
      compliance_type_name: readName(row.compliance_types as Parameters<typeof readName>[0]),
      enforcement: row.enforcement as ResolverRequirement['enforcement'],
      lock_period_hours: (row.lock_period_hours as number | null) ?? null,
      type_is_active: readActive(row.compliance_types as Parameters<typeof readActive>[0]),
    };
    const list = reqsByService.get(svcId) ?? [];
    list.push(req);
    reqsByService.set(svcId, list);
    typeIds.add(req.compliance_type_id);
  }

  // Batch-load the guests' records for the involved types.
  const recordsByGuest = new Map<string, ResolverRecord[]>();
  if (typeIds.size > 0) {
    const { data: recRows } = await admin
      .from('compliance_records')
      .select(
        'id, guest_id, compliance_type_id, status, expires_at, voided_at, captured_at, result, captured_by_staff_id, compliance_types!inner(result_type)',
      )
      .eq('venue_id', venueId)
      .in('guest_id', guestIds)
      .in('compliance_type_id', [...typeIds]);
    for (const r of (recRows ?? []) as Array<Record<string, unknown>>) {
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

  const flags: Record<string, BookingComplianceFlag> = {};
  for (const b of bookings) {
    const svcId = (b.appointment_service_id ?? b.service_item_id) as string;
    const reqs = reqsByService.get(svcId);
    if (!reqs || reqs.length === 0) continue;
    const records = recordsByGuest.get(b.guest_id as string) ?? [];
    const resolved = resolveRequirements(
      reqs,
      records,
      bookingDatetime(b.booking_date as string, (b.booking_time as string | null) ?? null),
      now,
    );
    if (resolved.length === 0) continue;

    const unmet = resolved.filter((r) => r.state === 'missing' || r.state === 'expired');
    if (unmet.length > 0) {
      flags[b.id as string] = {
        state: 'unmet',
        blocking: unmet.some(
          (r) => r.requirement.enforcement === 'block_online' || r.requirement.enforcement === 'block_all',
        ),
        labels: [...new Set(unmet.map((r) => r.requirement.compliance_type_name))],
      };
    } else {
      flags[b.id as string] = {
        state: 'satisfied',
        blocking: false,
        labels: [...new Set(resolved.map((r) => r.requirement.compliance_type_name))],
      };
    }
  }

  return flags;
}
