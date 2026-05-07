'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VenueServiceRow } from '@/app/dashboard/availability/service-settings-types';
import type { VenueArea } from '@/types/areas';

const diningAreaStorageKey = (venueId: string) => `diningArea:${venueId}`;

/**
 * Resolves dining area + services for restaurant onboarding so steps mirror
 * `/dashboard/availability` (per-area services, capacity, durations, rules).
 * Default area selection matches Availability: `localStorage` `diningArea:{venueId}`,
 * then first active area by sort order (same as `/api/venue/areas`).
 */
export function useRestaurantOnboardingAvailability() {
  const [venueId, setVenueId] = useState<string | null>(null);
  const [activeAreas, setActiveAreas] = useState<VenueArea[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [services, setServices] = useState<VenueServiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchServicesForArea = useCallback(async (areaId: string | null) => {
    const svcUrl = areaId
      ? `/api/venue/services?area_id=${encodeURIComponent(areaId)}`
      : '/api/venue/services';
    const svcRes = await fetch(svcUrl);
    if (svcRes.ok) {
      const body = (await svcRes.json()) as { services?: VenueServiceRow[] };
      setServices(body.services ?? []);
    } else {
      setServices([]);
    }
  }, []);

  const resolveAreaId = useCallback((active: VenueArea[], vId: string | null): string | null => {
    if (active.length === 0) return null;
    try {
      const stored = vId ? localStorage.getItem(diningAreaStorageKey(vId)) : null;
      if (stored && active.some((a) => a.id === stored)) return stored;
    } catch {
      /* ignore */
    }
    return active[0]!.id;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      let vId: string | null = null;
      const [venueRes, areasRes] = await Promise.all([fetch('/api/venue'), fetch('/api/venue/areas')]);
      if (venueRes.ok) {
        const v = (await venueRes.json()) as { id?: string };
        vId = v.id ?? null;
        setVenueId(vId);
      }
      let areaId: string | null = null;
      if (areasRes.ok) {
        const data = (await areasRes.json()) as { areas?: VenueArea[] };
        const list = data.areas ?? [];
        const active = list.filter((a) => a.is_active);
        setActiveAreas(active);
        areaId = resolveAreaId(active, vId);
      }
      if (!areaId) {
        try {
          const svRes = await fetch('/api/venue/services');
          if (svRes.ok) {
            const body = (await svRes.json()) as { services?: Array<{ area_id?: string | null }> };
            const withArea = (body.services ?? []).find((s) => s.area_id);
            areaId = withArea?.area_id ?? null;
          }
        } catch {
          /* ignore */
        }
      }
      setSelectedAreaId(areaId);
      await fetchServicesForArea(areaId);
    } finally {
      setLoading(false);
    }
  }, [fetchServicesForArea, resolveAreaId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectArea = useCallback(
    async (id: string) => {
      setSelectedAreaId(id);
      if (venueId) {
        try {
          localStorage.setItem(diningAreaStorageKey(venueId), id);
        } catch {
          /* ignore */
        }
      }
      await fetchServicesForArea(id);
    },
    [venueId, fetchServicesForArea],
  );

  return {
    venueId,
    activeAreas,
    selectedAreaId,
    selectArea,
    services,
    setServices,
    loading,
    refresh,
  };
}
