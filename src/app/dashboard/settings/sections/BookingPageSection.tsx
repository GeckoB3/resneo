'use client';

import Link from 'next/link';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VenueSettings } from '../types';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { useSettingsSave } from '../SettingsSaveContext';
import { readResponseJson } from '@/lib/http/read-response-json';

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

  const bookPath = venue.slug?.trim() ? `/book/${venue.slug.trim()}` : null;
  const bookUrl = bookPath ? `${publicBaseUrl.replace(/\/$/, '')}${bookPath}` : null;

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
      </SectionCard.Body>
    </SectionCard>
  );
}
