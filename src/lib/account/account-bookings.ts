import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDaysToYmd,
  toIsoWithOffset,
  venueLocalWallTimeToUtcMs,
} from '@/lib/venue/venue-local-clock';
import { resolveDisplayTimeZone } from '@/lib/time/iana-time-zone';
import {
  accountBookingEndMs,
  accountBookingStartMs,
  isCancelledAccountStatus,
  isUpcomingBooking,
} from '@/lib/account/account-booking-filters';
import { CAPACITY_CONSUMING_STATUSES } from '@/lib/availability/capacity-status';
import type { BookingModel } from '@/types/booking-models';
import { getSupabaseAdminClient } from '@/lib/supabase';

export interface AccountGuestSafeRow {
  id: string;
  venue_id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  marketing_opt_out: boolean;
  first_booked_at: string | null;
  last_booked_at: string | null;
  total_bookings_count: number;
  total_spent_minor: number;
}

export interface AccountVenueRow {
  id: string;
  name: string;
  slug: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  /** IANA timezone for the venue; defaults to Europe/London for display when missing. */
  timezone?: string | null;
}

/** One ticket tier on an event booking ("2 × Adult", etc.). */
export interface AccountTicketLine {
  label: string;
  quantity: number;
  unit_price_pence: number;
}

/**
 * Friendly, model-agnostic label for the booking's class/event/resource context plus
 * any extra detail we can show a guest (ticket tiers, session start, resource duration).
 * Assembled from the same FKs the staff detail + confirmation email use.
 */
export interface AccountCdeContext {
  inferred_model: BookingModel;
  /** Event / class / resource name. */
  title: string;
  /** e.g. "Ends 21:00", "Starts 18:30", host calendar name. */
  subtitle?: string | null;
  /** Event ticket tiers, when present. */
  ticket_lines?: AccountTicketLine[];
  /** Resource booking duration in minutes (from start/end), when derivable. */
  duration_minutes?: number | null;
  /** Class session capacity / how full it is (no attendee PII — guest-safe). */
  class_spots?: { capacity: number; booked: number; remaining: number } | null;
}

export interface AccountBookingRow {
  id: string;
  venue_id: string;
  guest_id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time?: string | null;
  party_size: number;
  status: string;
  booking_model: BookingModel;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  /**
   * What the booking's money looks like, from the ledger cache (P1-2).
   *
   * `payment_state` is the enum `unpaid | deposit_paid | partially_paid | paid
   * | refunded`; the balance is `booking_total_price_pence` less
   * `amount_paid_pence`. Both halves are needed: a free booking is `unpaid`
   * with nothing owed, and the state alone would put it on an outstanding list.
   */
  payment_state?: string | null;
  booking_total_price_pence?: number | null;
  amount_paid_pence?: number | null;
  /** Last instant the guest can cancel free of charge (deposit refund / card-hold release). */
  cancellation_deadline?: string | null;
  special_requests?: string | null;
  dietary_notes?: string | null;
  occasion?: string | null;
  /** Present when this row was part of a class multi-session / course cart checkout. */
  group_booking_id?: string | null;
  class_instance_id?: string | null;
  experience_event_id?: string | null;
  resource_id?: string | null;
  /**
   * The unified-scheduling pair, carried through since P0-6 widened the view's
   * column allowlist (G8b). Without these the portal could not say what an
   * appointment was or who it was with: `calendar_id` names the practitioner
   * and `service_item_id` the service.
   */
  calendar_id?: string | null;
  service_item_id?: string | null;
  /**
   * The practitioner's public booking slug, when the appointment has one.
   *
   * Carried so the portal can offer "Book again" without a second round trip:
   * the public booking page names a practitioner by path segment, not by id
   * (P3-1). Null for non-appointment rows and for calendars with no slug.
   */
  practitioner_slug?: string | null;
  venue: AccountVenueRow | null;
  /** CDE name + extras (event/class/resource). Null for table/appointment rows. */
  cde_context?: AccountCdeContext | null;
  /**
   * The booking's start as an unambiguous instant, e.g.
   * `2026-09-01T18:00:00+01:00` (P0-2, C10).
   *
   * `booking_date` and `booking_time` are venue wall-clock strings and carry no
   * zone, so every client that has them has to know the venue's timezone and
   * apply the DST rule itself to work out when the booking actually is. That is
   * how the web surface got it wrong for two years, and shipping the same two
   * strings to the mobile app invites the same bug a second time. These three
   * fields are the answer, and the wall-clock pair stays for compatibility.
   */
  starts_at: string;
  /** End instant, or null when the booking has no end time. */
  ends_at: string | null;
  /** The IANA zone `starts_at` and `ends_at` are expressed in. */
  time_zone: string;
}

