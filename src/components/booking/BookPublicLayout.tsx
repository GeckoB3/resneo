import { BookPublicBookingFlowSuspense } from '@/components/booking/BookPublicBookingFlowSuspense';
import type { LockedPractitionerBooking } from '@/components/booking/BookingFlowRouter';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import type { CSSProperties } from 'react';
import { BookVenueTitle } from '@/components/booking/BookVenueTitle';
import { bookingPageThemeVars, type BookingPageSocialLinks } from '@/lib/booking/booking-page-theme';
import { BOOKING_FONT_CLASSNAMES, bookingPageFontVars } from '@/lib/booking/booking-page-fonts';
import type { VenuePublic, OpeningHours } from '@/components/booking/types';

const SOCIAL_PLATFORMS: Array<{ key: keyof BookingPageSocialLinks; label: string; path: string }> = [
  {
    key: 'instagram',
    label: 'Instagram',
    path: 'M12 2.2c3.2 0 3.6 0 4.9.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.86s0 3.6-.07 4.86c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.9.07s-3.6 0-4.86-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.86c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.4 2.2 8.8 2.2 12 2.2Zm0 1.8c-3.15 0-3.5 0-4.74.07-.9.04-1.38.19-1.7.31-.43.17-.74.37-1.06.69-.32.32-.52.63-.69 1.06-.12.32-.27.8-.31 1.7C3.43 8.95 3.42 9.3 3.42 12s0 3.05.07 4.27c.04.9.19 1.38.31 1.7.17.43.37.74.69 1.06.32.32.63.52 1.06.69.32.12.8.27 1.7.31 1.24.06 1.59.07 4.74.07s3.5 0 4.74-.07c.9-.04 1.38-.19 1.7-.31.43-.17.74-.37 1.06-.69.32-.32.52-.63.69-1.06.12-.32.27-.8.31-1.7.06-1.22.07-1.57.07-4.27s0-3.05-.07-4.27c-.04-.9-.19-1.38-.31-1.7a2.86 2.86 0 0 0-.69-1.06 2.86 2.86 0 0 0-1.06-.69c-.32-.12-.8-.27-1.7-.31C15.5 4 15.15 4 12 4Zm0 3.06A4.94 4.94 0 1 1 12 17a4.94 4.94 0 0 1 0-9.88Zm0 1.8a3.14 3.14 0 1 0 0 6.28 3.14 3.14 0 0 0 0-6.28Zm5.14-.7a1.15 1.15 0 1 1-2.3 0 1.15 1.15 0 0 1 2.3 0Z',
  },
  {
    key: 'facebook',
    label: 'Facebook',
    path: 'M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.44 2.9h-2.34V22c4.78-.79 8.43-4.94 8.43-9.94Z',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    path: 'M16.5 2h-3v13.2a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.07V9.8a5.7 5.7 0 0 0-.6-.03 5.6 5.6 0 1 0 5.6 5.6V8.9a7 7 0 0 0 4 1.27V7.1a4 4 0 0 1-4-4Z',
  },
  {
    key: 'x',
    label: 'X',
    path: 'M17.53 3h2.97l-6.49 7.42L21.75 21h-5.97l-4.68-6.12L5.74 21H2.77l6.94-7.93L2.5 3h6.12l4.23 5.6L17.53 3Zm-1.04 16.2h1.64L7.6 4.72H5.84L16.49 19.2Z',
  },
];

function SocialLinks({ links }: { links: BookingPageSocialLinks }) {
  const items = SOCIAL_PLATFORMS.filter((p) => links[p.key]?.trim());
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {items.map((p) => (
        <a
          key={p.key}
          href={links[p.key]!.trim()}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={p.label}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d={p.path} />
          </svg>
        </a>
      ))}
    </div>
  );
}

const DAY_LABELS: Record<string, string> = {
  '0': 'Sunday',
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
};
const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = (h ?? 0) >= 12 ? 'pm' : 'am';
  const h12 = (h ?? 0) % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

