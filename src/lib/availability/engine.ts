/**
 * Service-based availability engine (v2).
 *
 * Pure functions: given pre-fetched data (EngineInput), compute available slots
 * per service with dual-constraint yield management (covers AND booking count).
 */

import type {
  AvailabilityBlock,
  BlockYieldOverridesPayload,
  BookingForEngine,
  BookingRestriction,
  BookingRestrictionException,
  EngineInput,
  EngineServiceResult,
  PartySizeDuration,
  ServiceAvailableSlot,
  ServiceCapacityRule,
  ServiceScheduleException,
  VenueService,
} from '@/types/availability';

const CAPACITY_CONSUMING_STATUSES = ['Booked', 'Confirmed', 'Pending'];

const DEFAULT_DURATION_MINUTES = 90;

const SLOT_PROBE_STEP_MINUTES = 15;

const DEFAULT_RESTRICTION_WHEN_MISSING: Omit<BookingRestriction, 'id' | 'service_id'> = {
  min_advance_minutes: 60,
  max_advance_days: 60,
  min_party_size_online: 1,
  max_party_size_online: 10,
  large_party_threshold: null,
  large_party_message: null,
  deposit_required_from_party_size: null,
  deposit_amount_per_person_gbp: null,
  online_requires_deposit: true,
  cancellation_notice_hours: 48,
};

/** Parse "HH:mm" or "HH:mm:ss" to minutes since midnight. */
export function timeToMinutes(t: string): number {
  const parts = t.trim().split(':');
  return parseInt(parts[0] ?? '0', 10) * 60 + parseInt(parts[1] ?? '0', 10);
}

/** Format minutes since midnight to "HH:mm". */
export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

/** Day-of-week for a date string YYYY-MM-DD (0=Sun). */
export function getDayOfWeek(dateStr: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y!, mo! - 1, d!).getDay();
}

function sliceTime(value: string | null | undefined): string | null {
  if (value == null) return null;
  return String(value).slice(0, 5);
}