export type AccountBookingDisplayItem =
  | { kind: 'group'; group_booking_id: string; venue: AccountVenueRow | null; rows: AccountBookingRow[] }
  | { kind: 'single'; row: AccountBookingRow };

/** Columns selected from `bookings` for every account loader (kept in one place). */
/**
 * The customer-safe projection (AD8 / P0-6). Ownership is established by
 * reading this view on the SESSION client: its own WHERE clause is
 * `guest_id IN (SELECT id FROM guests WHERE user_id = auth.uid())`, so a
 * customer cannot see another's booking even if an application filter were
 * dropped. The `.in('guest_id', ...)` filters below are kept as the second
 * layer: the pair is not two independent controls (both reduce to the same
 * predicate) but it does defend against a coding mistake in either.
 *
 * Derived context still reads as admin AFTER ownership is established. The
 * rule, recorded in Docs/Multi_model_RLS_and_API_audit.md: the row that
 * establishes ownership comes from the account-safe view; derived context and
 * action payloads may be read as admin.
 */
const ACCOUNT_BOOKINGS_VIEW = 'bookings_account_safe';

/**
 * The cancelled statuses as a PostgREST `in` list. Quoted because three of the
 * five contain a hyphen or a space, which PostgREST would otherwise split.
 */
const CANCELLED_STATUS_SQL_LIST = ['Cancelled', 'Canceled', 'No-Show', 'NoShow', 'No Show']
  .map((s) => `"${s}"`)
  .join(',');

/**
 * What is read from the view.
 *
 * **Every column the row builder reads must be listed here**, and that is not
 * automatic in either direction: PostgREST returns exactly what is asked for,
 * and a field the builder maps but this string omits is silently `undefined`,
 * which `?? null` then turns into a plausible-looking null.
 *
 * That is not hypothetical. `calendar_id` and `service_item_id` were added to
 * the view by P0-6, declared on the DTO, and mapped by the builder, but never
 * added HERE, so every appointment in the portal reported no service and no
 * practitioner for months. Nothing failed: the unit tests stub the database
 * and return whatever they are told, so they were green throughout.
 * `account-bookings-columns.test.ts` is the guard.
 */
const ACCOUNT_BOOKING_COLUMNS =
  'id, venue_id, guest_id, booking_date, booking_time, booking_end_time, party_size, status, booking_model, deposit_status, deposit_amount_pence, cancellation_deadline, special_requests, dietary_notes, occasion, group_booking_id, class_instance_id, experience_event_id, resource_id, calendar_id, service_item_id, payment_state, booking_total_price_pence, amount_paid_pence';

export const ACCOUNT_BOOKING_COLUMNS_FOR_TEST = ACCOUNT_BOOKING_COLUMNS;

type RawBookingRow = {
  id: string;
  venue_id: string;
  guest_id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time?: string | null;
  party_size: number;
  status: string;
  booking_model?: BookingModel | null;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  payment_state?: string | null;
  booking_total_price_pence?: number | null;
  amount_paid_pence?: number | null;
  cancellation_deadline?: string | null;
  special_requests?: string | null;
  dietary_notes?: string | null;
  occasion?: string | null;
  group_booking_id?: string | null;
  class_instance_id?: string | null;
  experience_event_id?: string | null;
  resource_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
};

const FRIENDLY_STATUS_LABELS: Record<string, string> = {
  'No-Show': 'Missed',
  NoShow: 'Missed',
  'No Show': 'Missed',
  Seated: 'Checked in',
  Booked: 'Confirmed',
  Pending: 'Awaiting payment',
};

/**
 * Guest-facing status wording. Raw lifecycle enums ("No-Show", "Seated") read as internal
 * jargon to a customer, so map them to friendlier copy. Unknown values pass through unchanged.
 */
export function friendlyAccountBookingStatus(status: string | null | undefined): string {
  if (!status) return 'Booked';
  return FRIENDLY_STATUS_LABELS[status] ?? status;
}

/** Resolve the display timezone for a booking (venue TZ, then caller fallback, then London). */
export function accountBookingTimeZone(
  row: Pick<AccountBookingRow, 'venue'> & { time_zone?: string | null },
  fallbackTz?: string | null,
): string {
  // Degrades rather than throwing: a stored value that Intl will not accept
  // must cost a customer the right zone, not the whole page (G23).
  return resolveDisplayTimeZone(row.time_zone ?? row.venue?.timezone ?? null, fallbackTz);
}

