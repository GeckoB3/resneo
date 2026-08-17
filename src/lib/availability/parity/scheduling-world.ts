/**
 * Stage 0b: one scheduling world, driven through every consumer that resolves hours.
 *
 * The point of this module is that a single fixture describes a venue + calendar +
 * blocks configuration ONCE, and the probes below feed it to each engine through the
 * same adapters production uses. Where two consumers disagree about that one world,
 * the matrix test records the disagreement as an explicit expectation rather than
 * letting it hide.
 *
 * Two rules this harness exists to enforce, both from the resolver plan:
 *
 *  1. **Probes return ordered start-time lists, not booleans.** A boolean matrix passes
 *     straight through slot re-anchoring without noticing, and re-anchoring is exactly
 *     what decisions (A) and Stage 3 move. See plan §2.7.
 *  2. **Read and write are probed as a pair.** `appointmentStarts` vs
 *     `appointmentAcceptsStart`, and the engines vs `venueWriteGate`. A read-only matrix
 *     cannot see "guest is offered the slot, create rejects it", which is live today for
 *     classes and events on a weekly-closed weekday. See plan §1.2 items 15 and 16.
 *
 * Everything here is pure: no Supabase client, no clock dependence. Fixtures use a
 * far-future date so the past-slot filter never fires, and no `venueTimezone` is set,
 * which keeps the engines on their server-local test path.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md Stage 0b.
 */

import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type {
  AppointmentService,
  ClassInstance,
  ClassType,
  ExperienceEvent,
  Practitioner,
  PractitionerService,
  VenueResource,
  WorkingHours,
} from '@/types/booking-models';
import { getDayOfWeek } from '@/lib/availability/engine';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import {
  computeAppointmentAvailability,
  validateExactAppointmentStart,
  type AppointmentBooking,
  type AppointmentEngineInput,
  type PractitionerCalendarBlockedRange,
} from '@/lib/availability/appointment-engine';
import { computeClassAvailability } from '@/lib/availability/class-session-engine';
import { computeEventAvailability } from '@/lib/availability/event-ticket-engine';
import {
  buildResourceEngineInputFromParts,
  computeResourceAvailability,
} from '@/lib/availability/resource-booking-engine';
import {
  resolveVenueWideAllowedMinuteRanges,
  scheduledInstanceRejectBookingWindow,
  venueWideBlocksRejectBookingWindow,
} from '@/lib/availability/venue-wide-business-hours';

export const VENUE_ID = 'venue-1';
export const CALENDAR_ID = 'cal-1';
export const SERVICE_ID = 'svc-1';
export const RESOURCE_ID = 'res-1';

/** A weekday's periods, in the numeric-string key shape `getOpeningPeriodsForDay` reads. */
export type DayPeriods = Array<{ open: string; close: string }>;

export interface SchedulingWorld {
  /** Short label used as the matrix row name. */
  name: string;
  /** YYYY-MM-DD. Always far-future so no clock filter applies. */
  date: string;
  /**
   * `null` means the venue has no weekly hours at all (UNRESTRICTED). An object with the
   * date's own weekday absent means "configured, but closed this weekday", which is a
   * different state and the one the plan's §2.3 step 1 insists on distinguishing.
   */
  venueOpeningHours: OpeningHours | null;
  /** Rows exactly as `availability_blocks` stores them. */
  venueBlocks: AvailabilityBlock[];
  /** The staff/resource calendar's own weekly shape. */
  workingHours: WorkingHours;
  breakTimes?: Array<{ start: string; end: string }>;
  breakTimesByDay?: WorkingHours | null;
  daysOff?: string[];
  /** Ad-hoc blocks, partial leave and projected resource ranges, as the engine sees them. */
  blockedRanges?: PractitionerCalendarBlockedRange[];
  /** Service shape. Interval defaults to the duration, which keeps fixture grids readable. */
  durationMinutes?: number;
  bufferMinutes?: number;
  intervalMinutes?: number;
  /** The fixed window used for the class / event / write-gate probes. */
  instance?: { start: string; end: string };
}

const DEFAULT_DURATION = 30;
const DEFAULT_INSTANCE = { start: '19:00', end: '20:00' };

function dayKey(dateStr: string): string {
  return String(getDayOfWeek(dateStr));
}

/** Weekly opening hours for the date's own weekday. Use for "venue open on this day". */
export function openOn(dateStr: string, periods: DayPeriods): OpeningHours {
  return { [dayKey(dateStr)]: { periods } } as unknown as OpeningHours;
}

/**
 * Opening hours that are *configured* but have no periods for this date's weekday, i.e. the
 * venue trades, just not today. Configured on the following weekday so the object is non-empty.
 */