function dateSpanDays(row: { date_start: string; date_end: string }): number {
  const a = new Date(row.date_start + 'T12:00:00').getTime();
  const b = new Date(row.date_end + 'T12:00:00').getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

function parseYieldPayload(raw: unknown): BlockYieldOverridesPayload {
  if (raw == null || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: BlockYieldOverridesPayload = {};
  if (typeof o.max_bookings_per_slot === 'number' && o.max_bookings_per_slot >= 1) {
    out.max_bookings_per_slot = Math.floor(o.max_bookings_per_slot);
  }
  if (typeof o.slot_interval_minutes === 'number' && o.slot_interval_minutes >= 5 && o.slot_interval_minutes <= 120) {
    out.slot_interval_minutes = Math.floor(o.slot_interval_minutes);
  }
  if (typeof o.buffer_minutes === 'number' && o.buffer_minutes >= 0 && o.buffer_minutes <= 120) {
    out.buffer_minutes = Math.floor(o.buffer_minutes);
  }
  if (typeof o.duration_minutes === 'number' && o.duration_minutes >= 15 && o.duration_minutes <= 300) {
    out.duration_minutes = Math.floor(o.duration_minutes);
  }
  return out;
}

/** Merged yield knobs from all matching reduced_capacity blocks (stricter ops). */
export interface MergedBlockYield {
  overrideMaxCovers: number | null;
  maxBookings: number | null;
  slotInterval: number | null;
  buffer: number | null;
  duration: number | null;
}

export interface SlotBlockResolution {
  blocked: boolean;
  mergedYield: MergedBlockYield;
}

function emptyMergedYield(): MergedBlockYield {
  return {
    overrideMaxCovers: null,
    maxBookings: null,
    slotInterval: null,
    buffer: null,
    duration: null,
  };
}

function mergeYieldPayloads(into: MergedBlockYield, payload: BlockYieldOverridesPayload): void {
  if (payload.max_bookings_per_slot != null) {
    into.maxBookings =
      into.maxBookings == null
        ? payload.max_bookings_per_slot
        : Math.min(into.maxBookings, payload.max_bookings_per_slot);
  }
  if (payload.slot_interval_minutes != null) {
    into.slotInterval =
      into.slotInterval == null
        ? payload.slot_interval_minutes
        : Math.max(into.slotInterval, payload.slot_interval_minutes);
  }
  if (payload.buffer_minutes != null) {
    into.buffer =
      into.buffer == null ? payload.buffer_minutes : Math.max(into.buffer, payload.buffer_minutes);
  }
  if (payload.duration_minutes != null) {
    into.duration =
      into.duration == null ? payload.duration_minutes : Math.max(into.duration, payload.duration_minutes);
  }
}

/** Collect blocks that apply to this venue, service, calendar date and slot time. */
function blocksMatchingSlot(
  blocks: AvailabilityBlock[],
  venueId: string,
  serviceId: string,
  dateStr: string,
  slotMinutes: number,
): AvailabilityBlock[] {
  const out: AvailabilityBlock[] = [];
  for (const block of blocks) {
    if (block.venue_id !== venueId) continue;
    if (block.service_id != null && block.service_id !== serviceId) continue;
    if (dateStr < block.date_start || dateStr > block.date_end) continue;

    const ts = sliceTime(block.time_start);
    const te = sliceTime(block.time_end);
    if (ts != null && te != null) {
      const bStart = timeToMinutes(ts);
      const bEnd = timeToMinutes(te);
      if (slotMinutes < bStart || slotMinutes >= bEnd) continue;
    }
    out.push(block);
  }
  return out;
}

/** Collect amended_hours blocks covering a venue + date (ignoring time_start/time_end). */
function amendedHoursBlocksForDate(
  blocks: AvailabilityBlock[],
  venueId: string,
  dateStr: string,
): AvailabilityBlock[] {
  const out: AvailabilityBlock[] = [];
  for (const b of blocks) {
    if (b.block_type !== 'amended_hours') continue;
    if (b.venue_id !== venueId) continue;
    if (b.service_id != null) continue;
    if (dateStr < b.date_start || dateStr > b.date_end) continue;
    out.push(b);
  }
  return out;
}

/** Check whether slotMinutes falls inside any period from an amended_hours block set. */
function isSlotWithinAmendedPeriods(amended: AvailabilityBlock[], slotMinutes: number): boolean {
  for (const b of amended) {
    if (!Array.isArray(b.override_periods)) continue;
    for (const p of b.override_periods) {
      const pStart = timeToMinutes(p.open);
      const pEnd = timeToMinutes(p.close);
      if (slotMinutes >= pStart && slotMinutes < pEnd) return true;
    }
  }
  return false;
}

/**
 * Deterministic merge: closed or special_event wins; amended_hours blocks slot
 * outside their periods; else minimum override_max_covers and merged JSON yield
 * overrides (min bookings, max interval/buffer/duration).
 */
export function resolveSlotBlockState(
  blocks: AvailabilityBlock[],
  venueId: string,
  serviceId: string,
  dateStr: string,
  slotMinutes: number,
): SlotBlockResolution {
  const matching = blocksMatchingSlot(blocks, venueId, serviceId, dateStr, slotMinutes);
  const merged = emptyMergedYield();

  if (matching.some((b) => b.block_type === 'closed' || b.block_type === 'special_event')) {
    return { blocked: true, mergedYield: merged };
  }

  const amended = amendedHoursBlocksForDate(blocks, venueId, dateStr);
  if (amended.length > 0 && !isSlotWithinAmendedPeriods(amended, slotMinutes)) {
    return { blocked: true, mergedYield: merged };
  }

  const reduced = matching.filter((b) => b.block_type === 'reduced_capacity');
  const coverVals = reduced
    .map((b) => b.override_max_covers)
    .filter((x): x is number => x != null && typeof x === 'number');
  if (coverVals.length > 0) {
    merged.overrideMaxCovers = Math.min(...coverVals);
  }

  for (const b of reduced) {
    mergeYieldPayloads(merged, parseYieldPayload(b.yield_overrides));
  }

  return { blocked: false, mergedYield: merged };
}

/** Resolve the best matching capacity rule for a service on a given day/time.
 *  Priority: time-range override > day override > default (both null).
 */
export function resolveCapacityRule(
  rules: ServiceCapacityRule[],
  serviceId: string,
  dayOfWeek: number,
  slotTimeMinutes: number,
): ServiceCapacityRule | null {
  const serviceRules = rules.filter((r) => r.service_id === serviceId);
  if (serviceRules.length === 0) return null;

  let best: ServiceCapacityRule | null = null;
  let bestSpecificity = -1;

  for (const rule of serviceRules) {
    let specificity = 0;

    if (rule.day_of_week != null) {
      if (rule.day_of_week !== dayOfWeek) continue;
      specificity += 1;
    }

    if (rule.time_range_start != null && rule.time_range_end != null) {
      const rangeStart = timeToMinutes(rule.time_range_start);
      const rangeEnd = timeToMinutes(rule.time_range_end);
      if (slotTimeMinutes < rangeStart || slotTimeMinutes >= rangeEnd) continue;
      specificity += 2;
    }

    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      best = rule;
    }
  }

  return best;
}

/** Resolve dining duration for a party size within a service. */
export function resolveDuration(
  durations: PartySizeDuration[],
  serviceId: string,
  partySize: number,
  dayOfWeek: number,
): number {
  const serviceDurations = durations.filter((d) => d.service_id === serviceId);
  if (serviceDurations.length === 0) return DEFAULT_DURATION_MINUTES;

  let best: PartySizeDuration | null = null;
  let bestSpecificity = -1;

  for (const d of serviceDurations) {
    if (partySize < d.min_party_size || partySize > d.max_party_size) continue;

    let specificity = 0;
    if (d.day_of_week != null) {
      if (d.day_of_week !== dayOfWeek) continue;
      specificity += 1_000;
    }
    // Prefer the most specific party-size band when several rows match.
    specificity += Math.max(0, 999 - (d.max_party_size - d.min_party_size));

    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      best = d;
    }
  }

  return best?.duration_minutes ?? DEFAULT_DURATION_MINUTES;
}