/**
 * Format a booking's start for display in `timeZone` (P0-2, part of G5).
 *
 * The old version took the stored wall-clock strings and did two different
 * things with them. The date was anchored to NOON UTC and formatted in
 * `timeZone`, so for any zone more than twelve hours from UTC the label landed
 * on the wrong calendar day, and the weekday with it. The time was returned as
 * a raw `slice(0, 5)` of the stored string, which meant the `timeZone` argument
 * did not affect it at all: asking for a booking in `America/Los_Angeles` gave
 * you the London time with a Los Angeles date.
 *
 * Now both halves come from one instant, so they cannot disagree, and asking
 * for a different zone actually shifts the time.
 *
 * `sourceTimeZone` is the venue zone the stored wall-clock values are expressed
 * in. It defaults to `timeZone`, which is what the callers pass today (the
 * display zone IS the venue zone unless a customer has overridden it), so the
 * common case needs no extra argument.
 */
export function formatAccountBookingDateTime(
  dateStr: string,
  timeStr: string | null | undefined,
  timeZone: string,
  opts?: { withWeekday?: boolean; sourceTimeZone?: string | null },
): { date: string; time: string | null } {
  const raw = timeStr ? String(timeStr).slice(0, 5) : null;
  const dParts = dateStr.split('-').map(Number);
  if (dParts.length !== 3 || dParts.some((n) => Number.isNaN(n))) {
    return { date: dateStr, time: raw };
  }

  const tz = resolveDisplayTimeZone(timeZone);
  const sourceTz = resolveDisplayTimeZone(opts?.sourceTimeZone ?? null, tz);
  const instant = venueLocalWallTimeToUtcMs(dateStr, raw ?? '12:00', sourceTz);

  const date = new Date(instant).toLocaleDateString('en-GB', {
    ...(opts?.withWeekday ? { weekday: 'long' as const } : {}),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: tz,
  });

  // No stored time means no time to show. Midday was only ever an anchor for
  // the date label and must not surface as "12:00".
  if (!raw) return { date, time: null };

  const time = new Date(instant).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  });
  return { date, time };
}

function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const s = (start ?? '').slice(0, 5);
  const e = (end ?? '').slice(0, 5);
  if (!s || !e) return null;
  const sm = parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10);
  const em = parseInt(e.slice(0, 2), 10) * 60 + parseInt(e.slice(3, 5), 10);
  if (!Number.isFinite(sm) || !Number.isFinite(em)) return null;
  const diff = em - sm;
  return diff > 0 ? diff : null;
}

/** Shapes of the batched lookup rows, kept local to the account loaders. */
type ClassInstanceRow = {
  start_time?: string | null;
  class_type_id?: string | null;
  capacity_override?: number | null;
};
type ClassTypeRow = { name?: string | null; capacity?: number | null };
type ResourceLabels = { resourceName: string | null; hostCalendarName: string | null };
type ClassSpots = { capacity: number; booked: number; remaining: number };

/**
 * Everything the CDE context needs for a whole page of bookings, fetched with
 * set-based reads instead of per-row ones (P0-3, closes G4).
 *
 * Before this, rendering the list called `resolveCdeBookingContext` once per
 * row, which issued between one and three reads each, and then minted a
 * short-link row per booking, so a GET wrote to the database. A hundred
 * bookings meant hundreds of queries and a hundred writes on a read. The whole
 * page now costs nine reads at worst, whatever the row count.
 */
interface AccountCdeMaps {
  events: Map<string, { name: string | null; end_time: string | null }>;
  /** Keyed by BOOKING id, not event id: ticket lines belong to the booking. */
  ticketLines: Map<string, AccountTicketLine[]>;
  instances: Map<string, ClassInstanceRow>;
  classTypes: Map<string, ClassTypeRow>;
  resources: Map<string, ResourceLabels>;
  classSpots: Map<string, ClassSpots>;
  /**
   * `unified_calendars.id` to its public booking slug, for appointment rows.
   *
   * The portal already knows WHICH practitioner an appointment was with
   * (`calendar_id`), but a "Book again" link needs the slug, because the
   * public booking page names a practitioner by path segment
   * (`/book/<venue>/<practitioner>`) and not by id (P3-1).
   */
  practitionerSlugs: Map<string, string>;
}

