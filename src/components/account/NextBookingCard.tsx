import Link from 'next/link';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { ManageBookingLink } from '@/components/account/ManageBookingLink';
import {
  accountBookingTimeZone,
  formatAccountBookingDateTime,
  friendlyAccountBookingStatus,
  type AccountBookingRow,
} from '@/lib/account/account-bookings';
import type { AccountHomeAppointmentLabel } from '@/lib/account/account-home';

/**
 * The next booking, above the fold (P1-2, closes G1 and part of G8b).
 *
 * WHAT THIS REPLACED. The hub was a static grid of links to other pages. A
 * customer opening the portal to check when their appointment was had to read
 * a menu, choose Bookings, and find it in a list. The single most common
 * reason to open a customer portal was the one thing it did not answer.
 *
 * IT NAMES THE SERVICE AND THE PRACTITIONER. That is new, and it is the point
 * of G8b: `bookings_account_safe` did not carry `calendar_id` or
 * `service_item_id` until P0-6 widened its column allowlist, so the portal
 * could previously say only that you had "a booking" at a venue. "Cut and
 * finish with Alex" is the difference between a record and a reminder.
 *
 * TIMES CARRY THEIR ZONE. Rendered in the VENUE's timezone with the zone named,
 * because a customer who booked in London and is reading in Sydney needs to
 * know which 14:00 this is.
 */
export function NextBookingCard({
  booking,
  appointment,
  formLinks,
  profileTz,
}: {
  booking: AccountBookingRow;
  appointment: AccountHomeAppointmentLabel;
  formLinks: Array<{ name: string; url: string }>;
  profileTz: string | null;
}) {
  const tz = accountBookingTimeZone(booking, profileTz);
  const { date, time } = formatAccountBookingDateTime(booking.booking_date, booking.booking_time, tz, {
    withWeekday: true,
  });

  // What was booked, best available: the named service, then the CDE title for
  // a class or event, then the venue. Never "Booking".
  const what = appointment.service ?? booking.cde_context?.title ?? booking.venue?.name ?? 'Your booking';
  // When the heading already fell back to the venue name, repeating it
  // underneath prints it twice, which is what a table booking with no named
  // service actually does.
  const venueName = booking.venue?.name && booking.venue.name !== what ? booking.venue.name : null;
  const withWhom = appointment.practitioner;
  const address = booking.venue?.address?.trim();

  return (
    <SectionCard className="p-5 sm:p-6" elevated>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-700">Next up</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{what}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {withWhom ? (
              <>
                with <span className="font-medium text-slate-800">{withWhom}</span>
                {venueName ? ' at ' : ''}
              </>
            ) : null}
            {venueName ? <span className="font-medium text-slate-800">{venueName}</span> : null}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 ring-1 ring-brand-100">
          {friendlyAccountBookingStatus(booking.status)}
        </span>
      </div>

      <p className="mt-4 text-lg font-semibold text-slate-900">
        {date}
        {time ? <> at {time}</> : null}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">Times shown in {tz.replace('_', ' ')}.</p>

      {formLinks.length > 0 ? (
        <div
          // Something the customer must DO before the appointment, so it sits
          // with the booking rather than in a list further down the page.
          role="alert"
          className="mt-4 rounded-xl border border-amber-200/90 bg-amber-50/60 p-3.5"
        >
          <p className="text-sm font-semibold text-amber-950">
            {formLinks.length === 1 ? 'One form to complete' : `${formLinks.length} forms to complete`}
          </p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {formLinks.map((form) => (
              <li key={form.url}>
                <a
                  href={form.url}
                  className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2"
                >
                  {form.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium">
        <Link
          href={`/account/bookings/${booking.id}`}
          className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2"
        >
          View details
        </Link>
        <ManageBookingLink
          bookingId={booking.id}
          label="Reschedule or cancel"
          className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2 disabled:opacity-60"
        />
        {address ? (
          <a
            // Maps rather than a bespoke directions integration: it works on
            // every platform and opens the app the customer already uses.
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              `${booking.venue?.name ?? ''} ${address}`.trim(),
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2"
          >
            Directions
          </a>
        ) : null}
      </div>
    </SectionCard>
  );
}
