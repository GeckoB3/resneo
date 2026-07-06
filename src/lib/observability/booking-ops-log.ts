/**
 * Minimal structured logs for observability (docs §Observability).
 * Uses JSON on one line - avoid PII beyond what is needed for support.
 */

export interface BookingOpLogFields {
  operation:
    | 'create'
    | 'confirm'
    | 'cancel'
    | 'delete'
    | 'refund_failed'
    | 'card_hold_charge'
    | 'card_hold_charge_failed'
    | 'error';
  venue_id: string;
  booking_id?: string;
  booking_model?: string;
  /** When present, log at error level */
  error?: string;
}

export function logBookingOp(fields: BookingOpLogFields): void {
  const line = JSON.stringify({
    ...fields,
    ts: new Date().toISOString(),
  });
  if (fields.error || fields.operation === 'refund_failed' || fields.operation === 'error') {
    console.error('[booking-op]', line);
  } else {
    console.info('[booking-op]', line);
  }
}