/**
 * Staff walk-ins can be added just after service closes. In that case, keep using
 * the dining service that most recently finished so party-size turn-time rules stay intuitive.
 */
export function selectServiceForWalkInTime(
  input: EngineInput,
  venueId: string,
  dateStr: string,
  time: string,
): VenueService | null {
  const dayOfWeek = getDayOfWeek(dateStr);
  const requestMinutesRaw = timeToMinutes(time);
  const effectiveServices = [...input.services]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((service) => {
      const effectiveService = resolveServiceForDate(
        service,
        input.schedule_exceptions,
        venueId,
        dateStr,
        dayOfWeek,
      );
      if (!effectiveService) return null;

      const startMinutes = timeToMinutes(effectiveService.start_time);
      let endMinutes = timeToMinutes(effectiveService.end_time);
      if (endMinutes <= startMinutes) endMinutes += 24 * 60;
      const requestMinutes =
        endMinutes > 24 * 60 && requestMinutesRaw < startMinutes
          ? requestMinutesRaw + 24 * 60
          : requestMinutesRaw;

      return { service, startMinutes, endMinutes, requestMinutes };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const current = effectiveServices.find(
    (row) => row.requestMinutes >= row.startMinutes && row.requestMinutes < row.endMinutes,
  );
  if (current) return current.service;

  const mostRecentlyFinished = effectiveServices
    .filter((row) => row.endMinutes <= row.requestMinutes)
    .sort((a, b) => b.endMinutes - a.endMinutes)[0];
  if (mostRecentlyFinished) return mostRecentlyFinished.service;

  return effectiveServices[0]?.service ?? null;
}

/** Resolve the restriction row for a service. */
export function resolveRestriction(
  restrictions: BookingRestriction[],
  serviceId: string,
): BookingRestriction | null {
  return restrictions.find((r) => r.service_id === serviceId) ?? null;
}

function resolveDepositPerPersonGbp(
  restriction: BookingRestriction | null,
  legacyAmountPerPersonGbp: number | null,
): number | null {
  if (restriction) {
    const direct = restriction.deposit_amount_per_person_gbp;
    if (direct != null && Number.isFinite(Number(direct))) {
      return Number(direct);
    }
  }
  return legacyAmountPerPersonGbp;
}

function depositThresholdMet(restriction: BookingRestriction | null, partySize: number): boolean {
  const t = restriction?.deposit_required_from_party_size;
  return t != null && partySize >= t;
}

/** Resolution rule (D5): restriction.deposit_type ?? legacy deposit_config.type ?? 'charge'. */
function resolveDepositType(
  restriction: BookingRestriction | null,
  legacyType: 'charge' | 'card_hold' | null | undefined,
): 'charge' | 'card_hold' {
  return restriction?.deposit_type ?? legacyType ?? 'charge';
}

function applicableRestrictionExceptions(
  exceptions: BookingRestrictionException[],
  venueId: string,
  serviceId: string,
  dateStr: string,
  slotMinutes: number | undefined,
): BookingRestrictionException[] {
  return exceptions.filter((ex) => {
    if (ex.venue_id !== venueId) return false;
    if (ex.service_id != null && ex.service_id !== serviceId) return false;
    if (dateStr < ex.date_start || dateStr > ex.date_end) return false;

    const ts = sliceTime(ex.time_start);
    const te = sliceTime(ex.time_end);
    if (ts != null && te != null) {
      if (slotMinutes === undefined) return false;
      const a = timeToMinutes(ts);
      const b = timeToMinutes(te);
      if (slotMinutes < a || slotMinutes >= b) return false;
    }
    return true;
  });
}

function pickNarrowestException<T extends { date_start: string; date_end: string }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => (dateSpanDays(row) < dateSpanDays(best) ? row : best));
}

