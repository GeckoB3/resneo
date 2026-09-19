import type { SupabaseClient } from '@supabase/supabase-js';
import { bookingModelShortLabel, inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { loadRowTotalResolver, type VisitBookingRow } from '@/lib/booking/payment-summary';
import { normaliseGuestNamePart } from '@/lib/guests/name';
import { mergeVenueTerminology } from '@/lib/dashboard/merge-venue-terminology';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import type { BookingModel } from '@/types/booking-models';
import { selectAllPages } from '@/lib/reports/select-all-pages';

/**
 * Whole-venue data exports (Settings → Reports → Export your data).
 *
 * One table per kind of thing a venue holds, with every detail a business would need to move
 * to another system or keep a backup: its appointments, its clients and its services. The same
 * table feeds every file type (`export-writers.ts`), so a CSV, a spreadsheet and a PDF of the
 * same range always agree.
 *
 * A date range narrows each table on the date that means most for it: appointments by the
 * appointment date, clients and services by the day they were added. No range means everything.
 */

export type ExportKind = 'bookings' | 'contacts' | 'services';

/** A plain date range, both ends inclusive, in the venue's own calendar days. */
export interface ExportRange {
  from: string;
  to: string;
}

export type ExportCell = string | number | null;

export interface ExportTable {
  kind: ExportKind;
  /** What the rows are, in the venue's words: "Appointments", "Clients", "Services". */
  title: string;
  headers: string[];
  rows: ExportCell[][];
  /** Indexes of the columns that hold money, so a spreadsheet can format them as numbers. */
  moneyColumns: number[];
}

export interface ExportVenue {
  id: string;
  name: string;
  timeZone: string;
  currencySymbol: string;
  /** "Appointment" or "Booking", "Client" or "Guest": the venue's own words. */
  bookingWord: string;
  clientWord: string;
}

export interface ExportClients {
  /** The venue's own client: reads its own tables under its own rights. */
  db: SupabaseClient;
  /**
   * Service-role client for the one read that must cross venues: the name of a collective a
   * booking was made through, which a venue that has since left can no longer read (REP-06).
   */
  admin: SupabaseClient;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: string | null | undefined): value is string {
  return typeof value === 'string' && YMD.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function pounds(pence: number | null | undefined): number | null {
  return typeof pence === 'number' && Number.isFinite(pence) ? Math.round(pence) / 100 : null;
}

function yesNo(value: boolean | null | undefined): string {
  return value ? 'Yes' : 'No';
}

function hm(time: string | null | undefined): string {
  return typeof time === 'string' && time.length >= 5 ? time.slice(0, 5) : (time ?? '');
}

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [normaliseGuestNamePart(first), normaliseGuestNamePart(last)].filter(Boolean).join(' ');
}

function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean).join(', ');
}

/**
 * "2026-09-19 14:05" in the venue's own clock, or empty. Every timestamp a file carries reads in
 * the venue's time, since that is the clock the business runs on.
 */
