/**
 * ResNeo availability: service engine (computeAvailability, fetchEngineInput)
 * plus legacy JSON helpers (getAvailableSlots) retained for tests and tooling.
 */

import type {
  AvailabilityConfig,
  AvailableSlot,
  BookingForAvailability,
  FixedIntervalsConfig,
  NamedSitting,
  NamedSittingsConfig,
  OpeningHours,
  OpeningHoursDayLegacy,
  OpeningHoursPeriod,
  VenueForAvailability,
} from '@/types/availability';

export {
  computeAvailability,
  computeEffectiveMinSlotCoverCap,
  resolveServiceForDate,
} from './engine';
export { fetchEngineInput, hasServiceConfig } from './fetch';

const DEFAULT_SITTING_DURATION_MINUTES = 90;
const CAPACITY_CONSUMING_STATUSES = ['Booked', 'Confirmed', 'Pending'];

/** Parse "HH:mm" or "HH:mm:ss" to minutes since midnight. */
export function timeToMinutes(t: string): number {
  const parts = t.trim().split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  return h * 60 + m;
}

/** Format minutes since midnight to "HH:mm". */
export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

/** Get day of week 0=Sun .. 6=Sat for date string YYYY-MM-DD (Europe/London not applied here; use date string as-is). */
export function getDayOfWeek(dateStr: string): number {
  const [y, mo, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  const date = new Date(y!, mo! - 1, d!);
  return date.getDay();
}

function isConfigFixed(c: AvailabilityConfig): c is FixedIntervalsConfig {
  return c.model === 'fixed_intervals';
}

function isConfigNamed(c: AvailabilityConfig): c is NamedSittingsConfig {
  return c.model === 'named_sittings';
}

/** Check if entire date is blocked. */
export function isDateBlocked(dateStr: string, config: AvailabilityConfig | null): boolean {
  if (!config?.blocked_dates) return false;
  return config.blocked_dates.includes(dateStr);
}

/** Check if a time range on a date is blocked by blocked_slots. */
export function isSlotBlocked(
  dateStr: string,
  startTime: string,
  endTime: string,
  config: AvailabilityConfig | null
): boolean {
  if (!config?.blocked_slots?.length) return false;
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  for (const block of config.blocked_slots) {
    if (block.date !== dateStr) continue;
    const blockStart = block.start_time != null ? timeToMinutes(block.start_time) : 0;
    const blockEnd = block.end_time != null ? timeToMinutes(block.end_time) : 24 * 60;
    if (startMin < blockEnd && endMin > blockStart) return true;
  }
  return false;
}

/** Normalize day config to array of periods (supports legacy single range or new periods format). */
export function getOpeningPeriodsForDay(openingHours: OpeningHours | null | undefined, day: number): OpeningHoursPeriod[] {
  if (!openingHours) return [];
  const key = String(day);
  const dayHours = openingHours[key];
  if (!dayHours) return [];
  if ('closed' in dayHours && dayHours.closed === true) return [];
  if ('periods' in dayHours && Array.isArray(dayHours.periods)) return dayHours.periods as OpeningHoursPeriod[];
  const legacy = dayHours as OpeningHoursDayLegacy;
  if (legacy.open && legacy.close) return [{ open: legacy.open, close: legacy.close }];
  return [];
}

/** Generate slot keys (start times) for a day from opening hours and interval. Supports multiple periods. */
function getFixedSlotKeys(
  openingHours: OpeningHours | null,
  dateStr: string,
  intervalMinutes: 15 | 30
): Array<{ start_time: string; end_time: string }> {
  const day = getDayOfWeek(dateStr);
  const periods = getOpeningPeriodsForDay(openingHours, day);
  const slots: Array<{ start_time: string; end_time: string }> = [];
  for (const range of periods) {
    const openMin = timeToMinutes(range.open);
    const closeMin = timeToMinutes(range.close);
    for (let m = openMin; m + intervalMinutes <= closeMin; m += intervalMinutes) {
      slots.push({
        start_time: minutesToTime(m),
        end_time: minutesToTime(m + intervalMinutes),
      });
    }
  }
  return slots;
}

/** Get max covers for a slot on the given day. */
function getMaxCoversForDay(config: FixedIntervalsConfig, day: number): number {
  const byDay = config.max_covers_by_day;
  if (!byDay) return 0;
  const key = String(day);
  if (byDay[key] != null) return byDay[key]!;
  const first = Object.values(byDay)[0];
  return typeof first === 'number' ? first : 0;
}

/** Get all slots for fixed-intervals model for one date (before capacity). */
function getFixedSlotsForDate(
  venue: VenueForAvailability,
  dateStr: string,
  config: FixedIntervalsConfig
): Array<{ key: string; start_time: string; end_time: string; max_covers: number }> {
  const day = getDayOfWeek(dateStr);
  const slots = getFixedSlotKeys(venue.opening_hours, dateStr, config.interval_minutes);
  const maxCovers = getMaxCoversForDay(config, day);
  return slots.map((s) => ({
    key: s.start_time,
    start_time: s.start_time,
    end_time: s.end_time,
    max_covers: maxCovers,
  }));
}

/** Get sittings for named-sittings model (same every day). */
function getNamedSittingsForDate(config: NamedSittingsConfig): Array<{ key: string; label: string; start_time: string; end_time: string; max_covers: number; sitting_id: string }> {
  return config.sittings.map((s) => ({
    key: s.id,
    label: s.name,
    start_time: s.start_time,
    end_time: s.end_time,
    max_covers: s.max_covers,
    sitting_id: s.id,
  }));
}

/** Bookings that consume capacity (Confirmed, Pending). */
function getConsumingBookings(bookings: BookingForAvailability[]): BookingForAvailability[] {
  return bookings.filter((b) => CAPACITY_CONSUMING_STATUSES.includes(b.status));
}

/** For fixed intervals: which slot keys does a booking at bookingTime span? (with turn time). */
function getSpannedSlotKeys(
  bookingTimeStr: string,
  config: FixedIntervalsConfig,
  slotKeys: Array<{ start_time: string; end_time: string }>
): string[] {
  const duration = config.turn_time_enabled
    ? Math.min(180, Math.max(60, config.sitting_duration_minutes ?? DEFAULT_SITTING_DURATION_MINUTES))
    : config.interval_minutes;
  const startMin = timeToMinutes(bookingTimeStr);
  const endMin = startMin + duration;
  const keys: string[] = [];
  for (const slot of slotKeys) {
    const slotStart = timeToMinutes(slot.start_time);
    const slotEnd = timeToMinutes(slot.end_time);
    if (slotStart < endMin && slotEnd > startMin) keys.push(slot.start_time);
  }
  return keys;
}

/** Compute booked covers per slot key for fixed-intervals (with turn-time). */
function getBookedCoversFixed(
  bookings: BookingForAvailability[],
  config: FixedIntervalsConfig,
  slotKeys: Array<{ start_time: string; end_time: string }>
): Record<string, number> {
  const consuming = getConsumingBookings(bookings);
  const booked: Record<string, number> = {};
  for (const slot of slotKeys) booked[slot.start_time] = 0;
  for (const b of consuming) {
    const spanned = getSpannedSlotKeys(b.booking_time, config, slotKeys);
    for (const key of spanned) {
      if (booked[key] != null) booked[key] += b.party_size;
    }
  }
  return booked;
}

/** For named sittings: which sitting does booking_time fall into? */
function getSittingKeyForBookingTime(bookingTime: string, sittings: NamedSitting[]): string | null {
  const min = timeToMinutes(bookingTime);
  for (const s of sittings) {
    const start = timeToMinutes(s.start_time);
    const end = timeToMinutes(s.end_time);
    if (min >= start && min < end) return s.id;
  }
  return null;
}

/** Compute booked covers per sitting for named-sittings model. */
function getBookedCoversNamed(
  bookings: BookingForAvailability[],
  sittings: NamedSitting[]
): Record<string, number> {
  const consuming = getConsumingBookings(bookings);
  const booked: Record<string, number> = {};
  for (const s of sittings) booked[s.id] = 0;
  for (const b of consuming) {
    const sittingId = getSittingKeyForBookingTime(b.booking_time, sittings);
    if (sittingId != null && booked[sittingId] != null) booked[sittingId] += b.party_size;
  }
  return booked;
}

/**
 * Main API: compute available slots/sittings for a venue on a date.
 * Pure function: no DB or side effects.
 */
export function getAvailableSlots(
  venue: VenueForAvailability,
  dateStr: string,
  bookings: BookingForAvailability[]
): AvailableSlot[] {
  const config = venue.availability_config;
  if (!config) return [];

  if (isDateBlocked(dateStr, config)) return [];

  if (isConfigFixed(config)) {
    const slots = getFixedSlotsForDate(venue, dateStr, config);
    if (slots.length === 0) return [];
    const slotKeys = slots.map((s) => ({ start_time: s.start_time, end_time: s.end_time }));
    const booked = getBookedCoversFixed(bookings, config, slotKeys);
    const result: AvailableSlot[] = [];
    for (const slot of slots) {
      if (isSlotBlocked(dateStr, slot.start_time, slot.end_time, config)) continue;
      let available: number;
      if (config.turn_time_enabled) {
        const spanned = getSpannedSlotKeys(slot.start_time, config, slotKeys);
        let minAvailable = Infinity;
        for (const key of spanned) {
          const s = slots.find((x) => x.start_time === key);
          if (!s) continue;
          const used = booked[key] ?? 0;
          minAvailable = Math.min(minAvailable, s.max_covers - used);
        }
        available = Math.max(0, minAvailable === Infinity ? 0 : minAvailable);
      } else {
        const used = booked[slot.key] ?? 0;
        available = Math.max(0, slot.max_covers - used);
      }
      result.push({
        key: slot.key,
        label: slot.start_time,
        start_time: slot.start_time,
        end_time: slot.end_time,
        available_covers: available,
      });
    }
    return result;
  }

  if (isConfigNamed(config)) {
    const sittings = getNamedSittingsForDate(config);
    const booked = getBookedCoversNamed(bookings, config.sittings);
    const result: AvailableSlot[] = [];
    for (const s of sittings) {
      if (isSlotBlocked(dateStr, s.start_time, s.end_time, config)) continue;
      const used = booked[s.key] ?? 0;
      const available = Math.max(0, s.max_covers - used);
      result.push({
        key: s.key,
        label: s.label,
        start_time: s.start_time,
        end_time: s.end_time,
        available_covers: available,
        sitting_id: s.sitting_id,
      });
    }
    return result;
  }

  return [];
}

/**
 * For turn-time model: minimum available covers across slots spanned by a booking at slotKey.
 * Returns that minimum (or 0 if any spanned slot is fully booked/unavailable).
 */
export function getAvailableCoversForSlotWithTurnTime(
  venue: VenueForAvailability,
  dateStr: string,
  bookings: BookingForAvailability[],
  slotKey: string
): number {
  const config = venue.availability_config;
  if (!config || !isConfigFixed(config)) return 0;
  const slots = getFixedSlotsForDate(venue, dateStr, config);
  const slotKeys = slots.map((s) => ({ start_time: s.start_time, end_time: s.end_time }));
  const spanned = getSpannedSlotKeys(slotKey, config, slotKeys);
  const booked = getBookedCoversFixed(bookings, config, slotKeys);
  let minAvailable = Infinity;
  for (const key of spanned) {
    const slot = slots.find((s) => s.start_time === key);
    if (!slot || isSlotBlocked(dateStr, slot.start_time, slot.end_time, config)) return 0;
    const used = booked[key] ?? 0;
    const available = slot.max_covers - used;
    minAvailable = Math.min(minAvailable, available);
  }
  return Math.max(0, minAvailable === Infinity ? 0 : minAvailable);
}
