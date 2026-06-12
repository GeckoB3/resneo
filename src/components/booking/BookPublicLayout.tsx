import type { CSSProperties } from 'react';

import { BookPublicPageContent } from '@/components/booking/BookPublicPageContent';

import type { LockedPractitionerBooking } from '@/components/booking/BookingFlowRouter';

import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';

import { BookVenueTitle } from '@/components/booking/BookVenueTitle';

import { bookingPageThemeVars } from '@/lib/booking/booking-page-theme';
import { normalizeWebsiteUrlForLink } from '@/lib/emails/external-links';

import { BookingPageCoverBanner } from '@/components/booking/BookingPageCoverBanner';
import {
  bookingPageCoverCropBoxFromConfig,
  bookingPageCoverIsFullWidth,
} from '@/lib/booking/booking-page-cover';
import { BookingPageLogo } from '@/components/booking/BookingPageLogo';
import { BookingPageSocialLinks } from '@/components/booking/BookingPageSocialLinks';
import { BOOKING_FONT_STYLESHEET, bookingPageFontVars } from '@/lib/booking/booking-page-font-presets';

import {

  bookingPageHideAboutTabContentFromHeader,

  bookingPageShowsAboutTab,

  bookingPageShowsServicesTab,

  bookingPageShowsTeamTab,

  resolveBookingPageTeamMembers,

  type BookingPagePublicService,

} from '@/lib/booking/booking-page-tabs';

import { BookOpeningHours } from '@/components/booking/BookOpeningHours';
import type { VenuePublic } from '@/components/booking/types';
import type { BookingPageLogoCrop } from '@/lib/booking/booking-page-logo';
import type { BookingPageSocialLinks as BookingPageSocialLinksConfig } from '@/lib/booking/booking-page-theme';

interface BookPublicVenueIdentityProps {
  venue: VenuePublic;
  isAppointment: boolean;
  about: string;
  socialLinks: BookingPageSocialLinksConfig | null;
  logoCrop?: BookingPageLogoCrop | null;
  /** Centre block when there is no logo (cover-less layout only). */
  centered?: boolean;
  /** Hides welcome text, social links, and opening hours (About-tab content). Address, phone, and website stay visible. */
  hideAboutTabContent?: boolean;
}

function BookPublicVenueIdentity({
  venue,
  isAppointment,
  about,
  socialLinks,
  logoCrop,
  centered = false,
  hideAboutTabContent = false,
}: BookPublicVenueIdentityProps) {
  const websiteHref = normalizeWebsiteUrlForLink(venue.website_url);
  const showContactRow =
    Boolean(venue.address?.trim()) ||
    Boolean(venue.phone?.trim()) ||
    Boolean(websiteHref) ||
    (!hideAboutTabContent && venue.opening_hours);

  return (
    <div className={venue.logo_url ? 'flex items-center gap-4' : centered ? 'mx-auto w-fit' : ''}>
      {venue.logo_url && (
        <BookingPageLogo logoUrl={venue.logo_url} crop={logoCrop} size="sm" />
      )}

      <div className={venue.logo_url ? 'min-w-0 flex-1' : ''}>
        <BookVenueTitle name={venue.name} isAppointment={isAppointment} variant="dark" />

        {showContactRow ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
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
            {websiteHref ? (
              <a
                href={websiteHref}
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
            ) : null}
            {!hideAboutTabContent && venue.opening_hours ? (
              <BookOpeningHours hours={venue.opening_hours} />
            ) : null}
          </div>
        ) : null}

        {!hideAboutTabContent && about ? (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{about}</p>
        ) : null}

        {!hideAboutTabContent && socialLinks ? (
          <BookingPageSocialLinks links={socialLinks} className="mt-3" />
        ) : null}
      </div>
    </div>
  );
}

interface BookPublicLayoutProps {

  venue: VenuePublic;

  lockedPractitioner?: LockedPractitionerBooking | null;

  /** Bookable team members for the Meet the team tab (omit when tab is off). */

