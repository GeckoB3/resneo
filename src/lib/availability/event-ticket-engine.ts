/**
 * Model C: Event / experience ticket availability engine.
 * Given events + ticket types + existing bookings for a date,
 * returns remaining capacity per event and per ticket type.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { ExperienceEvent, EventTicketType } from '@/types/booking-models';
import { timeToMinutes } from '@/lib/availability';
import { CAPACITY_CONSUMING_STATUSES } from '@/lib/availability/capacity-status';
import {
  resolveVenueWideAllowedMinuteRanges,
  isMinuteSubintervalCoveredByRanges,
  isWeeklyScheduleClosedForDate,
} from '@/lib/availability/venue-wide-business-hours';
import {
  rowsToVenueWideBlocks,
  venueWideBlocksQueryForDate,
  venueWideBlocksQueryForRange,
} from '@/lib/availability/venue-wide-blocks-fetch';
import { entityBookingWindowFromRow, isGuestBookingDateAllowed } from '@/lib/booking/entity-booking-window';
import { venueLocalDateTimeToUtcMs } from '@/lib/venue/venue-local-clock';

// Types

export interface EventEngineInput {
  date: string;
  events: ExperienceEvent[];
  ticketTypes: EventTicketType[];
  /** Total booked quantity per event (all statuses that consume capacity). */
  bookedByEvent: Record<string, number>;
  /** Total booked quantity per ticket type. */
  bookedByTicketType: Record<string, number>;
  /** Venue-wide Business Hours blocks (closures / amended hours) for `date`. */
  venueWideBlocks?: AvailabilityBlock[];
  venueOpeningHours?: OpeningHours | null;
}

export interface EventAvailabilitySlot {
  event_id: string;
  /** Groups recurring / multi-date occurrences; `parent_event_id ?? event_id`. */
  series_key: string;
  parent_event_id: string | null;
  event_name: string;
  event_date: string;
  start_time: string;
  end_time: string;
  description: string | null;
  image_url: string | null;
  total_capacity: number;
  remaining_capacity: number;
  payment_requirement: 'none' | 'deposit' | 'full_payment';
  deposit_amount_pence: number | null;
  /** Hours before start for deposit / prepayment refund (from `experience_events`). */
  cancellation_notice_hours: number;
  ticket_types: Array<{
    id: string;
    name: string;
    price_pence: number;
    capacity: number | null;
    remaining: number;
    sort_order: number;
  }>;
}

// Core engine

export function computeEventAvailability(
  input: EventEngineInput,
  guestCtx?: { venueTimezone: string; referenceNowMs?: number },
): EventAvailabilitySlot[] {
  const { events, ticketTypes, bookedByEvent, bookedByTicketType, venueWideBlocks, venueOpeningHours } = input;
  const ticketsByEvent = new Map<string, EventTicketType[]>();

  for (const tt of ticketTypes) {
    const list = ticketsByEvent.get(tt.event_id) ?? [];
    list.push(tt);
    ticketsByEvent.set(tt.event_id, list);
  }

  const results: EventAvailabilitySlot[] = [];

  for (const event of events) {
    if (!event.is_active) continue;

    if (venueWideBlocks != null) {
      const res = resolveVenueWideAllowedMinuteRanges(venueOpeningHours ?? null, event.event_date, venueWideBlocks);
      const weeklyOffDayNoBlocks =
        res.kind === 'closed' &&
        isWeeklyScheduleClosedForDate(venueOpeningHours ?? null, event.event_date, venueWideBlocks);
      if (res.kind === 'closed' && !weeklyOffDayNoBlocks) continue;
      if (res.kind === 'allowed') {
        const start = timeToMinutes(String(event.start_time).slice(0, 5));
        const end = timeToMinutes(String(event.end_time).slice(0, 5));
        if (!isMinuteSubintervalCoveredByRanges(start, end, res.ranges)) continue;
      }
    }

    if (guestCtx) {
      const w = entityBookingWindowFromRow(event as unknown as Record<string, unknown>);
      if (!isGuestBookingDateAllowed(event.event_date, w, guestCtx.venueTimezone, guestCtx.referenceNowMs)) {
        continue;
      }
      const startMs = venueLocalDateTimeToUtcMs(
        event.event_date,
        String(event.start_time).slice(0, 5),
        guestCtx.venueTimezone,
      );
      const nowMs = guestCtx.referenceNowMs ?? Date.now();
      const minNoticeMs = Math.max(0, w.min_booking_notice_hours) * 60 * 60 * 1000;
      if (startMs < nowMs + minNoticeMs) continue;
    }

    const totalBooked = bookedByEvent[event.id] ?? 0;
    const remaining = Math.max(0, event.capacity - totalBooked);
    const eventTickets = ticketsByEvent.get(event.id) ?? [];

    const ticketResults = eventTickets
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((tt) => {
        const ttBooked = bookedByTicketType[tt.id] ?? 0;
        const ttCapacity = tt.capacity ?? event.capacity;
        return {
          id: tt.id,
          name: tt.name,
          price_pence: tt.price_pence,
          capacity: tt.capacity,
          remaining: Math.min(remaining, Math.max(0, ttCapacity - ttBooked)),
          sort_order: tt.sort_order,
        };
      });

    const seriesKey = event.parent_event_id ?? event.id;
    const refundHours = entityBookingWindowFromRow(event as unknown as Record<string, unknown>).cancellation_notice_hours;
    results.push({
      event_id: event.id,
      series_key: seriesKey,
      parent_event_id: event.parent_event_id,
      event_name: event.name,
      event_date: event.event_date,
      start_time: event.start_time,
      end_time: event.end_time,
      description: event.description,
      image_url: event.image_url,
      total_capacity: event.capacity,
      remaining_capacity: remaining,
      payment_requirement: (event.payment_requirement as 'none' | 'deposit' | 'full_payment') ?? 'none',
      deposit_amount_pence: (event.deposit_amount_pence as number | null) ?? null,
      cancellation_notice_hours: refundHours,
      ticket_types: ticketResults,
    });
  }

  return results;
}

