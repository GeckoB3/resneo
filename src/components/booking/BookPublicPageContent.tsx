'use client';

import { useMemo, useState } from 'react';
import { BookPublicBookingFlowSuspense } from '@/components/booking/BookPublicBookingFlowSuspense';
import type { LockedPractitionerBooking } from '@/components/booking/BookingFlowRouter';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { BOOKING_TAB_PANEL_CLASS, BOOKING_TAB_PANEL_INSET_CLASS } from '@/components/booking/appointment-public-ui';
import { BookingPageAboutPanel } from '@/components/booking/BookingPageAboutPanel';
import {
  formatBookingPageDuration,
  formatBookingPagePrice,
  resolveBookingPageTabs,
  type BookingPagePublicService,
  type BookingPageTabId,
  type BookingPageTeamMember,
} from '@/lib/booking/booking-page-tabs';
import type { BookingPageSocialLinks } from '@/lib/booking/booking-page-theme';
import type { VenuePublic } from '@/components/booking/types';

const TAB_LABELS: Record<BookingPageTabId, string> = {
  book: 'Book now',
  services: 'Services',
  team: 'Meet the team',
  about: 'About',
};

function ServiceDurationIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function ServiceMetaPills({
  price,
  duration,
  className = '',
}: {
  price: string | null;
  duration: string;
  className?: string;
}) {
  const showDuration = Boolean(duration);
  const showPrice = Boolean(price);
  if (!showDuration && !showPrice) return null;

  return (
    <div className={`flex min-w-0 flex-wrap gap-2 ${className}`}>
      {showDuration ? (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-100/90 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200/60">
          <ServiceDurationIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="truncate">{duration}</span>
        </span>
      ) : null}
      {showPrice ? (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 ring-1 ring-brand-100">
          <span className="truncate">{price}</span>
        </span>
      ) : null}
    </div>
  );
}

const SERVICE_THUMB_CLASS =
  'h-[4.5rem] w-[4.5rem] shrink-0 rounded-xl object-cover object-center ring-1 ring-slate-200/90 sm:h-20 sm:w-20';

