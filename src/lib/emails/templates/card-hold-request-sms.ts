import type { BookingEmailData, VenueEmailData, RenderedSms } from "../types";
import { formatSmsDate, formatTime } from "./base-template";

const SMS_MAX = 160;

export interface CardHoldRequestSmsOptions {
  /** Reminder variant (card_hold_payment_reminder §10.3.2): prefixes "Reminder: ". */
  reminder?: boolean;
  customMessage?: string | null;
}

/**
 * Card-request SMS (card_hold deposits §10.3):
 * "{venueName}: card details needed to secure your booking for {date} at {time}.
 * No payment is taken now. Add: {link}"
 * Respects the 160-char single-segment target; the reassurance clause
 * ("No payment is taken now.") is dropped first when the message is over.
 * Long signed links can still exceed a segment; copy is kept and Twilio splits.
 */
export function renderCardHoldRequestSms(
  booking: BookingEmailData,
  venue: VenueEmailData,
  paymentLink: string,
  opts?: CardHoldRequestSmsOptions,
): RenderedSms {
  const date = formatSmsDate(booking.booking_date);
  const time = formatTime(booking.booking_time);
  const lead = opts?.customMessage?.trim() ? `${opts.customMessage.trim()} ` : "";
  const prefix = opts?.reminder ? "Reminder: " : "";
  const link = paymentLink.trim();

  const core = `${lead}${prefix}${venue.name}: card details needed to secure your booking for ${date} at ${time}.`;
  const withReassurance = `${core} No payment is taken now. Add: ${link}`;
  if (withReassurance.length <= SMS_MAX) return { body: withReassurance };
  return { body: `${core} Add: ${link}` };
}