function emptyCdeMaps(): AccountCdeMaps {
  return {
    events: new Map(),
    ticketLines: new Map(),
    instances: new Map(),
    classTypes: new Map(),
    resources: new Map(),
    classSpots: new Map(),
    practitionerSlugs: new Map(),
  };
}

type LookupRow = Record<string, unknown>;

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

const NO_ROWS = (): Promise<LookupRow[]> => Promise.resolve([]);

/**
 * Run one batched lookup, degrading to an empty result rather than throwing (G4a).
 *
 * A booking list must not disappear because a class type could not be read. The
 * affected rows lose a title or a subtitle; every other row, and the customer's
 * ability to see and cancel their bookings, is unaffected.
 */
async function batchRead(
  label: string,
  run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<LookupRow[]> {
  try {
    const { data, error } = await run();
    if (error) {
      console.error(`[account-bookings] ${label}:`, error.message);
      return [];
    }
    return (data ?? []) as LookupRow[];
  } catch (e) {
    console.error(`[account-bookings] ${label}:`, e);
    return [];
  }
}

const asText = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const asNumber = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/**
 * Capacity and how-full for a set of class instances, with no attendee PII
 * (guest-safe). capacity = instance override ?? class type capacity;
 * booked = sum of party_size over capacity-consuming bookings on the instance.
 *
 * Capacity comes from the instance and class-type maps the caller already
 * holds, so this costs exactly one query however many instances are asked for.
 */
async function loadClassInstanceSpots(
  admin: Pick<SupabaseClient, 'from'>,
  classInstanceIds: string[],
  instances: Map<string, ClassInstanceRow>,
  classTypes: Map<string, ClassTypeRow>,
): Promise<Map<string, ClassSpots>> {
  const out = new Map<string, ClassSpots>();
  if (classInstanceIds.length === 0) return out;

  const rows = await batchRead('class spots', () =>
    admin
      .from('bookings')
      .select('class_instance_id, party_size, status')
      .in('class_instance_id', classInstanceIds)
      .in('status', [...CAPACITY_CONSUMING_STATUSES]),
  );

  const bookedById = new Map<string, number>();
  for (const r of rows) {
    const id = asText(r.class_instance_id);
    if (!id) continue;
    bookedById.set(id, (bookedById.get(id) ?? 0) + (asNumber(r.party_size) ?? 1));
  }

  for (const id of classInstanceIds) {
    // No instance row means no capacity to report, matching the previous
    // per-row loader, which returned null when the instance was missing.
    const inst = instances.get(id);
    if (!inst) continue;
    const override = inst.capacity_override ?? null;
    let capacity = override != null && override > 0 ? override : 0;
    if (capacity <= 0) {
      capacity = (inst.class_type_id ? classTypes.get(inst.class_type_id)?.capacity : null) ?? 0;
    }
    const booked = bookedById.get(id) ?? 0;
    out.set(id, { capacity, booked, remaining: Math.max(0, capacity - booked) });
  }
  return out;
}

/**
 * Load the CDE context lookups for a page of bookings.
 *
 * Ids are gathered in the same precedence order the per-row builder resolves in
 * (event, then class, then resource), so a row carrying more than one FK only
 * pulls the lookup it will actually use.
 *
 * Three waves, because two lookups are named by the first: class types by the
 * instances, and a resource's host calendar by the resource. Class spots ride
 * the third wave and are only asked for by the single-booking detail page.
 */
async function loadAccountCdeMaps(
  admin: Pick<SupabaseClient, 'from'>,
  rows: RawBookingRow[],
  opts?: { includeClassSpots?: boolean },
): Promise<AccountCdeMaps> {
  const maps = emptyCdeMaps();
  if (rows.length === 0) return maps;

  const eventRows = rows.filter((r) => r.experience_event_id);
  const classRows = rows.filter((r) => !r.experience_event_id && r.class_instance_id);
  const resourceRows = rows.filter(
    (r) => !r.experience_event_id && !r.class_instance_id && r.resource_id,
  );

  const eventIds = uniqueIds(eventRows.map((r) => r.experience_event_id));
  const eventBookingIds = uniqueIds(eventRows.map((r) => r.id));
  const instanceIds = uniqueIds(classRows.map((r) => r.class_instance_id));
  const resourceIds = uniqueIds(resourceRows.map((r) => r.resource_id));
  /*
    Appointment practitioners, for rebook links. A separate list from
    `resourceIds` on purpose: both are `unified_calendars` rows, but a resource
    is read for its NAME on a resource booking, and this is read for the SLUG
    on an appointment. Rows with neither are not fetched at all.
  */
  const practitionerIds = uniqueIds(
    rows
      .filter((r) => !r.experience_event_id && !r.class_instance_id && !r.resource_id)
      .map((r) => r.calendar_id),
  );

  const [events, lines, instances, resources, practitioners] = await Promise.all([
    eventIds.length
      ? batchRead('experience_events', () =>
          admin.from('experience_events').select('id, name, end_time').in('id', eventIds),
        )
      : NO_ROWS(),
    eventBookingIds.length
      ? batchRead('booking_ticket_lines', () =>
          admin
            .from('booking_ticket_lines')
            .select('booking_id, label, quantity, unit_price_pence')
            .in('booking_id', eventBookingIds),
        )
      : NO_ROWS(),
    instanceIds.length
      ? batchRead('class_instances', () =>
          admin
            .from('class_instances')
            .select('id, start_time, class_type_id, capacity_override')
            .in('id', instanceIds),
        )
      : NO_ROWS(),
    resourceIds.length
      ? batchRead('unified_calendars', () =>
          admin
            .from('unified_calendars')
            .select('id, name, display_on_calendar_id')
            .in('id', resourceIds),
        )
      : NO_ROWS(),
    practitionerIds.length
      ? batchRead('unified_calendars', () =>
          admin.from('unified_calendars').select('id, slug').in('id', practitionerIds),
        )
      : NO_ROWS(),
  ]);

  for (const r of practitioners) {
    const id = asText(r.id);
    const slug = asText(r.slug);
    // No slug means no path segment to point at, so the rebook link falls back
    // to the venue rather than guessing one from the name.
    if (id && slug) maps.practitionerSlugs.set(id, slug);
  }

  for (const r of events) {
    const id = asText(r.id);
    if (id) maps.events.set(id, { name: asText(r.name), end_time: asText(r.end_time) });
  }

  for (const r of lines) {
    const bookingId = asText(r.booking_id);
    const quantity = asNumber(r.quantity) ?? 0;
    // Zero-quantity tiers were filtered out per row before; keep that.
    if (!bookingId || quantity <= 0) continue;
    const list = maps.ticketLines.get(bookingId) ?? [];
    list.push({
      label: asText(r.label) ?? 'Ticket',
      quantity,
      unit_price_pence: asNumber(r.unit_price_pence) ?? 0,
    });
    maps.ticketLines.set(bookingId, list);
  }

  for (const r of instances) {
    const id = asText(r.id);
    if (!id) continue;
    maps.instances.set(id, {
      start_time: asText(r.start_time),
      class_type_id: asText(r.class_type_id),
      capacity_override: asNumber(r.capacity_override),
    });
  }

  // A resource and its host calendar are both `unified_calendars` rows. Names
  // already in hand are reused, so the second read only asks for hosts that
  // are not themselves one of the resources on this page.
  const nameById = new Map<string, string | null>();
  const hostIdByResource = new Map<string, string>();
  for (const r of resources) {
    const id = asText(r.id);
    if (!id) continue;
    nameById.set(id, asText(r.name));
    maps.resources.set(id, { resourceName: asText(r.name), hostCalendarName: null });
    const host = asText(r.display_on_calendar_id);
    if (host) hostIdByResource.set(id, host);
  }

  const classTypeIds = uniqueIds(instances.map((r) => asText(r.class_type_id)));
  const hostIdsToFetch = uniqueIds([...hostIdByResource.values()]).filter(
    (id) => !nameById.has(id),
  );

  const [types, hosts] = await Promise.all([
    classTypeIds.length
      ? batchRead('class_types', () =>
          admin.from('class_types').select('id, name, capacity').in('id', classTypeIds),
        )
      : NO_ROWS(),
    hostIdsToFetch.length
      ? batchRead('unified_calendars (hosts)', () =>
          admin.from('unified_calendars').select('id, name').in('id', hostIdsToFetch),
        )
      : NO_ROWS(),
  ]);

  for (const r of types) {
    const id = asText(r.id);
    if (id) maps.classTypes.set(id, { name: asText(r.name), capacity: asNumber(r.capacity) });
  }
  for (const r of hosts) {
    const id = asText(r.id);
    if (id) nameById.set(id, asText(r.name));
  }
  for (const [resourceId, hostId] of hostIdByResource) {
    const entry = maps.resources.get(resourceId);
    if (entry) entry.hostCalendarName = nameById.get(hostId) ?? null;
  }

  if (opts?.includeClassSpots && instanceIds.length > 0) {
    maps.classSpots = await loadClassInstanceSpots(
      admin,
      instanceIds,
      maps.instances,
      maps.classTypes,
    );
  }

  return maps;
}

/**
 * Build the guest-facing CDE context for one booking from the batched maps.
 * Pure and synchronous: every read it needs has already happened.
 *
 * Returns null for table/appointment rows (no CDE FK). Precedence is event,
 * then class, then resource, matching `resolveCdeBookingContext`, which the
 * staff surfaces still use per row.
 *
 * `includeClassSpots` adds the class capacity summary, so the single-booking
 * detail page can show it without the list paying for the extra read.
 */
function buildAccountCdeContext(
  row: RawBookingRow,
  maps: AccountCdeMaps,
  opts?: { includeClassSpots?: boolean },
): AccountCdeContext | null {
  if (row.experience_event_id) {
    const ev = maps.events.get(row.experience_event_id);
    const end = ev?.end_time ? ev.end_time.slice(0, 5) : null;
    const ctx: AccountCdeContext = {
      inferred_model: 'event_ticket',
      title: ev?.name ?? 'Event',
      subtitle: end ? `Ends ${end}` : null,
    };
    const ticketLines = maps.ticketLines.get(row.id) ?? [];
    if (ticketLines.length > 0) ctx.ticket_lines = ticketLines;
    return ctx;
  }

  if (row.class_instance_id) {
    const inst = maps.instances.get(row.class_instance_id);
    const classType = inst?.class_type_id ? maps.classTypes.get(inst.class_type_id) : undefined;
    const start = inst?.start_time ? inst.start_time.slice(0, 5) : null;
    const ctx: AccountCdeContext = {
      inferred_model: 'class_session',
      title: classType?.name ?? 'Class',
      subtitle: start ? `Starts ${start}` : null,
    };
    if (opts?.includeClassSpots) {
      ctx.class_spots = maps.classSpots.get(row.class_instance_id) ?? null;
    }
    return ctx;
  }

  if (row.resource_id) {
    const resource = maps.resources.get(row.resource_id);
    return {
      inferred_model: 'resource_booking',
      title: resource?.resourceName ?? 'Resource',
      subtitle: resource?.hostCalendarName ?? null,
      duration_minutes: minutesBetween(row.booking_time, row.booking_end_time),
    };
  }

  return null;
}

/**
 * Collapses multi-session class rows that share `group_booking_id` into one list entry for the account UI.
 */
export function buildAccountBookingDisplayList(rows: AccountBookingRow[]): AccountBookingDisplayItem[] {
  const groupMap = new Map<string, AccountBookingRow[]>();
  for (const r of rows) {
    if (r.booking_model === 'class_session' && r.group_booking_id) {
      const g = r.group_booking_id;
      const arr = groupMap.get(g) ?? [];
      arr.push(r);
      groupMap.set(g, arr);
    }
  }

  const usedGroups = new Set<string>();
  const out: AccountBookingDisplayItem[] = [];

  for (const r of rows) {
    if (r.booking_model === 'class_session' && r.group_booking_id) {
      const g = r.group_booking_id;
      if (usedGroups.has(g)) continue;
      usedGroups.add(g);
      const members = groupMap.get(g) ?? [r];
      if (members.length > 1) {
        const sorted = [...members].sort(
          (a, b) =>
            a.booking_date.localeCompare(b.booking_date) ||
            String(a.booking_time).localeCompare(String(b.booking_time)),
        );
        out.push({ kind: 'group', group_booking_id: g, venue: r.venue, rows: sorted });
      } else {
        out.push({ kind: 'single', row: r });
      }
      continue;
    }
    out.push({ kind: 'single', row: r });
  }

  return out;
}

export async function loadAccountSafeGuests(
  supabase: SupabaseClient,
): Promise<AccountGuestSafeRow[]> {
  const { data, error } = await supabase
    .from('guests_account_safe')
    .select(
      'id, venue_id, email, phone, first_name, last_name, marketing_consent, marketing_consent_at, marketing_opt_out, first_booked_at, last_booked_at, total_bookings_count, total_spent_minor',
    )
    .order('last_booked_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[loadAccountSafeGuests]', error.message);
    throw new Error('Failed to load account guest relationships');
  }

  return (data ?? []) as AccountGuestSafeRow[];
}