function patchRestrictionFromException(
  base: BookingRestriction | null,
  ex: BookingRestrictionException,
): BookingRestriction {
  const b = base ?? {
    id: 'synthetic',
    service_id: ex.service_id ?? '',
    ...DEFAULT_RESTRICTION_WHEN_MISSING,
  };

  return {
    ...b,
    min_advance_minutes: ex.min_advance_minutes ?? b.min_advance_minutes,
    max_advance_days: ex.max_advance_days ?? b.max_advance_days,
    min_party_size_online: ex.min_party_size_online ?? b.min_party_size_online,
    max_party_size_online: ex.max_party_size_online ?? b.max_party_size_online,
    large_party_threshold: ex.large_party_threshold ?? b.large_party_threshold,
    large_party_message: ex.large_party_message ?? b.large_party_message,
    deposit_required_from_party_size:
      ex.deposit_required_from_party_size ?? b.deposit_required_from_party_size,
  };
}

/** Merge base booking_restrictions with the narrowest matching exception (whole-day or slot time). */
export function mergeBookingRestrictionForContext(
  base: BookingRestriction | null,
  exceptions: BookingRestrictionException[],
  venueId: string,
  serviceId: string,
  dateStr: string,
  slotMinutes: number | undefined,
): BookingRestriction | null {
  const pool = applicableRestrictionExceptions(exceptions, venueId, serviceId, dateStr, slotMinutes);
  const ex = pickNarrowestException(pool);
  if (!ex) return base;
  return patchRestrictionFromException(base, ex);
}

function scheduleExceptionsForService(
  exceptions: ServiceScheduleException[],
  venueId: string,
  serviceId: string,
  dateStr: string,
): ServiceScheduleException[] {
  return exceptions.filter(
    (e) =>
      e.venue_id === venueId &&
      e.service_id === serviceId &&
      dateStr >= e.date_start &&
      dateStr <= e.date_end,
  );
}

/**
 * Whether the service runs on this date and the effective time window.
 * Schedule exceptions can close, add an extra day, or override hours.
 */
export function resolveServiceForDate(
  service: VenueService,
  scheduleExceptions: ServiceScheduleException[],
  venueId: string,
  dateStr: string,
  dayOfWeek: number,
): VenueService | null {
  const scoped = scheduleExceptionsForService(scheduleExceptions, venueId, service.id, dateStr);

  if (scoped.some((e) => e.is_closed)) {
    return null;
  }

  const timed = scoped.filter((e) => e.start_time != null && e.end_time != null && e.last_booking_time != null);
  const bestTimed = pickNarrowestException(timed);
  if (bestTimed) {
    return {
      ...service,
      start_time: sliceTime(bestTimed.start_time)!,
      end_time: sliceTime(bestTimed.end_time)!,
      last_booking_time: sliceTime(bestTimed.last_booking_time)!,
    };
  }

  const opensExtra = scoped.some((e) => e.opens_extra_day);
  if (opensExtra) {
    return service;
  }

  if (!service.days_of_week.includes(dayOfWeek)) {
    return null;
  }

  return service;
}

