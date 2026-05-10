'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FloorPlanLiveView, type FloorPlanAreaNavConfig } from './FloorPlanLiveView';
import type { BookingModel } from '@/types/booking-models';
import type { VenueArea } from '@/types/areas';
import { readSessionPreference, writeSessionPreference } from '@/lib/ui/session-preferences';

interface FloorPlanPreferences {
  diningAreaId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function floorPlanPreferencesKey(venueId: string): string {
  return `reserve:dashboard:floor-plan:${venueId}:preferences`;
}

function isFloorPlanPreferences(value: unknown): value is FloorPlanPreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.diningAreaId === undefined || record.diningAreaId === null || (
    typeof record.diningAreaId === 'string' && UUID_RE.test(record.diningAreaId)
  );
}

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
  const preferencesKey = floorPlanPreferencesKey(venueId);
  const rememberedPreferences = useMemo(
    () => readSessionPreference<FloorPlanPreferences>(preferencesKey, {}, isFloorPlanPreferences),
    [preferencesKey],
  );
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
    const rememberedAreaId = rememberedPreferences.diningAreaId;
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
          : rememberedAreaId && active.some((a) => a.id === rememberedAreaId)
            ? rememberedAreaId
            : fromLs && active.some((a) => a.id === fromLs)
              ? fromLs
              : active[0]!.id;
      setDiningAreaId(pick);
    });
  }, [bookingModel, areasLoaded, diningAreas, rememberedPreferences.diningAreaId, searchParams, venueId]);

  const effectiveDiningAreaId = bookingModel === 'table_reservation' ? diningAreaId : null;
  const activeDiningAreas = useMemo(() => diningAreas.filter((a) => a.is_active), [diningAreas]);
  const waitingForDiningArea =
    bookingModel === 'table_reservation' &&
    (!areasLoaded || (activeDiningAreas.length > 0 && !effectiveDiningAreaId));

  const setDiningAreaFilter = useCallback(
    (id: string) => {
      setDiningAreaId(id);
      writeSessionPreference<FloorPlanPreferences>(preferencesKey, { diningAreaId: id });
      try {
        window.localStorage.setItem(`diningArea:${venueId}`, id);
      } catch {
        /* ignore */
      }
      const next = new URLSearchParams(searchParams.toString());
      next.set('area', id);
      router.replace(`/dashboard/floor-plan?${next}`, { scroll: false });
    },
    [preferencesKey, router, searchParams, venueId],
  );

  const editLayoutHref =
    effectiveDiningAreaId && showDiningAreaChrome
      ? `/dashboard/availability?tab=layout&area=${encodeURIComponent(effectiveDiningAreaId)}`
      : '/dashboard/availability?tab=layout';

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
