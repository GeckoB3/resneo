import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountBookingById } from '@/lib/account/account-bookings';
import { bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

type PageProps = { params: Promise<{ bookingId: string }> };

function money(pence: number | null | undefined): string | null {
  if (pence == null) return null;
  return `£${(pence / 100).toFixed(2)}`;
}

/** Calendar label in the user's profile timezone (falls back to Europe/London). */
function formatLongWeekdayDate(dateStr: string, timeZone: string): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateStr;
  const [y, mo, d] = parts;
  const utcNoon = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  return utcNoon.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timeZone.trim() || 'Europe/London',
  });
}

export default async function AccountBookingDetailPage({ params }: PageProps) {
  const { bookingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase.from('user_profiles').select('timezone').eq('id', user.id).maybeSingle();
  const displayTz = (profile?.timezone as string | null | undefined)?.trim() || 'Europe/London';

  const booking = await loadAccountBookingById(supabase, getSupabaseAdminClient(), bookingId);
  if (!booking) notFound();

  const dateHeading = formatLongWeekdayDate(booking.booking_date, displayTz);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/account/bookings"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back to bookings
        </Link>
        <div className="mt-5">
          <PageHeader
            eyebrow="Bookings"
            title={booking.venue?.name ?? 'Booking details'}
            subtitle={`${bookingModelShortLabel(booking.booking_model)} booking · ${booking.status}`}
            actions={
              <a
                href={booking.manage_booking_link}
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                Manage booking
              </a>
            }
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-900/5 sm:p-7">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date</dt>
            <dd className="mt-1 text-slate-900">{dateHeading}</dd>
            <dd className="mt-0.5 text-xs text-slate-500">ISO {booking.booking_date}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Time</dt>
            <dd className="mt-1 text-slate-900">
              {booking.booking_time.slice(0, 5)}
              {booking.booking_end_time ? ` to ${booking.booking_end_time.slice(0, 5)}` : ''}
            </dd>
            <dd className="mt-0.5 text-xs text-slate-500">As recorded by the venue (wall clock).</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Party size</dt>
            <dd className="mt-1 text-slate-900">{booking.party_size}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deposit</dt>
            <dd className="mt-1 text-slate-900">
              {booking.deposit_status ?? 'Not required'}
              {money(booking.deposit_amount_pence) ? ` · ${money(booking.deposit_amount_pence)}` : ''}
            </dd>
          </div>
          {booking.venue?.address ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Venue address</dt>
              <dd className="mt-1 text-slate-900">{booking.venue.address}</dd>
            </div>
          ) : null}
          {booking.special_requests || booking.dietary_notes || booking.occasion ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</dt>
              <dd className="mt-1 whitespace-pre-wrap text-slate-900">
                {[booking.occasion, booking.special_requests, booking.dietary_notes].filter(Boolean).join('\n')}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

    </div>
  );
}
