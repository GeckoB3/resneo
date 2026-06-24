/**
 * Server-side validation + pricing for an `event_ticket` booking.
 *
 * Single source of truth shared by the staff booking route
 * (`/api/venue/bookings`) and the public booking route (`/api/booking/create`).
 * Historically only the staff route validated ticket lines; the public route
 * trusted client-supplied `unit_price_pence`, allowing a £0 booking on a paid
 * event (see the CDE review, finding M1). Both routes now call this.
 *
 * Validates against the authoritative `EventAvailabilitySlot` computed by the
 * availability engine:
 *  - ticket lines present and party_size == Σ quantities
 *  - every ticket_type_id belongs to the event
 *  - per-tier remaining capacity is not exceeded
 *  - unit_price_pence matches the current event price (no client pricing)
 *  - (optional) requested start time matches the event start
 * and derives the charge (ticket total, deposit) from the slot's payment rule.
 */

import type { EventAvailabilitySlot } from '@/lib/availability/event-ticket-engine';

export interface EventTicketLineInput {
  ticket_type_id?: string | null;
  label?: string | null;
  quantity: number;
  unit_price_pence: number;
}

export interface ValidatedEventTicketLine {
  ticket_type_id: string;
  label: string;
  quantity: number;
  unit_price_pence: number;
}

export interface ValidatedEventTicketBooking {
  ticketLines: ValidatedEventTicketLine[];
  ticketTotalPence: number;
  requiresDeposit: boolean;
  depositAmountPence: number;
}

export type EventTicketValidationResult =
  | { ok: true; value: ValidatedEventTicketBooking }
  | { ok: false; error: string; status: number };

export function validateEventTicketBooking(params: {
  slot: EventAvailabilitySlot;
  ticketLines: EventTicketLineInput[] | null | undefined;
  partySize: number;
  /** When provided, the requested start ("HH:mm") must match the event start. */
  requestedStartTime?: string | null;
}): EventTicketValidationResult {
  const { slot, partySize } = params;
  const lines = params.ticketLines ?? [];

  if (lines.length === 0) {
    return { ok: false, error: 'ticket_lines is required for event bookings', status: 400 };
  }

  const totalQty = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  if (totalQty !== partySize) {
    return { ok: false, error: 'party_size must match total ticket quantity', status: 400 };
  }

  // Event-level capacity (defence in depth; the DB trigger is authoritative).
  if (slot.remaining_capacity < partySize) {
    return { ok: false, error: 'This event is fully booked or unavailable', status: 409 };
  }

  if (params.requestedStartTime != null) {
    const startStr = String(slot.start_time).slice(0, 5);
    if (startStr !== params.requestedStartTime) {
      return { ok: false, error: 'Booking time does not match the event start time', status: 400 };
    }
  }

  const validatedLines: ValidatedEventTicketLine[] = [];
  for (const line of lines) {
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) {
      return { ok: false, error: 'Each ticket line must have a positive quantity', status: 400 };
    }
    const tt = slot.ticket_types.find((t) => t.id === line.ticket_type_id);
    if (!tt) {
      return { ok: false, error: 'Invalid ticket type for this event', status: 400 };
    }
    if (qty > tt.remaining) {
      return {
        ok: false,
        error: 'Not enough tickets remaining for one or more ticket types',
        status: 409,
      };
    }
    if (line.unit_price_pence !== tt.price_pence) {
      return { ok: false, error: 'Ticket price does not match the current event price', status: 400 };
    }
    validatedLines.push({
      ticket_type_id: tt.id,
      // Trust the server's ticket-type name, not the client label.
      label: tt.name,
      quantity: qty,
      unit_price_pence: tt.price_pence,
    });
  }

  const ticketTotalPence = validatedLines.reduce((sum, l) => sum + l.quantity * l.unit_price_pence, 0);

  const payReq = slot.payment_requirement ?? 'none';
  const depPerPerson = slot.deposit_amount_pence ?? 0;
  let requiresDeposit = false;
  let depositAmountPence = 0;
  if (payReq === 'full_payment' && ticketTotalPence > 0) {
    requiresDeposit = true;
    depositAmountPence = ticketTotalPence;
  } else if (payReq === 'deposit' && depPerPerson > 0) {
    requiresDeposit = true;
    depositAmountPence = depPerPerson * partySize;
  }

  return {
    ok: true,
    value: { ticketLines: validatedLines, ticketTotalPence, requiresDeposit, depositAmountPence },
  };
}
