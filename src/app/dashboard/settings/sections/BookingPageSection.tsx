'use client';

import Link from 'next/link';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookingPageCoverPhoto } from '@/components/booking/BookingPageCoverPhoto';
import { BookingPageLogo } from '@/components/booking/BookingPageLogo';
import { BookingFontPresetSelect } from './BookingFontPresetSelect';
import {
  BOOKING_PAGE_COVER_SETTINGS_FRAME_CLASS,
  BOOKING_PAGE_COVER_SETTINGS_PLACEHOLDER_FRAME_CLASS,
  DEFAULT_BOOKING_PAGE_COVER_CROP,
  resolveBookingPageCoverCrop,
  sanitizeBookingPageCoverCrop,
  type BookingPageCoverCrop,
} from '@/lib/booking/booking-page-cover';
import { BookingPageDraggableCover } from './BookingPageDraggableCover';
import { BookingPageDraggableLogo } from './BookingPageDraggableLogo';
import { BookingPageImageFramingControls } from './BookingPageImageFramingControls';
import { BookingPageLogoFramingControls } from './BookingPageLogoFramingControls';
import { BookingPageLivePreview } from './BookingPageLivePreview';
import {
  BOOKING_PAGE_EYEBROW_CLASS,
  BOOKING_PAGE_FIELD_HEADING_MB1_CLASS,
  BOOKING_PAGE_FIELD_HEADING_MB15_CLASS,
  BOOKING_PAGE_FIELD_HEADING_MB2_CLASS,
  BOOKING_PAGE_PRIMARY_HEADING_CLASS,
  BOOKING_PAGE_SECTION_HEADING_CLASS,
} from './booking-page-settings-typography';
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
import type { VenueSettings } from '../types';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { useSettingsSave } from '../SettingsSaveContext';
import {
  blurFileInput,
  preserveSettingsScrollDuring,
  SETTINGS_HIDDEN_FILE_INPUT_CLASS,
} from '../preserve-settings-scroll';
import { readResponseJson } from '@/lib/http/read-response-json';
import {
  BOOKING_GALLERY_MAX,
  BOOKING_THEME_PRESETS,
  normalizeHexColor,
  primaryNeedsDarkText,
  type BookingFontPreset,
  type BookingPageConfig,
  type BookingTeamProfile,
} from '@/lib/booking/booking-page-theme';
import {
  DEFAULT_BOOKING_PAGE_LOGO_CROP,
  resolveBookingPageLogoCrop,
  sanitizeBookingPageLogoCrop,
  type BookingPageLogoCrop,
} from '@/lib/booking/booking-page-logo';
import type { BookingPagePublicService } from '@/lib/booking/booking-page-tabs';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';

const BOOKING_SLUG_TAKEN_MESSAGE =
  'That booking page address is already taken by another venue. Choose a different slug (letters, numbers, and hyphens only).';

class SlugConflictError extends Error {
  constructor() {
    super(BOOKING_SLUG_TAKEN_MESSAGE);
    this.name = 'SlugConflictError';
  }
}

const bookingPageSchema = z.object({
  slug: z
    .string()
    .min(1, 'Booking page address is required')
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
});

type BookingPageForm = z.infer<typeof bookingPageSchema>;

interface BookingPageSectionProps {
  venue: VenueSettings;
  onUpdate: (patch: Partial<VenueSettings>) => void;
  isAdmin: boolean;
  publicBaseUrl: string;
}