export function formatInstant(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}`;
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * "2026-09-21 10:00" from a timestamp that already holds venue wall-clock time. The guest
 * aggregates trigger writes `first_booked_at` and `last_booked_at` as booking_date + booking_time
 * with no zone, which the column then labels UTC, so converting them would shift every one by
 * the venue's offset.
 */
export function formatWallClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/** The venue-local calendar day an instant falls on, for range checks on "added on" dates. */
function ymdOf(iso: string | null | undefined, timeZone: string): string {
  return formatInstant(iso, timeZone).slice(0, 10);
}

function inRange(ymd: string, range: ExportRange | null): boolean {
  if (!range) return true;
  return ymd !== '' && ymd >= range.from && ymd <= range.to;
}

const LOCATION_LABELS: Record<string, string> = {
  business_venue: 'At the business',
  client_address: "At the client's address",
  online: 'Online',
};

const PAYMENT_STATE_LABELS: Record<string, string> = {
  unpaid: 'Unpaid',
  deposit_paid: 'Deposit paid',
  partially_paid: 'Partly paid',
  paid: 'Paid',
  refunded: 'Refunded',
};

const PAYMENT_REQUIREMENT_LABELS: Record<string, string> = {
  none: 'No payment needed to book',
  deposit: 'Deposit to book',
  full: 'Full payment to book',
  full_payment: 'Full payment to book',
};

const PRICE_TYPE_LABELS: Record<string, string> = {
  fixed: 'Fixed',
  from: 'From',
  free: 'Free',
  variable: 'Varies',
  hidden: 'Not shown',
};

function labelled(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '';
  return map[value] ?? value;
}

function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Venue ────────────────────────────────────────────────────────────────────

export async function loadExportVenue(db: SupabaseClient, venueId: string): Promise<ExportVenue> {
  const { data, error } = await db
    .from('venues')
    .select('id, name, timezone, currency, booking_model, terminology')
    .eq('id', venueId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as {
    name?: string | null;
    timezone?: string | null;
    currency?: string | null;
    booking_model?: string | null;
    terminology?: unknown;
  };
  // The venue's own words, as the dashboard shows them (a venue may call appointments bookings).
  const model: BookingModel = (row.booking_model as BookingModel | null | undefined) ?? 'unified_scheduling';
  const words = mergeVenueTerminology(model, row.terminology);
  return {
    id: venueId,
    name: row.name?.trim() || 'Your venue',
    timeZone: row.timezone?.trim() || 'Europe/London',
    currencySymbol: currencySymbolFromCode(row.currency),
    bookingWord: words.booking,
    clientWord: words.client,
  };
}

// ─── Appointments ─────────────────────────────────────────────────────────────

const BOOKING_SELECT = `
  id, group_booking_id, booking_date, booking_time, booking_end_time, estimated_end_time, party_size, status,
  source, collective_id, created_at, created_by_staff_id, cancelled_by_staff_id, cancellation_actor_type,
  calendar_id, service_item_id, service_variant_id, appointment_service_id, practitioner_id,
  experience_event_id, class_instance_id, resource_id, event_session_id,
  service_name_snapshot, service_variant_name_snapshot, service_price_snapshot_pence,
  booking_total_price_pence, addons_total_price_pence, amount_paid_pence, tip_amount_pence, payment_state,
  deposit_status, deposit_amount_pence, stripe_payment_intent_id,
  location_type, client_address_line1, client_address_line2, client_address_city, client_address_postcode,
  special_requests, dietary_notes, occasion, internal_notes,
  client_arrived_at, checked_in_at, reminder_sent_at, post_visit_sent_at,
  guest_id, guest_first_name, guest_last_name, guest_email, guest_phone,
  guests ( id, first_name, last_name, email, phone )