async function loadVenueMap(
  admin: SupabaseClient,
  venueIds: string[],
): Promise<Map<string, AccountVenueRow>> {
  if (venueIds.length === 0) return new Map();
  const { data: venues, error } = await admin
    .from('venues')
    .select('id, name, slug, address, phone, email, timezone')
    .in('id', venueIds);
  if (error) {
    console.error('[loadAccountBookings] venues:', error.message);
  }
  return new Map((venues ?? []).map((v) => [v.id, v as AccountVenueRow]));
}

/**
 * Hydrate a raw bookings row into an AccountBookingRow (venue + CDE context).
 *
 * Synchronous since P0-3: every lookup it needs was batched by the caller, and
 * the manage link it used to mint on render now comes from
 * `POST /api/account/bookings/[id]/manage-link` when a customer asks for it.
 */
function hydrateAccountBookingRow(
  b: RawBookingRow,
  venueMap: Map<string, AccountVenueRow>,
  maps: AccountCdeMaps,
  opts?: { includeClassSpots?: boolean },
): AccountBookingRow {
  const venue = venueMap.get(b.venue_id) ?? null;
  // The instant is built in the VENUE's zone, because that is the zone the
  // stored wall-clock strings are in. A customer's own timezone preference is a
  // DISPLAY choice and is applied when rendering, never when resolving.
  const time_zone = resolveDisplayTimeZone(venue?.timezone ?? null);
  const instantRow = { ...b, status: b.status, time_zone };

  return {
    id: b.id,
    venue_id: b.venue_id,
    guest_id: b.guest_id,
    booking_date: b.booking_date,
    booking_time: b.booking_time,
    booking_end_time: b.booking_end_time ?? null,
    party_size: b.party_size,
    status: b.status,
    booking_model: (b.booking_model as BookingModel | null) ?? 'table_reservation',
    deposit_status: b.deposit_status ?? null,
    deposit_amount_pence: b.deposit_amount_pence ?? null,
    payment_state: b.payment_state ?? null,
    booking_total_price_pence: b.booking_total_price_pence ?? null,
    amount_paid_pence: b.amount_paid_pence ?? null,
    cancellation_deadline: b.cancellation_deadline ?? null,
    special_requests: b.special_requests ?? null,
    dietary_notes: b.dietary_notes ?? null,
    occasion: b.occasion ?? null,
    group_booking_id: b.group_booking_id ?? null,
    class_instance_id: b.class_instance_id ?? null,
    experience_event_id: b.experience_event_id ?? null,
    resource_id: b.resource_id ?? null,
    calendar_id: b.calendar_id ?? null,
    service_item_id: b.service_item_id ?? null,
    practitioner_slug: b.calendar_id ? (maps.practitionerSlugs.get(b.calendar_id) ?? null) : null,
    venue,
    cde_context: buildAccountCdeContext(b, maps, opts),
    starts_at: toIsoWithOffset(accountBookingStartMs(instantRow), time_zone),
    ends_at: b.booking_end_time
      ? toIsoWithOffset(accountBookingEndMs(instantRow), time_zone)
      : null,
    time_zone,
  };
}

