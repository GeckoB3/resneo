'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookingPageEditor } from '@/components/booking-page-editor/BookingPageEditor';
import type {
  BookingPageEditorAdapter,
  EditorServiceItem,
  EditorTeamMember,
} from '@/components/booking-page-editor/types';
import { venueSettingsToPreviewPublic } from '@/lib/booking/venue-settings-to-preview-public';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { preserveSettingsScrollDuring } from '../preserve-settings-scroll';
import { readResponseJson } from '@/lib/http/read-response-json';
import { useSettingsSave } from '../SettingsSaveContext';
import type { BookingPageConfig } from '@/lib/booking/booking-page-theme';
import type { VenueSettings } from '../types';
import { VenueSlugField } from './VenueSlugField';

interface BookingPageSectionProps {
  venue: VenueSettings;
  onUpdate: (patch: Partial<VenueSettings>) => void;
  isAdmin: boolean;
  publicBaseUrl: string;
}

async function uploadVenueImage(endpoint: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(endpoint, { method: 'POST', body: form });
  const json = await readResponseJson<{ error?: string; url?: string }>(res);
  if (!res.ok || !json.url) throw new Error(json.error ?? 'Upload failed');
  return json.url;
}

/**
 * Single-venue "Booking page" editor — a thin wrapper that builds the venue adapter
 * and renders the shared <BookingPageEditor>. Behaviour is identical to the previous
 * standalone section: same `/api/venue` endpoints, same uploads, same settings save banner.
 */
export function BookingPageSection({ venue, onUpdate, isAdmin, publicBaseUrl }: BookingPageSectionProps) {
  const { report } = useSettingsSave();
  const reporter = useMemo(() => ({ report }), [report]);

  const [serviceList, setServiceList] = useState<EditorServiceItem[]>([]);
  const [teamList, setTeamList] = useState<EditorTeamMember[]>([]);

  // Load the venue's services so admins can attach a photo to each (appointment venues only).
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/appointment-services');
        if (!res.ok) return;
        const data = await readResponseJson<{
          services?: Array<{
            id: string;
            name: string;
            description?: string | null;
            price_pence?: number | null;
            duration_minutes?: number;
          }>;
        }>(res);
        if (!cancelled && Array.isArray(data.services)) {
          setServiceList(
            data.services.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description ?? null,
              price_pence: s.price_pence ?? null,
              duration_minutes: s.duration_minutes,
            })),
          );
        }
      } catch {
        /* non-appointment venues / fetch errors: leave the section hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, venue.id]);

  // Load the bookable team so admins can add a "Meet the team" profile per member.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/booking-page-team');
        if (!res.ok) return;
        const data = await readResponseJson<{ team?: Array<{ id: string; name: string }> }>(res);
        if (!cancelled && Array.isArray(data.team)) {
          setTeamList(data.team.map((m) => ({ id: m.id, name: m.name })));
        }
      } catch {
        /* leave the section hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, venue.id]);

  const getConfig = useCallback(
    (): BookingPageConfig => venue.booking_page_config ?? {},
    [venue.booking_page_config],
  );

  const savePatch = useCallback(
    async (config: BookingPageConfig): Promise<BookingPageConfig> => {
      const res = await fetch('/api/venue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_page_config: config }),
      });
      const body = await readResponseJson<{ error?: string; booking_page_config?: BookingPageConfig | null }>(res);
      if (!res.ok) throw new Error(body.error ?? 'Failed to save');
      const saved = body.booking_page_config ?? config;
      onUpdate({ booking_page_config: saved });
      return saved;
    },
    [onUpdate],
  );

  const saveLogoUrl = useCallback(
    async (url: string | null) => {
      const res = await fetch('/api/venue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: url }),
      });
      const body = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? 'Failed to update logo');
      onUpdate({ logo_url: url });
    },
    [onUpdate],
  );

  const saveCoverUrl = useCallback(
    async (url: string | null) => {
      const res = await fetch('/api/venue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_photo_url: url }),
      });
      const body = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? 'Failed to update cover photo');
      onUpdate({ cover_photo_url: url });
    },
    [onUpdate],
  );

  const adapter = useMemo<BookingPageEditorAdapter>(() => {
    const slug = (venue.slug ?? '').trim();
    const publicPath = slug ? `/book/${slug}` : null;
    const publicUrl = publicPath ? `${publicBaseUrl.replace(/\/$/, '')}${publicPath}` : null;
    return {
      displayName: venue.name,
      publicUrl,
      publicPath,
      seedKey: venue.id,
      getConfig,
      savePatch,
      addressSlot: (
        <VenueSlugField venue={venue} onUpdate={onUpdate} isAdmin={isAdmin} reporter={reporter} />
      ),
      logo: {
        getUrl: () => venue.logo_url,
        upload: (file) => uploadVenueImage('/api/venue/logo', file),
        saveUrl: saveLogoUrl,
      },
      cover: {
        getUrl: () => venue.cover_photo_url,
        upload: (file) => uploadVenueImage('/api/venue/cover', file),
        saveUrl: saveCoverUrl,
      },
      gallery: {
        upload: (file) => uploadVenueImage('/api/venue/gallery', file),
      },
      services: {
        list: serviceList,
        photo: {
          upload: (_serviceId, file) => uploadVenueImage('/api/venue/service-photo', file),
          // Venue service photos persist through the booking_page_config
          // (servicePhotosInConfig=true), so the editor never calls save() for venues.
          save: async () => {},
          removeStored: async (url) => {
            const res = await fetch('/api/venue/service-photo', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });
            if (!res.ok) {
              const body = await readResponseJson<{ error?: string }>(res);
              throw new Error(body.error ?? 'Failed to remove stored photo');
            }
          },
        },
      },
      team: {
        list: teamList,
        uploadPhoto: (_memberId, file) => uploadVenueImage('/api/venue/team-photo', file),
      },
      buildPreviewVenue: (draft) => venueSettingsToPreviewPublic(venue, draft, { slug: venue.slug ?? '' }),
      preserveScroll: preserveSettingsScrollDuring,
      capabilities: {
        isAppointmentVenue: isUnifiedSchedulingVenue(venue.booking_model),
        canEdit: isAdmin,
        servicePhotosInConfig: true,
        emailBranding: true,
      },
      importSources: [],
    };
  }, [
    venue,
    isAdmin,
    publicBaseUrl,
    onUpdate,
    reporter,
    getConfig,
    savePatch,
    saveLogoUrl,
    saveCoverUrl,
    serviceList,
    teamList,
  ]);

  return <BookingPageEditor adapter={adapter} reporter={reporter} />;
}