`;

type BookingRow = VisitBookingRow & {
  group_booking_id?: string | null;
  booking_date: string;
  booking_time?: string | null;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
  party_size?: number | null;
  status?: string | null;
  source?: string | null;
  collective_id?: string | null;
  created_at?: string | null;
  created_by_staff_id?: string | null;
  cancelled_by_staff_id?: string | null;
  cancellation_actor_type?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  amount_paid_pence?: number | null;
  tip_amount_pence?: number | null;
  payment_state?: string | null;
  stripe_payment_intent_id?: string | null;
  location_type?: string | null;
  client_address_line1?: string | null;
  client_address_line2?: string | null;
  client_address_city?: string | null;
  client_address_postcode?: string | null;
  special_requests?: string | null;
  dietary_notes?: string | null;
  occasion?: string | null;
  internal_notes?: string | null;
  client_arrived_at?: string | null;
  checked_in_at?: string | null;
  reminder_sent_at?: string | null;
  post_visit_sent_at?: string | null;
  guest_id?: string | null;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  guests?:
    | { id?: string; first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null }
    | Array<{ id?: string; first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null }>
    | null;
};

/** How many appointments a range holds, for the "Download 142 appointments" button. */
export async function countBookings(db: SupabaseClient, venueId: string, range: ExportRange | null): Promise<number> {
  let query = db.from('bookings').select('id', { count: 'exact', head: true }).eq('venue_id', venueId);
  if (range) query = query.gte('booking_date', range.from).lte('booking_date', range.to);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function buildBookingsExport(
  clients: ExportClients,
  venue: ExportVenue,
  range: ExportRange | null,
): Promise<ExportTable> {
  const { db, admin } = clients;
  const rows = await selectAllPages<BookingRow>((from, to) => {
    let query = db
      .from('bookings')
      .select(BOOKING_SELECT)
      .eq('venue_id', venue.id)
      .order('booking_date', { ascending: true })
      .order('booking_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (range) query = query.gte('booking_date', range.from).lte('booking_date', range.to);
    return query as unknown as PromiseLike<{ data: BookingRow[] | null; error: { message: string } | null }>;
  });

  const [staffNames, calendars, serviceNames, classNames, eventNames, addonsByBooking, collectiveNames, rowTotal] =
    await Promise.all([
      loadStaffNames(db, venue.id),
      loadCalendars(db, venue.id),
      loadNames(db, 'service_items', venue.id),
      loadClassNames(db, rows.map((r) => r.class_instance_id)),
      loadIdNames(db, 'experience_events', rows.map((r) => r.experience_event_id)),
      loadBookingAddons(db, rows.map((r) => r.id)),
      loadCollectiveNames(admin, rows.map((r) => r.collective_id)),
      rows.length > 0
        ? loadRowTotalResolver(db, rows, { venueId: venue.id }).then((r) => r.rowTotal)
        : Promise.resolve(() => 0),
    ]);

  const sym = venue.currencySymbol;
  const headers = [
    `${venue.bookingWord} ID`,
    'Visit ID',
    'Date',
    'Start time',
    'End time',
    'Status',
    'Type',
    'Service',
    'Option',
    'Add-ons',
    'Calendar',
    'Staff',
    `${venue.clientWord} name`,
    `${venue.clientWord} email`,
    `${venue.clientWord} phone`,
    `${venue.clientWord} ID`,
    'Party size',
    `Price (${sym})`,
    `Add-ons total (${sym})`,
    'Payment state',
    `Amount paid (${sym})`,
    `Tip (${sym})`,
    'Deposit status',
    `Deposit (${sym})`,
    'Stripe payment',
    'Source',
    'Booked through collective',
    'Location',
    `${venue.clientWord} address`,
    'Special requests',
    'Dietary notes',
    'Occasion',
    'Internal notes',
    'Booked on',
    'Booked by',
    'Arrived at',
    'Checked in at',
    'Cancelled by',
    'Reminder sent',
    'Follow-up sent',
  ];

  const body = rows.map((b): ExportCell[] => {
    const guest = Array.isArray(b.guests) ? b.guests[0] : b.guests;
    const inferred = inferBookingRowModel({
      experience_event_id: b.experience_event_id,
      class_instance_id: b.class_instance_id,
      resource_id: b.resource_id,
      event_session_id: b.event_session_id,
      calendar_id: b.calendar_id,
      service_item_id: b.service_item_id,
      practitioner_id: b.practitioner_id,
      appointment_service_id: b.appointment_service_id,
    });
    const calendar = b.calendar_id ? calendars.get(b.calendar_id) : undefined;
    const serviceName =
      b.service_name_snapshot?.trim() ||
      (b.service_item_id ? serviceNames.get(b.service_item_id) : undefined) ||
      (b.class_instance_id ? classNames.get(b.class_instance_id) : undefined) ||
      (b.experience_event_id ? eventNames.get(b.experience_event_id) : undefined) ||
      '';
    const addons = addonsByBooking.get(b.id) ?? [];
    const clientName = fullName(guest?.first_name, guest?.last_name) || fullName(b.guest_first_name, b.guest_last_name);
    const cancelledBy = b.cancelled_by_staff_id
      ? (staffNames.get(b.cancelled_by_staff_id) ?? 'Staff')
      : b.status === 'Cancelled'
        ? labelledActor(b.cancellation_actor_type, venue.clientWord)
        : '';
    return [
      b.id,
      b.group_booking_id ?? '',
      b.booking_date,
      hm(b.booking_time),
      hm(b.booking_end_time ?? b.estimated_end_time),
      b.status ?? '',
      bookingModelShortLabel(inferred),
      serviceName,
      b.service_variant_name_snapshot ?? '',
      addons.map((a) => (a.price > 0 ? `${a.name} (${sym}${(a.price / 100).toFixed(2)})` : a.name)).join('; '),
      calendar?.name ?? '',
      calendar?.staff_id ? (staffNames.get(calendar.staff_id) ?? '') : '',
      clientName,
      guest?.email ?? b.guest_email ?? '',
      guest?.phone ?? b.guest_phone ?? '',
      guest?.id ?? b.guest_id ?? '',
      b.party_size ?? null,
      pounds(rowTotal(b)),
      pounds(b.addons_total_price_pence),
      labelled(PAYMENT_STATE_LABELS, b.payment_state),
      pounds(b.amount_paid_pence),
      pounds(b.tip_amount_pence),
      b.deposit_status ?? '',
      pounds(b.deposit_amount_pence),
      b.stripe_payment_intent_id ?? '',
      titleCase(b.source),
      b.collective_id ? (collectiveNames.get(b.collective_id) ?? 'Collective') : '',
      labelled(LOCATION_LABELS, b.location_type),
      joinAddress([b.client_address_line1, b.client_address_line2, b.client_address_city, b.client_address_postcode]),
      b.special_requests ?? '',
      b.dietary_notes ?? '',
      b.occasion ?? '',
      b.internal_notes ?? '',
      formatInstant(b.created_at, venue.timeZone),
      b.created_by_staff_id ? (staffNames.get(b.created_by_staff_id) ?? 'Staff') : '',
      formatInstant(b.client_arrived_at, venue.timeZone),
      formatInstant(b.checked_in_at, venue.timeZone),
      cancelledBy,
      formatInstant(b.reminder_sent_at, venue.timeZone),
      formatInstant(b.post_visit_sent_at, venue.timeZone),
    ];
  });

  return {
    kind: 'bookings',
    title: `${venue.bookingWord}s`,
    headers,
    rows: body,
    moneyColumns: [17, 18, 20, 21, 23],
  };
}

function labelledActor(actor: string | null | undefined, clientWord: string): string {
  switch (actor) {
    case 'guest':
    case 'client':
    case 'customer':
      return clientWord;
    case 'staff':
    case 'venue':
      return 'Staff';
    case 'system':
      return 'System';
    default:
      return actor ? titleCase(actor) : '';
  }
}

async function loadStaffNames(db: SupabaseClient, venueId: string): Promise<Map<string, string>> {
  const { data, error } = await db.from('staff').select('id, name, email').eq('venue_id', venueId);
  if (error) throw new Error(error.message);
  const out = new Map<string, string>();
  for (const s of (data ?? []) as Array<{ id: string; name?: string | null; email?: string | null }>) {
    out.set(s.id, s.name?.trim() || s.email?.trim() || 'Staff');
  }
  return out;
}

async function loadCalendars(
  db: SupabaseClient,
  venueId: string,
): Promise<Map<string, { name: string; staff_id: string | null }>> {
  const { data, error } = await db.from('unified_calendars').select('id, name, staff_id').eq('venue_id', venueId);
  if (error) throw new Error(error.message);
  const out = new Map<string, { name: string; staff_id: string | null }>();
  for (const c of (data ?? []) as Array<{ id: string; name?: string | null; staff_id?: string | null }>) {
    out.set(c.id, { name: c.name ?? '', staff_id: c.staff_id ?? null });
  }
  return out;
}

async function loadNames(db: SupabaseClient, table: string, venueId: string): Promise<Map<string, string>> {
  const { data, error } = await db.from(table).select('id, name').eq('venue_id', venueId);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as Array<{ id: string; name?: string | null }>).map((r) => [r.id, r.name ?? '']));
}

async function loadIdNames(
  db: SupabaseClient,
  table: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const out = new Map<string, string>();
  for (const part of chunk(unique, 200)) {
    const { data, error } = await db.from(table).select('id, name').in('id', part);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ id: string; name?: string | null }>) out.set(r.id, r.name ?? '');
  }
  return out;
}

async function loadClassNames(db: SupabaseClient, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const typeByInstance = new Map<string, string>();
  for (const part of chunk(unique, 200)) {
    const { data, error } = await db.from('class_instances').select('id, class_type_id').in('id', part);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ id: string; class_type_id?: string | null }>) {
      if (r.class_type_id) typeByInstance.set(r.id, r.class_type_id);
    }
  }
  const typeNames = await loadIdNames(db, 'class_types', [...typeByInstance.values()]);
  for (const [instanceId, typeId] of typeByInstance) out.set(instanceId, typeNames.get(typeId) ?? '');
  return out;
}

async function loadBookingAddons(
  db: SupabaseClient,
  bookingIds: string[],
): Promise<Map<string, Array<{ name: string; price: number }>>> {
  const out = new Map<string, Array<{ name: string; price: number }>>();
  for (const part of chunk(bookingIds, 200)) {
    const { data, error } = await db
      .from('booking_addons')
      .select('booking_id, addon_name_snapshot, price_pence_at_booking')
      .in('booking_id', part);
    if (error) throw new Error(error.message);
    for (const a of (data ?? []) as Array<{ booking_id: string; addon_name_snapshot: string; price_pence_at_booking: number }>) {
      const list = out.get(a.booking_id) ?? [];
      list.push({ name: a.addon_name_snapshot, price: a.price_pence_at_booking ?? 0 });
      out.set(a.booking_id, list);
    }
  }
  return out;
}

/**
 * The collective each booking was made through (REP-01, SB-30). `collective_id` has no foreign
 * key to embed through, so names are read separately, with the service client: a venue that has
 * left a collective can no longer read the collective row under RLS, and its own bookings must
 * still say where they came from (REP-06). Only the ids on this venue's own bookings are looked
 * up, and only the name is read.
 */
async function loadCollectiveNames(admin: SupabaseClient, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data, error } = await admin.from('venue_collectives').select('id, name').in('id', unique);
  if (error) {
    console.error('Export bookings collective names failed:', error.message);
    return out;
  }
  for (const c of (data ?? []) as Array<{ id: string; name?: string | null }>) out.set(c.id, c.name ?? 'Collective');
  return out;
}

// ─── Clients ──────────────────────────────────────────────────────────────────

const GUEST_SELECT = `
  id, first_name, last_name, email, phone, address_line1, address_line2, address_city, address_postcode, tags,
  marketing_consent, marketing_consent_at, marketing_opt_out, customer_profile_notes, dietary_preferences,
  source, visit_count, no_show_count, last_visit_date, first_booked_at, last_booked_at,
  waiver_signed_at, custom_fields, created_at