function ServiceCardInitial({ name }: { name: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 text-base font-bold text-brand-800 ring-1 ring-brand-200/80 sm:text-lg ${SERVICE_THUMB_CLASS}`}
      aria-hidden
    >
      {letter}
    </div>
  );
}

function ServiceCardThumbnail({ name, imageUrl }: { name: string; imageUrl: string }) {
  return (
    <img
      src={imageUrl}
      alt={name}
      loading="lazy"
      className={`bg-slate-100 ${SERVICE_THUMB_CLASS}`}
    />
  );
}

function BookingPageServiceCard({ svc }: { svc: BookingPagePublicService }) {
  const price = formatBookingPagePrice(svc.price_pence);
  const duration = formatBookingPageDuration(svc.duration_minutes);
  const hasMeta = Boolean(price || duration);
  const photoUrl = svc.image_url?.trim() ?? '';
  const description = svc.description?.trim() ?? '';

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm ring-1 ring-slate-900/[0.04] sm:p-4">
      <div className="flex items-start gap-3 sm:gap-3.5">
        {photoUrl ? (
          <ServiceCardThumbnail name={svc.name} imageUrl={photoUrl} />
        ) : (
          <ServiceCardInitial name={svc.name} />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-pretty text-base font-semibold leading-snug tracking-tight text-slate-900 sm:text-[1.0625rem]">
            {svc.name}
          </h3>
          {hasMeta ? <ServiceMetaPills price={price} duration={duration} /> : null}
          {description ? (
            <p className="text-pretty whitespace-pre-line text-sm leading-relaxed text-slate-600">{description}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function BookingPageServicesPanel({ services }: { services: BookingPagePublicService[] }) {
  if (services.length === 0) {
    return (
      <div className={`${BOOKING_TAB_PANEL_CLASS} px-4 py-10 text-center`}>
        <p className="text-sm text-slate-600">No services are available to show yet.</p>
      </div>
    );
  }

  return (
    <div className={`${BOOKING_TAB_PANEL_CLASS} ${BOOKING_TAB_PANEL_INSET_CLASS}`}>
      <h2 className="mb-5 text-pretty text-lg font-semibold tracking-tight text-slate-900">Our services</h2>
      <ul className="flex list-none flex-col gap-4 p-0 m-0">
        {services.map((svc) => (
          <li key={svc.id} className="min-w-0">
            <BookingPageServiceCard svc={svc} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BookingPageTeamPanel({ members }: { members: BookingPageTeamMember[] }) {
  if (members.length === 0) {
    return (
      <div className={`${BOOKING_TAB_PANEL_CLASS} px-4 py-10 text-center`}>
        <p className="text-sm text-slate-600">No team profiles are visible yet.</p>
      </div>
    );
  }

  return (
    <div className={`${BOOKING_TAB_PANEL_CLASS} ${BOOKING_TAB_PANEL_INSET_CLASS}`}>
      <div className="space-y-3">
        {members.map((m) => {
          const specialties = (m.profile.specialties ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          return (
            <div key={m.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              {m.profile.photo?.trim() ? (
                <img
                  src={m.profile.photo.trim()}
                  alt=""
                  loading="lazy"
                  className="h-16 w-16 flex-shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                />
              ) : (
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-700 ring-1 ring-slate-200">
                  {m.name.trim().charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">{m.name}</p>
                {specialties.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {specialties.map((s, i) => (
                      <span
                        key={`${s}-${i}`}
                        className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {m.profile.bio?.trim() ? (
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                    {m.profile.bio.trim()}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface BookPublicPageContentProps {
  venue: VenuePublic;
  lockedPractitioner?: LockedPractitionerBooking | null;
  services: BookingPagePublicService[];
  teamMembers: BookingPageTeamMember[];
  aboutText: string;
  socialLinks: BookingPageSocialLinks | null;
  gallery: string[];
}

export function BookPublicPageContent({
  venue,
  lockedPractitioner,
  services,
  teamMembers,
  aboutText,
  socialLinks,
  gallery,
}: BookPublicPageContentProps) {
  const isAppointment = isUnifiedSchedulingVenue(venue.booking_model);
  const tabs = useMemo(
    () => resolveBookingPageTabs(venue.booking_page_config ?? null, venue.booking_model),
    [venue.booking_page_config, venue.booking_model],
  );
  const hasExtraTabs = tabs.length > 1;
  const [activeTab, setActiveTab] = useState<BookingPageTabId>('book');
  const effectiveTab = tabs.includes(activeTab) ? activeTab : 'book';

  const showBookPanel = !hasExtraTabs || effectiveTab === 'book';
  const showServicesPanel = hasExtraTabs && effectiveTab === 'services';
  const showTeamPanel = hasExtraTabs && effectiveTab === 'team';
  const showAboutPanel = hasExtraTabs && effectiveTab === 'about';

  return (
    <>
      {hasExtraTabs ? (
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
          <div className={`${BOOKING_TAB_PANEL_CLASS} px-4 py-3`}>
            <div
              className="flex gap-1 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200/80"
              role="tablist"
              aria-label="Booking page sections"
            >
              {tabs.map((tab) => {
                const selected = effectiveTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveTab(tab)}
                    className={`min-w-0 flex-1 rounded-lg px-1.5 py-2.5 text-center text-xs font-semibold transition-all duration-150 sm:px-2.5 sm:text-sm ${
                      selected
                        ? 'bg-brand-600 text-white shadow-md ring-1 ring-brand-700/40'
                        : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                    }`}
                  >
                    {TAB_LABELS[tab]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {showBookPanel ? (
        <>
          <div className="flex flex-1 flex-col">
            <div
              id="booking-form-start"
              className={`mx-auto w-full flex-1 scroll-mt-4 px-4 pb-6 ${isAppointment ? 'py-6 sm:py-8' : 'max-w-lg py-8'}`}
            >
              <BookPublicBookingFlowSuspense venue={venue} lockedPractitioner={lockedPractitioner ?? undefined} />
            </div>
          </div>
        </>
      ) : null}

      {showServicesPanel ? <BookingPageServicesPanel services={services} /> : null}
      {showTeamPanel ? <BookingPageTeamPanel members={teamMembers} /> : null}
      {showAboutPanel ? (
        <BookingPageAboutPanel
          venue={venue}
          isAppointment={isAppointment}
          aboutText={aboutText}
          socialLinks={socialLinks}
          gallery={gallery}
        />
      ) : null}
    </>
  );
}
