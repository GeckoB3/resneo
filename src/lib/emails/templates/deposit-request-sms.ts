import type { BookingEmailData, VenueEmailData, RenderedSms } from "../types";
import {
  formatRefundDeadlineIso,
  isDepositRefundAvailableAt,
} from "@/lib/booking/cancellation-deadline";
import { formatSmsDate, formatTime, formatDepositAmount } from "./base-template";

const SMS_MAX = 160;

function joinSmsPrefixAndUrl(prefix: string, url: string, label = "", max = SMS_MAX): string {
  const u = url.trim();
  const base = prefix.trim();
  const labelledUrl = `${label}${u}`;
  const combined = `${base} ${labelledUrl}`;
  if (combined.length <= max) return combined;
  return combined;
}

function isAppointment(booking: BookingEmailData): boolean {
  return (
    booking.email_variant === "appointment" ||
    Boolean(
      booking.group_appointments?.length ||
      booking.practitioner_name ||
      booking.appointment_service_name,
    )
  );
}

export function renderDepositRequestSms(
  booking: BookingEmailData,
  venue: VenueEmailData,
  paymentLink: string,
  customMessage?: string | null,
): RenderedSms {
  const date = formatSmsDate(booking.booking_date);
  const time = formatTime(booking.booking_time);
  const amount = booking.deposit_amount_pence
    ? formatDepositAmount(booking.deposit_amount_pence)
    : "0.00";
  const appt = isAppointment(booking);

  const lead = customMessage?.trim() ? `${customMessage.trim()} ` : "";

  const core = appt
    ? `${lead}${venue.name}: £${amount} deposit needed for ${date} at ${time}.`
    : `${lead}${venue.name}: £${amount} deposit needed for ${booking.party_size} guests on ${date} at ${time}.`;

  let body = joinSmsPrefixAndUrl(core, paymentLink, "Pay: ");

  if (booking.refund_cutoff) {
    const extra = isDepositRefundAvailableAt(booking.refund_cutoff)
      ? `Refund by ${formatRefundDeadlineIso(booking.refund_cutoff)}.`
      : "No refund (deadline passed).";
    if (body.length + 1 + extra.length <= SMS_MAX) {
      body = `${body} ${extra}`;
    }
  }

  return { body };
}
