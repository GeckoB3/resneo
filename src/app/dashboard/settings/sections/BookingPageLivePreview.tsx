'use client';

import { useMemo } from 'react';
import { BookPublicLayout } from '@/components/booking/BookPublicLayout';
import { venueSettingsToPreviewPublic } from '@/lib/booking/venue-settings-to-preview-public';
import type { BookingPageConfig } from '@/lib/booking/booking-page-theme';
import type { VenueSettings } from '../types';

interface BookingPageLivePreviewProps {
  venue: VenueSettings;
  bookingPageConfig: BookingPageConfig;
  /** Slug shown in preview (draft input or saved). */
  previewSlug: string;
  device: 'mobile' | 'desktop';
  /** Bump to force remount (e.g. after logo upload). */
  remountKey: number;
}

/**
 * In-dashboard booking page preview — uses draft branding from form state (no iframe).
 */
export function BookingPageLivePreview({
  venue,
  bookingPageConfig,
  previewSlug,
  device,
  remountKey,
}: BookingPageLivePreviewProps) {
  const previewVenue = useMemo(
    () => venueSettingsToPreviewPublic(venue, bookingPageConfig, { slug: previewSlug }),
    [venue, bookingPageConfig, previewSlug],
  );

  const width = device === 'mobile' ? 390 : '100%';

  return (
    <div className="flex justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-3">
      <div
        key={remountKey}
        className="h-[min(80vh,720px)] min-h-[600px] max-w-full overflow-y-auto overflow-x-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
        style={{ width }}
      >
        <BookPublicLayout venue={previewVenue} />
      </div>
    </div>
  );
}
