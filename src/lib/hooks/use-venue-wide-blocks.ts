'use client';

import { useEffect, useState } from 'react';
import type { AvailabilityBlock } from '@/types/availability';

/**
 * Venue-wide closures and amended hours for the signed-in venue.
 *
 * Every calendar grid derives its visible hours from `getCalendarGridBounds`, and that
 * function needs these blocks to follow a date's RESOLVED hours rather than the weekly
 * shape. Without them a day amended to run 09:00-11:00 and 15:00-17:00 still drew a grid
 * out to the weekly close, and the amended stripes were clipped away.
 *
 * The route is not date-scoped, so this fetches once per mount and the resolver filters
 * per date. That is what `PractitionerCalendarView` already did inline; this exists so the
 * other grids do not each grow their own copy of it.
 *
 * Fails soft to an empty list. An empty list is exactly the pre-Stage-4 input, so a failed
 * read degrades to weekly-only bounds rather than an empty or broken grid -- the same
 * fail-open convention the availability fetchers use, and for the same reason: a diary that
 * will not render is worse than one whose bounds are slightly wide.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md Stage 4.
 */
export function useVenueWideBlocks(enabled = true): AvailabilityBlock[] {
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/venue/availability-blocks');
        if (!res.ok) return;
        const json = (await res.json()) as { blocks?: AvailabilityBlock[] };
        if (!cancelled) setBlocks(json.blocks ?? []);
      } catch {
        // Fail soft: bounds fall back to the weekly shape.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return blocks;
}
