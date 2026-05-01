'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FloorPlanLiveView, type FloorPlanAreaNavConfig } from './FloorPlanLiveView';
import type { BookingModel } from '@/types/booking-models';
import type { VenueArea } from '@/types/areas';

export function UnifiedFloorPlanView({
  isAdmin,
  venueId,
  currency,
  bookingModel = 'table_reservation',
  enabledModels = [],
}: {
  isAdmin: boolean;
  venueId: string;
  currency?: string;
  bookingModel?: BookingModel;
  enabledModels?: BookingModel[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [diningAreas, setDiningAreas] = useState<VenueArea[]>([]);
  const [diningAreaId, setDiningAreaId] = useState<string | null>(null);
  const [areasLoaded, setAreasLoaded] = useState(bookingModel !== 'table_reservation');

  const showDiningAreaChrome =
    bookingModel === 'table_reservation' && diningAreas.filter((a) => a.is_active).length > 1;

  useEffect(() => {
    if (bookingModel !== 'table_reservation') {
      return;
    }
    let cancelled = false;
    void fetch('/api/venue/areas')
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => {
        if (cancelled) return;
        setDiningAreas(Array.isArray(j?.areas) ? (j.areas as VenueArea[]) : []);
        setAreasLoaded(true);
      })
      .catch((e) => {
        console.error('[UnifiedFloorPlanView] /api/venue/areas preload failed:', e);
        if (!cancelled) setAreasLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingModel]);

  useEffect(() => {
    if (bookingModel !== 'table_reservation' || !areasLoaded) return;
    const active = diningAreas.filter((a) => a.is_active);
    const fromUrl = searchParams.get('area');
    let fromLs: string | null = null;
    try {
      fromLs = window.localStorage.getItem(`diningArea:${venueId}`);
    } catch {
      /* ignore */
    }
    queueMicrotask(() => {
      if (active.length === 0) {
        setDiningAreaId(null);
        return;
      }
      if (active.length === 1) {
        setDiningAreaId(active[0]!.id);
        return;
      }
      const pick =
        fromUrl && active.some((a) => a.id === fromUrl)
          ? fromUrl
          : fromLs && active.some((a) => a.id === fromLs)
            ? fromLs
            : active[0]!.id;
      setDiningAreaId(pick);
    });
  }, [bookingModel, areasLoaded, diningAreas, searchParams, venueId]);

  const effectiveDiningAreaId = bookingModel === 'table_reservation' ? diningAreaId : null;
  const activeDiningAreas = useMemo(() => diningAreas.filter((a) => a.is_active), [diningAreas]);
  const waitingForDiningArea =
    bookingModel === 'table_reservation' &&
    (!areasLoaded || (activeDiningAreas.length > 0 && !effectiveDiningAreaId));

  const setDiningAreaFilter = useCallback(
    (id: string) => {
      setDiningAreaId(id);
      try {
        window.localStorage.setItem(`diningArea:${venueId}`, id);
      } catch {
        /* ignore */
      }
      const next = new URLSearchParams(searchParams.toString());
      next.set('area', id);
      router.replace(`/dashboard/floor-plan?${next}`, { scroll: false });
    },
    [router, searchParams, venueId],
  );

  const editLayoutHref =
    effectiveDiningAreaId && showDiningAreaChrome
      ? `/dashboard/availability?tab=table&fp=layout&area=${encodeURIComponent(effectiveDiningAreaId)}`
      : '/dashboard/availability?tab=table&fp=layout';

  const areaNav: FloorPlanAreaNavConfig | null =
    showDiningAreaChrome && effectiveDiningAreaId
      ? {
          areas: activeDiningAreas,
          value: effectiveDiningAreaId,
          onChange: setDiningAreaFilter,
        }
      : null;

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] flex-1 flex-col gap-1.5 sm:gap-2">
      {waitingForDiningArea ? (
        <div className="flex min-h-[calc(100dvh-13rem)] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
          Loading floor plan...
        </div>
      ) : (
        <FloorPlanLiveView
          isAdmin={isAdmin}
          venueId={venueId}
          currency={currency}
          bookingModel={bookingModel}
          enabledModels={enabledModels}
          diningAreaId={effectiveDiningAreaId}
          areaNav={areaNav}
          editLayoutHref={isAdmin ? editLayoutHref : undefined}
        />
      )}
    </div>
  );
}
