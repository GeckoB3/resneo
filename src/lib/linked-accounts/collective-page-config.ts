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
  // A combined page inherits the host venue's tab settings until the host has
  // set its own (see `inheritCollectivePageConfigFromHost`), so an explicit
  // "off" must survive sanitising or switching every tab off would read as
  // "never set" and the host's tabs would come straight back.
  if (src.show_services_tab === false) base.show_services_tab = false;
  if (src.show_team_tab === false) base.show_team_tab = false;
  return base;
}

const TAB_KEYS = ['show_services_tab', 'show_team_tab', 'show_about_tab'] as const;

/** True once the host has saved any tab setting for the combined page. */
export function collectivePageConfigHasOwnTabSettings(
  config: BookingPageConfig | null | undefined,
): boolean {
  if (!config) return false;
  return TAB_KEYS.some((key) => typeof config[key] === 'boolean');
}

/**
 * Fill a combined page's config from the host venue's own booking page, for the
 * parts the host has not set on the combined page yet.
 *
 * A collective is created with an empty page config, and the tab toggles are
 * opt-in, so a freshly linked combined page showed the booking form alone:
 * the Services, Meet the team and About tabs the host had on its own page all
 * vanished the moment its clients were sent to the combined address. The page
 * is designed to look like one venue and already borrows the host's address,
 * phone and hours, so it borrows the host's tabs too, plus the About tab's
 * text, gallery and social links, until the host edits them on the combined
 * page. Once any tab setting has been saved there, the host's choices stand.
 */
export function inheritCollectivePageConfigFromHost(
  collectiveConfig: CollectiveBookingPageConfig,
  hostConfig: BookingPageConfig | null | undefined,
): CollectiveBookingPageConfig {
  if (!hostConfig || collectivePageConfigHasOwnTabSettings(collectiveConfig)) return collectiveConfig;
  const out: CollectiveBookingPageConfig = { ...collectiveConfig };
  for (const key of TAB_KEYS) {
    if (typeof hostConfig[key] === 'boolean') out[key] = hostConfig[key];
  }
  if (out.about == null && typeof hostConfig.about === 'string') out.about = hostConfig.about;
  if (out.gallery == null && Array.isArray(hostConfig.gallery)) out.gallery = hostConfig.gallery;
  if (out.social_links == null && hostConfig.social_links) out.social_links = hostConfig.social_links;
  return out;
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
