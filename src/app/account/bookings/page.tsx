import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { buildAccountBookingDisplayList, loadAccountBookings } from '@/lib/account/account-bookings';
import { bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import {
  filterAccountBookings,
  parseAccountBookingFilter,
  type AccountBookingFilter,
} from '@/lib/account/account-booking-filters';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

export default async function AccountBookingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const filter = parseAccountBookingFilter(sp.filter);
  const todayUtcDate = new Date().toISOString().slice(0, 10);

  const supabase = await createClient();
  await supabase.auth.getUser();

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
              <li key={item.group_booking_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-slate-900">{item.venue?.name ?? 'Venue'}</p>
                  <p className="text-sm font-medium text-slate-800">Class multi-session · {item.rows.length} sessions</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {item.rows.map((b) => (
                      <li key={b.id}>
                        {b.booking_date} {String(b.booking_time).slice(0, 5)} · {b.party_size} guests · {b.status}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-1 text-sm font-medium sm:items-end">
                  {item.rows.map((b) => (
                    <div key={b.id} className="flex gap-3">
                      <Link href={`/account/bookings/${b.id}`} className="text-brand-700 hover:underline">
                        Details
                      </Link>
                      <a href={b.manage_booking_link} className="text-brand-700 hover:underline">
                        Manage
                      </a>
                    </div>
                  ))}
                </div>
              </li>
            ) : (
              <li key={item.row.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-slate-900">{item.row.venue?.name ?? 'Venue'}</p>
                  <p className="text-sm text-slate-600">
                    {bookingModelShortLabel(item.row.booking_model)} · {item.row.booking_date} ·{' '}
                    {String(item.row.booking_time).slice(0, 5)} · {item.row.party_size} guests · {item.row.status}
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
        Filters use the UTC calendar day. For exact local times, check the venue confirmation email.
      </p>
    </div>
  );
}
