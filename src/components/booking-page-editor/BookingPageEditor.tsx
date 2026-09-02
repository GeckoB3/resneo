'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookingPageCoverPhoto } from '@/components/booking/BookingPageCoverPhoto';
import { BookingPageLogo } from '@/components/booking/BookingPageLogo';
import { BookingFontPresetSelect } from '@/app/dashboard/settings/sections/BookingFontPresetSelect';
import {
  BOOKING_PAGE_COVER_SETTINGS_FRAME_CLASS,
  BOOKING_PAGE_COVER_SETTINGS_PLACEHOLDER_FRAME_CLASS,
  resolveBookingPageCoverCropBox,
  type BookingPageCoverCropBox,
} from '@/lib/booking/booking-page-cover';
import { BookingPageCoverCropper } from '@/app/dashboard/settings/sections/BookingPageCoverCropper';
import { BookingPageDraggableLogo } from '@/app/dashboard/settings/sections/BookingPageDraggableLogo';
import { BookingPageDraggableImage } from '@/app/dashboard/settings/sections/BookingPageDraggableImage';
import { BookingPageImageFramingControls } from '@/app/dashboard/settings/sections/BookingPageImageFramingControls';
import { BookingPageLogoFramingControls } from '@/app/dashboard/settings/sections/BookingPageLogoFramingControls';
import { InlineBookingPreview } from './InlineBookingPreview';
import {
  BOOKING_PAGE_EYEBROW_CLASS,
  BOOKING_PAGE_FIELD_HEADING_MB1_CLASS,
  BOOKING_PAGE_FIELD_HEADING_MB15_CLASS,
  BOOKING_PAGE_FIELD_HEADING_MB2_CLASS,
  BOOKING_PAGE_PRIMARY_HEADING_CLASS,
  BOOKING_PAGE_SECTION_HEADING_CLASS,
} from '@/app/dashboard/settings/sections/booking-page-settings-typography';
import {
  bookingExpandAccordionBodyClass,
  bookingExpandAccordionDetailsClass,
  bookingExpandAccordionSummaryClass,
} from '@/app/dashboard/bookings/booking-expand-accordion-classes';

const previewAccordionChevron = (
  <svg
    className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    aria-hidden
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
  </svg>
);
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import {
  blurFileInput,
  SETTINGS_HIDDEN_FILE_INPUT_CLASS,
} from '@/app/dashboard/settings/preserve-settings-scroll';
import {
  BOOKING_GALLERY_MAX,
  BOOKING_THEME_PRESETS,
  normalizeHexColor,
  primaryNeedsDarkText,
  resolveServicesLayout,
  type BookingFontPreset,
  type BookingPageConfig,
  type BookingTeamProfile,
  type ServicesLayout,
} from '@/lib/booking/booking-page-theme';
import {
  DEFAULT_BOOKING_PAGE_LOGO_CROP,
  resolveBookingPageLogoCrop,
  sanitizeBookingPageLogoCrop,
  type BookingPageLogoCrop,
} from '@/lib/booking/booking-page-logo';
import {
  sanitizeBookingPageImageFraming,
  type BookingPageImageFraming,
} from '@/lib/booking/booking-page-image-framing';
import type { BookingPagePublicService } from '@/lib/booking/booking-page-tabs';
import type { BookingPageEditorAdapter, ImportSource, SaveReporter } from './types';
import { ImportFromMember, type ImportScope } from './ImportFromMember';

type BookingPageTabToggle =
  | { kind: 'always-on' }
  | {
      id: string;
      checked: boolean;
      disabled?: boolean;
      onChange: (checked: boolean) => void;
    };

