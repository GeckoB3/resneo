'use client';

import Link from 'next/link';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookingPageLivePreview } from './BookingPageLivePreview';
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
import { readResponseJson } from '@/lib/http/read-response-json';
import {
  BOOKING_FONT_PRESET_KEYS,
  BOOKING_FONT_PRESET_LABELS,
  BOOKING_GALLERY_MAX,
  BOOKING_THEME_PRESETS,
  normalizeHexColor,
  primaryNeedsDarkText,
  type BookingFontPreset,
  type BookingPageConfig,
} from '@/lib/booking/booking-page-theme';

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
  const [about, setAbout] = useState(cfg0.about ?? '');
  const [announcement, setAnnouncement] = useState(cfg0.announcement ?? '');
  const [instagram, setInstagram] = useState(cfg0.social_links?.instagram ?? '');
  const [facebook, setFacebook] = useState(cfg0.social_links?.facebook ?? '');
  const [tiktok, setTiktok] = useState(cfg0.social_links?.tiktok ?? '');
  const [xUrl, setXUrl] = useState(cfg0.social_links?.x ?? '');
  const [gallery, setGallery] = useState<string[]>(cfg0.gallery ?? []);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const lastSavedConfigRef = useRef<string | null>(null);
  // Live preview of the public booking page.
  const [previewDevice, setPreviewDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [previewToken, setPreviewToken] = useState(0);
  /** Lazy-load preview on first expand; keep mounted when collapsed so re-open is instant. */
  const [previewMounted, setPreviewMounted] = useState(false);
  const bumpPreview = useCallback(() => setPreviewToken((t) => t + 1), []);

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
    return config;
  }, [brandPrimary, brandAccent, fontPreset, about, announcement, instagram, facebook, tiktok, xUrl, gallery]);

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
    lastSavedConfigRef.current = JSON.stringify(c ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only when the venue changes
  }, [venue.id]);

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
          const body = await readResponseJson<{ error?: string }>(res);
          if (!res.ok) throw new Error(body.error ?? 'Failed to save');
          lastSavedConfigRef.current = serialized;
          onUpdate({ booking_page_config: config });
          bumpPreview();
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
  }, [buildConfigFromState, isAdmin, onUpdate, report, bumpPreview]);

  const onLogoChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !isAdmin) return;
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
        onUpdate({ logo_url: uploadJson.url });
        bumpPreview();
        report({ status: 'saved', message: 'Logo updated.' });
      } catch (err) {
        setLogoError(err instanceof Error ? err.message : 'Upload failed');
        report({
          status: 'error',
          message: err instanceof Error ? err.message : 'Upload failed',
        });
      } finally {
        setLogoSaving(false);
        e.target.value = '';
      }
    },
    [isAdmin, onUpdate, report, bumpPreview],
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
      onUpdate({ logo_url: null });
      bumpPreview();
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
  }, [isAdmin, logoRemoving, onUpdate, report, bumpPreview]);

  const onCoverChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !isAdmin) return;
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
        onUpdate({ cover_photo_url: uploadJson.url });
        bumpPreview();
        report({ status: 'saved', message: 'Cover photo updated.' });
      } catch (err) {
        setCoverError(err instanceof Error ? err.message : 'Upload failed');
        report({
          status: 'error',
          message: err instanceof Error ? err.message : 'Upload failed',
        });
      } finally {
        setCoverSaving(false);
        e.target.value = '';
      }
    },
    [isAdmin, onUpdate, report, bumpPreview],
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
      onUpdate({ cover_photo_url: null });
      bumpPreview();
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
  }, [isAdmin, coverRemoving, onUpdate, report, bumpPreview]);

  const onGalleryAdd = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !isAdmin) return;
      if (gallery.length >= BOOKING_GALLERY_MAX) {
        setGalleryError(`You can add up to ${BOOKING_GALLERY_MAX} photos.`);
        e.target.value = '';
        return;
      }
      setGalleryUploading(true);
      setGalleryError(null);
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch('/api/venue/gallery', { method: 'POST', body: form });
        const json = await readResponseJson<{ error?: string; url?: string }>(res);
        if (!res.ok || !json.url) throw new Error(json.error ?? 'Upload failed');
        // Appending updates the config, which the debounced effect saves automatically.
        setGallery((g) => [...g, json.url!]);
      } catch (err) {
        setGalleryError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setGalleryUploading(false);
        e.target.value = '';
      }
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

  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50';

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Guest-facing"
        title="Your booking page"
        description={
          isAdmin
            ? 'Customise how your public booking page looks and where guests find it. Changes save automatically.'
            : 'Only an administrator can change the booking page URL and branding.'
        }
      />
      <SectionCard.Body className="space-y-6">
        {bookUrl && (
          <div className="rounded-xl border border-brand-200/80 bg-brand-50/50 px-4 py-3">
            <p className="text-sm font-medium text-slate-900">Public booking page</p>
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

        <div>
          <span className="mb-2 block text-sm font-medium text-slate-700">Logo</span>
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              {venue.logo_url ? (
                <div className="h-16 w-16 rounded-full bg-white p-1 ring-1 ring-slate-200 shadow-[0_2px_10px_rgba(15,23,42,0.08)]">
                  <img src={venue.logo_url} alt="Logo" className="h-full w-full rounded-full object-cover bg-white" />
                </div>
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 ring-1 ring-slate-200">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                    />
                  </svg>
                </div>
              )}
            </div>
            {isAdmin && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
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
                      className="sr-only"
                    />
                  </label>
                  {venue.logo_url && (
                    <button
                      type="button"
                      onClick={onLogoRemove}
                      disabled={logoSaving || logoRemoving}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {logoRemoving ? 'Removing…' : 'Remove logo'}
                    </button>
                  )}
                </div>
                {logoSaving && <p className="text-sm text-amber-700">Uploading…</p>}
                {logoError && <p className="text-sm text-red-600">{logoError}</p>}
                <p className="text-xs text-slate-500">Shown on your booking page and in guest emails.</p>
              </div>
            )}
          </div>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Cover photo</span>
          {venue.cover_photo_url ? (
            <img src={venue.cover_photo_url} alt="Cover" className="mb-2 h-40 w-full rounded-xl object-cover" />
          ) : (
            <div className="mb-2 flex h-40 w-full items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              No cover photo
            </div>
          )}
          {isAdmin && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 ${coverSaving || coverRemoving ? 'pointer-events-none opacity-50' : ''}`}
                >
                  {venue.cover_photo_url ? 'Change photo' : 'Upload photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onCoverChange}
                    disabled={coverSaving || coverRemoving}
                    className="sr-only"
                  />
                </label>
                {venue.cover_photo_url && (
                  <button
                    type="button"
                    onClick={onCoverRemove}
                    disabled={coverSaving || coverRemoving}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {coverRemoving ? 'Removing…' : 'Remove photo'}
                  </button>
                )}
              </div>
              {coverSaving && <p className="mt-2 text-sm text-amber-700">Uploading…</p>}
              {coverError && <p className="mt-2 text-sm text-red-600">{coverError}</p>}
            </>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <label htmlFor="booking-page-slug" className="mb-1 block text-sm font-medium text-slate-700">
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

        {/* Brand & content (Booking Site Studio) */}
        <div className="space-y-5 border-t border-slate-100 pt-6">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Brand &amp; content</h3>
            <p className="mt-1 text-xs text-slate-500">
              Personalise the colours and wording guests see on your booking page. Changes save automatically.
            </p>
          </div>

          {isAdmin && (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Quick palettes</span>
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
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Brand colour</label>
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
                  This colour is quite light — white button text may be hard to read. A darker shade works best.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
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
            <label htmlFor="bp-font" className="mb-1.5 block text-sm font-medium text-slate-700">
              Font style
            </label>
            <select
              id="bp-font"
              disabled={!isAdmin}
              value={fontPreset}
              onChange={(e) => setFontPreset(e.target.value as BookingFontPreset)}
              className={inputClass}
            >
              {BOOKING_FONT_PRESET_KEYS.map((key) => (
                <option key={key} value={key}>
                  {BOOKING_FONT_PRESET_LABELS[key]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">Sets the headings and text style on your booking page.</p>
          </div>

          <div>
            <label htmlFor="bp-about" className="mb-1.5 block text-sm font-medium text-slate-700">
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
            <label htmlFor="bp-announcement" className="mb-1.5 block text-sm font-medium text-slate-700">
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

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Social links <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              <input type="url" disabled={!isAdmin} value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="Instagram URL" className={inputClass} />
              <input type="url" disabled={!isAdmin} value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="Facebook URL" className={inputClass} />
              <input type="url" disabled={!isAdmin} value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="TikTok URL" className={inputClass} />
              <input type="url" disabled={!isAdmin} value={xUrl} onChange={(e) => setXUrl(e.target.value)} placeholder="X (Twitter) URL" className={inputClass} />
            </div>
          </div>

          {/* Photo gallery */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Photo gallery <span className="font-normal text-slate-400">({gallery.length}/{BOOKING_GALLERY_MAX})</span>
            </span>
            <p className="mb-2 text-xs text-slate-500">
              Showcase your space and work. Photos appear on your booking page — venues with more photos get more bookings.
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
                    className="sr-only"
                  />
                </label>
                {galleryError && <p className="mt-2 text-sm text-red-600">{galleryError}</p>}
              </>
            )}
          </div>
        </div>
      </SectionCard.Body>
    </SectionCard>
  );
}
