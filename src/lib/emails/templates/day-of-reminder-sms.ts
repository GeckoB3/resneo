import type { BookingEmailData, VenueEmailData, RenderedSms } from "../types";
import { formatTime } from "./base-template";

const SMS_MAX = 160;

function clipSmsText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 3))}...`;
}

function joinSmsPrefixAndUrl(prefix: string, url: string, label = "", max = SMS_MAX): string {
  const u = url.trim();
  const base = prefix.trim();
  const labelledUrl = `${label}${u}`;
  const combined = `${base} ${labelledUrl}`;
  if (combined.length <= max) return combined;
  return combined;
}

export function renderDayOfReminderSms(
  booking: BookingEmailData,
  venue: VenueEmailData,
  customMessage?: string | null,
): RenderedSms {
  const time = formatTime(booking.booking_time);
  const [h] = booking.booking_time.slice(0, 5).split(":").map(Number);
  const timeOfDay = (h ?? 18) < 15 ? "Today" : "Tonight";

  const lead = customMessage?.trim() ? `${customMessage.trim()} ` : "";

  const msg = `${lead}${venue.name}: Reminder: your booking is ${timeOfDay.toLowerCase()} at ${time}.`;
  if (booking.manage_booking_link) {
    return { body: joinSmsPrefixAndUrl(msg.replace(/\.\s*$/, ""), booking.manage_booking_link, "Manage: ") };
  }
  return { body: clipSmsText(msg, SMS_MAX) };
}
