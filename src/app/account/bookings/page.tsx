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
import { ManageBookingLink } from '@/components/account/ManageBookingLink';

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

  // The customer's own timezone is only a fallback: each booking is classified
  // in its VENUE's zone, which is the zone its stored times are in (P0-2).
  const filtered = filterAccountBookingsByModel(
    filterAccountBookings(bookings, filter, nowMs, profileTz),
    model,
  );
  const displayItems = buildAccountBookingDisplayList(filtered);

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
          {displayItems.map((item) =>
            item.kind === 'group' ? (
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
                              <ManageBookingLink
                                bookingId={b.id}
                                label="Cancel this session"
                                className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2 disabled:opacity-60"
                              />
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Each link cancels only that one session. To cancel the whole course, cancel every session here or
                  contact the venue.
                </p>
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
                  <Link href={`/account/bookings/${item.row.id}`} className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2">
                    Details
                  </Link>
                  <ManageBookingLink
                    bookingId={item.row.id}
                    label="Manage"
                    className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2 disabled:opacity-60"
                  />
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        Times are shown in each venue’s local timezone.
      </p>
    </div>
  );
}
