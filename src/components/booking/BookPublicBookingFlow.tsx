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
import type { VenuePublic } from '@/components/booking/types';

const EMPTY_ENABLED: BookingModel[] = [];

interface Props {
  venue: VenuePublic;
  lockedPractitioner?: LockedPractitionerBooking | null;
  embed?: boolean;
  /** Embed only: notifies parent iframe to remeasure (no intrinsic height payload). */
  onHeightChange?: () => void;
  accentColour?: string;
}

export function BookPublicBookingFlow({
  venue,
  lockedPractitioner,
  embed,
  onHeightChange,
  accentColour,
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

  return (
    <div className={embed ? 'space-y-4' : 'space-y-6'}>
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
                  className={`min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
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

      <BookingFlowRouter
        key={activeSlug}
        venue={venue}
        activeBookingModel={activeModel}
        lockedPractitioner={lockedPractitioner ?? undefined}
        embed={embed}
        onHeightChange={onHeightChange}
        accentColour={accentColour}
      />
    </div>
  );
}
