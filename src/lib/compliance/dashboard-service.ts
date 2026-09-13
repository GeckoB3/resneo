import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bookingDatetime,
  resolveRequirements,
  type ResolverRecord,
  type ResolverRequirement,
  mergeRequirementsServiceWins,
} from '@/lib/compliance/resolve-requirements';
import { COMPLIANCE_EXPIRING_SOON_DAYS } from '@/lib/compliance/constants';
import { formatYmdInTimezone, addDaysToYmd } from '@/lib/venue/venue-local-clock';

/** Read a `name` from a Supabase to-one join (object or single-element array). */
function joinName(join: { name?: string } | { name?: string }[] | null | undefined): string {
  const t = Array.isArray(join) ? join[0] : join;
  return t?.name ?? 'Compliance record';
}

/** The joined type's validity period: null = lifetime, 0 = per visit, >0 = days. */
function joinValidity(join: unknown): number | null {
  const t = (Array.isArray(join) ? join[0] : join) as { validity_period_days?: number | null } | null | undefined;
  return t?.validity_period_days ?? null;
}

/**
 * Aggregated data for the venue compliance dashboard (spec §3.5): records expiring
 * soon, upcoming bookings missing a required record, and pending form links.
 * Batch-loads requirements, bookings and records, and resolves in-memory via the
 * pure resolver, which avoids per-booking round-trips.
 *
 * Every read throws when it fails. The dashboard used to ignore its query errors, so a
 * broken read rendered "You're all caught up": all three panels asked `guests` for a
 * `name` column that no longer exists, and the page showed an all-clear from the day it
 * shipped. An error page is recoverable; a false all-clear on a compliance sweep is not.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UPCOMING_BOOKING_WINDOW_DAYS = 14;
const ACTIVE_BOOKING_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];
/** Bookings read for the window. Read soonest first, so a venue over the cap loses its furthest days. */
const BOOKINGS_READ_LIMIT = 1000;
/** Guest ids per records read, which keeps the request URL well inside the API gateway's limit. */
const GUEST_IDS_PER_RECORDS_READ = 50;
/** Records read per guest batch. Newest first, so a cap drops old history rather than a current record. */
const RECORDS_READ_LIMIT = 1000;

/**
 * The `guests` columns the dashboard embeds. The table has no `name` column: the
 * first/last name migration (20260810120000) replaced it, and asking for it fails the
 * whole read with 42703.
 */
const GUEST_EMBED_COLUMNS = 'first_name, last_name';

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
  /** Venue-local "today" (YYYY-MM-DD) the data was built for. The client uses this to
   *  split today's check-ins from upcoming bookings, so both agree on the day boundary. */
  today: string;
  expiring_soon: ExpiringRecordRow[];
  missing_for_bookings: MissingBookingRow[];
  awaiting_submission: AwaitingLinkRow[];
}

type GuestJoin = { first_name?: string | null; last_name?: string | null } | null;

function guestName(g: GuestJoin | GuestJoin[]): string {
  const j = Array.isArray(g) ? g[0] : g;
  const full = [j?.first_name?.trim(), j?.last_name?.trim()].filter(Boolean).join(' ');
  return full || 'Guest';
}

function readFailed(what: string, error: { message?: string }): Error {
  return new Error(`[compliance-dashboard] could not read ${what}: ${error.message ?? 'unknown error'}`);
}