/** Count covers and booking count for existing bookings that overlap a slot window. */
export function countOverlapping(
  bookings: BookingForEngine[],
  serviceId: string,
  slotStartMinutes: number,
  slotEndMinutes: number,
): { covers: number; bookingCount: number } {
  let covers = 0;
  let bookingCount = 0;

  for (const b of bookings) {
    if (!CAPACITY_CONSUMING_STATUSES.includes(b.status)) continue;

    const bStart = timeToMinutes(b.booking_time);
    let bEnd: number;

    if (b.estimated_end_time) {
      const endParts = b.estimated_end_time.split('T')[1];
      bEnd = endParts ? timeToMinutes(endParts) : bStart + DEFAULT_DURATION_MINUTES;
    } else {
      bEnd = bStart + DEFAULT_DURATION_MINUTES;
    }

    const overlaps = bStart < slotEndMinutes && bEnd > slotStartMinutes;
    const matchesService = !b.service_id || b.service_id === serviceId;

    if (overlaps && matchesService) {
      covers += b.party_size;
      bookingCount += 1;
    }
  }

  return { covers, bookingCount };
}

/** Minimum per-slot cover cap across the service window (ignores bookings); for day-sheet alignment. */
export function computeEffectiveMinSlotCoverCap(
  input: EngineInput,
  service: VenueService,
  effectiveService: VenueService,
  dayOfWeek: number,
): number | null {
  const baseRestriction = resolveRestriction(input.restrictions, service.id);
  const dayRestriction = mergeBookingRestrictionForContext(
    baseRestriction,
    input.restriction_exceptions,
    input.venue_id,
    service.id,
    input.date,
    undefined,
  );
  if (dayRestriction) {
    if (
      input.party_size < dayRestriction.min_party_size_online ||
      input.party_size > dayRestriction.max_party_size_online
    ) {
      return null;
    }
    if (
      dayRestriction.large_party_threshold &&
      input.party_size >= dayRestriction.large_party_threshold
    ) {
      return null;
    }
    const nowMs = input.now.getTime();
    const [y, mo, d] = input.date.split('-').map(Number);
    const bookingDateMs = new Date(y!, mo! - 1, d!, 12, 0, 0).getTime();
    const daysDiff = Math.floor((bookingDateMs - nowMs) / (1000 * 60 * 60 * 24));
    if (daysDiff > dayRestriction.max_advance_days) {
      return null;
    }
  }

  const serviceStart = timeToMinutes(effectiveService.start_time);
  const lastBooking = timeToMinutes(effectiveService.last_booking_time);
  const defaultRule = resolveCapacityRule(input.capacity_rules, service.id, dayOfWeek, serviceStart);

  let minCap: number | null = null;

  for (let slotMin = serviceStart; slotMin <= lastBooking; slotMin += SLOT_PROBE_STEP_MINUTES) {
    const { blocked, mergedYield } = resolveSlotBlockState(
      input.blocks,
      input.venue_id,
      service.id,
      input.date,
      slotMin,
    );
    if (blocked) continue;

    const rule = resolveCapacityRule(input.capacity_rules, service.id, dayOfWeek, slotMin);
    const intervalMinutes = mergedYield.slotInterval ?? rule?.slot_interval_minutes ?? defaultRule?.slot_interval_minutes ?? 15;
    if ((slotMin - serviceStart) % intervalMinutes !== 0) continue;

    const cap = mergedYield.overrideMaxCovers ?? rule?.max_covers_per_slot ?? 20;
    minCap = minCap == null ? cap : Math.min(minCap, cap);
  }

  return minCap;
}

