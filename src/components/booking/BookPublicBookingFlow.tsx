'use client';

import { useCallback, useEffect, useMemo, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { BookingModel } from '@/types/booking-models';
import {
  publicBookTabsForVenue,
  resolvePublicBookTabFromQuery,
  type PublicBookTabSlug,
} from '@/lib/booking/public-book-tabs';
import { resolveActiveBookingModels } from '@/lib/booking/active-models';
import { BookingFlowRouter, type LockedPractitionerBooking } from '@/components/booking/BookingFlowRouter';
import { PublicBookingAccountGateProvider } from '@/components/booking/PublicBookingAccountGate';
import type { VenuePublic } from '@/components/booking/types';
import {
  appointmentAccentStyle,
  APPOINTMENT_PUBLIC_SHELL_MAX_WIDTH_CLASS,
  APPOINTMENT_PUBLIC_TAB_INACTIVE,
} from '@/components/booking/appointment-public-ui';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';

const EMPTY_ENABLED: BookingModel[] = [];

interface Props {
  venue: VenuePublic;
  lockedPractitioner?: LockedPractitionerBooking | null;
  embed?: boolean;
  /** Embed only: notifies parent iframe to remeasure (no intrinsic height payload). */
  onHeightChange?: () => void;
  accentColour?: string;
  /** §7.7: set when this flow is mounted inside a venue collective page. */
  collectiveId?: string;
}

export function BookPublicBookingFlow({
  venue,
  lockedPractitioner,
  embed,
  onHeightChange,
  accentColour,
  collectiveId,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tabPending, startTabTransition] = useTransition();
  const activeModels = useMemo(
    () =>
      resolveActiveBookingModels({
        bookingModel: venue.booking_model,
        enabledModels: venue.enabled_models ?? EMPTY_ENABLED,
        activeBookingModels: venue.active_booking_models,
      }),
    [venue.active_booking_models, venue.booking_model, venue.enabled_models],
  );

  const tabs = useMemo(
    () => publicBookTabsForVenue(activeModels, venue.terminology),
    [activeModels, venue.terminology],
  );

  const tabParam = searchParams.get('tab');
  const waitlistOfferEntryId = searchParams.get('waitlist_offer') ?? undefined;
  const waitlistPrefillDate = searchParams.get('date') ?? undefined;
  const waitlistPrefillTime = searchParams.get('time') ?? undefined;
  const waitlistPrefillServiceId = searchParams.get('service_id') ?? undefined;
  const activeSlug = useMemo(
    () => resolvePublicBookTabFromQuery(tabParam, activeModels, venue.terminology),
    [tabParam, activeModels, venue.terminology],
  );

  const activeModel = useMemo(() => {
    const found = tabs.find((t) => t.slug === activeSlug);
    return found?.bookingModel ?? activeModels[0] ?? 'table_reservation';
  }, [tabs, activeSlug, activeModels]);

  const replaceTabInUrl = useCallback(
    (slug: PublicBookTabSlug) => {
      startTabTransition(() => {
        const next = new URLSearchParams(searchParams.toString());
        next.set('tab', slug);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (tabs.length <= 1) return;
    const resolved = resolvePublicBookTabFromQuery(tabParam, activeModels, venue.terminology);
    if (tabParam === resolved) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', resolved);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    // Intentionally omit `searchParams` object identity - use tabParam + pathname only.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams string is captured via tabParam + next URL build
  }, [tabs.length, tabParam, activeModels, venue.terminology, pathname, router]);

  if (venue.booking_paused) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center shadow-sm">
        <p className="text-base font-semibold text-slate-900">Online booking unavailable</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Online booking for {venue.name} is temporarily unavailable. Please contact them directly to make a booking.
        </p>
      </div>
    );
  }

  const appointmentTabs =
    activeModel === 'practitioner_appointment' || activeModel === 'unified_scheduling';

  const usesPublicAppointmentColumn = !embed && isUnifiedSchedulingVenue(venue.booking_model);

  const rootWidthClass = usesPublicAppointmentColumn
    ? `mx-auto w-full ${APPOINTMENT_PUBLIC_SHELL_MAX_WIDTH_CLASS}`
    : embed
      ? 'w-full'
      : 'mx-auto w-full max-w-lg';

  return (
    <div
      className={`min-w-0 ${rootWidthClass} ${embed ? 'space-y-3' : 'space-y-6'} ${appointmentTabs ? 'appointment-public' : ''}`.trim()}
      style={appointmentTabs ? appointmentAccentStyle(accentColour) : undefined}
    >
      {tabs.length > 1 && (
        <div className={`border-b border-slate-200 pb-2 ${embed ? 'space-y-2' : ''}`} aria-busy={tabPending}>
          <div className={`flex flex-wrap items-center gap-2 ${embed ? 'justify-center' : ''}`}>
            {tabs.map((t) => {
              const isActive = t.slug === activeSlug;
              return (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => replaceTabInUrl(t.slug)}
                  className={`min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    isActive
                      ? appointmentTabs
                        ? 'ap-tab-active shadow-sm'
                        : 'bg-brand-600 text-white shadow-sm'
                      : APPOINTMENT_PUBLIC_TAB_INACTIVE
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {tabPending ? (
            <div className={`flex ${embed ? 'justify-center' : ''}`}>
              <span className="text-xs text-slate-500" aria-live="polite">
                Switching…
              </span>
            </div>
          ) : null}
        </div>
      )}

      <PublicBookingAccountGateProvider venue={venue}>
        <BookingFlowRouter
          key={activeSlug}
          venue={venue}
          activeBookingModel={activeModel}
          lockedPractitioner={lockedPractitioner ?? undefined}
          embed={embed}
          onHeightChange={onHeightChange}
          accentColour={accentColour}
          collectiveId={collectiveId}
          waitlistOfferEntryId={waitlistOfferEntryId}
          preselectedServiceId={waitlistPrefillServiceId}
          initialDate={waitlistPrefillDate}
          initialTime={waitlistPrefillTime}
        />
      </PublicBookingAccountGateProvider>
    </div>
  );
}
