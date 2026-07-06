/**
 * Model D: Class / group session availability engine.
 * Given class instances for a date + existing bookings,
 * returns remaining capacity per class instance.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { ClassPaymentRequirement, ClassType, ClassInstance } from '@/types/booking-models';
import { timeToMinutes } from '@/lib/availability';
import { CAPACITY_CONSUMING_STATUSES } from '@/lib/availability/capacity-status';
import { venueLocalDateTimeToUtcMs } from '@/lib/venue/venue-local-clock';
import { entityBookingWindowFromRow, isGuestBookingDateAllowed } from '@/lib/booking/entity-booking-window';
import {
  resolveVenueWideAllowedMinuteRanges,
  isMinuteSubintervalCoveredByRanges,
  blocksForDate,
} from '@/lib/availability/venue-wide-business-hours';
import {
  rowsToVenueWideBlocks,
  venueWideBlocksQueryForDate,
  venueWideBlocksQueryForRange,
} from '@/lib/availability/venue-wide-blocks-fetch';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';

// Types

/** Public / online booking: class start must be at or after reference time + min_notice_hours (venue-local wall time). */
export interface GuestClassBookingWindow {
  minNoticeHours: number;
  venueTimezone: string;
  /** For tests; defaults to `Date.now()` when omitted. */
  referenceNowMs?: number;
}

export interface ClassEngineInput {
  date: string;
  classTypes: ClassType[];
  instances: ClassInstance[];
  /** Total booked spots per class_instance_id. */
  bookedByInstance: Record<string, number>;
  /**
   * Resolved venue `card_hold_deposits` feature flag (spec 6.3). When true, class types
   * configured `card_hold` with a positive per-person fee pass through as 'card_hold';
   * otherwise they degrade to 'none' with a warning. Omitted/false = degrade.
   */
  cardHoldDepositsEnabled?: boolean;
  /**
   * When set (public booking API), excludes instances outside per-class-type booking windows
   * (`class_types` columns) and past starts. `minNoticeHours` on the window object is unused;
   * notice comes from each class type row.
   */
  guestBookingWindow?: GuestClassBookingWindow;
  /** Resolved names for `class_types.instructor_id` (calendar or legacy practitioner) when `instructor_name` is empty. */
  instructorDisplayNamesById?: Record<string, string>;
  /** Venue-wide Business Hours blocks overlapping instance dates. */
  venueWideBlocks?: AvailabilityBlock[];
  venueOpeningHours?: OpeningHours | null;
}

export interface ClassAvailabilitySlot {
  instance_id: string;
  class_type_id: string;
  class_name: string;
  description: string | null;
  instance_date: string;
  start_time: string;
  duration_minutes: number;
  capacity: number;
  remaining: number;
  instructor_id: string | null;
  instructor_name: string | null;
  price_pence: number | null;
  /** Effective payment mode for this class type. */
  payment_requirement: ClassPaymentRequirement;
  /** Per-person deposit when payment_requirement is deposit. */
  deposit_amount_pence: number | null;
  /** Hours before start for deposit / prepayment refund (from `class_types`). */
  cancellation_notice_hours: number;
  /**
   * True when the customer flow should collect card details (deposit or full).
   * False for free or pay-at-venue (payment_requirement none with optional list price).
   */
  requires_stripe_checkout: boolean;
  /** @deprecated Use payment_requirement + requires_stripe_checkout */
  requires_online_payment: boolean;
  colour: string;
}

export interface ResolveClassPaymentRequirementOptions {
  /** Resolved venue `card_hold_deposits` flag; card_hold passes through only when true. */
  cardHoldDepositsEnabled?: boolean;
  /** Warning sink for degraded card_hold configs; defaults to `console.warn`. */
  warn?: (message: string) => void;
}