// Fetcher

export async function fetchEventInput(params: {
  supabase: SupabaseClient;
  venueId: string;
  date: string;
}): Promise<EventEngineInput> {
  const { supabase, venueId, date } = params;

  const [eventsRes, ticketTypesRes, bookingsRes, venueRes, venueBlocksRes] = await Promise.all([
    supabase
      .from('experience_events')
      .select('*')
      .eq('venue_id', venueId)
      .eq('event_date', date)
      .eq('is_active', true)
      .order('start_time'),
    supabase
      .from('event_ticket_types')
      .select('*')
      .in(
        'event_id',
        (await supabase
          .from('experience_events')
          .select('id')
          .eq('venue_id', venueId)
          .eq('event_date', date)
          .eq('is_active', true)
        ).data?.map((e) => e.id) ?? []
      )
      .order('sort_order'),
    supabase
      .from('bookings')
      .select('id, experience_event_id, party_size, status')
      .eq('venue_id', venueId)
      .eq('booking_date', date)
      .not('experience_event_id', 'is', null)
      .in('status', CAPACITY_CONSUMING_STATUSES),
    supabase.from('venues').select('opening_hours').eq('id', venueId).maybeSingle(),
    venueWideBlocksQueryForDate(supabase, venueId, date),
  ]);

  const events = (eventsRes.data ?? []) as ExperienceEvent[];
  const ticketTypes = (ticketTypesRes.data ?? []) as EventTicketType[];

  const bookedByEvent: Record<string, number> = {};
  const bookedByTicketType: Record<string, number> = {};

  const bookingIds = (bookingsRes.data ?? []).map((b) => b.id);
  let ticketLines: Array<{ booking_id: string; ticket_type_id: string | null; quantity: number }> = [];
  if (bookingIds.length > 0) {
    const { data } = await supabase
      .from('booking_ticket_lines')
      .select('booking_id, ticket_type_id, quantity')
      .in('booking_id', bookingIds);
    ticketLines = data ?? [];
  }

  for (const b of bookingsRes.data ?? []) {
    const eventId = b.experience_event_id!;
    bookedByEvent[eventId] = (bookedByEvent[eventId] ?? 0) + (b.party_size ?? 0);
  }

  for (const tl of ticketLines) {
    if (tl.ticket_type_id) {
      bookedByTicketType[tl.ticket_type_id] = (bookedByTicketType[tl.ticket_type_id] ?? 0) + tl.quantity;
    }
  }

  if (venueBlocksRes.error) {
    console.warn('[fetchEventInput] availability_blocks:', venueBlocksRes.error.message);
  }

  const venueOpeningHours = (venueRes.data?.opening_hours as OpeningHours | null) ?? null;
  const venueWideBlocks = rowsToVenueWideBlocks(venueBlocksRes.data);

  return {
    date,
    events,
    ticketTypes,
    bookedByEvent,
    bookedByTicketType,
    venueWideBlocks,
    venueOpeningHours,
  };
}

// Offerings (multi-day): group occurrences by series for event-first UIs

export interface EventOfferingSummary {
  series_key: string;
  event_name: string;
  description: string | null;
  image_url: string | null;
  /** Distinct dates with at least one bookable occurrence. */
  dates: string[];
  /** Bookable occurrences in range for this series. */
  occurrence_count: number;
  /** Minimum ticket price across occurrences (for "from £x" labels). */
  from_price_pence: number | null;
  payment_requirement: 'none' | 'deposit' | 'full_payment';
  deposit_amount_pence: number | null;
}