function OpeningHoursDisplay({ hours }: { hours: OpeningHours }) {
  const hasAnyOpen = DAY_ORDER.some((d) => {
    const day = hours[d];
    return day && !('closed' in day && day.closed);
  });
  if (!hasAnyOpen) return null;

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <details className="group rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-slate-700">
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            Opening hours
          </span>
          <svg
            className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className="border-t border-slate-100 px-4 py-3">
          <dl className="space-y-1.5">
            {DAY_ORDER.map((d) => {
              const day = hours[d];
              const label = DAY_LABELS[d]!;
              const closed = !day || ('closed' in day && day.closed);
              const periods = !closed && 'periods' in day ? day.periods : [];
              return (
                <div key={d} className="flex justify-between text-sm">
                  <dt className="font-medium text-slate-600">{label}</dt>
                  <dd className={closed ? 'text-slate-400' : 'text-slate-700'}>
                    {closed
                      ? 'Closed'
                      : periods.map((p, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-slate-300"> &middot; </span>}
                            {formatTime(p.open)}&ndash;{formatTime(p.close)}
                          </span>
                        ))}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </details>
    </div>
  );
}

interface BookPublicLayoutProps {
  venue: VenuePublic;
  lockedPractitioner?: LockedPractitionerBooking | null;
}

export function BookPublicLayout({ venue, lockedPractitioner }: BookPublicLayoutProps) {
  const isAppointment = isUnifiedSchedulingVenue(venue.booking_model);
  const pageConfig = venue.booking_page_config ?? null;
  const fontVars = bookingPageFontVars(pageConfig?.font_preset);
  const themeVars = { ...bookingPageThemeVars(pageConfig), ...fontVars } as CSSProperties;
  const hasHeadingFont = Boolean(fontVars['--font-heading']);
  const about = pageConfig?.about?.trim() ?? '';
  const announcement = pageConfig?.announcement?.trim() ?? '';
  const socialLinks = pageConfig?.social_links ?? null;
  const gallery = (pageConfig?.gallery ?? []).filter((u) => typeof u === 'string' && u.trim());

  if (venue.booking_paused) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-16">
        <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Online booking unavailable</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Online booking for {venue.name} is temporarily unavailable. Please contact them directly to make a booking.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`flex min-h-[100dvh] min-h-screen flex-col bg-slate-50 ${BOOKING_FONT_CLASSNAMES}`}
      style={themeVars}
      data-bp-fonts={hasHeadingFont ? '' : undefined}
    >
      {/* Announcement banner (venue-branded) */}
      {announcement && (
        <div className="bg-brand-600 px-4 py-2 text-center text-sm font-medium text-white">
          <p className="mx-auto max-w-lg">{announcement}</p>
        </div>
      )}

      {/* Cover photo — thin banner, no dark overlay */}
      {venue.cover_photo_url && (
        <div className="h-36 w-full overflow-hidden sm:h-44">
          <img src={venue.cover_photo_url} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      {/* White header card — overlaps cover photo when present */}
      <div
        className={`relative bg-white border-b border-slate-100 px-4 pb-6 pt-5${
          venue.cover_photo_url ? ' -mt-6 rounded-t-2xl shadow-sm' : ''
        }`}
      >
        <div className="mx-auto max-w-lg">
          <div className={venue.logo_url ? 'flex items-center gap-4' : 'mx-auto w-fit'}>
            {/* Logo */}
            {venue.logo_url && (
              <div className="shrink-0">
                <div className="h-16 w-16 rounded-full bg-white p-1 ring-1 ring-slate-200 shadow-[0_2px_10px_rgba(15,23,42,0.08)] sm:h-20 sm:w-20">
                  <img src={venue.logo_url} alt="" className="h-full w-full rounded-full object-cover bg-white" />
                </div>
              </div>
            )}

            <div className={venue.logo_url ? 'min-w-0 flex-1' : ''}>
              <BookVenueTitle name={venue.name} isAppointment={isAppointment} variant="dark" />

              {(venue.address || venue.phone || venue.website_url) && (
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                  {venue.address && (
                    <span className="flex items-center gap-1.5">
                      <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                      </svg>
                      {venue.address}
                    </span>
                  )}
                  {venue.phone && (
                    <a href={`tel:${venue.phone}`} className="flex items-center gap-1.5 hover:text-slate-700">
                      <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
                        />
                      </svg>
                      {venue.phone}
                    </a>
                  )}
                  {venue.website_url && (
                    <a
                      href={venue.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 max-w-full items-center gap-1.5 break-all hover:text-slate-700"
                    >
                      <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                        />
                      </svg>
                      <span className="underline decoration-slate-300 underline-offset-2">Visit website</span>
                    </a>
                  )}
                </div>
              )}

              {about && (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{about}</p>
              )}

              {socialLinks && <SocialLinks links={socialLinks} />}
            </div>
          </div>
        </div>
      </div>

      {gallery.length > 0 && (
        <div className="mx-auto w-full max-w-lg px-4 pt-6">
          <div className="grid grid-cols-3 gap-1.5 overflow-hidden rounded-2xl">
            {gallery.map((url, i) => (
              <img
                key={`${url}-${i}`}
                src={url}
                alt=""
                loading="lazy"
                className="aspect-square h-full w-full object-cover"
              />
            ))}
          </div>
        </div>
      )}

      {venue.opening_hours && <OpeningHoursDisplay hours={venue.opening_hours} />}

      <div className="flex flex-1 flex-col">
        <div
          id="booking-form-start"
          className={`mx-auto w-full flex-1 scroll-mt-4 px-4 pb-6 ${isAppointment ? 'py-6 sm:py-8' : 'max-w-lg py-8'}`}
        >
          <BookPublicBookingFlowSuspense venue={venue} lockedPractitioner={lockedPractitioner ?? undefined} />
        </div>

        <footer className="mt-auto shrink-0 border-t border-slate-200 bg-white/95 px-4 py-3 pb-safe text-center text-xs leading-relaxed text-slate-400 backdrop-blur">
          <p className="mx-auto max-w-lg">
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-brand-600">
              Privacy Policy
            </a>
            {' · '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-brand-600">
              Website Terms of Use
            </a>
            {' · '}
            <a href="https://www.resneo.com" target="_blank" rel="noopener noreferrer" className="hover:text-brand-600">
              Powered by Resneo
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