/** Resolves DB row to enum; supports legacy requires_online_payment. */
export function resolveClassPaymentRequirement(
  ct: ClassType,
  opts?: ResolveClassPaymentRequirementOptions,
): ClassPaymentRequirement {
  const raw = ct.payment_requirement;
  if (raw === 'deposit' || raw === 'full_payment' || raw === 'none') return raw;
  // Card-hold passthrough (spec 6.3), mirroring the table engine: 'card_hold' passes
  // through only when the venue's card_hold_deposits flag is on AND a positive per-person
  // fee is configured. Otherwise it degrades to 'none' (no upfront charge) with a warning.
  // Charging instead would take money the guest was never shown, and falling into the
  // legacy requires_online_payment inference below would charge the full list price.
  if (raw === 'card_hold') {
    const warn = opts?.warn ?? console.warn;
    if (opts?.cardHoldDepositsEnabled !== true) {
      warn(
        '[class-session-engine] class type configured card_hold but card_hold_deposits flag is off; treating as none',
      );
      return 'none';
    }
    if ((ct.deposit_amount_pence ?? 0) <= 0) {
      warn(
        '[class-session-engine] class type configured card_hold with no positive per-person fee; treating as none',
      );
      return 'none';
    }
    return 'card_hold';
  }
  if (ct.requires_online_payment === false) return 'none';
  if (ct.requires_online_payment === true) {
    if (ct.price_pence != null && ct.price_pence > 0) return 'full_payment';
    return 'none';
  }
  // Ambiguous legacy rows: a list price without explicit online payment mode is pay-at-venue.
  return 'none';
}

function resolveGuestFacingInstructorName(
  classType: ClassType,
  nameById: Record<string, string> | undefined,
): string | null {
  const custom = classType.instructor_name?.trim();
  if (custom) return custom;
  const id = classType.instructor_id;
  if (!id || !nameById) return null;
  return nameById[id] ?? null;
}

function stripeCheckoutNeeded(
  req: ClassPaymentRequirement,
  pricePence: number | null,
  depositPence: number | null,
): boolean {
  if (req === 'full_payment') return (pricePence ?? 0) > 0;
  if (req === 'deposit') return (depositPence ?? 0) > 0;
  return false;
}

/**
 * True when the class start (venue-local date + time) is at least `minNoticeHours` after reference "now".
 */
export function isClassInstanceBookableForGuest(
  instance: Pick<ClassInstance, 'instance_date' | 'start_time'>,
  guestBookingWindow: GuestClassBookingWindow,
): boolean {
  const startMs = venueLocalDateTimeToUtcMs(
    instance.instance_date,
    instance.start_time,
    guestBookingWindow.venueTimezone,
  );
  const nowMs = guestBookingWindow.referenceNowMs ?? Date.now();
  const minNoticeMs = Math.max(0, guestBookingWindow.minNoticeHours) * 60 * 60 * 1000;
  const earliestBookableStartMs = nowMs + minNoticeMs;
  return startMs >= earliestBookableStartMs;
}

// Core engine

/**
 * Class sessions are *explicitly scheduled* by staff, so the venue's weekly `opening_hours`
 * do not hide them (a 7pm yoga class is bookable even if the venue's weekly hours are 9am–5pm).
 * Only date-specific venue-wide blocks constrain them:
 *   - `closed` / `special_event` → hides overlapping class times
 *   - `amended_hours` → class must fit inside the amended periods
 * When there are no date-specific blocks, the scheduled session is always allowed.
 */
function classInstanceAllowedByVenueWideBlocks(
  instanceDate: string,
  startTimeHhMm: string,
  durationMinutes: number,
  venueWideBlocks: AvailabilityBlock[] | undefined,
  venueOpeningHours: OpeningHours | null | undefined,
): boolean {
  if (venueWideBlocks == null) return true;
  const dayBlocks = blocksForDate(venueWideBlocks, instanceDate);
  if (dayBlocks.length === 0) return true;

  const res = resolveVenueWideAllowedMinuteRanges(venueOpeningHours ?? null, instanceDate, venueWideBlocks);
  if (res.kind === 'unrestricted') return true;
  if (res.kind === 'closed') return false;
  const startMin = timeToMinutes(String(startTimeHhMm).slice(0, 5));
  const endMin = startMin + durationMinutes;
  if (endMin <= startMin) return false;
  if (endMin <= 24 * 60) {
    return isMinuteSubintervalCoveredByRanges(startMin, endMin, res.ranges);
  }
  return res.ranges.some((r) => startMin >= r.start && startMin < r.end);
}

