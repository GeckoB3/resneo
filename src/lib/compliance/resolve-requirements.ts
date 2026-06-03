import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COMPLIANCE_EXPIRING_SOON_DAYS,
  type ComplianceEnforcement,
  type ComplianceRequirementState,
} from '@/lib/compliance/constants';

/**
 * Requirements Resolution Algorithm (spec §5.0–§5.4).
 *
 * The pure functions here take already-loaded data so they are deterministic and
 * fully unit-testable. `loadAndResolveServiceRequirements` is the thin DB wrapper
 * used by the booking-detail endpoint and the booking-creation hook.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/** A guest's compliance record, reduced to what resolution needs. */
export interface ResolverRecord {
  id: string;
  compliance_type_id: string;
  status: 'completed' | 'expired' | 'voided';
  /** null = lifetime (never expires). */
  expires_at: Date | null;
  voided_at: Date | null;
  captured_at: Date;
  result: string | null;
  captured_by_staff_id: string | null;
}

/** A service compliance requirement, reduced to what resolution needs. */
export interface ResolverRequirement {
  id: string;
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: ComplianceEnforcement;
  lock_period_hours: number | null;
  /** Whether the underlying type is archived (surfaced as a read-only warning). */
  type_is_active: boolean;
}

export interface ResolvedRequirement {
  requirement: ResolverRequirement;
  state: ComplianceRequirementState;
  /** The valid record satisfying the requirement (when satisfied/expiring_soon). */
  matchingRecord: ResolverRecord | null;
  /** Most recent record of this type regardless of validity, for display. */
  latestRecord: ResolverRecord | null;
  /**
   * True when a record would satisfy the requirement except it was captured
   * inside the lock-period window (spec §4.5.1). Drives the public pre-check
   * `LOCK_PASSED` state and the "deadline passed" messaging.
   */
  lockBlocked: boolean;
}

/** Is a record valid for a booking at `bookingDatetime` under an optional lock window? */
export function isRecordValidForBooking(
  record: ResolverRecord,
  bookingDatetime: Date,
  lockPeriodHours: number | null,
): boolean {
  if (record.status !== 'completed') return false;
  if (record.voided_at !== null) return false;
  if (record.expires_at !== null && record.expires_at.getTime() <= bookingDatetime.getTime()) {
    return false;
  }
  if (lockPeriodHours !== null) {
    const deadline = bookingDatetime.getTime() - lockPeriodHours * MS_PER_HOUR;
    if (record.captured_at.getTime() > deadline) return false;
  }
  return true;
}

/** Most-recent-first comparison by captured_at. */
function byCapturedAtDesc(a: ResolverRecord, b: ResolverRecord): number {
  return b.captured_at.getTime() - a.captured_at.getTime();
}

/**
 * Resolve one requirement against the guest's records of that type.
 * `now` defaults to the current time and only affects the EXPIRING_SOON window.
 */
export function resolveRequirement(
  requirement: ResolverRequirement,
  recordsOfType: ResolverRecord[],
  bookingDatetime: Date,
  now: Date = new Date(),
): ResolvedRequirement {
  const sorted = [...recordsOfType].sort(byCapturedAtDesc);
  const latestRecord = sorted[0] ?? null;

  const validRecord =
    sorted.find((r) => isRecordValidForBooking(r, bookingDatetime, requirement.lock_period_hours)) ?? null;

  if (validRecord) {
    const expiringSoon =
      validRecord.expires_at !== null &&
      validRecord.expires_at.getTime() - now.getTime() <= COMPLIANCE_EXPIRING_SOON_DAYS * MS_PER_DAY;
    return {
      requirement,
      state: expiringSoon ? 'expiring_soon' : 'satisfied',
      matchingRecord: validRecord,
      latestRecord,
      lockBlocked: false,
    };
  }

  // No valid record. Distinguish a pure lock-window failure (otherwise-valid record
  // captured too close to the booking) from genuine expiry/missing.
  const lockBlocked =
    requirement.lock_period_hours !== null &&
    sorted.some(
      (r) =>
        isRecordValidForBooking(r, bookingDatetime, null) &&
        !isRecordValidForBooking(r, bookingDatetime, requirement.lock_period_hours),
    );

  return {
    requirement,
    state: latestRecord ? 'expired' : 'missing',
    matchingRecord: null,
    latestRecord,
    lockBlocked,
  };
}

/** Resolve all requirements against the guest's full record set (grouped internally by type). */
export function resolveRequirements(
  requirements: ResolverRequirement[],
  records: ResolverRecord[],
  bookingDatetime: Date,
  now: Date = new Date(),
): ResolvedRequirement[] {
  const byType = new Map<string, ResolverRecord[]>();
  for (const r of records) {
    const list = byType.get(r.compliance_type_id) ?? [];
    list.push(r);
    byType.set(r.compliance_type_id, list);
  }
  return requirements.map((req) =>
    resolveRequirement(req, byType.get(req.compliance_type_id) ?? [], bookingDatetime, now),
  );
}

export type EnforcementContext = 'online' | 'staff';

/** Whether an unmet requirement blocks creation in the given context (spec §5.1 step 4). */
export function isBlocking(
  state: ComplianceRequirementState,
  enforcement: ComplianceEnforcement,
  context: EnforcementContext,
): boolean {
  // Only EXPIRED / MISSING can block. satisfied / expiring_soon / not_applicable never block.
  if (state !== 'expired' && state !== 'missing') return false;
  switch (enforcement) {
    case 'block_all':
      return true;
    case 'block_online':
      return context === 'online';
    case 'warn_staff':
    case 'warn_client':
      return false;
    default:
      return false;
  }
}

