import { describe, it, expect } from "vitest";
import { renderBookingConfirmation } from "./booking-confirmation";
import { renderDepositRequestSms } from "./deposit-request-sms";
import { renderDepositRequestEmail } from "./deposit-request-email";
import { renderDepositConfirmation } from "./deposit-confirmation";
import { renderReminder56h } from "./reminder-56h";
import { renderDayOfReminderEmail } from "./day-of-reminder-email";
import { renderDayOfReminderSms } from "./day-of-reminder-sms";
import { renderPostVisitEmail } from "./post-visit";
import { formatDate, formatTime, formatDepositAmount } from "./base-template";
import type { BookingEmailData, VenueEmailData } from "../types";

const SAMPLE_BOOKING: BookingEmailData = {
  id: "b-001",
  guest_name: "Jane Doe",
  guest_email: "jane@example.com",
  booking_date: "2026-03-20",
  booking_time: "19:30",
  party_size: 4,
  special_requests: "Window seat please",
  dietary_notes: "1 vegetarian",
  deposit_amount_pence: 2000,
  deposit_status: "Paid",
  refund_cutoff: "2026-03-18T19:00:00Z",
  manage_booking_link: "https://reserveni.com/manage/b-001/tok",
  confirm_cancel_link: "https://reserveni.com/c/short.confirm",
};

const SAMPLE_VENUE: VenueEmailData = {
  name: "The Golden Whisk",
  address: "12 High Street, Belfast BT1 2AB",
};

