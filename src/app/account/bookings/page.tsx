import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  accountBookingTimeZone,
  buildAccountBookingDisplayList,
  formatAccountBookingDateTime,
  friendlyAccountBookingStatus,
  loadAccountBookings,
  type AccountBookingRow,
} from '@/lib/account/account-bookings';
import { bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import {
  ACCOUNT_BOOKING_MODEL_LABELS,
  accountBookingModelKey,
  filterAccountBookings,
  filterAccountBookingsByModel,
  parseAccountBookingFilter,
  parseAccountBookingModel,
  type AccountBookingFilter,
  type AccountBookingModelFilter,
} from '@/lib/account/account-booking-filters';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { CancelCourseButton } from '@/components/account/CancelCourseButton';
import { rebookUrl } from '@/lib/account/rebook-url';
import { AccountWaitlistSection } from '@/components/account/AccountWaitlistSection';
import { loadAccountWaitlist } from '@/lib/account/account-waitlist';
import { isPastBooking } from '@/lib/account/account-booking-filters';

/**
 * "Book again" (P3-1), rendered only when the link can honour the name.
 *
 * `rebookUrl` returns null when it cannot carry over enough for the phrase to
 * be true, and this renders nothing rather than a control that starts the
 * customer from scratch under a label promising otherwise.
 */
function RebookLink({ row }: { row: AccountBookingRow }) {
  const href = rebookUrl({
    venueSlug: row.venue?.slug,
    serviceItemId: row.service_item_id,
    practitionerSlug: row.practitioner_slug,
  });
  if (!href) return null;
  return (
    <Link
      href={href}
      className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2"
    >
      Book again
    </Link>
  );
}

/** Uses the SAME predicate the Past filter does, so the button and the tab agree. */
function isPastRow(row: AccountBookingRow): boolean {
  return isPastBooking(row, Date.now());
}
import {
  courseCancellationLines,
  summariseCourseCancellation,
} from '@/lib/account/course-cancellation-summary';

/**
 * What "cancel the whole course" would do, or null when there is nothing left
 * to cancel (P2-2a).
 *
 * The anchor is the FIRST remaining session, not the first row: the service
 * walks the group from whichever booking it is given, and handing it one that
 * is already cancelled would be asking it to act on a booking the customer can
 * no longer act on.
 */
function courseCancel(
  rows: AccountBookingRow[],
  nowIso: string,
): { anchorBookingId: string; lines: string[] } | null {
  const summary = summariseCourseCancellation(rows, nowIso);
  if (summary.remaining === 0) return null;
  const anchor = rows.find((r) => ['Pending', 'Booked', 'Confirmed'].includes(r.status));
  if (!anchor) return null;
  return { anchorBookingId: anchor.id, lines: courseCancellationLines(summary) };
}


/**
 * WCAG 2.4.2 (Level A): every page needs a title that describes it. Next
 * otherwise falls back to the root layout's title, so all thirteen portal
 * routes announced the same thing and a screen-reader user could not tell from
 * the tab or the announcement which one they were on.
 *
 * Scoped to the surviving routes, matching P0-5: P1-3 and P1-5 turn nine of
 * the thirteen into one-line redirects, and a redirect does not need a title.
 */
export const metadata = {
  title: 'Your bookings',
  description: 'Reservations and visits linked to your account.',
};

/** One-line summary "Class · Mon 4 August · 18:30 · Confirmed", venue-TZ + friendly status. */
function bookingSummaryLine(row: AccountBookingRow, profileTz: string | null): string {
  const tz = accountBookingTimeZone(row, profileTz);
  const { date, time } = formatAccountBookingDateTime(row.booking_date, row.booking_time, tz, {
    withWeekday: true,
  });
  const parts = [bookingModelShortLabel(row.booking_model), date];
  if (time) parts.push(time);
  parts.push(friendlyAccountBookingStatus(row.status));
  return parts.join(' · ');
}

/**
 * The extra line the retired per-model pages carried (P1-3).
 *
 * `/account/events` printed the ticket breakdown and `/account/resources` the
 * duration and end time. Folding those pages into this list as a filter must
 * not quietly drop what they showed: "2 x Adult, 1 x Child" is the thing a
 * customer opens their tickets to check, and replacing it with "Event · Sat 5
 * September · 19:00 · Confirmed" would be a worse list, not a shorter one.
 */
function bookingModelDetailLine(row: AccountBookingRow): string | null {
  const key = accountBookingModelKey(row.booking_model);
  if (key === 'event') {
    const lines = row.cde_context?.ticket_lines;
    if (lines && lines.length > 0) {
      return lines.map((l) => `${l.quantity} x ${l.label}`).join(', ');
    }
    return `${row.party_size} ${row.party_size === 1 ? 'ticket' : 'tickets'}`;
  }
  if (key === 'resource') {
    const parts: string[] = [];
    const duration = row.cde_context?.duration_minutes;
    if (duration) parts.push(`${duration} min`);
    if (row.booking_end_time) parts.push(`Ends ${row.booking_end_time.slice(0, 5)}`);
    if (row.cde_context?.subtitle) parts.push(row.cde_context.subtitle);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  return null;
}

/** A bookings-list URL carrying both filter dimensions, omitting the defaults. */
function bookingsHref(filter: AccountBookingFilter, model: AccountBookingModelFilter): string {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('filter', filter);
  if (model !== 'all') params.set('model', model);
  const qs = params.toString();
  return qs ? `/account/bookings?${qs}` : '/account/bookings';
}

const pillClass = (active: boolean) =>
  active
    ? 'rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/25'
    : 'rounded-full border border-slate-200/90 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5 transition-colors hover:border-slate-300 hover:bg-slate-50';

export default async function AccountBookingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string; model?: string | string[] }>;
}) {
  const sp = (await searchParams) ?? {};
  const filter = parseAccountBookingFilter(sp.filter);
  const model = parseAccountBookingModel(sp.model);
  const nowMs = new Date().getTime();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from('user_profiles').select('timezone').eq('id', user.id).maybeSingle()
    : { data: null };
  const profileTz = (profile?.timezone as string | null | undefined)?.trim() || null;

  const bookings = await loadAccountBookings(supabase, getSupabaseAdminClient(), 100);

  /*
    Waitlist places (P4-4), scoped by the account's own verified address
    because `waitlist_entries` has no guest id. Failure is carried rather than
    swallowed: an empty list would tell the customer they are waiting for
    nothing, which is a claim (P4-1's rule).
  */
  const waitlist = await loadAccountWaitlist(getSupabaseAdminClient(), user?.email)
    .then((entries) => ({ entries, failed: false }))
    .catch((e) => {
      console.error('[account/bookings] waitlist:', e instanceof Error ? e.message : e);
      return { entries: [], failed: true };
    });
  const waitlistVenueNames = Object.fromEntries(
    bookings.flatMap((b) => (b.venue ? [[b.venue.id, b.venue.name] as const] : [])),
  );

  // The customer's own timezone is only a fallback: each booking is classified
  // in its VENUE's zone, which is the zone its stored times are in (P0-2).
  const filtered = filterAccountBookingsByModel(
    filterAccountBookings(bookings, filter, nowMs, profileTz),
    model,
  );
  const displayItems = buildAccountBookingDisplayList(filtered);
  /*
    ONE clock for every course on the page. Each session's refundability is a
    comparison against this, and reading the clock per course would let two
    courses on one screen disagree about whether the same instant had passed.
  */
  const nowIso = new Date().toISOString();

  const tabs: Array<{ id: AccountBookingFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];

  /*
    Only the types this customer actually has, plus whichever is selected.
    A salon customer has no events and never will, and offering them an
    "Events" pill that can only ever return nothing is a worse list than no
    pill at all. The selected one is kept regardless so a shared or redirected
    URL is always representable: `/account/events` lands here as `?model=event`
    even for a customer with none, and the pill has to be able to show that
    state rather than silently reading as "All".
  */
  const presentModels = new Set(
    bookings.map((b) => accountBookingModelKey(b.booking_model)).filter(Boolean),
  );
  const modelTabs = ACCOUNT_BOOKING_MODEL_LABELS.filter(
    (m) => presentModels.has(m.id) || model === m.id,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Your bookings"
        subtitle="Reservations and visits linked to your account. Open a booking for details or use the venue manage link where available."
      />
      {/*
        Above the filters on purpose: a waitlist place is the thing a customer
        is most likely to have come to check on, and it is not affected by the
        date and type filters below, so putting it under them would look like
        a list that the filters had emptied.
      */}
      <AccountWaitlistSection
        entries={waitlist.entries}
        venueNames={waitlistVenueNames}
        failed={waitlist.failed}
      />

      {/*
        Both pill rows are named groups. There are two of them since P1-3, and
        without names a screen reader announces two undifferentiated runs of
        links: "All, Upcoming, Past, All types, Appointments" with nothing
        saying that the first three and the last two do different things.
      */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by date">
        {tabs.map((t) => (
          <Link
            key={t.id}
            // Each dimension keeps the other, so narrowing to Events and then
            // to Upcoming does not silently drop back to every type.
            href={bookingsHref(t.id, model)}
            // `true` rather than `page`: these are filters over one page, not
            // separate pages, so `page` would claim something untrue.
            aria-current={filter === t.id ? 'true' : undefined}
            className={pillClass(filter === t.id)}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {modelTabs.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by booking type">
          <Link
            href={bookingsHref(filter, 'all')}
            aria-current={model === 'all' ? 'true' : undefined}
            className={pillClass(model === 'all')}
          >
            All types
          </Link>
          {modelTabs.map((m) => (
            <Link
              key={m.id}
              href={bookingsHref(filter, m.id)}
              aria-current={model === m.id ? 'true' : undefined}
              className={pillClass(model === m.id)}
            >
              {m.label}
            </Link>
          ))}
        </div>
      ) : null}
      {bookings.length === 0 ? (
        <p className="text-slate-600">No bookings linked to this account yet.</p>
      ) : displayItems.length === 0 ? (
        <p className="text-slate-600">
          {model === 'all'
            ? 'No bookings in this view.'
            : `No ${(ACCOUNT_BOOKING_MODEL_LABELS.find((m) => m.id === model)?.label ?? '').toLowerCase()} in this view.`}{' '}
          <Link
            href="/account/bookings"
            className="inline-flex min-h-6 items-center font-medium text-brand-700 underline underline-offset-2"
          >
            See all bookings
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5">
          {displayItems.map((item) => {
            /*
              Computed once per course, here on the server (P2-2a). The rows
              already carry every session's status, deadline and deposit, so
              the dialog can state the outcome without the browser asking for
              it again. Null when nothing is left to cancel.
            */
            const course =
              item.kind === 'group' ? courseCancel(item.rows, nowIso) : null;
            return item.kind === 'group' ? (
              <li key={item.group_booking_id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {item.rows[0]?.cde_context?.title ?? item.venue?.name ?? 'Venue'}
                    </p>
                    <p className="text-sm font-medium text-slate-800">
                      {item.venue?.name ? `${item.venue.name} · ` : ''}Course · {item.rows.length} sessions
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                      {item.rows.map((b) => {
                        const tz = accountBookingTimeZone(b, profileTz);
                        const { date, time } = formatAccountBookingDateTime(b.booking_date, b.booking_time, tz);
                        return (
                          <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                            <span>
                              {date}
                              {time ? ` · ${time}` : ''} · {friendlyAccountBookingStatus(b.status)}
                            </span>
                            <span className="flex gap-3 font-medium">
                              <Link href={`/account/bookings/${b.id}`} className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2">
                                Details
                              </Link>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
                {/*
                  P2-2a closes Register Q-21. This footnote used to say "to
                  cancel the whole course, do that for every session here",
                  which was the portal handing a customer a chore because the
                  control below did not exist. What remains of it is the part
                  that is still true and still worth saying: one session at a
                  time is also allowed.

                  The consequences are worked out HERE, on the server, where
                  every session's deadline and deposit already are.
                */}
                {course ? (
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      Or open any session above to change or cancel just that one.
                    </p>
                    <CancelCourseButton
                      anchorBookingId={course.anchorBookingId}
                      courseName={item.rows[0]?.cde_context?.title ?? null}
                      lines={course.lines}
                    />
                  </div>
                ) : (
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Every session on this course is cancelled or finished.
                  </p>
                )}
              </li>
            ) : (
              <li key={item.row.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {item.row.cde_context?.title ?? item.row.venue?.name ?? 'Venue'}
                  </p>
                  <p className="text-sm text-slate-600">
                    {item.row.cde_context && item.row.venue?.name ? `${item.row.venue.name} · ` : ''}
                    {bookingSummaryLine(item.row, profileTz)}
                  </p>
                  {bookingModelDetailLine(item.row) ? (
                    <p className="mt-0.5 text-xs text-slate-500">{bookingModelDetailLine(item.row)}</p>
                  ) : null}
                </div>
                <div className="flex gap-3 text-sm font-medium">
                  {/*
                    "Book again" on a visit that has been and gone (P3-1). Only
                    on past bookings: offering it beside an appointment that has
                    not happened yet invites a customer to book a second one
                    when what they meant was to change the first.

                    Absent, not disabled, when the link cannot carry the service
                    and the practitioner over. A button that quietly starts them
                    from scratch is not booking again.
                  */}
                  {isPastRow(item.row) ? <RebookLink row={item.row} /> : null}
                  <Link href={`/account/bookings/${item.row.id}`} className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2">
                    Details
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        Times are shown in each venue’s local timezone.
      </p>
    </div>
  );
}