export function configuredButClosedOn(dateStr: string, periods: DayPeriods): OpeningHours {
  const other = String((getDayOfWeek(dateStr) + 1) % 7);
  return { [other]: { periods } } as unknown as OpeningHours;
}

export function block(partial: Partial<AvailabilityBlock> & { block_type: string }): AvailabilityBlock {
  return {
    id: `blk-${Math.random().toString(36).slice(2, 8)}`,
    venue_id: VENUE_ID,
    service_id: null,
    date_start: '2030-06-05',
    date_end: '2030-06-05',
    time_start: null,
    time_end: null,
    override_periods: null,
    reason: null,
    ...partial,
  } as unknown as AvailabilityBlock;
}

function practitioner(world: SchedulingWorld): Practitioner {
  return {
    id: CALENDAR_ID,
    name: 'Parity calendar',
    is_active: true,
    working_hours: world.workingHours,
    break_times: world.breakTimes ?? [],
    break_times_by_day: world.breakTimesByDay ?? null,
    days_off: world.daysOff ?? [],
  } as unknown as Practitioner;
}

function service(world: SchedulingWorld): AppointmentService {
  return {
    id: SERVICE_ID,
    name: 'Parity service',
    duration_minutes: world.durationMinutes ?? DEFAULT_DURATION,
    buffer_minutes: world.bufferMinutes ?? 0,
    booking_interval_minutes: world.intervalMinutes ?? world.durationMinutes ?? DEFAULT_DURATION,
    is_active: true,
  } as unknown as AppointmentService;
}

const PRACTITIONER_SERVICES: PractitionerService[] = [
  {
    id: 'ps-1',
    practitioner_id: CALENDAR_ID,
    service_id: SERVICE_ID,
    custom_duration_minutes: null,
    custom_price_pence: null,
  },
];

/**
 * The appointment engine does NOT take `availability_blocks`. It takes the legacy
 * `VenueOpeningException[]` shape, derived by `blocksToVenueOpeningExceptions`. Routing
 * fixtures through that adapter is deliberate: the adapter's lossiness (it discards
 * `time_start`/`time_end` on closures, and drops amended rows with empty periods) is one
 * of the divergences this matrix exists to pin. See plan §1.2 items 3 and 17.
 */
export function toAppointmentInput(
  world: SchedulingWorld,
  existingBookings: AppointmentBooking[] = [],
): AppointmentEngineInput {
  return {
    date: world.date,
    practitioners: [practitioner(world)],
    services: [service(world)],
    practitionerServices: PRACTITIONER_SERVICES,
    existingBookings,
    practitionerBlockedRanges: world.blockedRanges ?? [],
    venueOpeningHours: world.venueOpeningHours,
    venueWideBlocks: world.venueBlocks,
  };
}

/** Ordered start times the appointment engine offers, as "HH:mm". */
export function appointmentStarts(world: SchedulingWorld): string[] {
  const result = computeAppointmentAvailability(toAppointmentInput(world));
  const prac = result.practitioners.find((p) => p.id === CALENDAR_ID);
  return (prac?.slots ?? []).map((s) => s.start_time);
}

/** The write gate for one exact start. Pairs with {@link appointmentStarts}. */
export function appointmentAcceptsStart(world: SchedulingWorld, startHhMm: string): { ok: boolean; reason?: string } {
  return validateExactAppointmentStart(toAppointmentInput(world), CALENDAR_ID, SERVICE_ID, startHhMm);
}

function instanceWindow(world: SchedulingWorld): { start: string; end: string } {
  return world.instance ?? DEFAULT_INSTANCE;
}

/** True when the class engine offers its single instance for this world. */
export function classOffered(world: SchedulingWorld): boolean {
  const win = instanceWindow(world);
  // Classes are scheduled as start + duration, so a past-midnight window has to be turned
  // back into a positive duration here. Without this the fixture hands the engine a
  // negative duration and the probe reports "not offered" for a harness bug.
  const startMin = timeToMinutes(win.start);
  const rawEndMin = timeToMinutes(win.end);
  const duration = (rawEndMin <= startMin ? rawEndMin + 24 * 60 : rawEndMin) - startMin;
  const classTypes = [
    {
      id: 'ct-1',
      venue_id: VENUE_ID,
      name: 'Parity class',
      duration_minutes: duration,
      capacity: 10,
      is_active: true,
      payment_requirement: 'none',
      price_pence: 0,
    },
  ] as unknown as ClassType[];
  const instances = [
    {
      id: 'ci-1',
      class_type_id: 'ct-1',
      instance_date: world.date,
      start_time: win.start,
      capacity_override: null,
      is_cancelled: false,
    },
  ] as unknown as ClassInstance[];

  const slots = computeClassAvailability({
    date: world.date,
    classTypes,
    instances,
    bookedByInstance: {},
    venueWideBlocks: world.venueBlocks,
    venueOpeningHours: world.venueOpeningHours,
  });
  return slots.length > 0;
}