function BookingPageSettingsGroup({
  title,
  description,
  tabToggle,
  headerAction,
  children,
}: {
  title: string;
  description?: string;
  tabToggle?: BookingPageTabToggle;
  /** Optional control rendered in the group header (e.g. "Import from a member"). */
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-slate-100 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className={BOOKING_PAGE_SECTION_HEADING_CLASS}>{title}</h3>
          {description ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-0.5">
          {headerAction}
          {tabToggle && 'kind' in tabToggle ? (
            <span className="text-xs font-medium text-slate-500">Always shown</span>
          ) : tabToggle ? (
            <label
              htmlFor={tabToggle.id}
              className={`flex cursor-pointer items-center gap-2 ${
                tabToggle.disabled ? 'cursor-not-allowed opacity-60' : ''
              }`}
            >
              <input
                id={tabToggle.id}
                type="checkbox"
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={tabToggle.checked}
                disabled={tabToggle.disabled}
                onChange={(e) => tabToggle.onChange(e.target.checked)}
              />
              <span className="text-xs font-medium text-slate-700">Show on booking page</span>
            </label>
          ) : null}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

interface BookingPageEditorProps {
  adapter: BookingPageEditorAdapter;
  reporter: SaveReporter;
}

export function BookingPageEditor({ adapter, reporter }: BookingPageEditorProps) {
  const { report } = reporter;
  const isAdmin = adapter.capabilities.canEdit;
  const isAppointmentVenue = adapter.capabilities.isAppointmentVenue;
  const logoUrl = adapter.logo.getUrl();
  const coverUrl = adapter.cover.getUrl();
  const serviceList = adapter.services.list;
  const teamList = adapter.team.list;
  const bookUrl = adapter.publicUrl;
  const bookPath = adapter.publicPath;

  const [logoSaving, setLogoSaving] = useState(false);
  const [logoRemoving, setLogoRemoving] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  // ── Booking Site Studio: branding & content ──────────────────────────────
  const cfg0 = adapter.getConfig();
  const [brandPrimary, setBrandPrimary] = useState(cfg0.brand_primary ?? '');
  const [brandEmails, setBrandEmails] = useState(cfg0.brand_emails === true);
  const [fontPreset, setFontPreset] = useState<BookingFontPreset>(cfg0.font_preset ?? 'default');
  const [logoCrop, setLogoCrop] = useState<BookingPageLogoCrop>(() =>
    resolveBookingPageLogoCrop(cfg0.logo_crop),
  );
  const [coverCropBox, setCoverCropBox] = useState<BookingPageCoverCropBox | null>(() =>
    resolveBookingPageCoverCropBox(cfg0.cover_crop_box),
  );
  const [cropperOpen, setCropperOpen] = useState(false);
  const [coverFullWidth, setCoverFullWidth] = useState(cfg0.cover_full_width === true);
  const [about, setAbout] = useState(cfg0.about ?? '');
  const [announcement, setAnnouncement] = useState(cfg0.announcement ?? '');
  const [instagram, setInstagram] = useState(cfg0.social_links?.instagram ?? '');
  const [facebook, setFacebook] = useState(cfg0.social_links?.facebook ?? '');
  const [tiktok, setTiktok] = useState(cfg0.social_links?.tiktok ?? '');
  const [xUrl, setXUrl] = useState(cfg0.social_links?.x ?? '');
  const [gallery, setGallery] = useState<string[]>(cfg0.gallery ?? []);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [servicePhotos, setServicePhotos] = useState<Record<string, string>>(cfg0.service_photos ?? {});
  const [servicePhotoCrops, setServicePhotoCrops] = useState<Record<string, BookingPageImageFraming>>(
    cfg0.service_photo_crops ?? {},
  );
  const [showServicesTab, setShowServicesTab] = useState(cfg0.show_services_tab === true);
  const [showTeamTab, setShowTeamTab] = useState(cfg0.show_team_tab === true);
  const [showAboutTab, setShowAboutTab] = useState(cfg0.show_about_tab === true);
  const [servicesLayout, setServicesLayout] = useState<ServicesLayout>(() => resolveServicesLayout(cfg0));
  const [servicePhotoBusyId, setServicePhotoBusyId] = useState<string | null>(null);
  const [servicePhotoError, setServicePhotoError] = useState<string | null>(null);
  const [teamProfiles, setTeamProfiles] = useState<Record<string, BookingTeamProfile>>(cfg0.team_profiles ?? {});
  const [teamPhotoBusyId, setTeamPhotoBusyId] = useState<string | null>(null);
  const lastSavedConfigRef = useRef<string | null>(null);
  // Live preview of the public booking page.
  const [previewDevice, setPreviewDevice] = useState<'mobile' | 'desktop'>('desktop');
  const [previewToken, setPreviewToken] = useState(0);
  /** Lazy-load preview on first expand; keep mounted when collapsed so re-open is instant. */
  const [previewMounted, setPreviewMounted] = useState(false);
  const bumpPreview = useCallback(() => setPreviewToken((t) => t + 1), []);

  const servicePhotosForConfig = useCallback(
    (photos: Record<string, string>): Record<string, string> => {
      const liveServiceIds = new Set(serviceList.map((s) => s.id));
      const out: Record<string, string> = {};
      for (const [id, url] of Object.entries(photos)) {
        const trimmed = url?.trim();
        if (!trimmed) continue;
        if (liveServiceIds.size > 0 && !liveServiceIds.has(id)) continue;
        out[id] = trimmed;
      }
      return out;
    },
    [serviceList],
  );

  /**
   * The photo showing for each service right now. Venue photos live in the config (so state is
   * the source of truth); collective offering photos live on the item, so they arrive on the
   * list and state only holds this session's edits. An empty string is a tombstone: the user
   * removed the photo, so the value from the list must not resurface before it reloads.
   */
  const effectiveServicePhotos = useMemo((): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const s of serviceList) {
      const edited = servicePhotos[s.id];
      const url = (edited !== undefined ? edited : s.imageUrl ?? '').trim();
      if (url) out[s.id] = url;
    }
    return out;
  }, [serviceList, servicePhotos]);

  /** Framing is only meaningful for a service that currently has a photo, and that still exists. */
  const servicePhotoCropsForConfig = useCallback(
    (crops: Record<string, BookingPageImageFraming>, photos: Record<string, string>) => {
      const out: Record<string, BookingPageImageFraming> = {};
      for (const [id, crop] of Object.entries(crops)) {
        if (!photos[id]) continue;
        const framed = sanitizeBookingPageImageFraming(crop);
        if (framed) out[id] = framed;
      }
      return out;
    },
    [],
  );

  const buildConfigFromState = useCallback((): BookingPageConfig => {
    const config: BookingPageConfig = {};
    const primary = normalizeHexColor(brandPrimary);
    if (primary) config.brand_primary = primary;
    config.brand_emails = brandEmails;
    if (fontPreset && fontPreset !== 'default') config.font_preset = fontPreset;
    if (about.trim()) config.about = about.trim();
    if (announcement.trim()) config.announcement = announcement.trim();
    const social: NonNullable<BookingPageConfig['social_links']> = {};
    if (instagram.trim()) social.instagram = instagram.trim();
    if (facebook.trim()) social.facebook = facebook.trim();
    if (tiktok.trim()) social.tiktok = tiktok.trim();
    if (xUrl.trim()) social.x = xUrl.trim();
    if (Object.keys(social).length > 0) config.social_links = social;
    if (gallery.length > 0) config.gallery = gallery;
    if (adapter.capabilities.servicePhotosInConfig) {
      const photos = servicePhotosForConfig(servicePhotos);
      config.service_photos = Object.keys(photos).length > 0 ? photos : null;
    }
    // Framing rides the config for both surfaces, including collectives, whose offering photo
    // itself lives on the catalogue item (see sanitizeCollectiveBookingPageConfig).
    const crops = servicePhotoCropsForConfig(servicePhotoCrops, effectiveServicePhotos);
    config.service_photo_crops = Object.keys(crops).length > 0 ? crops : null;
    config.show_services_tab = showServicesTab;
    config.show_team_tab = showTeamTab;
    config.show_about_tab = showAboutTab;
    config.services_layout = servicesLayout;
    // Team profiles: keep only members that still exist and carry content.
    const liveTeamIds = new Set(teamList.map((m) => m.id));
    const profiles: Record<string, BookingTeamProfile> = {};
    for (const [id, p] of Object.entries(teamProfiles)) {
      if (liveTeamIds.size > 0 && !liveTeamIds.has(id)) continue;
      const clean: BookingTeamProfile = {};
      if (p.bio?.trim()) clean.bio = p.bio.trim();
      if (p.specialties?.trim()) clean.specialties = p.specialties.trim();
      if (p.photo?.trim()) {
        clean.photo = p.photo.trim();
        // Framing only travels with a photo; the sanitiser drops it otherwise anyway.
        const framed = sanitizeBookingPageImageFraming(p.photo_crop);
        if (framed) clean.photo_crop = framed;
      }
      if (!showTeamTab || p.hidden) clean.hidden = true;
      if (clean.bio || clean.specialties || clean.photo || clean.hidden) profiles[id] = clean;
    }
    if (Object.keys(profiles).length > 0) config.team_profiles = profiles;
    if (logoUrl) {
      const framed = sanitizeBookingPageLogoCrop(logoCrop);
      if (framed) config.logo_crop = framed;
    }
    // The whole photo shows by default; a crop box (if set) narrows it to the chosen region.
    config.cover_crop_box = coverUrl ? coverCropBox : null;
    config.cover_full_width = coverFullWidth;
    return config;
  }, [
    adapter.capabilities.servicePhotosInConfig,
    brandPrimary,
    brandEmails,
    fontPreset,
    logoCrop,
    coverCropBox,
    coverFullWidth,
    logoUrl,
    coverUrl,
    about,
    announcement,
    instagram,
    facebook,
    tiktok,
    xUrl,
    gallery,
    servicePhotos,
    servicePhotosForConfig,
    servicePhotoCrops,
    servicePhotoCropsForConfig,
    effectiveServicePhotos,
    showServicesTab,
    showTeamTab,
    showAboutTab,
    servicesLayout,
    teamProfiles,
    teamList,
  ]);

  const persistBookingPageConfig = useCallback(
    async (
      photosOverride?: Record<string, string>,
      cropsOverride?: Record<string, BookingPageImageFraming>,
    ) => {
      const config = buildConfigFromState();
      if (photosOverride !== undefined && adapter.capabilities.servicePhotosInConfig) {
        const photos = servicePhotosForConfig(photosOverride);
        config.service_photos = Object.keys(photos).length > 0 ? photos : null;
      }
      // Photo uploads and removals save immediately, before React has re-rendered with the new
      // state, so the caller passes what it just set rather than letting the stale closure win.
      if (photosOverride !== undefined || cropsOverride !== undefined) {
        // Only the config-backed surface can read the live photo set off the override; for a
        // collective the photos come from the catalogue item, so the rendered set is the truth.
        const photosForCrops =
          photosOverride !== undefined && adapter.capabilities.servicePhotosInConfig
            ? servicePhotosForConfig(photosOverride)
            : effectiveServicePhotos;
        const crops = servicePhotoCropsForConfig(cropsOverride ?? servicePhotoCrops, photosForCrops);
        config.service_photo_crops = Object.keys(crops).length > 0 ? crops : null;
      }
      report({ status: 'saving', message: null });
      const savedConfig = await adapter.savePatch(config);
      // Baseline = what we built + sent (same producer as the auto-save dirty check), not the
      // server's re-ordered canonical config — otherwise the auto-save effect re-detects a phantom
      // diff right after this explicit save and fires a redundant "branding saved".
      lastSavedConfigRef.current = JSON.stringify(config);
      report({ status: 'saved', message: 'Booking page updated.' });
      return savedConfig;
    },
    [
      adapter,
      buildConfigFromState,
      servicePhotosForConfig,
      servicePhotoCropsForConfig,
      servicePhotoCrops,
      effectiveServicePhotos,
      report,
    ],
  );

  const primaryHasColour = Boolean(normalizeHexColor(brandPrimary));
  const primaryLowContrast = primaryHasColour && primaryNeedsDarkText(normalizeHexColor(brandPrimary)!);

  const draftBookingPageConfig = useMemo(() => buildConfigFromState(), [buildConfigFromState]);
  const previewVenue = useMemo(
    () => adapter.buildPreviewVenue(draftBookingPageConfig),
    [adapter, draftBookingPageConfig],
  );

  const serviceHasCategories = useMemo(() => serviceList.some((s) => s.category != null), [serviceList]);

  const previewServices = useMemo((): BookingPagePublicService[] => {
    if (!showServicesTab) return [];
    return serviceList.map((s) => {
      const imageUrl = effectiveServicePhotos[s.id] ?? null;
      return {
        id: s.id,
        name: s.name,
        description: typeof s.description === 'string' && s.description.trim() ? s.description.trim() : null,
        image_url: imageUrl,
        image_crop: imageUrl ? servicePhotoCrops[s.id] ?? null : null,
        price_pence: typeof s.price_pence === 'number' ? s.price_pence : null,
        duration_minutes: typeof s.duration_minutes === 'number' && s.duration_minutes > 0 ? s.duration_minutes : 60,
        category: s.category ?? null,
        sort_order: s.sort_order ?? 0,
      };
    });
  }, [showServicesTab, serviceList, effectiveServicePhotos, servicePhotoCrops]);

  const previewTeam = showTeamTab ? teamList : [];

  // Seed branding fields from the entity (and reset when switching entity).
  useEffect(() => {
    const c = adapter.getConfig();
    setBrandPrimary(c.brand_primary ?? '');
    setBrandEmails(c.brand_emails === true);
    setFontPreset(c.font_preset ?? 'default');
    setAbout(c.about ?? '');
    setAnnouncement(c.announcement ?? '');
    setInstagram(c.social_links?.instagram ?? '');
    setFacebook(c.social_links?.facebook ?? '');
    setTiktok(c.social_links?.tiktok ?? '');
    setXUrl(c.social_links?.x ?? '');
    setGallery(c.gallery ?? []);
    setServicePhotos(c.service_photos ?? {});
    setServicePhotoCrops(c.service_photo_crops ?? {});
    setShowServicesTab(c.show_services_tab === true);
    setShowTeamTab(c.show_team_tab === true);
    setShowAboutTab(c.show_about_tab === true);
    setServicesLayout(resolveServicesLayout(c));
    setTeamProfiles(c.team_profiles ?? {});
    setLogoCrop(resolveBookingPageLogoCrop(c.logo_crop));
    setCoverCropBox(resolveBookingPageCoverCropBox(c.cover_crop_box));
    setCoverFullWidth(c.cover_full_width === true);
    // Reset the dirty-check baseline; the auto-save effect re-captures it from buildConfigFromState()
    // (the same producer it compares against) once the seeded state settles. Seeding it from the
    // server's JSONB config here would mismatch the locally-built config and cause a save loop.
    lastSavedConfigRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only when the entity changes
  }, [adapter.seedKey]);

  useEffect(() => {
    const c = adapter.getConfig();
    setShowServicesTab(c.show_services_tab === true);
    setShowTeamTab(c.show_team_tab === true);
    setShowAboutTab(c.show_about_tab === true);
    setServicesLayout(resolveServicesLayout(c));
    setCoverFullWidth(c.cover_full_width === true);
    setCoverCropBox(resolveBookingPageCoverCropBox(c.cover_crop_box));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync only when the saved config changes
  }, [adapter.getConfig]);

  // Debounced auto-save for branding & content.
  useEffect(() => {
    if (!isAdmin) return;
    const config = buildConfigFromState();
    const serialized = JSON.stringify(config);
    // First settled build after (re)seeding: capture the dirty-check baseline from the SAME
    // producer used for the comparison (buildConfigFromState), then bail without saving. The
    // server/seed config is JSONB and reorders+normalises keys, so a baseline taken from it would
    // never equal this serialization — which previously triggered a phantom auto-save every ~850ms.
    if (lastSavedConfigRef.current === null) {
      lastSavedConfigRef.current = serialized;
      return;
    }
    if (serialized === lastSavedConfigRef.current) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        report({ status: 'saving', message: null });
        try {
          await adapter.savePatch(config);
          // Record exactly what we built + sent as the new baseline (NOT the server's re-ordered
          // canonical config), so the next render doesn't re-detect a phantom change and re-save.
          lastSavedConfigRef.current = serialized;
          report({ status: 'saved', message: 'Booking page branding saved.' });
        } catch (err) {
          report({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to save branding',
          });
        }
      })();
    }, 850);
    return () => window.clearTimeout(timer);
  }, [buildConfigFromState, isAdmin, adapter, report]);

  const onLogoChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const input = e.target;
      if (!file || !isAdmin) return;
      await adapter.preserveScroll(async () => {
        setLogoSaving(true);
        setLogoError(null);
        report({ status: 'saving', message: null });
        try {
          const url = await adapter.logo.upload(file);
          await adapter.logo.saveUrl(url);
          setLogoCrop({ ...DEFAULT_BOOKING_PAGE_LOGO_CROP });
          report({ status: 'saved', message: 'Logo updated.' });
        } catch (err) {
          setLogoError(err instanceof Error ? err.message : 'Upload failed');
          report({
            status: 'error',
            message: err instanceof Error ? err.message : 'Upload failed',
          });
        } finally {
          setLogoSaving(false);
          input.value = '';
          blurFileInput(input);
        }
      });
    },
    [isAdmin, adapter, report],
  );

  const onLogoRemove = useCallback(async () => {
    if (!isAdmin || logoRemoving) return;
    setLogoRemoving(true);
    setLogoError(null);
    report({ status: 'saving', message: null });
    try {
      await adapter.logo.saveUrl(null);
      setLogoCrop({ ...DEFAULT_BOOKING_PAGE_LOGO_CROP });
      report({ status: 'saved', message: 'Logo removed.' });
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Failed to remove');
      report({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to remove logo',
      });
    } finally {
      setLogoRemoving(false);
    }
  }, [isAdmin, logoRemoving, adapter, report]);

  const onCoverChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const input = e.target;
      if (!file || !isAdmin) return;
      await adapter.preserveScroll(async () => {
        setCoverSaving(true);
        setCoverError(null);
        report({ status: 'saving', message: null });
        try {
          const url = await adapter.cover.upload(file);
          await adapter.cover.saveUrl(url);
          // A new photo invalidates any prior crop region.
          setCoverCropBox(null);
          report({ status: 'saved', message: 'Cover photo updated.' });
        } catch (err) {
          setCoverError(err instanceof Error ? err.message : 'Upload failed');
          report({
            status: 'error',
            message: err instanceof Error ? err.message : 'Upload failed',
          });
        } finally {
          setCoverSaving(false);
          input.value = '';
          blurFileInput(input);
        }
      });
    },
    [isAdmin, adapter, report],
  );

  const onCoverRemove = useCallback(async () => {
    if (!isAdmin || coverRemoving) return;
    setCoverRemoving(true);
    setCoverError(null);
    report({ status: 'saving', message: null });
    try {
      await adapter.cover.saveUrl(null);
      setCoverCropBox(null);
      report({ status: 'saved', message: 'Cover photo removed.' });
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : 'Failed to remove');
      report({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to remove cover photo',
      });
    } finally {
      setCoverRemoving(false);
    }
  }, [isAdmin, coverRemoving, adapter, report]);

  const onGalleryAdd = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const input = e.target;
      if (!file || !isAdmin) return;
      if (gallery.length >= BOOKING_GALLERY_MAX) {
        setGalleryError(`You can add up to ${BOOKING_GALLERY_MAX} photos.`);
        input.value = '';
        return;
      }
      await adapter.preserveScroll(async () => {
        setGalleryUploading(true);
        setGalleryError(null);
        try {
          const url = await adapter.gallery.upload(file);
          setGallery((g) => [...g, url]);
        } catch (err) {
          setGalleryError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
          setGalleryUploading(false);
          input.value = '';
          blurFileInput(input);
        }
      });
    },
    [isAdmin, gallery.length, adapter],
  );

  const removeGalleryImage = useCallback((idx: number) => {
    setGallery((g) => g.filter((_, i) => i !== idx));
  }, []);

  const moveGalleryImage = useCallback((idx: number, dir: -1 | 1) => {
    setGallery((g) => {
      const j = idx + dir;
      if (j < 0 || j >= g.length) return g;
      const next = [...g];
      const tmp = next[idx]!;
      next[idx] = next[j]!;
      next[j] = tmp;
      return next;
    });
  }, []);

  const onServicePhotoChange = useCallback(
    async (serviceId: string, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const input = e.target;
      if (!file || !isAdmin) return;
      await adapter.preserveScroll(async () => {
        setServicePhotoBusyId(serviceId);
        setServicePhotoError(null);
        try {
          const url = await adapter.services.photo.upload(serviceId, file);
          let nextPhotos: Record<string, string> = {};
          setServicePhotos((prev) => {
            nextPhotos = { ...prev, [serviceId]: url };
            return nextPhotos;
          });
          // A new photo starts centred: framing chosen for the old one means nothing here.
          const nextCrops = { ...servicePhotoCrops };
          delete nextCrops[serviceId];
          setServicePhotoCrops(nextCrops);
          if (adapter.capabilities.servicePhotosInConfig) {
            await persistBookingPageConfig(nextPhotos, nextCrops);
          } else {
            // Collective: the photo lives on the item, and the dropped framing rides the
            // debounced config save that this state change triggers.
            await adapter.services.photo.save(serviceId, url);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Upload failed';
          setServicePhotoError(message);
          report({ status: 'error', message });
        } finally {
          setServicePhotoBusyId(null);
          input.value = '';
          blurFileInput(input);
        }
      });
    },
    [isAdmin, adapter, persistBookingPageConfig, servicePhotoCrops, report],
  );

  const removeServicePhoto = useCallback(
    (serviceId: string) => {
      const removedUrl = effectiveServicePhotos[serviceId]?.trim() ?? '';
      // Empty string, not a delete: for a collective the url also lives on the catalogue item,
      // which would put the photo straight back until the catalogue reloads.
      const next = { ...servicePhotos, [serviceId]: '' };
      const nextCrops = { ...servicePhotoCrops };
      delete nextCrops[serviceId];
      setServicePhotos(next);
      setServicePhotoCrops(nextCrops);
      setServicePhotoError(null);
      void (async () => {
        report({ status: 'saving', message: null });
        try {
          if (adapter.capabilities.servicePhotosInConfig) {
            await persistBookingPageConfig(next, nextCrops);
          } else {
            await adapter.services.photo.save(serviceId, null);
          }
          if (removedUrl) {
            try {
              await adapter.services.photo.removeStored?.(removedUrl);
            } catch (cleanupErr) {
              console.warn('Service photo storage delete failed:', cleanupErr);
            }
          }
          report({ status: 'saved', message: 'Service photo removed.' });
        } catch (err) {
          // Put both back: the photo is still there, so its framing is still meaningful.
          setServicePhotos(servicePhotos);
          setServicePhotoCrops(servicePhotoCrops);
          const message = err instanceof Error ? err.message : 'Failed to remove photo';
          setServicePhotoError(message);
          report({ status: 'error', message });
        }
      })();
    },
    [
      adapter,
      effectiveServicePhotos,
      persistBookingPageConfig,
      report,
      servicePhotos,
      servicePhotoCrops,
    ],
  );

  const hideAllTeamProfilesOnPage = useCallback(() => {
    setTeamProfiles((prev) => {
      if (teamList.length === 0) return prev;
      const next = { ...prev };
      for (const m of teamList) {
        const existing = next[m.id] ?? {};
        next[m.id] = { ...existing, hidden: true };
      }
      return next;
    });
  }, [teamList]);

  const onShowTeamTabChange = useCallback(
    (checked: boolean) => {
      setShowTeamTab(checked);
      if (!checked) hideAllTeamProfilesOnPage();
    },
    [hideAllTeamProfilesOnPage],
  );

  const updateTeamProfile = useCallback((memberId: string, patch: Partial<BookingTeamProfile>) => {
    setTeamProfiles((prev) => ({ ...prev, [memberId]: { ...prev[memberId], ...patch } }));
  }, []);

  const setServicePhotoCrop = useCallback((serviceId: string, crop: BookingPageImageFraming) => {
    setServicePhotoCrops((prev) => ({ ...prev, [serviceId]: crop }));
  }, []);

  const onTeamPhotoChange = useCallback(
    async (memberId: string, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const input = e.target;
      if (!file || !isAdmin) return;
      await adapter.preserveScroll(async () => {
        setTeamPhotoBusyId(memberId);
        try {
          const url = await adapter.team.uploadPhoto(memberId, file);
          // New photo, fresh framing: whatever suited the previous one does not apply.
          updateTeamProfile(memberId, { photo: url, photo_crop: null });
        } catch {
          /* debounced branding save surfaces errors */
        } finally {
          setTeamPhotoBusyId(null);
          input.value = '';
          blurFileInput(input);
        }
      });
    },
    [isAdmin, adapter, updateTeamProfile],
  );

  /** Copy a member venue's saved settings into the editor (collective import). */
  const applyImport = useCallback(
    (source: ImportSource, scope: ImportScope) => {
      const c = source.config;
      if (scope === 'all' || scope === 'book_now') {
        setBrandPrimary(c.brand_primary ?? '');
        setBrandEmails(c.brand_emails === true);
        setFontPreset(c.font_preset ?? 'default');
        setAnnouncement(c.announcement ?? '');
        setCoverFullWidth(c.cover_full_width === true);
        setCoverCropBox(resolveBookingPageCoverCropBox(c.cover_crop_box));
        // Reuse the member's existing public image URLs (no re-upload).
        void adapter.logo.saveUrl(source.logoUrl ?? null);
        void adapter.cover.saveUrl(source.coverPhotoUrl ?? null);
      }
      if (scope === 'all' || scope === 'about') {
        setAbout(c.about ?? '');
        setInstagram(c.social_links?.instagram ?? '');
        setFacebook(c.social_links?.facebook ?? '');
        setTiktok(c.social_links?.tiktok ?? '');
        setXUrl(c.social_links?.x ?? '');
        setGallery(c.gallery ?? []);
      }
      if (scope === 'all') {
        setShowServicesTab(c.show_services_tab === true);
        setShowTeamTab(c.show_team_tab === true);
        setShowAboutTab(c.show_about_tab === true);
        setServicesLayout(resolveServicesLayout(c));
      }
    },
    [adapter],
  );

  const importSources = adapter.importSources;

  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50';

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Guest-facing"
        eyebrowClassName={BOOKING_PAGE_EYEBROW_CLASS}
        title="Your booking page"
        titleClassName={BOOKING_PAGE_PRIMARY_HEADING_CLASS}
        description={
          isAdmin
            ? 'Customise how your public booking page looks and where guests find it. Changes save automatically.'
            : 'Only an administrator can change the booking page URL and branding.'
        }
      />
      <SectionCard.Body className="space-y-6">
        {isAdmin && importSources.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200/70 bg-brand-50/40 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">Start from an existing page</p>
              <p className="text-xs text-slate-500">
                Copy a member venue’s logo, colours and content, then edit it here.
              </p>
            </div>
            <ImportFromMember
              sources={importSources}
              scope="all"
              label="Start from…"
              onImport={applyImport}
              disabled={!isAdmin}
              variant="prominent"
            />
          </div>
        ) : null}

        {bookUrl && (
          <div className="rounded-xl border border-brand-200/80 bg-brand-50/50 px-4 py-3">
            <p className={BOOKING_PAGE_FIELD_HEADING_MB1_CLASS}>Public booking page</p>
            <p className="mt-1 break-all text-sm text-slate-600">{bookUrl}</p>
            <Link
              href={bookPath!}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex text-sm font-semibold text-brand-700 hover:text-brand-800"
            >
              Open booking page in a new tab
            </Link>
          </div>
        )}

        {bookPath ? (
          <details
            className={bookingExpandAccordionDetailsClass}
            onToggle={(e) => {
              if ((e.currentTarget as HTMLDetailsElement).open) {
                setPreviewMounted(true);
              }
            }}
          >
            <summary className={bookingExpandAccordionSummaryClass}>
              <span>Live preview</span>
              <span className="flex items-center gap-2">
                <span className="max-w-[12rem] truncate text-[11px] font-medium text-slate-400 group-open:hidden sm:max-w-none">
                  Show how guests see your page
                </span>
                {previewAccordionChevron}
              </span>
            </summary>
            <div className={`${bookingExpandAccordionBodyClass} space-y-3`}>
              {previewMounted ? (
                <>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                      <button
                        type="button"
                        onClick={() => setPreviewDevice('mobile')}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          previewDevice === 'mobile'
                            ? 'bg-slate-100 text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Mobile
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewDevice('desktop')}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          previewDevice === 'desktop'
                            ? 'bg-slate-100 text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Desktop
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={bumpPreview}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50"
                    >
                      Refresh
                    </button>
                  </div>
                  <InlineBookingPreview
                    previewVenue={previewVenue}
                    device={previewDevice}
                    remountKey={previewToken}
                    services={previewServices}
                    team={previewTeam}
                  />
                  <p className="text-xs text-slate-500">
                    Updates as you edit colours and content. Logo, cover, and gallery photos appear after upload.
                    {bookPath && (
                      <>
                        {' '}
                        <Link
                          href={bookPath}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-brand-700 hover:text-brand-800"
                        >
                          Open full page in a new tab
                        </Link>
                        .
                      </>
                    )}
                  </p>
                </>
              ) : null}
            </div>
          </details>
        ) : null}

        <BookingPageSettingsGroup
          title="Book now"
          description={
            isAppointmentVenue
              ? 'Header, booking flow, and styling for the Book now tab. Address and phone are edited under Profile.'
              : 'Logo, cover, branding, and your public booking flow.'
          }
          tabToggle={isAppointmentVenue ? { kind: 'always-on' } : undefined}
          headerAction={
            importSources.length > 0 ? (
              <ImportFromMember
                sources={importSources}
                scope="book_now"
                label="Import from…"
                onImport={applyImport}
                disabled={!isAdmin}
              />
            ) : undefined
          }
        >
        {adapter.addressSlot}

        <div>
          <span className={BOOKING_PAGE_FIELD_HEADING_MB2_CLASS}>Logo</span>
          <div className="flex flex-wrap items-center gap-3">
            {logoUrl ? (
              isAdmin ? (
                <BookingPageDraggableLogo
                  logoUrl={logoUrl}
                  crop={logoCrop}
                  disabled={logoSaving || logoRemoving}
                  onCropChange={setLogoCrop}
                />
              ) : (
                <BookingPageLogo logoUrl={logoUrl} alt="Logo" crop={logoCrop} size="md" />
              )
            ) : (
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 ring-1 ring-slate-200">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                  />
                </svg>
              </div>
            )}
            {isAdmin && (
              <>
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 ${logoSaving || logoRemoving ? 'pointer-events-none opacity-50' : ''}`}
                >
                  <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                    />
                  </svg>
                  {logoUrl ? 'Change logo' : 'Upload logo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onLogoChange}
                    disabled={logoSaving || logoRemoving}
                    className={SETTINGS_HIDDEN_FILE_INPUT_CLASS}
                    tabIndex={-1}
                  />
                </label>
                {logoUrl && (
                  <>
                    <button
                      type="button"
                      onClick={onLogoRemove}
                      disabled={logoSaving || logoRemoving}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {logoRemoving ? 'Removing…' : 'Remove logo'}
                    </button>
                    <BookingPageLogoFramingControls
                      crop={logoCrop}
                      disabled={logoSaving || logoRemoving}
                      onChange={setLogoCrop}
                    />
                  </>
                )}
              </>
            )}
          </div>
          {isAdmin && (
            <div className="mt-2 space-y-1">
              {logoSaving && <p className="text-sm text-amber-700">Uploading…</p>}
              {logoError && <p className="text-sm text-red-600">{logoError}</p>}
              <p className="text-xs text-slate-500">
                {logoUrl
                  ? 'Drag the logo to reposition it. Shown on your booking page and in guest emails.'
                  : 'Shown on your booking page and in guest emails.'}
              </p>
            </div>
          )}
        </div>

        <div>
          <span className={BOOKING_PAGE_FIELD_HEADING_MB2_CLASS}>Cover photo</span>
          {isAdmin ? (
            <fieldset className="mb-3">
              <legend className="sr-only">Cover photo layout</legend>
              <div className="flex flex-wrap gap-2">
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    coverFullWidth
                      ? 'border-brand-300 bg-brand-50 text-brand-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="bp-cover-layout"
                    className="sr-only"
                    checked={coverFullWidth}
                    onChange={() => setCoverFullWidth(true)}
                  />
                  Full width
                </label>
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    !coverFullWidth
                      ? 'border-brand-300 bg-brand-50 text-brand-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="bp-cover-layout"
                    className="sr-only"
                    checked={!coverFullWidth}
                    onChange={() => setCoverFullWidth(false)}
                  />
                  Contained width
                </label>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {coverFullWidth
                  ? 'Spans the full screen width. Best for wide photos.'
                  : 'Stays the same width as your booking content on all screen sizes. Best when cropping is awkward.'}
              </p>
            </fieldset>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {coverUrl ? (
              <div className={BOOKING_PAGE_COVER_SETTINGS_FRAME_CLASS}>
                <BookingPageCoverPhoto coverUrl={coverUrl} alt="Cover" cropBox={coverCropBox} />
              </div>
            ) : (
              <div className={BOOKING_PAGE_COVER_SETTINGS_PLACEHOLDER_FRAME_CLASS}>No cover photo</div>
            )}
            {isAdmin && (
              <>
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 ${coverSaving || coverRemoving ? 'pointer-events-none opacity-50' : ''}`}
                >
                  {coverUrl ? 'Change photo' : 'Upload photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onCoverChange}
                    disabled={coverSaving || coverRemoving}
                    className={SETTINGS_HIDDEN_FILE_INPUT_CLASS}
                    tabIndex={-1}
                  />
                </label>
                {coverUrl && (
                  <>
                    <button
                      type="button"
                      onClick={() => setCropperOpen(true)}
                      disabled={coverSaving || coverRemoving}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {coverCropBox ? 'Edit crop' : 'Crop photo'}
                    </button>
                    {coverCropBox && (
                      <button
                        type="button"
                        onClick={() => setCoverCropBox(null)}
                        disabled={coverSaving || coverRemoving}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50"
                      >
                        Reset crop
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onCoverRemove}
                      disabled={coverSaving || coverRemoving}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {coverRemoving ? 'Removing…' : 'Remove photo'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          {isAdmin && (
            <div className="mt-2 space-y-1">
              {coverSaving && <p className="text-sm text-amber-700">Uploading…</p>}
              {coverError && <p className="text-sm text-red-600">{coverError}</p>}
              <p className="text-xs text-slate-500">
                {coverUrl
                  ? coverCropBox
                    ? coverFullWidth
                      ? 'Showing your selected crop as a full-width banner. Use Edit crop to change the area, or Reset crop to show the whole photo.'
                      : 'Showing your selected crop above your venue name. Use Edit crop to change the area, or Reset crop to show the whole photo.'
                    : coverFullWidth
                      ? 'Showing the whole photo as a full-width banner, never cropped. Use Crop photo to choose a specific area.'
                      : 'Showing the whole photo above your venue name, never cropped. Use Crop photo to choose a specific area.'
                  : coverFullWidth
                    ? 'Upload a photo to show as a full-width banner at the top of your booking page.'
                    : 'Upload a photo to show above your venue name at a fixed content width.'}
              </p>
            </div>
          )}
          {isAdmin && coverUrl && cropperOpen && (
            <BookingPageCoverCropper
              open
              onOpenChange={setCropperOpen}
              coverUrl={coverUrl}
              initialCrop={coverCropBox}
              onApply={setCoverCropBox}
            />
          )}
        </div>

          {isAdmin && (
            <div>
              <span className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>Quick palettes</span>
              <div className="flex flex-wrap gap-2">
                {BOOKING_THEME_PRESETS.map((preset) => {
                  const active = normalizeHexColor(brandPrimary) === preset.primary;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => setBrandPrimary(preset.primary)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? 'border-brand-300 bg-brand-50 text-brand-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <span className="h-4 w-4 rounded-full ring-1 ring-white" style={{ backgroundColor: preset.primary }} />
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="sm:max-w-sm">
            <label className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>Brand colour</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Brand colour"
                disabled={!isAdmin}
                value={normalizeHexColor(brandPrimary) ?? '#003b6f'}
                onChange={(e) => setBrandPrimary(e.target.value)}
                className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 disabled:opacity-50"
              />
              <input
                type="text"
                disabled={!isAdmin}
                value={brandPrimary}
                onChange={(e) => setBrandPrimary(e.target.value)}
                placeholder="#003B6F"
                className={inputClass}
              />
              {brandPrimary.trim() && isAdmin && (
                <button
                  type="button"
                  onClick={() => setBrandPrimary('')}
                  className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  Reset
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">Buttons, highlights and accents on your booking page.</p>
            {primaryLowContrast && (
              <p className="mt-1 text-xs text-amber-800">
                This colour is quite light. White button text may be hard to read; a darker shade works best.
              </p>
            )}
            {adapter.capabilities.emailBranding ? (
              <label htmlFor="bp-brand-emails" className="mt-3 flex items-start gap-2">
                <input
                  id="bp-brand-emails"
                  type="checkbox"
                  className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={brandEmails}
                  disabled={!isAdmin || !primaryHasColour}
                  onChange={(e) => setBrandEmails(e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-700">
                    Use my brand colour in customer emails
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {primaryHasColour
                      ? 'Buttons, links and highlights in booking confirmations, reminders and receipts. Leave this off to keep the ResNeo colours.'
                      : 'Choose a brand colour first.'}
                    {primaryHasColour && primaryLowContrast
                      ? ' A light colour is darkened a little in emails so white button text stays readable.'
                      : ''}
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          <div>
            <label htmlFor="bp-font" className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>
              Font style
            </label>
            <BookingFontPresetSelect
              id="bp-font"
              disabled={!isAdmin}
              value={fontPreset}
              onChange={setFontPreset}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-500">Sets the headings and text style on your booking page.</p>
          </div>

          <div>
            <label htmlFor="bp-announcement" className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>
              Announcement banner
            </label>
            <input
              id="bp-announcement"
              type="text"
              disabled={!isAdmin}
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              maxLength={300}
              placeholder="e.g. Closed bank holiday Monday"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-500">Shown as a coloured bar across the top of your booking page.</p>
          </div>
        </BookingPageSettingsGroup>

        {isAppointmentVenue && isAdmin ? (
          <BookingPageSettingsGroup
            title="Services"
            description="Photos for each bookable service. Names and descriptions come from your appointment services."
            tabToggle={{
              id: 'bp-tab-services',
              checked: showServicesTab,
              disabled: !isAdmin,
              onChange: setShowServicesTab,
            }}
          >
              <fieldset className="mb-5">
                <legend className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>How services are listed</legend>
                <p className="mb-2 text-xs text-slate-500">
                  {serviceHasCategories
                    ? 'Applies wherever customers pick a service: the booking form and the Services tab.'
                    : 'Create categories on the Services page to group your services. Until then the list shows as it does now.'}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      {
                        value: 'sections',
                        label: 'Sections with a category menu',
                        hint: 'Every category is shown with its services below. A menu at the top jumps between them.',
                      },
                      {
                        value: 'accordion',
                        label: 'Collapsible categories',
                        hint: 'Customers open a category to see its services. Good for long menus.',
                      },
                    ] as const
                  ).map((option) => {
                    const selected = servicesLayout === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors ${
                          selected ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 bg-white hover:border-slate-300'
                        } ${!isAdmin ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        <input
                          type="radio"
                          name="bp-services-layout"
                          value={option.value}
                          checked={selected}
                          disabled={!isAdmin}
                          onChange={() => setServicesLayout(option.value)}
                          className="mt-0.5 text-brand-600 focus:ring-brand-500"
                        />
                        <span>
                          <span className="block font-medium text-slate-800">{option.label}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">{option.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {serviceList.length > 0 ? (
              <div>
              <span className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>Service photos</span>
              <p className="mb-2 text-xs text-slate-500">
                Add a photo to each service. Shown on the Services tab when that tab is enabled.
                Drag a photo to reposition it, and use the scale slider to zoom.
              </p>
              {servicePhotoError ? (
                <p className="mb-2 text-sm text-red-600" role="alert">
                  {servicePhotoError}
                </p>
              ) : null}
              <div className="space-y-2">
                {serviceList.map((svc) => {
                  const url = effectiveServicePhotos[svc.id];
                  const busy = servicePhotoBusyId === svc.id;
                  return (
                    <div key={svc.id} className="rounded-xl border border-slate-200 bg-white p-2.5">
                      <div className="flex items-center gap-3">
                      {url ? (
                        <BookingPageDraggableImage
                          imageUrl={url}
                          crop={servicePhotoCrops[svc.id] ?? null}
                          onCropChange={(crop) => setServicePhotoCrop(svc.id, crop)}
                          sizePx={48}
                          shape="rounded"
                          disabled={!isAdmin}
                          label={`Reposition the photo for ${svc.name}`}
                        />
                      ) : (
                        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                          <div className="flex h-full w-full items-center justify-center text-slate-300">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M18 14.25v4.5m-9-12.75h.008v.008H9V6Z" />
                            </svg>
                          </div>
                        </div>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{svc.name}</span>
                      <label
                        className={`cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 ${
                          busy ? 'pointer-events-none opacity-50' : ''
                        }`}
                      >
                        {busy ? 'Uploading…' : url ? 'Change' : 'Add photo'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => onServicePhotoChange(svc.id, e)}
                          disabled={busy}
                          className={SETTINGS_HIDDEN_FILE_INPUT_CLASS}
                      tabIndex={-1}
                        />
                      </label>
                      {url && (
                        <button
                          type="button"
                          onClick={() => removeServicePhoto(svc.id)}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      )}
                      </div>
                      {url ? (
                        <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-2">
                          <BookingPageImageFramingControls
                            crop={servicePhotoCrops[svc.id] ?? {}}
                            disabled={!isAdmin}
                            onChange={(crop) => setServicePhotoCrop(svc.id, crop)}
                            controlId={`service-photo-${svc.id}`}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              </div>
              ) : (
                <p className="text-xs text-slate-500">Add appointment services to upload photos for each one.</p>
              )}
            </BookingPageSettingsGroup>
          ) : null}

          {isAppointmentVenue && isAdmin ? (
            <BookingPageSettingsGroup
              title="Meet the team"
              description="Staff photos, bios, and specialties on your public booking page."
              tabToggle={{
                id: 'bp-tab-team',
                checked: showTeamTab,
                disabled: !isAdmin,
                onChange: onShowTeamTabChange,
              }}
            >
              {teamList.length > 0 ? (
              <div>
              <span className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>Team profiles</span>
              <p className="mb-2 text-xs text-slate-500">
                Add a photo, short bio, and specialties for each team member. Drag a photo to
                reposition it, and use the scale slider to zoom.
              </p>
              <div className="space-y-3">
                {teamList.map((m) => {
                  const profile = teamProfiles[m.id] ?? {};
                  const busy = teamPhotoBusyId === m.id;
                  return (
                    <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-start gap-3">
                        {profile.photo ? (
                          <BookingPageDraggableImage
                            imageUrl={profile.photo}
                            crop={profile.photo_crop ?? null}
                            onCropChange={(crop) => updateTeamProfile(m.id, { photo_crop: crop })}
                            sizePx={56}
                            shape="circle"
                            disabled={!isAdmin}
                            label={`Reposition the photo for ${m.name}`}
                          />
                        ) : (
                          <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                            <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-400">
                              {m.name.charAt(0).toUpperCase()}
                            </div>
                          </div>
                        )}
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-slate-900">{m.name}</span>
                            <label
                              className={`inline-flex shrink-0 items-center gap-1.5 text-xs text-slate-600 ${
                                !showTeamTab ? 'opacity-50' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={showTeamTab && !profile.hidden}
                                disabled={!showTeamTab}
                                onChange={(e) => updateTeamProfile(m.id, { hidden: !e.target.checked })}
                              />
                              Show on page
                            </label>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <label
                              className={`cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 ${
                                busy ? 'pointer-events-none opacity-50' : ''
                              }`}
                            >
                              {busy ? 'Uploading…' : profile.photo ? 'Change photo' : 'Add photo'}
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={(e) => onTeamPhotoChange(m.id, e)}
                                disabled={busy}
                                className={SETTINGS_HIDDEN_FILE_INPUT_CLASS}
                      tabIndex={-1}
                              />
                            </label>
                            {profile.photo && (
                              <button
                                type="button"
                                onClick={() => updateTeamProfile(m.id, { photo: null, photo_crop: null })}
                                className="text-xs font-medium text-red-600 hover:text-red-700"
                              >
                                Remove photo
                              </button>
                            )}
                          </div>
                          {profile.photo ? (
                            <div className="flex flex-wrap items-center gap-3">
                              <BookingPageImageFramingControls
                                crop={profile.photo_crop ?? {}}
                                disabled={!isAdmin}
                                onChange={(crop) => updateTeamProfile(m.id, { photo_crop: crop })}
                                controlId={`team-photo-${m.id}`}
                              />
                            </div>
                          ) : null}
                          <input
                            type="text"
                            value={profile.specialties ?? ''}
                            onChange={(e) => updateTeamProfile(m.id, { specialties: e.target.value })}
                            placeholder="Specialties (comma-separated)"
                            maxLength={200}
                            className={inputClass}
                          />
                          <textarea
                            value={profile.bio ?? ''}
                            onChange={(e) => updateTeamProfile(m.id, { bio: e.target.value })}
                            rows={2}
                            maxLength={600}
                            placeholder="Short bio"
                            className={`${inputClass} resize-y`}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
              ) : (
                <p className="text-xs text-slate-500">Add bookable team members to configure their profiles.</p>
              )}
            </BookingPageSettingsGroup>
          ) : null}

        {isAppointmentVenue ? (
          <BookingPageSettingsGroup
            title="About"
            description="Welcome message, map, gallery, and social links for the About tab."
            tabToggle={{
              id: 'bp-tab-about',
              checked: showAboutTab,
              disabled: !isAdmin,
              onChange: setShowAboutTab,
            }}
            headerAction={
              importSources.length > 0 ? (
                <ImportFromMember
                  sources={importSources}
                  scope="about"
                  label="Import from…"
                  onImport={applyImport}
                  disabled={!isAdmin}
                />
              ) : undefined
            }
          >
          <div>
            <label htmlFor="bp-about" className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>
              About / welcome message
            </label>
            <textarea
              id="bp-about"
              disabled={!isAdmin}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Tell guests a little about your business…"
              className={`${inputClass} resize-y`}
            />
          </div>

          <div>
            <span className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>
              Social links <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              <input type="url" disabled={!isAdmin} value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="Instagram URL" className={inputClass} />
              <input type="url" disabled={!isAdmin} value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="Facebook URL" className={inputClass} />
              <input type="url" disabled={!isAdmin} value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="TikTok URL" className={inputClass} />
              <input type="url" disabled={!isAdmin} value={xUrl} onChange={(e) => setXUrl(e.target.value)} placeholder="X (Twitter) URL" className={inputClass} />
            </div>
          </div>

          <div>
            <span className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>
              Photo gallery <span className="font-normal text-slate-400">({gallery.length}/{BOOKING_GALLERY_MAX})</span>
            </span>
            <p className="mb-2 text-xs text-slate-500">
              Showcase your space and work. Photos appear on the About tab when it is enabled.
            </p>
            {gallery.length > 0 && (
              <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {gallery.map((url, idx) => (
                  <div key={`${url}-${idx}`} className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-slate-200">
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    {isAdmin && (
                      <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => moveGalleryImage(idx, -1)}
                          disabled={idx === 0}
                          aria-label="Move left"
                          className="rounded-md bg-white/90 px-1.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-40"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => removeGalleryImage(idx)}
                          aria-label="Remove photo"
                          className="rounded-md bg-white/90 px-1.5 py-1 text-xs font-semibold text-red-600"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => moveGalleryImage(idx, 1)}
                          disabled={idx === gallery.length - 1}
                          aria-label="Move right"
                          className="rounded-md bg-white/90 px-1.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-40"
                        >
                          →
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {isAdmin && (
              <>
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 ${
                    galleryUploading || gallery.length >= BOOKING_GALLERY_MAX ? 'pointer-events-none opacity-50' : ''
                  }`}
                >
                  {galleryUploading ? 'Uploading…' : 'Add photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onGalleryAdd}
                    disabled={galleryUploading || gallery.length >= BOOKING_GALLERY_MAX}
                    className={SETTINGS_HIDDEN_FILE_INPUT_CLASS}
                    tabIndex={-1}
                  />
                </label>
                {galleryError && <p className="mt-2 text-sm text-red-600">{galleryError}</p>}
              </>
            )}
          </div>
          </BookingPageSettingsGroup>
        ) : null}
      </SectionCard.Body>
    </SectionCard>
  );
}
