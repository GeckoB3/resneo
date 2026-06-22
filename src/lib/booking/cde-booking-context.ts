/**
 * Staff booking detail: human-readable labels for C/D/E rows (Sprint 1.4).
 *
 * `title`/`subtitle` are the original, always-present fields (backward-compatible).
 * The remaining fields are **optional enrichment** added per model where the data
 * is cheaply available — event ticket-line breakdown, class roster/spots, resource
 * duration. Every enrichment query is best-effort: a failed/empty lookup leaves the
 * field `undefined` and never throws, so existing callers that read only
 * `{ title, subtitle }` are unaffected.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingModel } from '@/types/booking-models';
import { getResourceBookingEmailLabels } from '@/lib/booking/resource-booking-email-labels';
import { isCapacityConsumingStatus } from '@/lib/availability/capacity-status';

/** One ticket tier on an event booking (snapshot label + quantity). */
export interface CdeTicketLine {
  label: string | null;
  quantity: number;
}

/** Roster fill for a class instance: live booked seats vs capacity (null = uncapped/unknown). */
export interface CdeRoster {
  booked: number;
  capacity: number | null;
}

export interface CdeBookingContext {
  inferred_model: BookingModel;
  title: string;
  subtitle?: string | null;
  /** Event only — per-tier ticket lines (e.g. Adult ×2, Child ×1). */
  ticket_lines?: CdeTicketLine[];
  /** Event only — one-line ticket summary, e.g. "2× Adult, 1× Child". */
  ticket_summary?: string | null;
  /** Event only — total tickets across all lines. */
  ticket_total_quantity?: number | null;
  /** Class only — roster fill for the session. */
  roster?: CdeRoster;
  /** Class only — one-line roster summary, e.g. "8 / 12 booked" or "8 booked". */
  roster_summary?: string | null;
  /** Resource (and any timed model) — booked duration in minutes when derivable. */
  duration_minutes?: number | null;
}

type BookingLike = {
  id?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  party_size?: number | null;
  status?: string | null;
  booking_time?: string | null;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
};

/** "HH:MM[:SS]" → minutes since midnight, or null if unparseable. */
function hmToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/**
 * Booked duration in minutes from start/end wall-clock, wrapping a single midnight
 * crossing. Returns null when either bound is missing or the result is non-positive.
 */
function durationFromBooking(booking: BookingLike): number | null {
  const start = hmToMinutes(booking.booking_time);
  const endRaw = booking.booking_end_time ?? booking.estimated_end_time ?? null;
  // estimated_end_time may be a full ISO string; pull the time component if so.
  const endHm =
    typeof endRaw === 'string' && endRaw.includes('T') ? endRaw.split('T')[1] ?? endRaw : endRaw;
  const end = hmToMinutes(endHm);
  if (start == null || end == null) return null;
  let diff = end - start;
  if (diff < 0) diff += 24 * 60;
  return diff > 0 ? diff : null;
}

/** "2× Adult, 1× Child" from ticket lines (drops blank labels / zero quantities). */
function summariseTicketLines(lines: CdeTicketLine[]): string | null {
  const parts = lines
    .filter((l) => l.quantity > 0)
    .map((l) => `${l.quantity}× ${l.label?.trim() || 'Ticket'}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

export async function resolveCdeBookingContext(
  supabase: Pick<SupabaseClient, 'from'>,
  booking: BookingLike,
): Promise<CdeBookingContext | null> {
  const ex = booking.experience_event_id;
  if (ex) {
    const { data: ev } = await supabase
      .from('experience_events')
      .select('name, end_time')
      .eq('id', ex)
      .maybeSingle();
    const end = ev?.end_time != null ? String(ev.end_time).slice(0, 5) : null;

    // Per-tier ticket lines for this booking (best-effort).
    let ticket_lines: CdeTicketLine[] | undefined;
    if (typeof booking.id === 'string' && booking.id) {
      const { data: lineRows } = await supabase
        .from('booking_ticket_lines')
        .select('label, quantity')
        .eq('booking_id', booking.id);
      if (Array.isArray(lineRows) && lineRows.length > 0) {
        ticket_lines = lineRows.map((l) => ({
          label: (l as { label?: string | null }).label ?? null,
          quantity: Number((l as { quantity?: number }).quantity ?? 0),
        }));
      }
    }
    const ticket_summary = ticket_lines ? summariseTicketLines(ticket_lines) : null;
    const ticket_total_quantity = ticket_lines
      ? ticket_lines.reduce((sum, l) => sum + (l.quantity > 0 ? l.quantity : 0), 0)
      : null;

    return {
      inferred_model: 'event_ticket',
      title: (ev as { name?: string } | null)?.name ?? 'Event',
      subtitle: end ? `Ends ${end}` : null,
      ...(ticket_lines ? { ticket_lines } : {}),
      ...(ticket_summary ? { ticket_summary } : {}),
      ...(ticket_total_quantity != null ? { ticket_total_quantity } : {}),
    };
  }

  const ci = booking.class_instance_id;
  if (ci) {
    const { data: inst } = await supabase
      .from('class_instances')
      .select('start_time, class_type_id, capacity_override')
      .eq('id', ci)
      .maybeSingle();
    const ctId = (inst as { class_type_id?: string } | null)?.class_type_id;
    let title = 'Class';
    let typeCapacity: number | null = null;
    if (ctId) {
      const { data: ct } = await supabase
        .from('class_types')
        .select('name, capacity')
        .eq('id', ctId)
        .maybeSingle();
      title = (ct as { name?: string } | null)?.name ?? title;
      const capRaw = (ct as { capacity?: number | null } | null)?.capacity;
      typeCapacity = typeof capRaw === 'number' ? capRaw : null;
    }
    const st = (inst as { start_time?: string } | null)?.start_time;
    const startStr = st != null ? String(st).slice(0, 5) : null;

    // Roster fill: live booked seats on the instance vs capacity (best-effort).
    let roster: CdeRoster | undefined;
    let roster_summary: string | null = null;
    {
      const overrideRaw = (inst as { capacity_override?: number | null } | null)?.capacity_override;
      const capacity =
        typeof overrideRaw === 'number' ? overrideRaw : typeCapacity;
      const { data: bookingRows } = await supabase
        .from('bookings')
        .select('party_size, status')
        .eq('class_instance_id', ci);
      if (Array.isArray(bookingRows)) {
        let booked = 0;
        for (const b of bookingRows) {
          if (!isCapacityConsumingStatus((b as { status?: string }).status)) continue;
          booked += Number((b as { party_size?: number }).party_size ?? 1);
        }
        roster = { booked, capacity: capacity ?? null };
        roster_summary =
          capacity != null ? `${booked} / ${capacity} booked` : `${booked} booked`;
      }
    }

    return {
      inferred_model: 'class_session',
      title,
      subtitle: startStr ? `Starts ${startStr}` : null,
      ...(roster ? { roster } : {}),
      ...(roster_summary ? { roster_summary } : {}),
    };
  }

  const rid = booking.resource_id;
  if (rid) {
    const { resourceName, hostCalendarName } = await getResourceBookingEmailLabels(supabase, rid);
    const duration_minutes = durationFromBooking(booking);
    return {
      inferred_model: 'resource_booking',
      title: resourceName ?? 'Resource',
      subtitle: hostCalendarName ?? null,
      ...(duration_minutes != null ? { duration_minutes } : {}),
    };
  }

  return null;
}
