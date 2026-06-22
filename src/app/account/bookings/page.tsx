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
  filterAccountBookings,
  parseAccountBookingFilter,
  type AccountBookingFilter,
} from '@/lib/account/account-booking-filters';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

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

export default async function AccountBookingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const filter = parseAccountBookingFilter(sp.filter);
  const todayUtcDate = new Date().toISOString().slice(0, 10);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from('user_profiles').select('timezone').eq('id', user.id).maybeSingle()
    : { data: null };
  const profileTz = (profile?.timezone as string | null | undefined)?.trim() || null;

  const bookings = await loadAccountBookings(supabase, getSupabaseAdminClient(), 100);

  const filtered = filterAccountBookings(bookings, filter, todayUtcDate);
  const displayItems = buildAccountBookingDisplayList(filtered);

  const tabs: Array<{ id: AccountBookingFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Your bookings"
        subtitle="Reservations and visits linked to your account. Open a booking for details or use the venue manage link where available."
      />
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.id === 'all' ? '/account/bookings' : `/account/bookings?filter=${t.id}`}
            className={
              filter === t.id
                ? 'rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/25'
                : 'rounded-full border border-slate-200/90 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5 transition-colors hover:border-slate-300 hover:bg-slate-50'
            }
          >
            {t.label}
          </Link>
        ))}
      </div>
      {bookings.length === 0 ? (
        <p className="text-slate-600">No bookings linked to this account yet.</p>
      ) : displayItems.length === 0 ? (
        <p className="text-slate-600">No bookings in this view.</p>
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
                              <Link href={`/account/bookings/${b.id}`} className="text-brand-700 hover:underline">
                                Details
                              </Link>
                              <a href={b.manage_booking_link} className="text-brand-700 hover:underline">
                                Cancel this session
                              </a>
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
                </div>
                <div className="flex gap-3 text-sm font-medium">
                  <Link href={`/account/bookings/${item.row.id}`} className="text-brand-700 hover:underline">
                    Details
                  </Link>
                  <a href={item.row.manage_booking_link} className="text-brand-700 hover:underline">
                    Manage
                  </a>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        Times are shown in each venue’s local timezone. Filters use the UTC calendar day.
      </p>
    </div>
  );
}