  team?: Array<{ id: string; name: string }>;

  /** Services for the Services tab (omit when tab is off). */

  services?: BookingPagePublicService[];

}



export function BookPublicLayout({

  venue,

  lockedPractitioner,

  team,

  services = [],

}: BookPublicLayoutProps) {

  const isAppointment = isUnifiedSchedulingVenue(venue.booking_model);

  const pageConfig = venue.booking_page_config ?? null;

  const fontVars = bookingPageFontVars(pageConfig?.font_preset);

  const themeVars = { ...bookingPageThemeVars(pageConfig), ...fontVars } as CSSProperties;

  const hasHeadingFont = Boolean(fontVars['--font-heading']);

  const about = pageConfig?.about?.trim() ?? '';

  const announcement = pageConfig?.announcement?.trim() ?? '';

  const socialLinks = pageConfig?.social_links ?? null;

  const gallery = (pageConfig?.gallery ?? []).filter((u) => typeof u === 'string' && u.trim());

  const teamProfiles = pageConfig?.team_profiles ?? {};

  const showTeamTab = bookingPageShowsTeamTab(pageConfig);

  const teamMembers =

    showTeamTab && isAppointment

      ? resolveBookingPageTeamMembers(team ?? [], teamProfiles)

      : [];

  const showServicesTab = bookingPageShowsServicesTab(pageConfig);

  const servicesForTab = showServicesTab && isAppointment ? services : [];

  const showAboutTab = bookingPageShowsAboutTab(pageConfig, venue.booking_model);
  const hideAboutTabContentFromHeader = bookingPageHideAboutTabContentFromHeader(
    pageConfig,
    venue.booking_model,
  );
  const coverFullWidth = bookingPageCoverIsFullWidth(pageConfig);
  const coverCropBox = bookingPageCoverCropBoxFromConfig(pageConfig);

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

      className="flex min-h-[100dvh] min-h-screen flex-col bg-slate-50"

      style={themeVars}

      data-bp-fonts={hasHeadingFont ? '' : undefined}

    >

      <link rel="stylesheet" href={BOOKING_FONT_STYLESHEET} />

      {announcement && (

        <div className="bg-brand-600 px-4 py-2 text-center text-sm font-medium text-white">

          <p className="mx-auto max-w-lg">{announcement}</p>

        </div>

      )}



      {venue.cover_photo_url && coverFullWidth ? (
        <BookingPageCoverBanner
          coverUrl={venue.cover_photo_url}
          cropBox={coverCropBox}
          fullWidth
        />
      ) : null}

      <div
        className={`relative border-b border-slate-100 bg-white px-4 pb-6 pt-5${
          venue.cover_photo_url && coverFullWidth ? ' -mt-6 rounded-t-2xl shadow-sm' : ''
        }`}
      >
        <div className={`mx-auto max-w-lg${venue.cover_photo_url && !coverFullWidth ? ' space-y-4' : ''}`}>
          {venue.cover_photo_url && !coverFullWidth ? (
            <BookingPageCoverBanner
              coverUrl={venue.cover_photo_url}
              cropBox={coverCropBox}
              fullWidth={false}
            />
          ) : null}
          <BookPublicVenueIdentity
            venue={venue}
            isAppointment={isAppointment}
            about={showAboutTab ? about : ''}
            socialLinks={showAboutTab ? socialLinks : null}
            logoCrop={pageConfig?.logo_crop}
            centered={!venue.logo_url && !venue.cover_photo_url}
            hideAboutTabContent={hideAboutTabContentFromHeader}
          />
        </div>
      </div>

      <BookPublicPageContent
        venue={venue}
        lockedPractitioner={lockedPractitioner}
        services={servicesForTab}
        teamMembers={teamMembers}
        aboutText={showAboutTab ? about : ''}
        socialLinks={showAboutTab ? socialLinks : null}
        gallery={showAboutTab ? gallery : []}
      />



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

    </main>

  );

}