export function computeClassAvailability(input: ClassEngineInput): ClassAvailabilitySlot[] {
  const {
    classTypes,
    instances,
    bookedByInstance,
    guestBookingWindow,
    instructorDisplayNamesById,
    venueWideBlocks,
    venueOpeningHours,
  } = input;
  const typeMap = new Map(classTypes.map((ct) => [ct.id, ct]));

  // Dedupe card-hold degrade warnings: one per class type per call (many instances can
  // share a type), mirroring the table engine's per-call dedupe.
  const cardHoldWarnedTypeIds = new Set<string>();

  const results: ClassAvailabilitySlot[] = [];

  for (const instance of instances) {
    if (instance.is_cancelled) continue;
    const classType = typeMap.get(instance.class_type_id);
    if (!classType || !classType.is_active) continue;
    if (
      !classInstanceAllowedByVenueWideBlocks(
        instance.instance_date,
        instance.start_time,
        classType.duration_minutes,
        venueWideBlocks,
        venueOpeningHours,
      )
    ) {
      continue;
    }
    if (guestBookingWindow) {
      const win = entityBookingWindowFromRow(classType as unknown as Record<string, unknown>);
      if (!isGuestBookingDateAllowed(instance.instance_date, win, guestBookingWindow.venueTimezone, guestBookingWindow.referenceNowMs)) {
        continue;
      }
      const minH = win.min_booking_notice_hours;
      if (!isClassInstanceBookableForGuest(instance, { ...guestBookingWindow, minNoticeHours: minH })) {
        continue;
      }
    }

    const capacity = instance.capacity_override ?? classType.capacity;
    const booked = bookedByInstance[instance.id] ?? 0;
    const remaining = Math.max(0, capacity - booked);

    const paymentRequirement = resolveClassPaymentRequirement(classType, {
      cardHoldDepositsEnabled: input.cardHoldDepositsEnabled,
      warn: (message) => {
        if (cardHoldWarnedTypeIds.has(classType.id)) return;
        cardHoldWarnedTypeIds.add(classType.id);
        console.warn(message, { class_type_id: classType.id });
      },
    });
    // Per-person amount: the deposit charged today ('deposit') or the no-show fee the
    // venue may charge later ('card_hold'); both ride the same slot field.
    const depositPerPerson =
      paymentRequirement === 'deposit' || paymentRequirement === 'card_hold'
        ? (classType.deposit_amount_pence ?? null)
        : null;
    const requiresStripe = stripeCheckoutNeeded(
      paymentRequirement,
      classType.price_pence,
      depositPerPerson,
    );

    const refundHours = entityBookingWindowFromRow(classType as unknown as Record<string, unknown>).cancellation_notice_hours;

    results.push({
      instance_id: instance.id,
      class_type_id: classType.id,
      class_name: classType.name,
      description: classType.description,
      instance_date: instance.instance_date,
      start_time: instance.start_time,
      duration_minutes: classType.duration_minutes,
      capacity,
      remaining,
      instructor_id: classType.instructor_id,
      instructor_name: resolveGuestFacingInstructorName(classType, instructorDisplayNamesById),
      price_pence: classType.price_pence,
      payment_requirement: paymentRequirement,
      deposit_amount_pence: depositPerPerson,
      cancellation_notice_hours: refundHours,
      requires_stripe_checkout: requiresStripe,
      requires_online_payment: requiresStripe,
      colour: classType.colour,
    });
  }

  results.sort(
    (a, b) =>
      a.instance_date.localeCompare(b.instance_date) || a.start_time.localeCompare(b.start_time),
  );
  return results;
}

// Offerings (multi-day): group bookable slots by class type for class-first UIs

export interface ClassOfferingSummary {
  class_type_id: string;
  class_name: string;
  description: string | null;
  colour: string;
  price_pence: number | null;
  payment_requirement: ClassPaymentRequirement;
  deposit_amount_pence: number | null;
  instructor_name: string | null;
  /** Distinct instance dates with at least one bookable spot. */
  dates: string[];
  /** Bookable instances in range for this type (remaining > 0). */
  session_count: number;
}

export function buildClassOfferingSummaries(slots: ClassAvailabilitySlot[]): ClassOfferingSummary[] {
  const byType = new Map<string, ClassAvailabilitySlot[]>();
  for (const s of slots) {
    if (s.remaining <= 0) continue;
    const arr = byType.get(s.class_type_id) ?? [];
    arr.push(s);
    byType.set(s.class_type_id, arr);
  }
  const out: ClassOfferingSummary[] = [];
  for (const [, arr] of byType) {
    const first = arr[0]!;
    const dates = [...new Set(arr.map((x) => x.instance_date))].sort();
    out.push({
      class_type_id: first.class_type_id,
      class_name: first.class_name,
      description: first.description,
      colour: first.colour,
      price_pence: first.price_pence,
      payment_requirement: first.payment_requirement,
      deposit_amount_pence: first.deposit_amount_pence,
      instructor_name: first.instructor_name,
      dates,
      session_count: arr.length,
    });
  }
  out.sort((a, b) => a.class_name.localeCompare(b.class_name));
  return out;
}

