import type { SupabaseClient } from '@supabase/supabase-js';
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';
import { formatGuestDisplayName } from '@/lib/guests/name';
import type { ServiceRemovalAffectedBooking } from '@/lib/venue/service-removal-bookings';

/**
 * Taking a service off a calendar is allowed even when that calendar already has
 * upcoming bookings for it: the calendar simply stops offering the service to new
 * guests. The bookings already taken are never touched. This module gathers the
 * ones affected so the dashboard can list them and let the operator either move
 * them to another calendar or leave them where they are.
 */

/** Most affected bookings returned to the dashboard; `total` stays exact beyond it. */
export const SERVICE_REMOVAL_BOOKING_SAMPLE_LIMIT = 200;

export interface ServiceRemovalImpact {
  bookings: ServiceRemovalAffectedBooking[];
  /** Exact number of affected bookings, even when `bookings` is capped. */
  total: number;
  truncated: boolean;
  /** Set when the lookup failed, so callers can fail closed. */
  error?: string;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** HH:mm from a Postgres `time`, an ISO local stamp, or an ISO stamp with a zone. */
function toHhmm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.includes('T')) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(11, 16);
  }
  return /^\d{2}:\d{2}/.test(trimmed) ? trimmed.slice(0, 5) : null;
}

interface RawBookingRow {
  id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
  status?: string | null;
  party_size?: number | null;
  calendar_id?: string | null;
  practitioner_id?: string | null;
  service_item_id?: string | null;
  appointment_service_id?: string | null;
  guest?:
    | { first_name?: string | null; last_name?: string | null }
    | Array<{ first_name?: string | null; last_name?: string | null }>
    | null;
}

/**
 * The column a booking actually belongs to. Exactly one of the two ids is
 * authoritative: `/api/venue/bookings/[id]` writes `calendar_id` when the row has
 * one and `practitioner_id` otherwise, so reads must resolve it the same way.
 */
function owningColumnId(row: RawBookingRow): string | null {
  return row.calendar_id ?? row.practitioner_id ?? null;
}

function guestNameFrom(row: RawBookingRow): string {
  const guest = Array.isArray(row.guest) ? row.guest[0] : row.guest;
  return formatGuestDisplayName(guest?.first_name, guest?.last_name);
}

async function loadNames(
  admin: SupabaseClient,
  table: string,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await admin.from(table).select('id, name').in('id', ids);
  for (const row of data ?? []) {
    const id = (row as { id: string }).id;
    const name = (row as { name?: string | null }).name?.trim();
    if (name) map.set(id, name);
  }
  return map;
}

async function findAffectedBookings(
  admin: SupabaseClient,
  params: {
    venueId: string;
    calendarIds: string[];
    serviceIds: string[];
    serviceColumn: 'service_item_id' | 'appointment_service_id';
    serviceTable: 'service_items' | 'appointment_services';
    calendarTable: 'unified_calendars' | 'practitioners';
    logLabel: string;
  },
): Promise<ServiceRemovalImpact> {
  const columnIds = [...new Set(params.calendarIds.filter(Boolean))];
  const serviceIds = [...new Set(params.serviceIds.filter(Boolean))];
  const empty: ServiceRemovalImpact = { bookings: [], total: 0, truncated: false };
  if (columnIds.length === 0 || serviceIds.length === 0) return empty;

  const idList = columnIds.join(',');
  const { data, error, count } = await admin
    .from('bookings')
    .select(
      `id, booking_date, booking_time, booking_end_time, estimated_end_time, status, party_size, calendar_id, practitioner_id, ${params.serviceColumn}, guest:guests(first_name, last_name)`,
      { count: 'exact' },
    )
    .eq('venue_id', params.venueId)
    .gte('booking_date', todayIsoDate())
    .in('status', [...BOOKING_ACTIVE_STATUSES])
    .in(params.serviceColumn, serviceIds)
    .or(`calendar_id.in.(${idList}),practitioner_id.in.(${idList})`)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(SERVICE_REMOVAL_BOOKING_SAMPLE_LIMIT);

  if (error) {
    console.error(`${params.logLabel}:`, error.message);
    return { bookings: [], total: 0, truncated: false, error: 'Could not check existing bookings.' };
  }

  const columnSet = new Set(columnIds);
  const raw = (data ?? []) as unknown as RawBookingRow[];
  // The `.or()` above matches either id column; keep only rows whose OWNING
  // column is one we are removing the service from.
  const rows = raw.filter((r) => {
    const owner = owningColumnId(r);
    return owner !== null && columnSet.has(owner);
  });
  const truncated = raw.length >= SERVICE_REMOVAL_BOOKING_SAMPLE_LIMIT;

  const [serviceNames, calendarNames] = await Promise.all([
    loadNames(admin, params.serviceTable, serviceIds),
    loadNames(admin, params.calendarTable, columnIds),
  ]);

  const bookings: ServiceRemovalAffectedBooking[] = rows.map((r) => {
    const serviceId = (r[params.serviceColumn] as string | null) ?? '';
    const calendarId = owningColumnId(r) ?? '';
    return {
      id: r.id,
      service_id: serviceId,
      service_name: serviceNames.get(serviceId) ?? 'This service',
      calendar_id: calendarId,
      calendar_name: calendarNames.get(calendarId) ?? 'This calendar',
      booking_date: r.booking_date,
      booking_time: toHhmm(r.booking_time) ?? String(r.booking_time).slice(0, 5),
      end_time: toHhmm(r.booking_end_time) ?? toHhmm(r.estimated_end_time),
      guest_name: guestNameFrom(r),
      party_size: r.party_size ?? 1,
      status: r.status ?? 'Booked',
    };
  });

  return {
    bookings,
    // `count` is the pre-limit total; it can only exceed the filtered rows in the
    // rare case above, and only matters once the sample itself is capped.
    total: truncated ? count ?? bookings.length : bookings.length,
    truncated,
  };
}