/**
 * Venue map and CDE lookups for a page of rows, fetched together.
 *
 * Both are admin reads, which is allowed because ownership was already
 * established by reading `bookings_account_safe` as the caller (AD8).
 */
async function hydrateAccountBookingRows(
  admin: SupabaseClient,
  rows: RawBookingRow[],
  opts?: { includeClassSpots?: boolean },
): Promise<AccountBookingRow[]> {
  const venueIds = [...new Set(rows.map((b) => b.venue_id))];
  const [venueMap, maps] = await Promise.all([
    loadVenueMap(admin, venueIds),
    loadAccountCdeMaps(admin, rows, opts),
  ]);
  return rows.map((b) => hydrateAccountBookingRow(b, venueMap, maps, opts));
}

export async function loadAccountBookings(
  supabase: SupabaseClient,
  /*
    Defaulted so a PAGE never has to construct one (C1). Pages have no
    legitimate need for admin privileges of their own: their job is to call a
    loader a route also calls, and a page that reaches for the service role is
    a page doing something no route can reuse. Still injectable, so tests keep
    passing a fake.
  */
  admin: SupabaseClient = getSupabaseAdminClient(),
  limit = 100,
): Promise<AccountBookingRow[]> {
  const guests = await loadAccountSafeGuests(supabase);
  const guestIds = guests.map((g) => g.id);
  if (guestIds.length === 0) return [];

  const { data: bookings, error: bErr } = await supabase
    .from(ACCOUNT_BOOKINGS_VIEW)
    .select(ACCOUNT_BOOKING_COLUMNS)
    .in('guest_id', guestIds)
    .order('booking_date', { ascending: false })
    .order('booking_time', { ascending: false })
    .limit(limit);

  if (bErr) {
    console.error('[loadAccountBookings] bookings:', bErr.message);
    throw new Error('Failed to load account bookings');
  }

  return hydrateAccountBookingRows(admin, (bookings ?? []) as RawBookingRow[]);
}

