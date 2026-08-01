'use client';

import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readResponseJson } from '@/lib/http/read-response-json';
import { BOOKING_PAGE_FIELD_HEADING_MB1_CLASS } from './booking-page-settings-typography';
import type { VenueSettings } from '../types';
import type { SaveReporter } from '@/components/booking-page-editor/types';

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

function slugFingerprint(slug: string): string {
  return slug.trim().toLowerCase();
}

interface VenueSlugFieldProps {
  venue: VenueSettings;
  onUpdate: (patch: Partial<VenueSettings>) => void;
  isAdmin: boolean;
  reporter: SaveReporter;
}

/**
 * The single-venue "Booking page address" (slug) control: live availability check,
 * conflict handling, and debounced auto-save to `/api/venue`. Venue-only — mounted as
 * the shared editor's `addressSlot` for venues (collectives use the address chooser).
 */
export function VenueSlugField({ venue, onUpdate, isAdmin, reporter }: VenueSlugFieldProps) {
  const { report } = reporter;
  type SlugHint = 'idle' | 'checking' | 'current' | 'available' | 'taken';
  const [slugHint, setSlugHint] = useState<SlugHint>('idle');
  const lastSavedSlug = useRef<string | null>(null);
  const slugConflictFingerprintRef = useRef<string | null>(null);
  const venueIdRef = useRef<string | null>(null);

  const {
    register,
    control,
    formState: { errors, isDirty },
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
      if (!parsed.success) {
        // Surface why nothing is saving. The format check above only resets the
        // hint to 'idle', and the resolver never runs on its own (autosave, not
        // submit), so without this an address with spaces or capitals silently
        // never saves and the field says nothing at all.
        // Only nag once the user has edited: a venue arriving with no slug yet
        // should not be greeted with a red "required" message on load.
        if (isDirty) {
          const message =
            parsed.error.issues.find((i) => i.path[0] === 'slug')?.message ??
            'Booking page address is not valid';
          setError('slug', { type: 'validation', message });
          report({ status: 'error', message: `Not saved. ${message}` });
        }
        return;
      }
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
  }, [watched, isAdmin, persistSlug, report, getValues, setError, slugHint, venue.slug, isDirty]);

  return (
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
  );
}
