import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeBookingPageConfig, type BookingPageConfig } from '@/lib/booking/booking-page-theme';
import type { ImportSource } from '@/components/booking-page-editor/types';

/** The collective combined-page config: the single-venue config plus a cover photo URL. */
export type CollectiveBookingPageConfig = BookingPageConfig & {
  /** Cover photo URL — stored in the collective config (single venues keep it in a column). */
  cover_photo_url?: string | null;
};

const COVER_URL_MAX = 500;

function sanitizeCoverPhotoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (!url || url.length > COVER_URL_MAX || !/^https?:\/\//i.test(url)) return null;
  return url;
}

/**
 * Sanitise a collective combined-page config. Reuses the single-venue sanitiser for all
 * shared fields (colours, font, logo/cover crops, gallery, social links, team profiles
 * incl. photo and its framing, tab toggles), then drops `service_photos` (collective offering
 * photos live on the item, not the config) and adds the collective-only `cover_photo_url`.
 *
 * `service_photo_crops` is deliberately kept: the framing belongs to this page even though the
 * photo it frames is stored on the catalogue item.
 */
export function sanitizeCollectiveBookingPageConfig(raw: unknown): CollectiveBookingPageConfig {
  const base = sanitizeBookingPageConfig(raw) as CollectiveBookingPageConfig;
  delete base.service_photos;
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cover = sanitizeCoverPhotoUrl(src.cover_photo_url);
  if (cover) base.cover_photo_url = cover;
  return base;
}

/**
 * Merge a combined-page config PATCH onto the stored config. The editor always sends the
 * full managed config (buildConfigFromState), so managed keys come wholesale from
 * `incoming`. `cover_photo_url` is a separate slot the branding save omits, so it is
 * preserved from `existing` unless the patch explicitly provides it.
 */
export function mergeCollectiveBookingPageConfigPatch(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): CollectiveBookingPageConfig {
  const merged: Record<string, unknown> = { ...incoming };
  if (
    !('cover_photo_url' in incoming) &&
    existing &&
    typeof existing === 'object' &&
    'cover_photo_url' in existing
  ) {
    merged.cover_photo_url = (existing as Record<string, unknown>).cover_photo_url;
  }
  return sanitizeCollectiveBookingPageConfig(merged);
}

/**
 * Active member venues' saved booking-page settings, so the host can prefill the combined
 * page from a member venue. Only transferable branding/content is exposed — per-service
 * photos and team profiles are venue-id-keyed and meaningless for the collective, so they
 * are dropped.
 */
export async function loadCollectiveMemberImportSources(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<ImportSource[]> {
  const { data: members } = await admin
    .from('venue_collective_members')
    .select('venue_id')
    .eq('collective_id', collectiveId)
    .eq('status', 'active');
  const venueIds = (members ?? []).map((m) => m.venue_id as string).filter(Boolean);
  if (venueIds.length === 0) return [];

  const { data: venues } = await admin
    .from('venues')
    .select('id, name, logo_url, cover_photo_url, booking_page_config')
    .in('id', venueIds);

  return (venues ?? []).map((v) => {
    const config = sanitizeBookingPageConfig(v.booking_page_config) as BookingPageConfig;
    delete config.service_photos;
    delete config.service_photo_crops;
    delete config.team_profiles;
    return {
      venueId: v.id as string,
      venueName: (v.name as string) ?? 'Venue',
      logoUrl: (v.logo_url as string | null) ?? null,
      coverPhotoUrl: (v.cover_photo_url as string | null) ?? null,
      config,
    };
  });
}