function minTicketPricePence(slot: EventAvailabilitySlot): number | null {
  const prices = slot.ticket_types.map((t) => t.price_pence).filter((p) => p > 0);
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

export function buildEventOfferingSummaries(slots: EventAvailabilitySlot[]): EventOfferingSummary[] {
  const bySeries = new Map<string, EventAvailabilitySlot[]>();
  for (const s of slots) {
    if (s.remaining_capacity <= 0) continue;
    const arr = bySeries.get(s.series_key) ?? [];
    arr.push(s);
    bySeries.set(s.series_key, arr);
  }
  const out: EventOfferingSummary[] = [];
  for (const [, arr] of bySeries) {
    arr.sort(
      (a, b) => a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time),
    );
    const first = arr[0]!;
    const dates = [...new Set(arr.map((x) => x.event_date))].sort();
    let fromPrice: number | null = null;
    for (const slot of arr) {
      const m = minTicketPricePence(slot);
      if (m == null) continue;
      fromPrice = fromPrice == null ? m : Math.min(fromPrice, m);
    }
    out.push({
      series_key: first.series_key,
      event_name: first.event_name,
      description: first.description,
      image_url: first.image_url,
      dates,
      occurrence_count: arr.length,
      from_price_pence: fromPrice,
      payment_requirement: first.payment_requirement,
      deposit_amount_pence: first.deposit_amount_pence,
    });
  }
  out.sort((a, b) => a.event_name.localeCompare(b.event_name));
  return out;
}

/**
 * Load events, ticket types, and bookings across a date range (inclusive).
 * Use with {@link computeEventAvailability} for event-first booking flows.
 */
export async function fetchEventInputForRange(params: {
  supabase: SupabaseClient;
  venueId: string;
  fromDate: string;
  toDate: string;
}): Promise<EventEngineInput> {
  const { supabase, venueId, fromDate, toDate } = params;

  const [eventsRes, venueRes, venueBlocksRes] = await Promise.all([
    supabase
      .from('experience_events')
      .select('*')
      .eq('venue_id', venueId)
      .gte('event_date', fromDate)
      .lte('event_date', toDate)
      .eq('is_active', true)
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true }),
    supabase.from('venues').select('opening_hours').eq('id', venueId).maybeSingle(),
    venueWideBlocksQueryForRange(supabase, venueId, fromDate, toDate),
  ]);

  const events = (eventsRes.data ?? []) as ExperienceEvent[];
  const eventIds = events.map((e) => e.id);

  const ticketTypesRes =
    eventIds.length === 0
      ? { data: [] as EventTicketType[] }
      : await supabase.from('event_ticket_types').select('*').in('event_id', eventIds).order('sort_order');

  const ticketTypes = (ticketTypesRes.data ?? []) as EventTicketType[];

  const bookingsRes = await supabase
    .from('bookings')
    .select('id, experience_event_id, party_size, status')
    .eq('venue_id', venueId)
    .gte('booking_date', fromDate)
    .lte('booking_date', toDate)
    .not('experience_event_id', 'is', null)
    .in('status', CAPACITY_CONSUMING_STATUSES);

  const bookingIds = (bookingsRes.data ?? []).map((b) => b.id);
  let ticketLines: Array<{ booking_id: string; ticket_type_id: string | null; quantity: number }> = [];
  if (bookingIds.length > 0) {
    const { data } = await supabase
      .from('booking_ticket_lines')
      .select('booking_id, ticket_type_id, quantity')
      .in('booking_id', bookingIds);
    ticketLines = data ?? [];
  }

  const bookedByEvent: Record<string, number> = {};
  for (const b of bookingsRes.data ?? []) {
    const eventId = b.experience_event_id!;
    bookedByEvent[eventId] = (bookedByEvent[eventId] ?? 0) + (b.party_size ?? 0);
  }

  const bookedByTicketType: Record<string, number> = {};
  for (const tl of ticketLines) {
    if (tl.ticket_type_id) {
      bookedByTicketType[tl.ticket_type_id] = (bookedByTicketType[tl.ticket_type_id] ?? 0) + tl.quantity;
    }
  }

  if (venueBlocksRes.error) {
    console.warn('[fetchEventInputForRange] availability_blocks:', venueBlocksRes.error.message);
  }

  const venueOpeningHours = (venueRes.data?.opening_hours as OpeningHours | null) ?? null;
  const venueWideBlocks = rowsToVenueWideBlocks(venueBlocksRes.data);

  return {
    date: fromDate,
    events,
    ticketTypes,
    bookedByEvent,
    bookedByTicketType,
    venueWideBlocks,
    venueOpeningHours,
  };
}
