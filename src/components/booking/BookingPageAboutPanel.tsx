import type { ReactNode } from 'react';
import { BOOKING_TAB_PANEL_CLASS, BOOKING_TAB_PANEL_INSET_CLASS } from '@/components/booking/appointment-public-ui';
import { BookOpeningHours } from '@/components/booking/BookOpeningHours';
import { BookingPageSocialLinks } from '@/components/booking/BookingPageSocialLinks';
import { BookVenueTitle } from '@/components/booking/BookVenueTitle';
import type { VenuePublic } from '@/components/booking/types';
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsEmbedUrl,
  normalizeWebsiteUrlForLink,
} from '@/lib/emails/external-links';
import type { BookingPageSocialLinks as BookingPageSocialLinksConfig } from '@/lib/booking/booking-page-theme';

function AboutContactRow({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-sm text-slate-600">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </div>
  );
}

function LocationIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
      />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
      />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
      />
    </svg>
  );
}

interface BookingPageAboutPanelProps {
  venue: VenuePublic;
  isAppointment: boolean;
  aboutText: string;
  socialLinks: BookingPageSocialLinksConfig | null;
  gallery: string[];
}

export function BookingPageAboutPanel({
  venue,
  isAppointment,
  aboutText,
  socialLinks,
  gallery,
}: BookingPageAboutPanelProps) {
  const websiteHref = normalizeWebsiteUrlForLink(venue.website_url);
  const mapsEmbedUrl = buildGoogleMapsEmbedUrl(venue.address);
  const mapsDirectionsUrl = buildGoogleMapsDirectionsUrl(venue.address);
  const hasContact =
    Boolean(venue.address?.trim()) ||
    Boolean(venue.phone?.trim()) ||
    Boolean(websiteHref) ||
    Boolean(venue.opening_hours);
  const hasSocial =
    socialLinks &&
    (socialLinks.instagram?.trim() ||
      socialLinks.facebook?.trim() ||
      socialLinks.tiktok?.trim() ||
      socialLinks.x?.trim());

  return (
    <div className={`${BOOKING_TAB_PANEL_CLASS} ${BOOKING_TAB_PANEL_INSET_CLASS}`}>
      <div className="space-y-4">
        <article className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.04] sm:p-5">
          <BookVenueTitle name={venue.name} isAppointment={isAppointment} variant="dark" />

          {hasContact ? (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              {venue.address?.trim() ? (
                <AboutContactRow icon={<LocationIcon className="h-4 w-4" />}>
                  <p className="font-medium text-slate-900">Address</p>
                  <p className="mt-0.5 leading-relaxed">{venue.address.trim()}</p>
                </AboutContactRow>
              ) : null}
              {venue.phone?.trim() ? (
                <AboutContactRow icon={<PhoneIcon className="h-4 w-4" />}>
                  <p className="font-medium text-slate-900">Phone</p>
                  <a href={`tel:${venue.phone.trim()}`} className="mt-0.5 inline-block hover:text-brand-700">
                    {venue.phone.trim()}
                  </a>
                </AboutContactRow>
              ) : null}
              {venue.opening_hours ? (
                <AboutContactRow
                  icon={
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                  }
                >
                  <p className="font-medium text-slate-900">Opening hours</p>
                  <div className="mt-1">
                    <BookOpeningHours hours={venue.opening_hours} variant="expanded" />
                  </div>
                </AboutContactRow>
              ) : null}
              {websiteHref ? (
                <AboutContactRow icon={<LinkIcon className="h-4 w-4" />}>
                  <p className="font-medium text-slate-900">Website</p>
                  <a
                    href={websiteHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-brand-700 underline decoration-brand-200 underline-offset-2 hover:text-brand-800"
                  >
                    Visit website
                  </a>
                </AboutContactRow>
              ) : null}
            </div>
          ) : null}
        </article>

        {aboutText ? (
          <article className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.04] sm:p-5">
            <h3 className="text-sm font-semibold text-slate-900">Welcome</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{aboutText}</p>
          </article>
        ) : null}

        {mapsEmbedUrl ? (
          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04]">
            <div className="relative aspect-[16/10] w-full bg-slate-100">
              <iframe
                title={`Map showing location of ${venue.name}`}
                src={mapsEmbedUrl}
                className="absolute inset-0 h-full w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            </div>
            {mapsDirectionsUrl ? (
              <p className="border-t border-slate-100 px-4 py-3 text-center text-sm">
                <a
                  href={mapsDirectionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-700 hover:text-brand-800"
                >
                  Open in Google Maps
                </a>
              </p>
            ) : null}
          </section>
        ) : null}

        {gallery.length > 0 ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Gallery</h3>
            <div className="grid grid-cols-3 gap-1.5 overflow-hidden rounded-2xl ring-1 ring-slate-200/90">
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
          </section>
        ) : null}

        {hasSocial && socialLinks ? (
          <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.04] sm:p-5">
            <h3 className="text-sm font-semibold text-slate-900">Follow us</h3>
            <BookingPageSocialLinks links={socialLinks} className="mt-3" />
          </section>
        ) : null}
      </div>
    </div>
  );
}