/**
 * Unified scheduling: upcoming active bookings for these `service_items` sitting on
 * any of these calendar columns.
 */
export async function findBookingsAffectedByRemovingServicesUnified(
  admin: SupabaseClient,
  params: { venueId: string; calendarIds: string[]; serviceItemIds: string[] },
): Promise<ServiceRemovalImpact> {
  return findAffectedBookings(admin, {
    venueId: params.venueId,
    calendarIds: params.calendarIds,
    serviceIds: params.serviceItemIds,
    serviceColumn: 'service_item_id',
    serviceTable: 'service_items',
    calendarTable: 'unified_calendars',
    logLabel: 'findBookingsAffectedByRemovingServicesUnified',
  });
}

/** Legacy practitioner appointments: the same lookup over `appointment_services`. */
export async function findBookingsAffectedByRemovingServicesLegacy(
  admin: SupabaseClient,
  params: { venueId: string; practitionerIds: string[]; appointmentServiceIds: string[] },
): Promise<ServiceRemovalImpact> {
  return findAffectedBookings(admin, {
    venueId: params.venueId,
    calendarIds: params.practitionerIds,
    serviceIds: params.appointmentServiceIds,
    serviceColumn: 'appointment_service_id',
    serviceTable: 'appointment_services',
    calendarTable: 'practitioners',
    logLabel: 'findBookingsAffectedByRemovingServicesLegacy',
  });
}

function formatNameList(names: string[]): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ''))];
  if (unique.length === 0) return 'these services';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, 2).join(', ')} and ${unique.length - 2} more`;
}

/**
 * One-line summary of what stays behind. Used as the dialog's opening line and as the
 * plain `error` string for any caller that has not been taught the richer payload.
 */
export function buildServiceRemovalWarning(impact: ServiceRemovalImpact): string {
  const count = impact.total;
  const services = formatNameList(impact.bookings.map((b) => b.service_name));
  const calendars = [...new Set(impact.bookings.map((b) => b.calendar_name))];
  const where = calendars.length === 1 ? `on ${calendars[0]}` : 'on these calendars';
  const subject = count === 1 ? '1 upcoming booking is' : `${count} upcoming bookings are`;
  const kept = count === 1 ? 'that booking exactly as it is' : 'those bookings exactly as they are';
  return `${subject} already booked for ${services} ${where}. Removing the service keeps ${kept} and only stops new bookings.`;
}

export interface ServiceRemovalConfirmationPayload {
  requires_confirmation: true;
  message: string;
  /** Same text under `error`, so a caller that only reads `error` still says something useful. */
  error: string;
  affected_bookings: ServiceRemovalAffectedBooking[];
  affected_total: number;
  affected_truncated: boolean;
}

/**
 * Body of the 409 that asks the operator to confirm. Retried with
 * `?acknowledge_affected_bookings=true`, the removal goes through and the bookings stay put.
 */
export function serviceRemovalConfirmationPayload(
  impact: ServiceRemovalImpact,
): ServiceRemovalConfirmationPayload {
  const message = buildServiceRemovalWarning(impact);
  return {
    requires_confirmation: true,
    message,
    error: message,
    affected_bookings: impact.bookings,
    affected_total: impact.total,
    affected_truncated: impact.truncated,
  };
}