/**
 * Load upcoming bookings of a single CDE model for the per-model hub pages
 * (/account/events, /account/resources). Ordered soonest-first.
 *
 * "Upcoming" is decided against instants, not against a UTC calendar day
 * (P0-2, G5). The SQL bound is deliberately one day WIDER than today's UTC
 * date, because a venue as far behind UTC as -12:00 can still be on yesterday's
 * local date while UTC has rolled over, and a bound of "today or later" drops
 * a booking that has not happened yet. The precise cut is then made per row in
 * the venue's own zone. The cost is at most one day of already-finished rows
 * counting against `limit`, which is the right trade against silently hiding a
 * booking a customer still has.
 */
export async function loadAccountUpcomingBookingsByModel(
  supabase: SupabaseClient,
  admin: SupabaseClient = getSupabaseAdminClient(),
  model: Extract<BookingModel, 'event_ticket' | 'resource_booking'>,
  nowMs: number = Date.now(),
  limit = 50,
): Promise<AccountBookingRow[]> {
  const guests = await loadAccountSafeGuests(supabase);
  const guestIds = guests.map((g) => g.id);
  if (guestIds.length === 0) return [];

  const fkColumn = model === 'event_ticket' ? 'experience_event_id' : 'resource_id';

  // Cancellations are excluded IN THE QUERY, not afterwards (G5a). Filtering
  // after `.limit()` meant a customer with fifty cancelled events saw an empty
  // page: the limit was spent on rows that were then thrown away. And the old
  // filter compared against the exact string 'Cancelled', so the four other
  // stored spellings ('Canceled', 'No-Show', 'NoShow', 'No Show') came through
  // as upcoming.
  const { data: bookings, error: bErr } = await supabase
    .from(ACCOUNT_BOOKINGS_VIEW)
    .select(ACCOUNT_BOOKING_COLUMNS)
    .in('guest_id', guestIds)
    .eq('booking_model', model)
    .gte('booking_date', addDaysToYmd(new Date(nowMs).toISOString().slice(0, 10), -1))
    .not(fkColumn, 'is', null)
    .not('status', 'in', `(${CANCELLED_STATUS_SQL_LIST})`)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(limit);

  if (bErr) {
    console.error(`[loadAccountUpcomingBookingsByModel:${model}]`, bErr.message);
    throw new Error('Failed to load account bookings');
  }

  // Belt and braces: the predicate above is the one that matters, but a status
  // spelling the database has and this list does not must not reach the page as
  // an upcoming booking.
  const rows = ((bookings ?? []) as RawBookingRow[]).filter(
    (b) => !isCancelledAccountStatus(b.status),
  );
  // Hydrate first: `time_zone` is resolved there, and it is what makes the
  // upcoming test correct for a venue in a zone other than the server's.
  const hydrated = await hydrateAccountBookingRows(admin, rows);
  return hydrated.filter((b) => isUpcomingBooking(b, nowMs));
}

/**
 * Not exported: nothing outside this module calls it, and C1 asks that every
 * exported loader be reachable through a route. An internal helper that looks
 * like a surface is worse than one that does not.
 */
async function loadAccountBookingById(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  bookingId: string,
): Promise<AccountBookingRow | null> {
  // Only the caller's own bookings are visible: scope to guest ids derived from the
  // authenticated session's account-safe guest view, then load the single row directly.
  const guests = await loadAccountSafeGuests(supabase);
  const guestIds = guests.map((g) => g.id);
  if (guestIds.length === 0) return null;

  const { data: booking, error } = await supabase
    .from(ACCOUNT_BOOKINGS_VIEW)
    .select(ACCOUNT_BOOKING_COLUMNS)
    .eq('id', bookingId)
    .in('guest_id', guestIds)
    .maybeSingle();

  if (error) {
    console.error('[loadAccountBookingById]', error.message);
    throw new Error('Failed to load booking');
  }
  if (!booking) return null;

  const [row] = await hydrateAccountBookingRows(admin, [booking as RawBookingRow], {
    includeClassSpots: true,
  });
  return row ?? null;
}