/** True when the event engine offers its single event for this world. */
export function eventOffered(world: SchedulingWorld): boolean {
  const win = instanceWindow(world);
  const events = [
    {
      id: 'ev-1',
      venue_id: VENUE_ID,
      name: 'Parity event',
      event_date: world.date,
      start_time: win.start,
      end_time: win.end,
      capacity: 20,
      is_active: true,
      parent_event_id: null,
      payment_requirement: 'none',
    },
  ] as unknown as ExperienceEvent[];

  const slots = computeEventAvailability({
    date: world.date,
    events,
    ticketTypes: [],
    bookedByEvent: {},
    bookedByTicketType: {},
    venueWideBlocks: world.venueBlocks,
    venueOpeningHours: world.venueOpeningHours,
  });
  return slots.length > 0;
}

/**
 * The resource calendar carries the world's own working hours as `availability_hours`, with
 * no host. That isolates the venue layer, which is the layer this matrix is about; the
 * host-composition fixtures set `display_on_calendar_id` explicitly.
 */
export function resourceStarts(world: SchedulingWorld, host?: VenueResource['host_calendar']): string[] {
  const duration = world.durationMinutes ?? DEFAULT_DURATION;
  const resource = {
    id: RESOURCE_ID,
    venue_id: VENUE_ID,
    name: 'Parity resource',
    resource_type: null,
    min_booking_minutes: duration,
    max_booking_minutes: duration,
    slot_interval_minutes: world.intervalMinutes ?? duration,
    price_per_slot_pence: null,
    payment_requirement: 'none',
    deposit_amount_pence: null,
    availability_hours: world.workingHours,
    is_active: true,
    sort_order: 0,
    created_at: '2030-01-01T00:00:00Z',
    display_on_calendar_id: host ? CALENDAR_ID : null,
    host_calendar: host ?? null,
  } as unknown as VenueResource;

  const input = buildResourceEngineInputFromParts({
    date: world.date,
    resources: [resource],
    conflictResources: [resource],
    bookingsForDate: [],
    venueOpeningHours: world.venueOpeningHours,
    venueWideBlocks: world.venueBlocks,
    skipPastSlotFilter: true,
  });
  const results = computeResourceAvailability(input, duration);
  return (results[0]?.slots ?? []).map((s) => s.start_time);
}

/** A host calendar row shaped as `attachHostCalendarsToResources` builds it. */
export function hostCalendar(world: SchedulingWorld): NonNullable<VenueResource['host_calendar']> {
  return {
    id: CALENDAR_ID,
    working_hours: world.workingHours,
    days_off: world.daysOff ?? [],
    break_times: world.breakTimes ?? [],
    break_times_by_day: world.breakTimesByDay ?? null,
  } as unknown as NonNullable<VenueResource['host_calendar']>;
}

/**
 * The `booking/create` venue gate, reached at route.ts:1031 (group session), :1298 (event
 * ticket) and :1562 (resource). Returns a user-facing message, or null when it accepts.
 */
export function venueWriteGate(world: SchedulingWorld, startHhMm?: string, endHhMm?: string): string | null {
  const win = instanceWindow(world);
  return venueWideBlocksRejectBookingWindow(
    world.venueOpeningHours,
    world.date,
    startHhMm ?? win.start,
    endHhMm ?? win.end,
    world.venueBlocks,
  );
}

/**
 * The `booking/create` gate for a SCHEDULED INSTANCE (group session at :1039, event ticket
 * at :1307). Split from the slot-generation gate in Stage 2, so the pair can be asserted
 * against the class and event listings rather than against the appointment grid.
 */
export function instanceWriteGate(world: SchedulingWorld, startHhMm?: string, endHhMm?: string): string | null {
  const win = instanceWindow(world);
  return scheduledInstanceRejectBookingWindow(
    world.venueOpeningHours,
    world.date,
    startHhMm ?? win.start,
    endHhMm ?? win.end,
    world.venueBlocks,
  );
}

/** The venue resolver's own answer, as `kind` plus readable ranges. */
export function venueResolution(world: SchedulingWorld): { kind: string; ranges: string[] } {
  const res = resolveVenueWideAllowedMinuteRanges(world.venueOpeningHours, world.date, world.venueBlocks);
  if (res.kind !== 'allowed') return { kind: res.kind, ranges: [] };
  return {
    kind: res.kind,
    ranges: res.ranges.map((r) => `${minutesToTime(r.start)}-${minutesToTime(r.end)}`),
  };
}