/** Generate timeslots for a single service on a given date. */
function generateServiceSlots(
  input: EngineInput,
  service: VenueService,
): { slots: ServiceAvailableSlot[]; restriction: BookingRestriction | null; largeParty: boolean; largePartyMsg: string | null } {
  const dayOfWeek = getDayOfWeek(input.date);

  const effectiveService = resolveServiceForDate(
    service,
    input.schedule_exceptions,
    input.venue_id,
    input.date,
    dayOfWeek,
  );
  if (!effectiveService) {
    return { slots: [], restriction: null, largeParty: false, largePartyMsg: null };
  }

  const baseRestriction = resolveRestriction(input.restrictions, service.id);
  const dayRestriction = mergeBookingRestrictionForContext(
    baseRestriction,
    input.restriction_exceptions,
    input.venue_id,
    service.id,
    input.date,
    undefined,
  );

  if (dayRestriction) {
    if (
      input.party_size < dayRestriction.min_party_size_online ||
      input.party_size > dayRestriction.max_party_size_online
    ) {
      return { slots: [], restriction: dayRestriction, largeParty: false, largePartyMsg: null };
    }

    if (
      dayRestriction.large_party_threshold &&
      input.party_size >= dayRestriction.large_party_threshold
    ) {
      return {
        slots: [],
        restriction: dayRestriction,
        largeParty: true,
        largePartyMsg: dayRestriction.large_party_message ?? 'Please call us to book for large parties.',
      };
    }

    const nowMs = input.now.getTime();
    const [y, mo, d] = input.date.split('-').map(Number);
    const bookingDateMs = new Date(y!, mo! - 1, d!, 12, 0, 0).getTime();
    const daysDiff = Math.floor((bookingDateMs - nowMs) / (1000 * 60 * 60 * 24));

    if (daysDiff > dayRestriction.max_advance_days) {
      return { slots: [], restriction: dayRestriction, largeParty: false, largePartyMsg: null };
    }
  }

  const baseDuration = resolveDuration(input.durations, service.id, input.party_size, dayOfWeek);
  const serviceStart = timeToMinutes(effectiveService.start_time);
  const lastBooking = timeToMinutes(effectiveService.last_booking_time);

  const slots: ServiceAvailableSlot[] = [];

  const defaultRule = resolveCapacityRule(input.capacity_rules, service.id, dayOfWeek, serviceStart);

  // Dedupe card-hold safety warnings: the config is per-service, so one warning per call.
  let cardHoldSafetyWarned = false;

  for (let slotMin = serviceStart; slotMin <= lastBooking; slotMin += SLOT_PROBE_STEP_MINUTES) {
    const slotRestriction = mergeBookingRestrictionForContext(
      baseRestriction,
      input.restriction_exceptions,
      input.venue_id,
      service.id,
      input.date,
      slotMin,
    );

    const perPersonGbp = resolveDepositPerPersonGbp(
      slotRestriction,
      input.deposit_legacy_amount_per_person_gbp,
    );
    // Card-hold passthrough (spec 6.3). The engine is audience-blind, so instead of
    // staff-only plumbing the slot carries two ALWAYS-populated fields (`deposit_type`,
    // `configured_deposit_per_person_gbp`) alongside the threshold-gated
    // `deposit_required`/`deposit_amount` pair, which stays the sole online gate.
    // Staff surfaces read the configured fields unconditionally.
    let depositType = resolveDepositType(slotRestriction, input.deposit_legacy_type);
    let configuredPerPersonGbp = perPersonGbp != null && perPersonGbp > 0 ? perPersonGbp : null;
    let depositRequired =
      configuredPerPersonGbp != null && depositThresholdMet(slotRestriction, input.party_size);
    if (depositType === 'card_hold') {
      if (!input.card_hold_deposits_enabled) {
        // Flag-off safety (spec 6.3): card_hold configured while the venue flag is off
        // resolves as no deposit. Charging instead would take money the guest was never shown.
        if (!cardHoldSafetyWarned) {
          console.warn(
            '[availability-engine] deposit_type card_hold configured but card_hold_deposits flag is off; treating as no deposit',
            { venue_id: input.venue_id, service_id: service.id },
          );
          cardHoldSafetyWarned = true;
        }
        depositType = 'charge';
        configuredPerPersonGbp = null;
        depositRequired = false;
      } else if (configuredPerPersonGbp == null) {
        // Zero-fee safety (spec 6.3): a card hold with fee <= 0 resolves as no deposit.
        if (!cardHoldSafetyWarned) {
          console.warn(
            '[availability-engine] deposit_type card_hold configured with no positive per-person fee; treating as no deposit',
            { venue_id: input.venue_id, service_id: service.id },
          );
          cardHoldSafetyWarned = true;
        }
        depositType = 'charge';
        depositRequired = false;
      }
    }
    const onlineRequiresDeposit = depositRequired ? true : (slotRestriction?.online_requires_deposit ?? true);

    if (slotRestriction) {
      const minAdvanceMs = slotRestriction.min_advance_minutes * 60 * 1000;
      const [sy, smo, sd] = input.date.split('-').map(Number);
      const slotDateTime = new Date(sy!, smo! - 1, sd!, Math.floor(slotMin / 60), slotMin % 60);
      if (slotDateTime.getTime() - input.now.getTime() < minAdvanceMs) {
        continue;
      }
    }

    const { blocked, mergedYield } = resolveSlotBlockState(
      input.blocks,
      input.venue_id,
      service.id,
      input.date,
      slotMin,
    );

    if (blocked) continue;

    const rule = resolveCapacityRule(input.capacity_rules, service.id, dayOfWeek, slotMin);
    const intervalMinutes =
      mergedYield.slotInterval ?? rule?.slot_interval_minutes ?? defaultRule?.slot_interval_minutes ?? 15;
    if ((slotMin - serviceStart) % intervalMinutes !== 0) continue;

    const bufferMinutes =
      mergedYield.buffer ?? rule?.buffer_minutes ?? defaultRule?.buffer_minutes ?? 15;
    const duration =
      mergedYield.duration ?? baseDuration;
    const totalOccupancy = duration + bufferMinutes;

    const slotEnd = slotMin + totalOccupancy;
    const slotTimeStr = minutesToTime(slotMin);
    const slotEndStr = minutesToTime(Math.min(slotEnd, timeToMinutes(effectiveService.end_time)));

    const maxCovers = mergedYield.overrideMaxCovers ?? rule?.max_covers_per_slot ?? 20;
    const maxBookings = mergedYield.maxBookings ?? rule?.max_bookings_per_slot ?? 10;

    const { covers: usedCovers, bookingCount } = countOverlapping(
      input.bookings,
      service.id,
      slotMin,
      slotEnd,
    );

    const availableCovers = Math.max(0, maxCovers - usedCovers);
    const availableBookings = Math.max(0, maxBookings - bookingCount);

    if (availableCovers < input.party_size || availableBookings < 1) continue;

    const limited = availableCovers <= input.party_size * 2 || availableBookings <= 2;

    const refundHours =
      typeof slotRestriction?.cancellation_notice_hours === 'number' && Number.isFinite(slotRestriction.cancellation_notice_hours)
        ? slotRestriction.cancellation_notice_hours
        : DEFAULT_RESTRICTION_WHEN_MISSING.cancellation_notice_hours!;

    slots.push({
      key: `${service.id}_${slotTimeStr}`,
      label: slotTimeStr,
      start_time: slotTimeStr,
      end_time: slotEndStr,
      service_name: service.name,
      service_id: service.id,
      available_covers: availableCovers,
      available_bookings: availableBookings,
      estimated_duration: duration,
      deposit_required: depositRequired,
      deposit_amount:
        depositRequired && configuredPerPersonGbp != null
          ? configuredPerPersonGbp * input.party_size
          : null,
      deposit_type: depositType,
      configured_deposit_per_person_gbp: configuredPerPersonGbp,
      online_requires_deposit: onlineRequiresDeposit,
      cancellation_notice_hours: refundHours,
      limited,
    });
  }

  return { slots, restriction: dayRestriction, largeParty: false, largePartyMsg: null };
}

/**
 * Main entry point: compute available slots for all active services on a date.
 * Pure function - all data must be pre-fetched and passed via EngineInput.
 */
export function computeAvailability(input: EngineInput): EngineServiceResult[] {
  const results: EngineServiceResult[] = [];

  const sortedServices = [...input.services].sort((a, b) => a.sort_order - b.sort_order);

  for (const service of sortedServices) {
    if (!service.is_active) continue;

    const { slots, restriction, largeParty, largePartyMsg } = generateServiceSlots(input, service);

    results.push({
      service,
      slots,
      restriction,
      large_party_redirect: largeParty,
      large_party_message: largePartyMsg,
    });
  }

  return results;
}