export async function loadComplianceDashboard(
  admin: SupabaseClient,
  venueId: string,
  now: Date = new Date(),
): Promise<ComplianceDashboardData> {
  const nowIso = now.toISOString();
  const expiringHorizonIso = new Date(now.getTime() + COMPLIANCE_EXPIRING_SOON_DAYS * MS_PER_DAY).toISOString();

  // "Today" and the upcoming-booking horizon are calendar dates compared against each
  // booking's local `booking_date`, so they must be resolved in the venue's own timezone.
  // Using server UTC here mis-buckets bookings by a day around midnight (and throughout
  // BST for UK venues), e.g. showing tomorrow's booking under "Today's check-ins".
  const { data: venueRow } = await admin
    .from('venues')
    .select('timezone')
    .eq('id', venueId)
    .maybeSingle();
  const timezone = ((venueRow?.timezone as string | null) ?? '').trim() || 'Europe/London';
  const todayDate = formatYmdInTimezone(now.getTime(), timezone);
  const bookingHorizonDate = addDaysToYmd(todayDate, UPCOMING_BOOKING_WINDOW_DAYS);

  const [expiringRes, awaitingRes, missing_for_bookings] = await Promise.all([
    admin
      .from('compliance_records')
      .select(
        `id, guest_id, compliance_type_id, expires_at, result, compliance_types!inner(name, validity_period_days), guests!inner(${GUEST_EMBED_COLUMNS})`,
      )
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
      .select(
        `id, guest_id, compliance_type_id, sent_via, sent_at, expires_at, compliance_types!inner(name), guests!inner(${GUEST_EMBED_COLUMNS})`,
      )
      .eq('venue_id', venueId)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(200),
    loadMissingForBookings(admin, venueId, { fromDate: todayDate, toDate: bookingHorizonDate, now }),
  ]);
  if (expiringRes.error) throw readFailed('expiring records', expiringRes.error);
  if (awaitingRes.error) throw readFailed('pending form links', awaitingRes.error);

  const expiring_soon: ExpiringRecordRow[] = (expiringRes.data ?? [])
    // Per-visit records (validity 0) are excluded: they expire the night of the visit by
    // design, so every one of them falls inside the 30-day window. Listing them here would
    // bury the records that genuinely need chasing under paperwork nobody has to renew.
    .filter((r) => joinValidity((r as Record<string, unknown>).compliance_types) !== 0)
    .map((r) => {
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

  return { today: todayDate, expiring_soon, missing_for_bookings, awaiting_submission };
}

/** Stricter enforcement wins when one client's form is required twice on the same day. */
const ENFORCEMENT_RANK: Record<string, number> = { warn_staff: 0, warn_client: 1, block_online: 2, block_all: 3 };

async function loadMissingForBookings(
  admin: SupabaseClient,
  venueId: string,
  range: { fromDate: string; toDate: string; now: Date },
): Promise<MissingBookingRow[]> {
  // Requirements first: a venue has a handful, and they decide which bookings are worth reading.
  const { data: reqData, error: reqErr } = await admin
    .from('service_compliance_requirements')
    .select(
      'id, compliance_type_id, enforcement, lock_period_hours, scope, appointment_service_id, service_item_id, compliance_types!inner(name, is_active, validity_period_days)',
    )
    .eq('venue_id', venueId);
  if (reqErr) throw readFailed('requirements', reqErr);
  const reqRows = (reqData ?? []) as Record<string, unknown>[];
  if (reqRows.length === 0) return [];

  // Index requirements by service id (whichever column is set); venue-wide rows aside.
  const reqsByService = new Map<string, ResolverRequirement[]>();
  const venueReqs: ResolverRequirement[] = [];
  const typeIds = new Set<string>();
  const serviceItemIds = new Set<string>();
  const apptServiceIds = new Set<string>();
  for (const row of reqRows) {
    type TypeJoin = { name?: string; is_active?: boolean; validity_period_days?: number | null };
    const typeJoin = row.compliance_types as TypeJoin | TypeJoin[] | null;
    const t = Array.isArray(typeJoin) ? typeJoin[0] : typeJoin;
    const req: ResolverRequirement = {
      id: row.id as string,
      compliance_type_id: row.compliance_type_id as string,
      compliance_type_name: t?.name ?? 'Compliance record',
      enforcement: row.enforcement as ResolverRequirement['enforcement'],
      lock_period_hours: (row.lock_period_hours as number | null) ?? null,
      type_is_active: t?.is_active ?? true,
      validity_period_days: t?.validity_period_days ?? null,
      scope: row.scope === 'venue' ? 'venue' : 'service',
    };
    typeIds.add(req.compliance_type_id);
    const svcId = (row.appointment_service_id ?? row.service_item_id) as string | null;
    // Venue-wide rows (plan §4) apply to every booking; a service row for the same type wins.
    if (req.scope === 'venue' || !svcId) {
      venueReqs.push(req);
      continue;
    }
    if (row.appointment_service_id) apptServiceIds.add(svcId);
    else serviceItemIds.add(svcId);
    const list = reqsByService.get(svcId) ?? [];
    list.push(req);
    reqsByService.set(svcId, list);
  }

  // A venue-wide requirement can be missing on any booking. Otherwise only bookings for a
  // service that carries one can, so read just those (both polymorphic columns).
  const readBookings = (narrow?: { column: 'appointment_service_id' | 'service_item_id'; ids: Set<string> }) => {
    let query = admin
      .from('bookings')
      .select(
        `id, guest_id, booking_date, booking_time, appointment_service_id, service_item_id, guests(${GUEST_EMBED_COLUMNS})`,
      )
      .eq('venue_id', venueId)
      .gte('booking_date', range.fromDate)
      .lte('booking_date', range.toDate)
      .in('status', ACTIVE_BOOKING_STATUSES);
    if (narrow) query = query.in(narrow.column, [...narrow.ids]);
    return query
      .order('booking_date', { ascending: true })
      .order('booking_time', { ascending: true })
      .limit(BOOKINGS_READ_LIMIT);
  };
  const bookingReads =
    venueReqs.length > 0
      ? [readBookings()]
      : [
          ...(serviceItemIds.size > 0 ? [readBookings({ column: 'service_item_id', ids: serviceItemIds })] : []),
          ...(apptServiceIds.size > 0 ? [readBookings({ column: 'appointment_service_id', ids: apptServiceIds })] : []),
        ];

  const bookingsById = new Map<string, Record<string, unknown>>();
  for (const res of await Promise.all(bookingReads)) {
    if (res.error) throw readFailed('upcoming bookings', res.error);
    const rows = (res.data ?? []) as Record<string, unknown>[];
    if (rows.length >= BOOKINGS_READ_LIMIT) {
      console.warn('[compliance-dashboard] upcoming bookings reached the read limit; the furthest days are incomplete', {
        venueId,
        limit: BOOKINGS_READ_LIMIT,
      });
    }
    // Bookings without a service are not appointment bookings, so no requirement applies (§5.0).
    for (const b of rows) {
      if (b.appointment_service_id || b.service_item_id) bookingsById.set(b.id as string, b);
    }
  }
  const bookings = [...bookingsById.values()];
  if (bookings.length === 0) return [];

  // Batch-load the guests' records for the involved types.
  const guestIds = [...new Set(bookings.map((b) => b.guest_id).filter(Boolean))] as string[];
  const recordReads: Array<PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>> = [];
  for (let i = 0; i < guestIds.length; i += GUEST_IDS_PER_RECORDS_READ) {
    recordReads.push(
      admin
        .from('compliance_records')
        .select(
          'id, guest_id, compliance_type_id, status, expires_at, voided_at, captured_at, result, captured_by_staff_id, compliance_types!inner(result_type)',
        )
        .eq('venue_id', venueId)
        .in('guest_id', guestIds.slice(i, i + GUEST_IDS_PER_RECORDS_READ))
        .in('compliance_type_id', [...typeIds])
        .order('captured_at', { ascending: false })
        .limit(RECORDS_READ_LIMIT),
    );
  }
  const recordsByGuest = new Map<string, ResolverRecord[]>();
  for (const res of await Promise.all(recordReads)) {
    if (res.error) throw readFailed('client records', res.error);
    for (const r of (res.data ?? []) as Record<string, unknown>[]) {
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

  // One line per client, day and form. A multi-service visit whose services share a
  // requirement, or a client booked twice that day, needs the form once, and one record
  // covers every booking. The earliest booking is kept: it is when the form is due.
  const byClientDayForm = new Map<string, MissingBookingRow>();
  for (const b of bookings) {
    const svcId = (b.appointment_service_id ?? b.service_item_id) as string;
    const reqs = mergeRequirementsServiceWins(reqsByService.get(svcId) ?? [], venueReqs);
    if (reqs.length === 0) continue;
    const guestId = (b.guest_id as string | null) ?? null;
    const records = guestId ? recordsByGuest.get(guestId) ?? [] : [];
    const resolved = resolveRequirements(
      reqs,
      records,
      bookingDatetime(b.booking_date as string, (b.booking_time as string | null) ?? null),
      range.now,
    );
    for (const r of resolved) {
      if (r.state !== 'missing' && r.state !== 'expired') continue;
      const row: MissingBookingRow = {
        booking_id: b.id as string,
        guest_id: guestId,
        guest_name: guestName(b.guests as GuestJoin),
        booking_date: b.booking_date as string,
        booking_time: (b.booking_time as string | null) ?? null,
        compliance_type_id: r.requirement.compliance_type_id,
        compliance_type_name: r.requirement.compliance_type_name,
        enforcement: r.requirement.enforcement,
        state: r.state,
      };
      const key = `${guestId ?? `booking:${row.booking_id}`}|${row.booking_date}|${row.compliance_type_id}`;
      const kept = byClientDayForm.get(key);
      if (!kept) {
        byClientDayForm.set(key, row);
        continue;
      }
      const stricter =
        (ENFORCEMENT_RANK[row.enforcement] ?? 0) > (ENFORCEMENT_RANK[kept.enforcement] ?? 0)
          ? row.enforcement
          : kept.enforcement;
      const earlier = (row.booking_time ?? '24:00') < (kept.booking_time ?? '24:00') ? row : kept;
      byClientDayForm.set(key, { ...earlier, enforcement: stricter });
    }
  }

  // Soonest bookings first.
  return [...byClientDayForm.values()].sort((a, b) =>
    `${a.booking_date}${a.booking_time ?? ''}`.localeCompare(`${b.booking_date}${b.booking_time ?? ''}`),
  );
}