export interface BlockingSummary {
  blocked: boolean;
  unmet: Array<{
    compliance_type_id: string;
    compliance_type_name: string;
    enforcement: ComplianceEnforcement;
    state: ComplianceRequirementState;
  }>;
}

/** Summarise which resolved requirements block creation in the given context. */
export function summariseBlocking(
  resolved: ResolvedRequirement[],
  context: EnforcementContext,
): BlockingSummary {
  const unmet = resolved
    .filter((r) => isBlocking(r.state, r.requirement.enforcement, context))
    .map((r) => ({
      compliance_type_id: r.requirement.compliance_type_id,
      compliance_type_name: r.requirement.compliance_type_name,
      enforcement: r.requirement.enforcement,
      state: r.state,
    }));
  return { blocked: unmet.length > 0, unmet };
}

// ─── DB loader ──────────────────────────────────────────────────────────────

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface LoadResolveParams {
  venueId: string;
  guestId: string | null;
  appointmentServiceId: string | null;
  serviceItemId: string | null;
  bookingDatetime: Date;
  now?: Date;
}

export interface LoadResolveResult {
  /** False when the booking is not Model B (no service FK) — requirements engine skipped (§5.0). */
  applicable: boolean;
  resolved: ResolvedRequirement[];
}

/**
 * Load a service's requirements and the guest's records, then resolve them.
 * Uses the admin (service-role) client; callers must have authorised the venue.
 */
export async function loadAndResolveServiceRequirements(
  admin: SupabaseClient,
  params: LoadResolveParams,
): Promise<LoadResolveResult> {
  const { venueId, guestId, appointmentServiceId, serviceItemId, bookingDatetime } = params;
  const now = params.now ?? new Date();

  // §5.0/§5.1 step 0: non-Model-B bookings are skipped.
  if (!appointmentServiceId && !serviceItemId) {
    return { applicable: false, resolved: [] };
  }

  let query = admin
    .from('service_compliance_requirements')
    .select(
      'id, compliance_type_id, enforcement, lock_period_hours, compliance_types!inner(id, name, is_active)',
    )
    .eq('venue_id', venueId);
  query = appointmentServiceId
    ? query.eq('appointment_service_id', appointmentServiceId)
    : query.eq('service_item_id', serviceItemId as string);

  const { data: reqRows, error: reqErr } = await query;
  if (reqErr) {
    console.error('[resolve-requirements] requirement load failed:', reqErr.message, { venueId });
    return { applicable: true, resolved: [] };
  }

  const requirements: ResolverRequirement[] = (reqRows ?? []).map((row) => {
    const r = row as {
      id: string;
      compliance_type_id: string;
      enforcement: ComplianceEnforcement;
      lock_period_hours: number | null;
      compliance_types: { name?: string; is_active?: boolean } | { name?: string; is_active?: boolean }[] | null;
    };
    const typeJoin = Array.isArray(r.compliance_types) ? r.compliance_types[0] : r.compliance_types;
    return {
      id: r.id,
      compliance_type_id: r.compliance_type_id,
      compliance_type_name: typeJoin?.name ?? 'Compliance record',
      enforcement: r.enforcement,
      lock_period_hours: r.lock_period_hours,
      type_is_active: typeJoin?.is_active ?? true,
    };
  });

  if (requirements.length === 0 || !guestId) {
    // No requirements → nothing to resolve. No guest yet → everything MISSING.
    return {
      applicable: true,
      resolved: guestId
        ? []
        : resolveRequirements(requirements, [], bookingDatetime, now),
    };
  }

  const typeIds = [...new Set(requirements.map((r) => r.compliance_type_id))];
  const { data: recordRows, error: recErr } = await admin
    .from('compliance_records')
    .select('id, compliance_type_id, status, expires_at, voided_at, captured_at, result, captured_by_staff_id')
    .eq('venue_id', venueId)
    .eq('guest_id', guestId)
    .in('compliance_type_id', typeIds);

  if (recErr) {
    console.error('[resolve-requirements] record load failed:', recErr.message, { venueId, guestId });
    return { applicable: true, resolved: resolveRequirements(requirements, [], bookingDatetime, now) };
  }

  const records: ResolverRecord[] = (recordRows ?? []).map((row) => {
    const r = row as {
      id: string;
      compliance_type_id: string;
      status: 'completed' | 'expired' | 'voided';
      expires_at: string | null;
      voided_at: string | null;
      captured_at: string;
      result: string | null;
      captured_by_staff_id: string | null;
    };
    return {
      id: r.id,
      compliance_type_id: r.compliance_type_id,
      status: r.status,
      expires_at: toDate(r.expires_at),
      voided_at: toDate(r.voided_at),
      captured_at: toDate(r.captured_at) ?? new Date(0),
      result: r.result,
      captured_by_staff_id: r.captured_by_staff_id,
    };
  });

  return { applicable: true, resolved: resolveRequirements(requirements, records, bookingDatetime, now) };
}

/** Build a `(booking_date, booking_time)` pair into a Date (spec §5.1 step 2). */
export function bookingDatetime(bookingDate: string, bookingTime: string | null | undefined): Date {
  const time = (bookingTime ?? '00:00:00').slice(0, 8);
  const normalisedTime = time.length === 5 ? `${time}:00` : time;
  // Interpret as the venue's local wall-clock; stored separately so we build a plain ISO.
  const d = new Date(`${bookingDate}T${normalisedTime}`);
  return Number.isNaN(d.getTime()) ? new Date(`${bookingDate}T00:00:00`) : d;
}