// Fetcher

export async function fetchClassInput(params: {
  supabase: SupabaseClient;
  venueId: string;
  date: string;
  /**
   * When true, loads venue `timezone` and applies guest filtering using per-class-type rules.
   */
  forPublicBooking?: boolean;
}): Promise<ClassEngineInput> {
  const { supabase, venueId, date, forPublicBooking } = params;

  const [typesRes, venueRes, venueBlocksRes] = await Promise.all([
    supabase.from('class_types').select('*').eq('venue_id', venueId).eq('is_active', true),
    supabase.from('venues').select('timezone, opening_hours, feature_flags').eq('id', venueId).maybeSingle(),
    venueWideBlocksQueryForDate(supabase, venueId, date),
  ]);

  const classTypes = (typesRes.data ?? []) as ClassType[];
  const classTypeIds = classTypes.map((ct) => ct.id);

  const instructorIds = [...new Set(classTypes.map((ct) => ct.instructor_id).filter(Boolean))] as string[];
  const instructorDisplayNamesById: Record<string, string> = {};
  if (instructorIds.length > 0) {
    const [calsRes, pracsRes] = await Promise.all([
      supabase.from('unified_calendars').select('id, name').eq('venue_id', venueId).in('id', instructorIds),
      supabase.from('practitioners').select('id, name').eq('venue_id', venueId).in('id', instructorIds),
    ]);
    if (calsRes.error) {
      console.error('[fetchClassInput] unified_calendars:', calsRes.error);
    }
    if (pracsRes.error) {
      console.error('[fetchClassInput] practitioners:', pracsRes.error);
    }
    for (const row of pracsRes.data ?? []) {
      const p = row as { id: string; name: string };
      instructorDisplayNamesById[p.id] = p.name;
    }
    for (const row of calsRes.data ?? []) {
      const c = row as { id: string; name: string };
      instructorDisplayNamesById[c.id] = c.name;
    }
  }

  const instancesPromise =
    classTypeIds.length === 0
      ? Promise.resolve({ data: [] as ClassInstance[] })
      : supabase
          .from('class_instances')
          .select('*')
          .eq('instance_date', date)
          .eq('is_cancelled', false)
          .in('class_type_id', classTypeIds)
          .order('start_time');

  const [instancesRes, bookingsRes] = await Promise.all([
    instancesPromise,
    supabase
      .from('bookings')
      .select('id, class_instance_id, party_size, status')
      .eq('venue_id', venueId)
      .eq('booking_date', date)
      .not('class_instance_id', 'is', null)
      .in('status', CAPACITY_CONSUMING_STATUSES),
  ]);

  const instances = (instancesRes.data ?? []) as ClassInstance[];

  const bookedByInstance: Record<string, number> = {};
  for (const b of bookingsRes.data ?? []) {
    const instId = b.class_instance_id!;
    bookedByInstance[instId] = (bookedByInstance[instId] ?? 0) + (b.party_size ?? 1);
  }

  if (venueBlocksRes.error) {
    console.warn('[fetchClassInput] availability_blocks:', venueBlocksRes.error.message);
  }

  const venueOpeningHours = (venueRes.data?.opening_hours as OpeningHours | null) ?? null;
  const venueWideBlocks = rowsToVenueWideBlocks(venueBlocksRes.data);
  const cardHoldDepositsEnabled = resolveAppointmentsFeatureFlag(
    'card_hold_deposits',
    parseVenueFeatureFlags((venueRes.data as { feature_flags?: unknown } | null)?.feature_flags),
  );

  let guestBookingWindow: GuestClassBookingWindow | undefined;
  if (forPublicBooking === true) {
    if ('error' in venueRes && venueRes.error) {
      console.error('[fetchClassInput] venue row for public booking:', venueRes.error);
    }
    const v = venueRes.data as { timezone?: string | null } | null;
    const tz =
      v && typeof v.timezone === 'string' && v.timezone.trim() !== '' ? v.timezone.trim() : 'Europe/London';
    guestBookingWindow = { minNoticeHours: 0, venueTimezone: tz };
  }

  return {
    date,
    classTypes,
    instances,
    bookedByInstance,
    guestBookingWindow,
    instructorDisplayNamesById,
    venueWideBlocks,
    venueOpeningHours,
    cardHoldDepositsEnabled,
  };
}

/**
 * Load class instances and bookings across a date range (inclusive).
 * Use with {@link computeClassAvailability} for class-first booking flows (e.g. next 3 months).
 */