describe("formatDate", () => {
  it("formats YYYY-MM-DD to a readable date", () => {
    const result = formatDate("2026-03-20");
    expect(result).toContain("20");
    expect(result).toContain("March");
    expect(result).toContain("2026");
  });

  it("returns original string for invalid input", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatTime", () => {
  it("formats 24h time to 12h", () => {
    expect(formatTime("19:30")).toBe("7:30pm");
    expect(formatTime("09:00")).toBe("9:00am");
    expect(formatTime("00:00")).toBe("12:00am");
    expect(formatTime("12:00")).toBe("12:00pm");
  });
});

describe("formatDepositAmount", () => {
  it("converts pence to pounds", () => {
    expect(formatDepositAmount(2000)).toBe("20.00");
    expect(formatDepositAmount(1550)).toBe("15.50");
    expect(formatDepositAmount(0)).toBe("0.00");
  });
});

describe("renderBookingConfirmation", () => {
  it("renders HTML with venue name and booking details", () => {
    const result = renderBookingConfirmation(SAMPLE_BOOKING, SAMPLE_VENUE);
    expect(result.subject).toContain("The Golden Whisk");
    expect(result.subject).toContain("confirmed");
    expect(result.html).toContain("The Golden Whisk");
    expect(result.html).toContain("4 guest");
    expect(result.html).toContain("20");
    expect(result.text).toContain("Jane Doe");
    expect(result.text).toContain("The Golden Whisk");
  });

  it("includes custom message when provided", () => {
    const result = renderBookingConfirmation(
      SAMPLE_BOOKING,
      SAMPLE_VENUE,
      "Please arrive 10 minutes early.",
    );
    expect(result.html).toContain("Please arrive 10 minutes early.");
    expect(result.text).toContain("Please arrive 10 minutes early.");
  });

  it("handles missing optional fields", () => {
    const minBooking: BookingEmailData = {
      id: "b-002",
      guest_name: "John",
      booking_date: "2026-04-01",
      booking_time: "18:00",
      party_size: 2,
    };
    const result = renderBookingConfirmation(minBooking, {
      name: "Test Venue",
    });
    expect(result.subject).toContain("confirmed");
    expect(result.html).toContain("Test Venue");
    expect(result.html).toContain("2 guest");
  });

  it("includes deposit info when paid", () => {
    const result = renderBookingConfirmation(SAMPLE_BOOKING, SAMPLE_VENUE);
    expect(result.html).toContain("20.00");
  });

  it("mentions pending deposit when not yet paid", () => {
    const pending = { ...SAMPLE_BOOKING, deposit_status: "Pending" };
    const result = renderBookingConfirmation(pending, SAMPLE_VENUE);
    expect(result.html).toContain("deposit");
  });
});

describe("renderDepositRequestSms", () => {
  it("includes venue name and payment link", () => {
    const result = renderDepositRequestSms(
      SAMPLE_BOOKING,
      SAMPLE_VENUE,
      "https://pay.link/abc",
    );
    expect(result.body).toContain("The Golden Whisk");
    expect(result.body).toContain("https://pay.link/abc");
    expect(result.body).toMatch(/£20\.00 dep/);
    expect(result.body.length).toBeLessThanOrEqual(160);
  });

  it("prepends custom message", () => {
    const result = renderDepositRequestSms(
      SAMPLE_BOOKING,
      SAMPLE_VENUE,
      "https://pay.link",
      "Hi! Deposit needed.",
    );
    expect(result.body.startsWith("Hi! Deposit needed.")).toBe(true);
  });

  it("keeps deposit request wording when the payment link is long", () => {
    const longPaymentLink =
      "https://www.reserveni.com/pay/v2.eyJib29raW5nSWQiOiJiLTAwMSIsInNpZyI6IjEyMzQ1Njc4OTAiLCJleHAiOjE4MzAwMDAwMDB9";
    const result = renderDepositRequestSms(
      SAMPLE_BOOKING,
      SAMPLE_VENUE,
      longPaymentLink,
    );
    expect(result.body).toContain("The Golden Whisk: £20.00 deposit needed");
    expect(result.body).toContain(`Pay: ${longPaymentLink}`);
    expect(result.body).not.toBe(longPaymentLink);
  });
});

describe("renderDepositRequestEmail", () => {
  it("includes payment link and deposit amount", () => {
    const result = renderDepositRequestEmail(
      SAMPLE_BOOKING,
      SAMPLE_VENUE,
      "https://pay.link/abc",
    );
    expect(result.subject.toLowerCase()).toContain("deposit");
    expect(result.html).toContain("https://pay.link/abc");
    expect(result.html).toContain("20.00");
    expect(result.text).toContain("https://pay.link/abc");
  });
});

describe("renderDepositConfirmation", () => {
  it("renders email with deposit amount", () => {
    const result = renderDepositConfirmation(SAMPLE_BOOKING, SAMPLE_VENUE);
    expect(result.subject).toContain("Deposit received");
    expect(result.html).toContain("20.00");
    expect(result.text).toContain("20.00");
  });
});

describe("renderReminder56h", () => {
  it("renders reminder with booking details", () => {
    const result = renderReminder56h(SAMPLE_BOOKING, SAMPLE_VENUE);
    expect(result.subject).toContain("Please confirm");
    expect(result.subject).toContain(SAMPLE_VENUE.name);
    expect(result.html).toContain("upcoming booking");
    expect(result.html).toContain("Confirm my booking");
    expect(result.html).toContain("Manage or cancel");
  });

  it("shows deposit variant when deposit was paid", () => {
    const result = renderReminder56h(SAMPLE_BOOKING, SAMPLE_VENUE);
    expect(result.html).toContain("Deposit refund notice");
  });

  it("shows no-deposit variant when no deposit", () => {
    const noDeposit = {
      ...SAMPLE_BOOKING,
      deposit_status: "Not Required",
      deposit_amount_pence: null,
    };
    const result = renderReminder56h(noDeposit, SAMPLE_VENUE);
    expect(result.text).toContain("Quick check on your upcoming booking");
    expect(result.text).not.toContain("paid a deposit");
  });
});

describe("renderDayOfReminderEmail", () => {
  it("uses tonight for evening bookings", () => {
    const result = renderDayOfReminderEmail(SAMPLE_BOOKING, SAMPLE_VENUE);
    expect(result.subject).toContain("tonight");
  });

  it("uses today for early bookings", () => {
    const earlyBooking = { ...SAMPLE_BOOKING, booking_time: "12:00" };
    const result = renderDayOfReminderEmail(earlyBooking, SAMPLE_VENUE);
    expect(result.subject).toContain("today");
  });
});

describe("renderDayOfReminderSms", () => {
  it("includes venue name and time", () => {
    const result = renderDayOfReminderSms(SAMPLE_BOOKING, SAMPLE_VENUE);
    expect(result.body).toContain("The Golden Whisk");
    expect(result.body).toContain("7:30pm");
    expect(result.body.length).toBeLessThanOrEqual(160);
  });

  it("keeps reminder wording when the manage link is long", () => {
    const longManageLink =
      "https://www.reserveni.com/m/v2.eyJib29raW5nSWQiOiJiLTAwMSIsInNpZyI6IjEyMzQ1Njc4OTAiLCJleHAiOjE4MzAwMDAwMDB9";
    const result = renderDayOfReminderSms(
      { ...SAMPLE_BOOKING, manage_booking_link: longManageLink },
      SAMPLE_VENUE,
    );
    expect(result.body).toContain("The Golden Whisk: Reminder: your booking");
    expect(result.body).toContain(`Manage: ${longManageLink}`);
    expect(result.body).not.toBe(longManageLink);
  });
});

describe("renderPostVisitEmail", () => {
  it("renders thank-you email", () => {
    const result = renderPostVisitEmail(SAMPLE_BOOKING, SAMPLE_VENUE);
    expect(result.subject).toContain("Thanks");
    expect(result.html).toContain("enjoyed your visit");
    expect(result.html).toContain("Book again");
    expect(result.html).toContain("had a booking");
  });
});

describe("all templates produce valid structure", () => {
  const allRenderers = [
    () => renderBookingConfirmation(SAMPLE_BOOKING, SAMPLE_VENUE),
    () => renderDepositConfirmation(SAMPLE_BOOKING, SAMPLE_VENUE),
    () => renderReminder56h(SAMPLE_BOOKING, SAMPLE_VENUE),
    () => renderDayOfReminderEmail(SAMPLE_BOOKING, SAMPLE_VENUE),
    () => renderPostVisitEmail(SAMPLE_BOOKING, SAMPLE_VENUE),
  ];

  it.each(allRenderers.map((fn, i) => [i, fn]))(
    "renderer %i returns subject, html, and text",
    (_, fn) => {
      const result = (
        fn as () => { subject: string; html: string; text: string }
      )();
      expect(result.subject).toBeTruthy();
      expect(result.html).toContain("<!DOCTYPE html>");
      expect(result.html).toContain("</html>");
      expect(result.text).toBeTruthy();
    },
  );

  it("SMS templates return body string", () => {
    const sms1 = renderDepositRequestSms(
      SAMPLE_BOOKING,
      SAMPLE_VENUE,
      "https://pay.link",
    );
    const sms2 = renderDayOfReminderSms(SAMPLE_BOOKING, SAMPLE_VENUE);
    expect(typeof sms1.body).toBe("string");
    expect(sms1.body.length).toBeGreaterThan(0);
    expect(typeof sms2.body).toBe("string");
    expect(sms2.body.length).toBeGreaterThan(0);
  });
});
