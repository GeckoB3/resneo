import {
  computeAppointmentAvailability,
  validateExactAppointmentStart,
  type AppointmentAvailabilityResult,
  type AppointmentEngineInput,
  type PhantomBooking,
  type PractitionerSlot,
} from '@/lib/availability/appointment-engine';
import { minutesToTime, timeToMinutes } from '@/lib/availability';

/**
 * Chain availability: the starts at which several services fit back to back
 * with ONE person.
 *
 * The guest ticks every service before seeing any times, so the day view has
 * to answer "when can the whole visit start?" rather than "when can the first
 * service start?". The first segment's candidates come from the ordinary slot
 * generator; each later segment is then checked at the previous end plus
 * buffer with `validateExactAppointmentStart`, carrying the earlier segments
 * as phantom bookings. A start survives only when every segment fits.
 *
 * This is the same walk `create-multi-service` performs when it writes the
 * visit (one segment at a time, phantoms accumulating), so what this offers,
 * that route accepts.
 */

export interface ChainSegmentEngineInput {
  /**
   * Engine input whose `services` already carry this segment's EFFECTIVE
   * duration (variant, add-ons, staff custom duration, collective override).
   * Bookings, blocks and phantoms are shared across segments; only the service
   * differs.
   */
  input: AppointmentEngineInput;
  serviceId: string;
  /** Effective core duration, the same number the input's service carries. */
  durationMinutes: number;
  /** Buffer after this segment; the next one starts once it has elapsed. */
  bufferMinutes: number;
}

export interface ChainStart {
  /** "HH:mm" start of the first service. */
  start_time: string;
  /** "HH:mm" end of the last service (its buffer excluded). */
  end_time: string;
  /** First start to last end, inner buffers included. */
  span_minutes: number;
}

export interface ChainAvailabilityForPractitioner {
  practitioner: AppointmentAvailabilityResult['practitioners'][number] | null;
  starts: ChainStart[];
}

/** Minutes from the first start to the last end, inner buffers included. */
export function chainSegmentsSpanMinutes(
  segments: ReadonlyArray<{ durationMinutes: number; bufferMinutes: number }>,
): number {
  let total = 0;
  segments.forEach((seg, i) => {
    total += seg.durationMinutes;
    if (i < segments.length - 1) total += seg.bufferMinutes;
  });
  return total;
}

export function computeChainStartsForPractitioner(
  practitionerId: string,
  segments: ChainSegmentEngineInput[],
): ChainAvailabilityForPractitioner {
  const first = segments[0];
  if (!first) return { practitioner: null, starts: [] };

  const firstResult = computeAppointmentAvailability(first.input);
  const practitioner = firstResult.practitioners.find((p) => p.id === practitionerId) ?? null;
  if (!practitioner) return { practitioner: null, starts: [] };

  const candidates = practitioner.slots.filter((s) => s.service_id === first.serviceId);
  const span = chainSegmentsSpanMinutes(segments);
  const starts: ChainStart[] = [];

  for (const candidate of candidates) {
    const startMinutes = timeToMinutes(candidate.start_time.slice(0, 5));
    if (chainFitsFrom(practitionerId, segments, startMinutes)) {
      starts.push({
        start_time: candidate.start_time.slice(0, 5),
        end_time: minutesToTime(startMinutes + span),
        span_minutes: span,
      });
    }
  }

  return { practitioner, starts };
}

/**
 * Whether segments 1..n fit after a first segment starting at `startMinutes`.
 * Segment 0 is trusted: it came out of the slot generator.
 */
function chainFitsFrom(
  practitionerId: string,
  segments: ChainSegmentEngineInput[],
  startMinutes: number,
): boolean {
  const first = segments[0]!;
  const chainPhantoms: PhantomBooking[] = [
    {
      practitioner_id: practitionerId,
      start_time: minutesToTime(startMinutes),
      duration_minutes: first.durationMinutes,
      buffer_minutes: first.bufferMinutes,
    },
  ];
  let t = startMinutes + first.durationMinutes + first.bufferMinutes;

  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i]!;
    if (t >= 24 * 60) return false;
    const input: AppointmentEngineInput = {
      ...seg.input,
      phantomBookings: [...(seg.input.phantomBookings ?? []), ...chainPhantoms],
    };
    const check = validateExactAppointmentStart(input, practitionerId, seg.serviceId, minutesToTime(t));
    if (!check.ok) return false;
    chainPhantoms.push({
      practitioner_id: practitionerId,
      start_time: minutesToTime(t),
      duration_minutes: seg.durationMinutes,
      buffer_minutes: seg.bufferMinutes,
    });
    t += seg.durationMinutes + seg.bufferMinutes;
  }
  return true;
}

/**
 * Chain starts in the shape the day view already reads: one slot per start,
 * labelled with the FIRST service (so the flow's slot matching is unchanged)
 * and carrying the whole span as its duration.
 */
export function chainStartsToSlots(
  practitioner: { id: string; name: string },
  firstService: { id: string; name: string; price_pence: number | null },
  starts: ChainStart[],
): PractitionerSlot[] {
  return starts.map((s) => ({
    practitioner_id: practitioner.id,
    practitioner_name: practitioner.name,
    service_id: firstService.id,
    service_name: firstService.name,
    start_time: s.start_time,
    duration_minutes: s.span_minutes,
    price_pence: firstService.price_pence,
  }));
}