export async function fetchClassInputForRange(params: {
  supabase: SupabaseClient;
  venueId: string;
  fromDate: string;
  toDate: string;
  forPublicBooking?: boolean;
}): Promise<ClassEngineInput> {
  const { supabase, venueId, fromDate, toDate, forPublicBooking } = params;

  const [typesRes, venueRes, venueBlocksRes] = await Promise.all([
    supabase.from('class_types').select('*').eq('venue_id', venueId).eq('is_active', true),
    supabase.from('venues').select('timezone, opening_hours, feature_flags').eq('id', venueId).maybeSingle(),
    venueWideBlocksQueryForRange(supabase, venueId, fromDate, toDate),
  ]);

  const classTypes = (typesRes.data ?? []) as ClassType[];
  const classTypeIds = classTypes.map((ct) => ct.id);

  const instructorIds = [...new Set(classTypes.map((ct) => ct.instructor_id).filter(Boolean))] as string[];
  const instructorDisplayNamesById: Record<string, string> = {};
  if (instructorIds.length > 0) {
    const [calsRes, pracsRes] = await Promise.all([
      supabase.from('unified_calendars').select('id, name').eq('venue_id', venueId).in('id', instructorIds),
      supabase.from('practitioners').select('id, name').eq('venue_id', venueId).in('id', instructorIds),
    ]);
    if (calsRes.error) {
      console.error('[fetchClassInputForRange] unified_calendars:', calsRes.error);
    }
    if (pracsRes.error) {
      console.error('[fetchClassInputForRange] practitioners:', pracsRes.error);
    }
    for (const row of pracsRes.data ?? []) {
      const p = row as { id: string; name: string };
      instructorDisplayNamesById[p.id] = p.name;
    }
    for (const row of calsRes.data ?? []) {
      const c = row as { id: string; name: string };
      instructorDisplayNamesById[c.id] = c.name;
    }
  }

  const instancesPromise =
    classTypeIds.length === 0
      ? Promise.resolve({ data: [] as ClassInstance[] })
      : supabase
          .from('class_instances')
          .select('*')
          .gte('instance_date', fromDate)
          .lte('instance_date', toDate)
          .eq('is_cancelled', false)
          .in('class_type_id', classTypeIds)
          .order('instance_date', { ascending: true })
          .order('start_time', { ascending: true });

  const [instancesRes, bookingsRes] = await Promise.all([
    instancesPromise,
    supabase
      .from('bookings')
      .select('id, class_instance_id, party_size, status')
      .eq('venue_id', venueId)
      .gte('booking_date', fromDate)
      .lte('booking_date', toDate)
      .not('class_instance_id', 'is', null)
      .in('status', CAPACITY_CONSUMING_STATUSES),
  ]);

  const instances = (instancesRes.data ?? []) as ClassInstance[];

  const bookedByInstance: Record<string, number> = {};
  for (const b of bookingsRes.data ?? []) {
    const instId = b.class_instance_id!;
    bookedByInstance[instId] = (bookedByInstance[instId] ?? 0) + (b.party_size ?? 1);
  }

  if (venueBlocksRes.error) {
    console.warn('[fetchClassInputForRange] availability_blocks:', venueBlocksRes.error.message);
  }

  const venueOpeningHours = (venueRes.data?.opening_hours as OpeningHours | null) ?? null;
  const venueWideBlocks = rowsToVenueWideBlocks(venueBlocksRes.data);
  const cardHoldDepositsEnabled = resolveAppointmentsFeatureFlag(
    'card_hold_deposits',
    parseVenueFeatureFlags((venueRes.data as { feature_flags?: unknown } | null)?.feature_flags),
  );

  let guestBookingWindow: GuestClassBookingWindow | undefined;
  if (forPublicBooking === true) {
    if ('error' in venueRes && venueRes.error) {
      console.error('[fetchClassInputForRange] venue row for public booking:', venueRes.error);
    }
    const v = venueRes.data as { timezone?: string | null } | null;
    const tz =
      v && typeof v.timezone === 'string' && v.timezone.trim() !== '' ? v.timezone.trim() : 'Europe/London';
    guestBookingWindow = { minNoticeHours: 0, venueTimezone: tz };
  }

  return {
    date: fromDate,
    classTypes,
    instances,
    bookedByInstance,
    guestBookingWindow,
    instructorDisplayNamesById,
    venueWideBlocks,
    venueOpeningHours,
    cardHoldDepositsEnabled,
  };
}