`;

interface GuestRow {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_city?: string | null;
  address_postcode?: string | null;
  tags?: string[] | null;
  marketing_consent?: boolean | null;
  marketing_consent_at?: string | null;
  marketing_opt_out?: boolean | null;
  customer_profile_notes?: string | null;
  dietary_preferences?: string | null;
  source?: string | null;
  visit_count?: number | null;
  no_show_count?: number | null;
  last_visit_date?: string | null;
  first_booked_at?: string | null;
  last_booked_at?: string | null;
  waiver_signed_at?: string | null;
  custom_fields?: Record<string, unknown> | null;
  created_at?: string | null;
}

async function loadGuests(db: SupabaseClient, venueId: string): Promise<GuestRow[]> {
  return selectAllPages<GuestRow>(
    (from, to) =>
      db
        .from('guests')
        .select(GUEST_SELECT)
        .eq('venue_id', venueId)
        .order('last_name', { ascending: true, nullsFirst: false })
        .order('first_name', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: GuestRow[] | null; error: { message: string } | null }>,
  );
}

/** How many clients were added in a range (every client when there is no range). */
export async function countContacts(db: SupabaseClient, venue: ExportVenue, range: ExportRange | null): Promise<number> {
  if (!range) {
    const { count, error } = await db.from('guests').select('id', { count: 'exact', head: true }).eq('venue_id', venue.id);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
  const { data, error } = await db.from('guests').select('id, created_at').eq('venue_id', venue.id);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ created_at?: string | null }>).filter((g) => inRange(ymdOf(g.created_at, venue.timeZone), range)).length;
}

export async function buildContactsExport(clients: ExportClients, venue: ExportVenue, range: ExportRange | null): Promise<ExportTable> {
  const { db } = clients;
  const [allGuests, customFields, bookingFacts] = await Promise.all([
    loadGuests(db, venue.id),
    loadCustomFields(db, venue.id),
    loadGuestBookingFacts(db, venue.id),
  ]);
  const guests = allGuests.filter((g) => inRange(ymdOf(g.created_at, venue.timeZone), range));
  const today = ymdOf(new Date().toISOString(), venue.timeZone);
  const sym = venue.currencySymbol;

  const headers = [
    `${venue.clientWord} ID`,
    'First name',
    'Surname',
    'Email',
    'Phone',
    'Address line 1',
    'Address line 2',
    'City',
    'Postcode',
    'Tags',
    'Marketing consent',
    'Consent recorded',
    'Marketing opt-out',
    'Notes',
    'Dietary preferences',
    'Source',
    'Visits',
    'No-shows',
    'Last visit',
    `Total ${venue.bookingWord.toLowerCase()}s`,
    'Upcoming',
    'Cancelled',
    `Paid deposits (${sym})`,
    'First booked',
    'Last booked',
    'Waiver signed',
    'Added on',
    ...customFields.map((f) => f.field_name),
  ];

  const rows = guests.map((g): ExportCell[] => {
    const facts = bookingFacts.get(g.id);
    const cf = g.custom_fields ?? {};
    return [
      g.id,
      normaliseGuestNamePart(g.first_name) ?? '',
      normaliseGuestNamePart(g.last_name) ?? '',
      g.email ?? '',
      g.phone ?? '',
      g.address_line1 ?? '',
      g.address_line2 ?? '',
      g.address_city ?? '',
      g.address_postcode ?? '',
      Array.isArray(g.tags) ? g.tags.join('; ') : '',
      yesNo(g.marketing_consent),
      formatInstant(g.marketing_consent_at, venue.timeZone),
      yesNo(g.marketing_opt_out),
      g.customer_profile_notes ?? '',
      g.dietary_preferences ?? '',
      titleCase(g.source),
      g.visit_count ?? 0,
      g.no_show_count ?? 0,
      g.last_visit_date ?? '',
      facts?.total ?? 0,
      facts ? facts.upcoming(today) : 0,
      facts?.cancelled ?? 0,
      (facts?.paidDepositPence ?? 0) / 100,
      formatWallClock(g.first_booked_at),
      formatWallClock(g.last_booked_at),
      formatInstant(g.waiver_signed_at, venue.timeZone),
      formatInstant(g.created_at, venue.timeZone),
      ...customFields.map((f) => text(cf[f.field_key])),
    ];
  });

  return { kind: 'contacts', title: `${venue.clientWord}s`, headers, rows, moneyColumns: [22] };
}

async function loadCustomFields(db: SupabaseClient, venueId: string): Promise<Array<{ field_name: string; field_key: string }>> {
  const { data, error } = await db
    .from('custom_client_fields')
    .select('field_name, field_key, is_active, created_at')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ field_name: string; field_key: string }>).map((f) => ({
    field_name: f.field_name,
    field_key: f.field_key,
  }));
}

interface GuestBookingFacts {
  total: number;
  cancelled: number;
  paidDepositPence: number;
  futureActive: string[];
  upcoming: (today: string) => number;
}

async function loadGuestBookingFacts(db: SupabaseClient, venueId: string): Promise<Map<string, GuestBookingFacts>> {
  const rows = await selectAllPages<{
    guest_id: string | null;
    status: string | null;
    booking_date: string;
    deposit_status: string | null;
    deposit_amount_pence: number | null;
  }>(
    (from, to) =>
      db
        .from('bookings')
        .select('guest_id, status, booking_date, deposit_status, deposit_amount_pence')
        .eq('venue_id', venueId)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: never[] | null; error: { message: string } | null }>,
  );
  const out = new Map<string, GuestBookingFacts>();
  for (const b of rows) {
    if (!b.guest_id) continue;
    let facts = out.get(b.guest_id);
    if (!facts) {
      facts = {
        total: 0,
        cancelled: 0,
        paidDepositPence: 0,
        futureActive: [],
        upcoming(today) {
          return this.futureActive.filter((d) => d >= today).length;
        },
      };
      out.set(b.guest_id, facts);
    }
    facts.total += 1;
    if (b.status === 'Cancelled') facts.cancelled += 1;
    else if (b.status !== 'No-Show') facts.futureActive.push(b.booking_date);
    if (b.deposit_status === 'Paid' && typeof b.deposit_amount_pence === 'number') facts.paidDepositPence += b.deposit_amount_pence;
  }
  return out;
}

// ─── Services ─────────────────────────────────────────────────────────────────

const SERVICE_SELECT = `
  id, name, description, item_type, category_id, duration_minutes, buffer_minutes, processing_time_minutes,
  processing_time_blocks, price_pence, price_type, deposit_pence, payment_requirement, capacity_per_session,
  location_type, online_meeting_url, online_meeting_info, is_active, is_bookable_online,
  max_advance_booking_days, min_booking_notice_hours, cancellation_notice_hours, allow_same_day_booking,
  pre_appointment_instructions, colour, sort_order, synced_from_service_id, created_at