function slugFingerprint(slug: string): string {
  return slug.trim().toLowerCase();
}

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
  children,
}: {
  title: string;
  description?: string;
  tabToggle?: BookingPageTabToggle;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-slate-100 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className={BOOKING_PAGE_SECTION_HEADING_CLASS}>{title}</h3>
          {description ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p> : null}
        </div>
        {tabToggle && 'kind' in tabToggle ? (
          <span className="shrink-0 pt-0.5 text-xs font-medium text-slate-500">Always shown</span>
        ) : tabToggle ? (
          <label
            htmlFor={tabToggle.id}
            className={`flex shrink-0 cursor-pointer items-center gap-2 pt-0.5 ${
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
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function BookingPageSection({
  venue,
  onUpdate,
  isAdmin,
  publicBaseUrl,
}: BookingPageSectionProps) {
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoRemoving, setLogoRemoving] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  type SlugHint = 'idle' | 'checking' | 'current' | 'available' | 'taken';
  const [slugHint, setSlugHint] = useState<SlugHint>('idle');
  const { report } = useSettingsSave();
  const lastSavedSlug = useRef<string | null>(null);
  const slugConflictFingerprintRef = useRef<string | null>(null);
  const venueIdRef = useRef<string | null>(null);

  // ── Booking Site Studio: branding & content ──────────────────────────────
  const cfg0 = venue.booking_page_config ?? {};
  const [brandPrimary, setBrandPrimary] = useState(cfg0.brand_primary ?? '');
  const [brandAccent, setBrandAccent] = useState(cfg0.brand_accent ?? '');
  const [fontPreset, setFontPreset] = useState<BookingFontPreset>(cfg0.font_preset ?? 'default');
  const [logoCrop, setLogoCrop] = useState<BookingPageLogoCrop>(() =>
    resolveBookingPageLogoCrop(cfg0.logo_crop),
  );
  const [coverCrop, setCoverCrop] = useState<BookingPageCoverCrop>(() =>
    resolveBookingPageCoverCrop(cfg0.cover_crop),
  );
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
  const [showServicesTab, setShowServicesTab] = useState(cfg0.show_services_tab === true);
  const [showTeamTab, setShowTeamTab] = useState(cfg0.show_team_tab === true);
  const [showAboutTab, setShowAboutTab] = useState(cfg0.show_about_tab === true);
  const [serviceList, setServiceList] = useState<
    Array<{ id: string; name: string; description?: string | null; price_pence?: number | null; duration_minutes?: number }>
  >([]);
  const [servicePhotoBusyId, setServicePhotoBusyId] = useState<string | null>(null);
  const [servicePhotoError, setServicePhotoError] = useState<string | null>(null);
  const [teamProfiles, setTeamProfiles] = useState<Record<string, BookingTeamProfile>>(cfg0.team_profiles ?? {});
  const [teamList, setTeamList] = useState<Array<{ id: string; name: string }>>([]);
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

  const buildConfigFromState = useCallback((): BookingPageConfig => {
    const config: BookingPageConfig = {};
    const primary = normalizeHexColor(brandPrimary);
    if (primary) config.brand_primary = primary;
    const accent = normalizeHexColor(brandAccent);
    if (accent) config.brand_accent = accent;
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
    const photos = servicePhotosForConfig(servicePhotos);
    config.service_photos = Object.keys(photos).length > 0 ? photos : null;
    config.show_services_tab = showServicesTab;
    config.show_team_tab = showTeamTab;
    config.show_about_tab = showAboutTab;
    // Team profiles: keep only members that still exist and carry content.
    const liveTeamIds = new Set(teamList.map((m) => m.id));
    const profiles: Record<string, BookingTeamProfile> = {};
    for (const [id, p] of Object.entries(teamProfiles)) {
      if (liveTeamIds.size > 0 && !liveTeamIds.has(id)) continue;
      const clean: BookingTeamProfile = {};
      if (p.bio?.trim()) clean.bio = p.bio.trim();
      if (p.specialties?.trim()) clean.specialties = p.specialties.trim();
      if (p.photo?.trim()) clean.photo = p.photo.trim();
      if (!showTeamTab || p.hidden) clean.hidden = true;
      if (clean.bio || clean.specialties || clean.photo || clean.hidden) profiles[id] = clean;
    }
    if (Object.keys(profiles).length > 0) config.team_profiles = profiles;
    if (venue.logo_url) {
      const framed = sanitizeBookingPageLogoCrop(logoCrop);
      if (framed) config.logo_crop = framed;
    }
    if (venue.cover_photo_url) {
      const framed = sanitizeBookingPageCoverCrop(coverCrop);
      if (framed) config.cover_crop = framed;
    }
    config.cover_full_width = coverFullWidth;
    return config;
  }, [
    brandPrimary,
    brandAccent,
    fontPreset,
    logoCrop,
    coverCrop,
    coverFullWidth,
    venue.logo_url,
    venue.cover_photo_url,
    about,
    announcement,
    instagram,
    facebook,
    tiktok,
    xUrl,
    gallery,
    servicePhotos,
    servicePhotosForConfig,
    showServicesTab,
    showTeamTab,
    showAboutTab,
    teamProfiles,
    teamList,
  ]);

  const persistBookingPageConfig = useCallback(
    async (photosOverride?: Record<string, string>) => {
      const config = buildConfigFromState();
      if (photosOverride !== undefined) {
        const photos = servicePhotosForConfig(photosOverride);
        config.service_photos = Object.keys(photos).length > 0 ? photos : null;
      }
      report({ status: 'saving', message: null });
      const res = await fetch('/api/venue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_page_config: config }),
      });
      const body = await readResponseJson<{ error?: string; booking_page_config?: BookingPageConfig | null }>(
        res,
      );
      if (!res.ok) throw new Error(body.error ?? 'Failed to save');
      const savedConfig = body.booking_page_config ?? config;
      lastSavedConfigRef.current = JSON.stringify(savedConfig);
      onUpdate({ booking_page_config: savedConfig });
      report({ status: 'saved', message: 'Booking page updated.' });
      return savedConfig;
    },
    [buildConfigFromState, servicePhotosForConfig, onUpdate, report],
  );

  const primaryHasColour = Boolean(normalizeHexColor(brandPrimary));
  const primaryLowContrast = primaryHasColour && primaryNeedsDarkText(normalizeHexColor(brandPrimary)!);

  const {
    register,
    control,
    formState: { errors },
    watch,
    getValues,
    reset,
    setValue,
    setError,
    clearErrors,
  } = useForm<BookingPageForm>({
    resolver: zodResolver(bookingPageSchema),
    defaultValues: { slug: venue.slug ?? '' },
  });

  const slugInput = watch('slug');
  const watched = useWatch({ control });

  const savedSlug = venue.slug?.trim() ?? '';
  const draftSlugNorm = slugInput.trim().toLowerCase();
  const previewSlug =
    draftSlugNorm && /^[a-z0-9-]+$/.test(draftSlugNorm) && draftSlugNorm.length <= 100
      ? draftSlugNorm
      : savedSlug;
  const bookPath = previewSlug ? `/book/${previewSlug}` : null;
  const bookUrl = bookPath ? `${publicBaseUrl.replace(/\/$/, '')}${bookPath}` : null;

  const draftBookingPageConfig = useMemo(() => buildConfigFromState(), [buildConfigFromState]);
  const isAppointmentVenue = isUnifiedSchedulingVenue(venue.booking_model);

  const previewServices = useMemo((): BookingPagePublicService[] => {
    if (!showServicesTab) return [];
    return serviceList.map((s) => ({
        id: s.id,
        name: s.name,
        description: typeof s.description === 'string' && s.description.trim() ? s.description.trim() : null,
        image_url: servicePhotos[s.id]?.trim() || null,
        price_pence: typeof s.price_pence === 'number' ? s.price_pence : null,
        duration_minutes: typeof s.duration_minutes === 'number' && s.duration_minutes > 0 ? s.duration_minutes : 60,
      }));
  }, [showServicesTab, serviceList, servicePhotos]);

  const previewTeam = showTeamTab ? teamList : [];

  const persistSlug = useCallback(
    async (slug: string) => {
      const res = await fetch('/api/venue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const body = await readResponseJson<{ error?: string; slug?: string }>(res);
      if (!res.ok) {
        const apiError = body.error ?? 'Failed to save';
        if (res.status === 409 && /slug/i.test(apiError)) {
          throw new SlugConflictError();
        }
        throw new Error(apiError);
      }
      if (typeof body.slug !== 'string') {
        throw new Error('Unexpected response from server. Please refresh and try again.');
      }
      setValue('slug', body.slug);
      onUpdate({ slug: body.slug });
      lastSavedSlug.current = slugFingerprint(body.slug);
      slugConflictFingerprintRef.current = null;
    },
    [onUpdate, setValue],
  );

  useEffect(() => {
    if (venueIdRef.current === null) {
      venueIdRef.current = venue.id;
      return;
    }
    if (venueIdRef.current === venue.id) return;
    venueIdRef.current = venue.id;
    slugConflictFingerprintRef.current = null;
    setSlugHint('idle');
    clearErrors('slug');
    reset({ slug: venue.slug ?? '' });
    lastSavedSlug.current = slugFingerprint(venue.slug ?? '');
  }, [venue.id, venue.slug, reset, clearErrors]);

  useLayoutEffect(() => {
    if (lastSavedSlug.current === null) {
      lastSavedSlug.current = slugFingerprint(venue.slug ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time fingerprint from initial defaults
  }, []);

  useEffect(() => {
    const subscription = watch((_, info) => {
      if (info?.name === 'slug') {
        clearErrors('slug');
        slugConflictFingerprintRef.current = null;
      }
    });
    return () => subscription.unsubscribe();
  }, [watch, clearErrors]);

  useEffect(() => {
    if (!isAdmin) {
      setSlugHint('idle');
      return;
    }
    const norm = slugInput.trim().toLowerCase();
    const saved = (venue.slug ?? '').trim().toLowerCase();
    if (!norm) {
      setSlugHint('idle');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(norm) || norm.length > 100) {
      setSlugHint('idle');
      return;
    }
    if (norm === saved) {
      setSlugHint('current');
      return;
    }

    const ac = new AbortController();
    setSlugHint('checking');
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/venue/slug-available?slug=${encodeURIComponent(norm)}`, {
          signal: ac.signal,
        });
        const data = await readResponseJson<{ available?: boolean }>(res);
        if (ac.signal.aborted) return;
        if (!res.ok) {
          setSlugHint('idle');
          return;
        }
        setSlugHint(data.available ? 'available' : 'taken');
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        if (!ac.signal.aborted) setSlugHint('idle');
      }
    }, 420);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [slugInput, isAdmin, venue.slug]);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = window.setTimeout(() => {
      const parsed = bookingPageSchema.safeParse(getValues());
      if (!parsed.success) return;
      const normSlug = parsed.data.slug.trim().toLowerCase();
      const savedSlug = (venue.slug ?? '').trim().toLowerCase();
      if (normSlug !== savedSlug && slugHint === 'taken') {
        return;
      }
      const next = slugFingerprint(parsed.data.slug);
      if (next === lastSavedSlug.current) return;
      if (slugConflictFingerprintRef.current !== null && next === slugConflictFingerprintRef.current) {
        return;
      }
      void (async () => {
        report({ status: 'saving', message: null });
        try {
          await persistSlug(parsed.data.slug);
          report({ status: 'saved', message: 'Booking page address saved.' });
        } catch (err) {
          if (err instanceof SlugConflictError) {
            slugConflictFingerprintRef.current = next;
            setError('slug', { type: 'server', message: err.message });
            report({ status: 'error', message: err.message });
            return;
          }
          report({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to save booking page address',
          });
        }
      })();
    }, 850);
    return () => window.clearTimeout(timer);
  }, [watched, isAdmin, persistSlug, report, getValues, setError, slugHint, venue.slug]);

  // Seed branding fields from the venue (and reset when switching venue).
  useEffect(() => {
    const c = venue.booking_page_config ?? {};
    setBrandPrimary(c.brand_primary ?? '');
    setBrandAccent(c.brand_accent ?? '');
    setFontPreset(c.font_preset ?? 'default');
    setAbout(c.about ?? '');
    setAnnouncement(c.announcement ?? '');
    setInstagram(c.social_links?.instagram ?? '');
    setFacebook(c.social_links?.facebook ?? '');
    setTiktok(c.social_links?.tiktok ?? '');
    setXUrl(c.social_links?.x ?? '');
    setGallery(c.gallery ?? []);
    setServicePhotos(c.service_photos ?? {});
    setShowServicesTab(c.show_services_tab === true);
    setShowTeamTab(c.show_team_tab === true);
    setShowAboutTab(c.show_about_tab === true);
    setTeamProfiles(c.team_profiles ?? {});
    setLogoCrop(resolveBookingPageLogoCrop(c.logo_crop));
    setCoverCrop(resolveBookingPageCoverCrop(c.cover_crop));
    setCoverFullWidth(c.cover_full_width === true);
    lastSavedConfigRef.current = JSON.stringify(c ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only when the venue changes
  }, [venue.id]);

  useEffect(() => {
    const c = venue.booking_page_config ?? {};
    setShowServicesTab(c.show_services_tab === true);
    setShowTeamTab(c.show_team_tab === true);
    setShowAboutTab(c.show_about_tab === true);
    setCoverFullWidth(c.cover_full_width === true);
  }, [venue.booking_page_config]);

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
            is_active?: boolean;
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
              is_active: s.is_active,
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

  // Debounced auto-save for branding & content.
  useEffect(() => {
    if (!isAdmin) return;
    if (lastSavedConfigRef.current === null) return;
    const config = buildConfigFromState();
    const serialized = JSON.stringify(config);
    if (serialized === lastSavedConfigRef.current) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        report({ status: 'saving', message: null });
        try {
          const res = await fetch('/api/venue', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking_page_config: config }),
          });
          const body = await readResponseJson<{ error?: string; booking_page_config?: BookingPageConfig | null }>(
            res,
          );
          if (!res.ok) throw new Error(body.error ?? 'Failed to save');
          const savedConfig = body.booking_page_config ?? config;
          lastSavedConfigRef.current = JSON.stringify(savedConfig);
          onUpdate({ booking_page_config: savedConfig });
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
  }, [buildConfigFromState, isAdmin, onUpdate, report]);

  const onLogoChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const input = e.target;
      if (!file || !isAdmin) return;
      await preserveSettingsScrollDuring(async () => {
        setLogoSaving(true);
        setLogoError(null);
        report({ status: 'saving', message: null });
        const form = new FormData();
        form.append('file', file);
        try {
          const res = await fetch('/api/venue/logo', { method: 'POST', body: form });
          const uploadJson = await readResponseJson<{ error?: string; url?: string }>(res);
          if (!res.ok) {
            throw new Error(uploadJson.error ?? 'Upload failed');
          }
          if (!uploadJson.url) {
            throw new Error('Upload failed');
          }
          const patchRes = await fetch('/api/venue', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logo_url: uploadJson.url }),
          });
          const patchJson = await readResponseJson<{ error?: string }>(patchRes);
          if (!patchRes.ok) {
            throw new Error(patchJson.error ?? 'Failed to update logo URL');
          }
          setLogoCrop({ ...DEFAULT_BOOKING_PAGE_LOGO_CROP });
          onUpdate({ logo_url: uploadJson.url });
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
    [isAdmin, onUpdate, report],
  );

  const onLogoRemove = useCallback(async () => {
    if (!isAdmin || logoRemoving) return;
    setLogoRemoving(true);
    setLogoError(null);
    report({ status: 'saving', message: null });
    try {
      const res = await fetch('/api/venue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: null }),
      });
      const body = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? 'Failed to remove logo');
      setLogoCrop({ ...DEFAULT_BOOKING_PAGE_LOGO_CROP });
      onUpdate({ logo_url: null });
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
  }, [isAdmin, logoRemoving, onUpdate, report]);

  const onCoverChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const input = e.target;
      if (!file || !isAdmin) return;
      await preserveSettingsScrollDuring(async () => {
        setCoverSaving(true);
        setCoverError(null);
        report({ status: 'saving', message: null });
        const form = new FormData();
        form.append('file', file);
        try {
          const res = await fetch('/api/venue/cover', { method: 'POST', body: form });
          const uploadJson = await readResponseJson<{ error?: string; url?: string }>(res);
          if (!res.ok) {
            throw new Error(uploadJson.error ?? 'Upload failed');
          }
          if (!uploadJson.url) {
            throw new Error('Upload failed');
          }
          const patchRes = await fetch('/api/venue', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cover_photo_url: uploadJson.url }),
          });
          const patchJson = await readResponseJson<{ error?: string }>(patchRes);
          if (!patchRes.ok) {
            throw new Error(patchJson.error ?? 'Failed to update cover URL');
          }
          setCoverCrop({ ...DEFAULT_BOOKING_PAGE_COVER_CROP });
          onUpdate({ cover_photo_url: uploadJson.url });
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
    [isAdmin, onUpdate, report],
  );

  const onCoverRemove = useCallback(async () => {
    if (!isAdmin || coverRemoving) return;
    setCoverRemoving(true);
    setCoverError(null);
    report({ status: 'saving', message: null });
    try {
      const res = await fetch('/api/venue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_photo_url: null }),
      });
      const body = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? 'Failed to remove cover photo');
      setCoverCrop({ ...DEFAULT_BOOKING_PAGE_COVER_CROP });
      onUpdate({ cover_photo_url: null });
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
  }, [isAdmin, coverRemoving, onUpdate, report]);

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
      await preserveSettingsScrollDuring(async () => {
        setGalleryUploading(true);
        setGalleryError(null);
        const form = new FormData();
        form.append('file', file);
        try {
          const res = await fetch('/api/venue/gallery', { method: 'POST', body: form });
          const json = await readResponseJson<{ error?: string; url?: string }>(res);
          if (!res.ok || !json.url) throw new Error(json.error ?? 'Upload failed');
          setGallery((g) => [...g, json.url!]);
        } catch (err) {
          setGalleryError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
          setGalleryUploading(false);
          input.value = '';
          blurFileInput(input);
        }
      });
    },
    [isAdmin, gallery.length],
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
      await preserveSettingsScrollDuring(async () => {
        setServicePhotoBusyId(serviceId);
        setServicePhotoError(null);
        const form = new FormData();
        form.append('file', file);
        try {
          const res = await fetch('/api/venue/service-photo', { method: 'POST', body: form });
          const json = await readResponseJson<{ error?: string; url?: string }>(res);
          if (!res.ok || !json.url) throw new Error(json.error ?? 'Upload failed');
          let nextPhotos: Record<string, string> = {};
          setServicePhotos((prev) => {
            nextPhotos = { ...prev, [serviceId]: json.url! };
            return nextPhotos;
          });
          await persistBookingPageConfig(nextPhotos);
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
    [isAdmin, persistBookingPageConfig, report],
  );

  const removeServicePhoto = useCallback(
    (serviceId: string) => {
      const removedUrl = servicePhotos[serviceId]?.trim() ?? '';
      const next = { ...servicePhotos };
      delete next[serviceId];
      setServicePhotos(next);
      setServicePhotoError(null);
      void (async () => {
        report({ status: 'saving', message: null });
        try {
          await persistBookingPageConfig(next);
          if (removedUrl) {
            const res = await fetch('/api/venue/service-photo', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: removedUrl }),
            });
            const body = await readResponseJson<{ error?: string }>(res);
            if (!res.ok) {
              console.warn('Service photo storage delete failed:', body.error ?? res.status);
            }
          }
          report({ status: 'saved', message: 'Service photo removed.' });
        } catch (err) {
          setServicePhotos(servicePhotos);
          const message = err instanceof Error ? err.message : 'Failed to remove photo';
          setServicePhotoError(message);
          report({ status: 'error', message });
        }
      })();
    },
    [persistBookingPageConfig, report, servicePhotos],
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

  const onTeamPhotoChange = useCallback(
    async (memberId: string, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const input = e.target;
      if (!file || !isAdmin) return;
      await preserveSettingsScrollDuring(async () => {
        setTeamPhotoBusyId(memberId);
        const form = new FormData();
        form.append('file', file);
        try {
          const res = await fetch('/api/venue/team-photo', { method: 'POST', body: form });
          const json = await readResponseJson<{ error?: string; url?: string }>(res);
          if (!res.ok || !json.url) throw new Error(json.error ?? 'Upload failed');
          updateTeamProfile(memberId, { photo: json.url });
        } catch {
          /* debounced branding save surfaces errors */
        } finally {
          setTeamPhotoBusyId(null);
          input.value = '';
          blurFileInput(input);
        }
      });
    },
    [isAdmin, updateTeamProfile],
  );

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

        {previewSlug ? (
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
                  <BookingPageLivePreview
                    venue={venue}
                    bookingPageConfig={draftBookingPageConfig}
                    previewSlug={previewSlug}
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
        >
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <label htmlFor="booking-page-slug" className={BOOKING_PAGE_FIELD_HEADING_MB1_CLASS}>
            Booking page address
          </label>
          <div className="flex max-w-md items-center gap-0 rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
            <span className="shrink-0 border-r border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
              /book/
            </span>
            <input
              id="booking-page-slug"
              {...register('slug')}
              disabled={!isAdmin}
              className={`min-w-0 flex-1 rounded-r-xl border-0 bg-transparent px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:bg-slate-50${errors.slug ? ' text-red-900' : ''}`}
              placeholder="my-venue"
              aria-invalid={errors.slug ? true : undefined}
            />
          </div>
          {errors.slug && <p className="mt-1 text-sm text-red-600">{errors.slug.message}</p>}
          {!errors.slug && isAdmin && slugHint === 'checking' && (
            <p className="mt-1 text-xs text-slate-500">Checking whether this address is available…</p>
          )}
          {!errors.slug && isAdmin && slugHint === 'current' && (
            <p className="mt-1 text-xs text-emerald-700">This is your current booking page address.</p>
          )}
          {!errors.slug && isAdmin && slugHint === 'available' && (
            <p className="mt-1 text-xs text-emerald-700">This address is available.</p>
          )}
          {!errors.slug && isAdmin && slugHint === 'taken' && (
            <p className="mt-1 text-xs text-amber-800">
              This address is already in use. Choose a different one before it can be saved.
            </p>
          )}
        </form>

        <div>
          <span className={BOOKING_PAGE_FIELD_HEADING_MB2_CLASS}>Logo</span>
          <div className="flex flex-wrap items-center gap-3">
            {venue.logo_url ? (
              isAdmin ? (
                <BookingPageDraggableLogo
                  logoUrl={venue.logo_url}
                  crop={logoCrop}
                  disabled={logoSaving || logoRemoving}
                  onCropChange={setLogoCrop}
                />
              ) : (
                <BookingPageLogo logoUrl={venue.logo_url} alt="Logo" crop={logoCrop} size="md" />
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
                  {venue.logo_url ? 'Change logo' : 'Upload logo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onLogoChange}
                    disabled={logoSaving || logoRemoving}
                    className={SETTINGS_HIDDEN_FILE_INPUT_CLASS}
                    tabIndex={-1}
                  />
                </label>
                {venue.logo_url && (
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
                {venue.logo_url
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
            {venue.cover_photo_url ? (
              isAdmin ? (
                <BookingPageDraggableCover
                  coverUrl={venue.cover_photo_url}
                  crop={coverCrop}
                  disabled={coverSaving || coverRemoving}
                  onCropChange={setCoverCrop}
                />
              ) : (
                <div className={BOOKING_PAGE_COVER_SETTINGS_FRAME_CLASS}>
                  <BookingPageCoverPhoto
                    coverUrl={venue.cover_photo_url}
                    alt="Cover"
                    crop={coverCrop}
                    className="h-full w-full"
                  />
                </div>
              )
            ) : (
              <div className={BOOKING_PAGE_COVER_SETTINGS_PLACEHOLDER_FRAME_CLASS}>No cover photo</div>
            )}
            {isAdmin && (
              <>
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 ${coverSaving || coverRemoving ? 'pointer-events-none opacity-50' : ''}`}
                >
                  {venue.cover_photo_url ? 'Change photo' : 'Upload photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onCoverChange}
                    disabled={coverSaving || coverRemoving}
                    className={SETTINGS_HIDDEN_FILE_INPUT_CLASS}
                    tabIndex={-1}
                  />
                </label>
                {venue.cover_photo_url && (
                  <>
                    <button
                      type="button"
                      onClick={onCoverRemove}
                      disabled={coverSaving || coverRemoving}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {coverRemoving ? 'Removing…' : 'Remove photo'}
                    </button>
                    <BookingPageImageFramingControls
                      controlId="cover"
                      crop={coverCrop}
                      disabled={coverSaving || coverRemoving}
                      onChange={setCoverCrop}
                    />
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
                {venue.cover_photo_url
                  ? coverFullWidth
                    ? 'Drag to reposition. Shown as a full-width banner at the top of your booking page (fixed height, crops to fit).'
                    : 'Drag to reposition. Shown above your venue name at a fixed content width on all screen sizes (fixed height, crops to fit).'
                  : coverFullWidth
                    ? 'Upload a photo to show as a full-width banner at the top of your booking page (fixed height).'
                    : 'Upload a photo to show above your venue name at a fixed content width (fixed height).'}
              </p>
            </div>
          )}
        </div>

          {isAdmin && (
            <div>
              <span className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>Quick palettes</span>
              <div className="flex flex-wrap gap-2">
                {BOOKING_THEME_PRESETS.map((preset) => {
                  const active =
                    normalizeHexColor(brandPrimary) === preset.primary &&
                    normalizeHexColor(brandAccent) === preset.accent;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => {
                        setBrandPrimary(preset.primary);
                        setBrandAccent(preset.accent);
                      }}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? 'border-brand-300 bg-brand-50 text-brand-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <span className="flex -space-x-1">
                        <span className="h-4 w-4 rounded-full ring-1 ring-white" style={{ backgroundColor: preset.primary }} />
                        <span className="h-4 w-4 rounded-full ring-1 ring-white" style={{ backgroundColor: preset.accent }} />
                      </span>
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
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
            </div>

            <div>
              <label className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>
                Accent colour <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Accent colour"
                  disabled={!isAdmin}
                  value={normalizeHexColor(brandAccent) ?? '#00c2c7'}
                  onChange={(e) => setBrandAccent(e.target.value)}
                  className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 disabled:opacity-50"
                />
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={brandAccent}
                  onChange={(e) => setBrandAccent(e.target.value)}
                  placeholder="#00C2C7"
                  className={inputClass}
                />
                {brandAccent.trim() && isAdmin && (
                  <button
                    type="button"
                    onClick={() => setBrandAccent('')}
                    className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
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
              {serviceList.length > 0 ? (
              <div>
              <span className={BOOKING_PAGE_FIELD_HEADING_MB15_CLASS}>Service photos</span>
              <p className="mb-2 text-xs text-slate-500">
                Add a photo to each service. Shown on the Services tab when that tab is enabled.
              </p>
              {servicePhotoError ? (
                <p className="mb-2 text-sm text-red-600" role="alert">
                  {servicePhotoError}
                </p>
              ) : null}
              <div className="space-y-2">
                {serviceList.map((svc) => {
                  const url = servicePhotos[svc.id];
                  const busy = servicePhotoBusyId === svc.id;
                  return (
                    <div key={svc.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
                      <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                        {url ? (
                          <img src={url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-slate-300">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M18 14.25v4.5m-9-12.75h.008v.008H9V6Z" />
                            </svg>
                          </div>
                        )}
                      </div>
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
                Add a photo, short bio, and specialties for each team member.
              </p>
              <div className="space-y-3">
                {teamList.map((m) => {
                  const profile = teamProfiles[m.id] ?? {};
                  const busy = teamPhotoBusyId === m.id;
                  return (
                    <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-start gap-3">
                        <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                          {profile.photo ? (
                            <img src={profile.photo} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-400">
                              {m.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
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
                                onClick={() => updateTeamProfile(m.id, { photo: null })}
                                className="text-xs font-medium text-red-600 hover:text-red-700"
                              >
                                Remove photo
                              </button>
                            )}
                          </div>
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
