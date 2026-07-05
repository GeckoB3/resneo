import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  accountBookingTimeZone,
  formatAccountBookingDateTime,
  friendlyAccountBookingStatus,
  loadAccountBookingById,
} from '@/lib/account/account-bookings';
import { bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import {
  deriveGuestCardHoldSummary,
  type GuestCardHoldRowInput,
} from '@/lib/booking/guest-card-hold-summary';
import { formatCardHoldFeePence } from '@/lib/booking/card-hold-terms';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

type PageProps = { params: Promise<{ bookingId: string }> };

function money(pence: number | null | undefined): string | null {
  if (pence == null) return null;
  return `£${(pence / 100).toFixed(2)}`;
}

export default async function AccountBookingDetailPage({ params }: PageProps) {
  const { bookingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase.from('user_profiles').select('timezone').eq('id', user.id).maybeSingle();
  const profileTz = (profile?.timezone as string | null | undefined)?.trim() || null;

  const booking = await loadAccountBookingById(supabase, getSupabaseAdminClient(), bookingId);
  if (!booking) notFound();

  // Prefer the venue's timezone (the slot is the venue's wall clock); fall back to the
  // user's profile timezone, then Europe/London — one convention across all surfaces.
  const displayTz = accountBookingTimeZone(booking, profileTz);
  const { date: dateHeading, time: timeHeading } = formatAccountBookingDateTime(
    booking.booking_date,
    booking.booking_time,
    displayTz,
    { withWeekday: true },
  );
  const endTime = booking.booking_end_time ? booking.booking_end_time.slice(0, 5) : null;

  const cde = booking.cde_context;
  const friendlyStatus = friendlyAccountBookingStatus(booking.status);
  const isClassGroup = booking.booking_model === 'class_session' && !!booking.group_booking_id;

  // Card-hold deposits (§10.1): the signed-in booking detail page is a
  // consent-bearing surface, so it carries the same hold line as the manage
  // page for the held/charged states. The fee comes from the hold row (one
  // indexed admin read; only done when deposit_status says a hold exists).
  const depositStatusLower = (booking.deposit_status ?? '').toLowerCase();
  let cardHoldLine: string | null = null;
  if (depositStatusLower === 'card held' || depositStatusLower === 'charged') {
    const { data: holdRow } = await getSupabaseAdminClient()
      .from('booking_card_holds')
      .select('fee_pence, released_at, charged_pence, charged_at, stripe_payment_method_id')
      .eq('booking_id', booking.id)
      .maybeSingle();
    const holdSummary = deriveGuestCardHoldSummary(
      booking,
      (holdRow as GuestCardHoldRowInput | null) ?? null,
    );
    const venueName = booking.venue?.name ?? 'The venue';
    if (holdSummary?.state === 'held') {
      cardHoldLine = `Your card is securely on file. ${venueName} may charge a no-show fee of up to ${formatCardHoldFeePence(holdSummary.fee_pence)} if you miss this booking. Cancel before it starts to avoid any charge.`;
    } else if (holdSummary?.state === 'charged' && holdSummary.charged_pence != null) {
      const chargedDate = holdSummary.charged_at
        ? ` on ${new Date(holdSummary.charged_at).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}`
        : '';
      cardHoldLine = `A no-show fee of ${formatCardHoldFeePence(holdSummary.charged_pence)} was charged for this booking${chargedDate}.`;
    }
  }

  const headerTitle = cde?.title ?? booking.venue?.name ?? 'Booking details';
  const headerSubtitleParts = [
    `${bookingModelShortLabel(booking.booking_model)} booking`,
    friendlyStatus,
  ];
  if (cde && booking.venue?.name) headerSubtitleParts.unshift(booking.venue.name);

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
            title={headerTitle}
            subtitle={headerSubtitleParts.join(' · ')}
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
          {cde ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {bookingModelShortLabel(booking.booking_model)}
              </dt>
              <dd className="mt-1 font-medium text-slate-900">{cde.title}</dd>
              {cde.subtitle ? <dd className="mt-0.5 text-sm text-slate-600">{cde.subtitle}</dd> : null}
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date</dt>
            <dd className="mt-1 text-slate-900">{dateHeading}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Time</dt>
            <dd className="mt-1 text-slate-900">
              {timeHeading ?? booking.booking_time.slice(0, 5)}
              {endTime ? ` to ${endTime}` : ''}
            </dd>
            <dd className="mt-0.5 text-xs text-slate-500">Shown in the venue’s local time.</dd>
          </div>
          {cde?.duration_minutes ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Duration</dt>
              <dd className="mt-1 text-slate-900">{cde.duration_minutes} minutes</dd>
            </div>
          ) : null}
          {cde?.class_spots && cde.class_spots.capacity > 0 ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Class spaces</dt>
              <dd className="mt-1 text-slate-900">
                {cde.class_spots.remaining > 0
                  ? `${cde.class_spots.remaining} of ${cde.class_spots.capacity} space${
                      cde.class_spots.capacity === 1 ? '' : 's'
                    } left`
                  : 'Fully booked'}
              </dd>
              <dd className="mt-0.5 text-xs text-slate-500">
                {cde.class_spots.booked} of {cde.class_spots.capacity} booked
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {booking.booking_model === 'event_ticket'
                ? 'Tickets'
                : booking.booking_model === 'resource_booking'
                  ? 'Bookers'
                  : 'Party size'}
            </dt>
            <dd className="mt-1 text-slate-900">{booking.party_size}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
            <dd className="mt-1 text-slate-900">{friendlyStatus}</dd>
          </div>
          {cde?.ticket_lines && cde.ticket_lines.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ticket breakdown</dt>
              <dd className="mt-1">
                <ul className="space-y-1 text-sm text-slate-900">
                  {cde.ticket_lines.map((line, i) => (
                    <li key={`${line.label}-${i}`} className="flex justify-between gap-3">
                      <span>
                        {line.quantity} × {line.label}
                      </span>
                      {line.unit_price_pence > 0 ? (
                        <span className="text-slate-600">{money(line.unit_price_pence * line.quantity)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deposit</dt>
            <dd className="mt-1 text-slate-900">
              {booking.deposit_status ?? 'Not required'}
              {money(booking.deposit_amount_pence) ? ` · ${money(booking.deposit_amount_pence)}` : ''}
            </dd>
            {cardHoldLine ? (
              <dd className="mt-1.5 text-sm leading-relaxed text-slate-600">{cardHoldLine}</dd>
            ) : null}
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

        {isClassGroup ? (
          <p className="mt-5 rounded-xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
            This is one session of a multi-session course. <strong>Manage booking</strong> on this page affects
            <strong> only this session</strong> — your other sessions stay booked. To change the whole course,
            cancel each session from your bookings list or contact the venue.
          </p>
        ) : null}
      </div>
    </div>
  );
}