`;

interface ServiceRow {
  id: string;
  name?: string | null;
  description?: string | null;
  item_type?: string | null;
  category_id?: string | null;
  duration_minutes?: number | null;
  buffer_minutes?: number | null;
  processing_time_minutes?: number | null;
  processing_time_blocks?: Array<{ start_minute?: number; end_minute?: number; start?: number; end?: number }> | null;
  price_pence?: number | null;
  price_type?: string | null;
  deposit_pence?: number | null;
  payment_requirement?: string | null;
  capacity_per_session?: number | null;
  location_type?: string | null;
  online_meeting_url?: string | null;
  online_meeting_info?: string | null;
  is_active?: boolean | null;
  is_bookable_online?: boolean | null;
  max_advance_booking_days?: number | null;
  min_booking_notice_hours?: number | null;
  cancellation_notice_hours?: number | null;
  allow_same_day_booking?: boolean | null;
  pre_appointment_instructions?: string | null;
  colour?: string | null;
  sort_order?: number | null;
  synced_from_service_id?: string | null;
  created_at?: string | null;
}

async function loadServices(db: SupabaseClient, venueId: string): Promise<ServiceRow[]> {
  const { data, error } = await db
    .from('service_items')
    .select(SERVICE_SELECT)
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ServiceRow[];
}

/** How many services were added in a range (every service when there is no range). */
export async function countServices(db: SupabaseClient, venue: ExportVenue, range: ExportRange | null): Promise<number> {
  const { data, error } = await db.from('service_items').select('id, created_at').eq('venue_id', venue.id);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ created_at?: string | null }>).filter((s) => inRange(ymdOf(s.created_at, venue.timeZone), range)).length;
}

export async function buildServicesExport(clients: ExportClients, venue: ExportVenue, range: ExportRange | null): Promise<ExportTable> {
  const { db } = clients;
  const [allServices, categories, calendars, assignments, variants, addonGroups] = await Promise.all([
    loadServices(db, venue.id),
    loadNames(db, 'service_categories', venue.id),
    loadCalendars(db, venue.id),
    loadAssignments(db),
    loadVariants(db, venue.id),
    loadServiceAddonGroups(db, venue.id),
  ]);
  const services = allServices.filter((s) => inRange(ymdOf(s.created_at, venue.timeZone), range));
  const sym = venue.currencySymbol;
  const money = (pence: number | null | undefined) => (pence == null ? '' : `${sym}${(pence / 100).toFixed(2)}`);
  const ownCalendarIds = new Set(calendars.keys());

  const headers = [
    'Service ID',
    'Name',
    'Category',
    'Description',
    'Type',
    'Duration (minutes)',
    'Buffer after (minutes)',
    'Processing time (minutes)',
    `Price (${sym})`,
    'Price shown as',
    `Deposit (${sym})`,
    'Payment to book',
    'Location',
    'Online meeting link',
    'Online meeting details',
    'Bookable online',
    'Active',
    'Offered on calendars',
    'Options',
    'Add-on groups',
    'Places per session',
    'Book up to (days ahead)',
    'Minimum notice (hours)',
    'Cancellation notice (hours)',
    'Same-day booking',
    'Pre-appointment instructions',
    'Colour',
    'Sort order',
    'Shared from a collective',
    'Added on',
  ];

  const rows = services.map((s): ExportCell[] => {
    const offered = (assignments.get(s.id) ?? [])
      .filter((a) => ownCalendarIds.has(a.calendar_id))
      .map((a) => {
        const name = calendars.get(a.calendar_id)?.name ?? '';
        const extras = [
          a.custom_duration_minutes != null ? `${a.custom_duration_minutes} min` : null,
          a.custom_price_pence != null ? money(a.custom_price_pence) : null,
        ].filter(Boolean);
        return extras.length > 0 ? `${name} (${extras.join(', ')})` : name;
      })
      .filter(Boolean);
    const options = (variants.get(s.id) ?? []).map((v) => {
      const bits = [
        v.duration_minutes != null ? `${v.duration_minutes} min` : null,
        v.price_pence != null ? money(v.price_pence) : null,
        v.deposit_pence ? `deposit ${money(v.deposit_pence)}` : null,
        v.is_active === false ? 'inactive' : null,
      ].filter(Boolean);
      return bits.length > 0 ? `${v.name}: ${bits.join(', ')}` : v.name;
    });
    const groups = (addonGroups.get(s.id) ?? []).map((g) =>
      g.addons.length > 0 ? `${g.name}: ${g.addons.map((a) => `${a.name} ${money(a.price)}`).join(', ')}` : g.name,
    );
    return [
      s.id,
      s.name ?? '',
      s.category_id ? (categories.get(s.category_id) ?? '') : '',
      s.description ?? '',
      titleCase(s.item_type),
      s.duration_minutes ?? null,
      s.buffer_minutes ?? 0,
      processingMinutes(s),
      pounds(s.price_pence),
      labelled(PRICE_TYPE_LABELS, s.price_type),
      pounds(s.deposit_pence),
      labelled(PAYMENT_REQUIREMENT_LABELS, s.payment_requirement),
      labelled(LOCATION_LABELS, s.location_type),
      s.online_meeting_url ?? '',
      s.online_meeting_info ?? '',
      yesNo(s.is_bookable_online),
      yesNo(s.is_active),
      offered.join('; '),
      options.join('; '),
      groups.join('; '),
      s.capacity_per_session ?? null,
      s.max_advance_booking_days ?? null,
      s.min_booking_notice_hours ?? null,
      s.cancellation_notice_hours ?? null,
      s.allow_same_day_booking == null ? '' : yesNo(s.allow_same_day_booking),
      s.pre_appointment_instructions ?? '',
      s.colour ?? '',
      s.sort_order ?? null,
      yesNo(Boolean(s.synced_from_service_id)),
      formatInstant(s.created_at, venue.timeZone),
    ];
  });

  return { kind: 'services', title: 'Services', headers, rows, moneyColumns: [8, 10] };
}

/** Total processing minutes: the canonical blocks when set, else the flat column. */
function processingMinutes(s: ServiceRow): number | null {
  const blocks = Array.isArray(s.processing_time_blocks) ? s.processing_time_blocks : [];
  if (blocks.length > 0) {
    let total = 0;
    for (const b of blocks) {
      const start = typeof b.start_minute === 'number' ? b.start_minute : typeof b.start === 'number' ? b.start : null;
      const end = typeof b.end_minute === 'number' ? b.end_minute : typeof b.end === 'number' ? b.end : null;
      if (start != null && end != null && end > start) total += end - start;
    }
    if (total > 0) return total;
  }
  return s.processing_time_minutes ?? null;
}

async function loadAssignments(
  db: SupabaseClient,
): Promise<Map<string, Array<{ calendar_id: string; custom_duration_minutes: number | null; custom_price_pence: number | null }>>> {
  // No venue_id on this table: rows are scoped afterwards to the venue's own calendars.
  const { data, error } = await db
    .from('calendar_service_assignments')
    .select('service_item_id, calendar_id, custom_duration_minutes, custom_price_pence');
  if (error) throw new Error(error.message);
  const out = new Map<string, Array<{ calendar_id: string; custom_duration_minutes: number | null; custom_price_pence: number | null }>>();
  for (const a of (data ?? []) as Array<{
    service_item_id: string;
    calendar_id: string;
    custom_duration_minutes?: number | null;
    custom_price_pence?: number | null;
  }>) {
    const list = out.get(a.service_item_id) ?? [];
    list.push({
      calendar_id: a.calendar_id,
      custom_duration_minutes: a.custom_duration_minutes ?? null,
      custom_price_pence: a.custom_price_pence ?? null,
    });
    out.set(a.service_item_id, list);
  }
  return out;
}

async function loadVariants(
  db: SupabaseClient,
  venueId: string,
): Promise<
  Map<string, Array<{ name: string; duration_minutes: number | null; price_pence: number | null; deposit_pence: number | null; is_active: boolean | null }>>
> {
  const { data, error } = await db
    .from('service_variants')
    .select('service_item_id, name, duration_minutes, price_pence, deposit_pence, is_active, sort_order')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  const out = new Map<
    string,
    Array<{ name: string; duration_minutes: number | null; price_pence: number | null; deposit_pence: number | null; is_active: boolean | null }>
  >();
  for (const v of (data ?? []) as Array<{
    service_item_id: string | null;
    name: string;
    duration_minutes?: number | null;
    price_pence?: number | null;
    deposit_pence?: number | null;
    is_active?: boolean | null;
  }>) {
    if (!v.service_item_id) continue;
    const list = out.get(v.service_item_id) ?? [];
    list.push({
      name: v.name,
      duration_minutes: v.duration_minutes ?? null,
      price_pence: v.price_pence ?? null,
      deposit_pence: v.deposit_pence ?? null,
      is_active: v.is_active ?? null,
    });
    out.set(v.service_item_id, list);
  }
  return out;
}

async function loadServiceAddonGroups(
  db: SupabaseClient,
  venueId: string,
): Promise<Map<string, Array<{ name: string; addons: Array<{ name: string; price: number }> }>>> {
  const [{ data: links, error: linkErr }, { data: groups, error: groupErr }, { data: addons, error: addonErr }] = await Promise.all([
    db.from('service_addon_groups').select('service_item_id, addon_group_id, sort_order').eq('venue_id', venueId),
    db.from('addon_groups').select('id, name, is_active').eq('venue_id', venueId),
    db.from('addons').select('addon_group_id, name, additional_price_pence, is_active, sort_order').eq('venue_id', venueId),
  ]);
  if (linkErr) throw new Error(linkErr.message);
  if (groupErr) throw new Error(groupErr.message);
  if (addonErr) throw new Error(addonErr.message);
  const groupNames = new Map(((groups ?? []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]));
  const addonsByGroup = new Map<string, Array<{ name: string; price: number }>>();
  for (const a of (addons ?? []) as Array<{ addon_group_id: string; name: string; additional_price_pence?: number | null; is_active?: boolean | null }>) {
    if (a.is_active === false) continue;
    const list = addonsByGroup.get(a.addon_group_id) ?? [];
    list.push({ name: a.name, price: a.additional_price_pence ?? 0 });
    addonsByGroup.set(a.addon_group_id, list);
  }
  const out = new Map<string, Array<{ name: string; addons: Array<{ name: string; price: number }> }>>();
  const sorted = ((links ?? []) as Array<{ service_item_id: string | null; addon_group_id: string; sort_order?: number | null }>)
    .filter((l) => l.service_item_id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const l of sorted) {
    const name = groupNames.get(l.addon_group_id);
    if (!name) continue;
    const list = out.get(l.service_item_id as string) ?? [];
    list.push({ name, addons: addonsByGroup.get(l.addon_group_id) ?? [] });
    out.set(l.service_item_id as string, list);
  }
  return out;
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function buildExportTable(kind: ExportKind, clients: ExportClients, venue: ExportVenue, range: ExportRange | null): Promise<ExportTable> {
  switch (kind) {
    case 'bookings':
      return buildBookingsExport(clients, venue, range);
    case 'contacts':
      return buildContactsExport(clients, venue, range);
    case 'services':
      return buildServicesExport(clients, venue, range);
  }
}

export async function countExportRows(kind: ExportKind, db: SupabaseClient, venue: ExportVenue, range: ExportRange | null): Promise<number> {
  switch (kind) {
    case 'bookings':
      return countBookings(db, venue.id, range);
    case 'contacts':
      return countContacts(db, venue, range);
    case 'services':
      return countServices(db, venue, range);
  }
}
