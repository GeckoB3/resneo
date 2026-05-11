'use client';

import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VenueSettings } from '../types';
import { useNumericField } from '@/hooks/useNumericField';
import { PhoneWithCountryField } from '@/components/phone/PhoneWithCountryField';
import { normalizeToE164 } from '@/lib/phone/e164';
import { isValidWebsiteUrlInput } from '@/lib/urls/website-url';
import { buildAddress, parseAddress } from '@/lib/venue/address-format';
import { isAppointmentsProductVenue } from '@/lib/booking/unified-scheduling';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { useSettingsSave } from '../SettingsSaveContext';

const profileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
  address_name: z.string().max(200).optional(),
  address_street: z.string().max(200).optional(),
  address_town: z.string().max(100).optional(),
  address_postcode: z.string().max(20).optional(),
  phone: z
    .string()
    .max(24)
    .optional()
    .refine((v) => !v?.trim() || normalizeToE164(v.trim(), 'GB') !== null, {
      message: 'Enter a valid phone number',
    }),
  email: z.string().email().optional().or(z.literal('')),
  website_url: z
    .string()
    .max(2000)
    .optional()
    .refine((v) => isValidWebsiteUrlInput(v ?? ''), {
      message: 'Enter a valid web address (e.g. example.com or https://example.com)',
    }),
  cuisine_type: z.string().max(100).optional(),
  price_band: z.string().max(50).optional(),
  no_show_grace_minutes: z.number().int().min(10).max(60).optional(),
  kitchen_email: z.string().email().optional().or(z.literal('')),
  timezone: z.string().max(50).optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

interface VenueProfileSectionProps {
  venue: VenueSettings;
  onUpdate: (patch: Partial<VenueSettings>) => void;
  isAdmin: boolean;
  bookingModel?: string;
  /** When set, overrides tier-derived detection (keeps profile in sync with settings shell). */
  isAppointmentsProduct?: boolean;
}

function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'venue';
}

function buildRequestBody(data: ProfileForm) {
  const combinedAddress = buildAddress({
    name: data.address_name ?? '',
    street: data.address_street ?? '',
    town: data.address_town ?? '',
    postcode: data.address_postcode ?? '',
  });
  return {
    name: data.name,
    slug: data.slug,
    address: combinedAddress || undefined,
    phone: data.phone?.trim() ? normalizeToE164(data.phone.trim(), 'GB') ?? undefined : undefined,
    email: data.email || undefined,
    website_url: data.website_url?.trim() ?? '',
    cuisine_type: data.cuisine_type || undefined,
    price_band: data.price_band || undefined,
    no_show_grace_minutes: data.no_show_grace_minutes ?? 15,
    kitchen_email: data.kitchen_email || undefined,
    timezone: data.timezone || 'Europe/London',
  };
}

function payloadFingerprint(data: ProfileForm): string {
  return JSON.stringify(buildRequestBody(data));
}

export function VenueProfileSection({
  venue,
  onUpdate,
  isAdmin,
  bookingModel: _bookingModel = 'table_reservation',
  isAppointmentsProduct: isAppointmentsProductProp,
}: VenueProfileSectionProps) {
  const isAppointmentsProduct =
    isAppointmentsProductProp ?? isAppointmentsProductVenue(venue.pricing_tier ?? null);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoRemoving, setLogoRemoving] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const { integerProps } = useNumericField();
  const int = integerProps();
  const { report } = useSettingsSave();
  const lastSavedFingerprint = useRef<string | null>(null);
  const venueIdRef = useRef<string | null>(null);

  const parsedAddr = parseAddress(venue.address);

  const { register, control, formState: { errors }, setValue, watch, getValues, reset } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: venue.name ?? '',
      slug: venue.slug ?? '',
      address_name: parsedAddr.name,
      address_street: parsedAddr.street,
      address_town: parsedAddr.town,
      address_postcode: parsedAddr.postcode,
      phone: venue.phone ?? '',
      email: venue.email ?? '',
      website_url: venue.website_url ?? '',
      cuisine_type: venue.cuisine_type ?? '',
      price_band: venue.price_band ?? '',
      no_show_grace_minutes: venue.no_show_grace_minutes ?? 15,
      kitchen_email: venue.kitchen_email ?? '',
      timezone: venue.timezone ?? 'Europe/London',
    },
  });

  const nameValue = watch('name');
  const watched = useWatch({ control });

  const handleNameBlur = useCallback(() => {
    const slug = slugFromName(nameValue);
    if (slug) setValue('slug', slug);
  }, [nameValue, setValue]);

  const persistProfile = useCallback(
    async (data: ProfileForm) => {
      const res = await fetch('/api/venue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(data)),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'Failed to save');
      }
      const updated = (await res.json()) as {
        name: string;
        slug: string;
        address: string | null;
        phone: string | null;
        email: string | null;
        reply_to_email?: string | null;
        website_url: string | null;
        cuisine_type: string | null;
        price_band: string | null;
        no_show_grace_minutes: number;
        kitchen_email: string | null;
        timezone: string;
      };
      setValue('website_url', updated.website_url ?? '');
      setValue('name', updated.name);
      setValue('slug', updated.slug);
      setValue('email', updated.email ?? '');
      setValue('phone', updated.phone ?? '');
      setValue('cuisine_type', updated.cuisine_type ?? '');
      setValue('price_band', updated.price_band ?? '');
      setValue('no_show_grace_minutes', updated.no_show_grace_minutes ?? 15);
      setValue('kitchen_email', updated.kitchen_email ?? '');
      setValue('timezone', updated.timezone ?? data.timezone);
      const addr = parseAddress(updated.address);
      setValue('address_name', addr.name);
      setValue('address_street', addr.street);
      setValue('address_town', addr.town);
      setValue('address_postcode', addr.postcode);
      onUpdate({
        name: updated.name,
        slug: updated.slug,
        address: updated.address ?? null,
        phone: updated.phone ?? null,
        email: updated.email ?? null,
        reply_to_email: updated.reply_to_email ?? updated.email ?? null,
        website_url: updated.website_url ?? null,
        cuisine_type: updated.cuisine_type ?? null,
        price_band: updated.price_band ?? null,
        no_show_grace_minutes: updated.no_show_grace_minutes ?? 15,
        kitchen_email: updated.kitchen_email ?? null,
        timezone: updated.timezone ?? venue.timezone,
      });
      const synced = profileSchema.safeParse(getValues());
      if (synced.success) {
        lastSavedFingerprint.current = payloadFingerprint(synced.data);
      }
    },
    [onUpdate, setValue, venue.timezone, getValues],
  );

  useEffect(() => {
    if (venueIdRef.current === null) {
      venueIdRef.current = venue.id;
      return;
    }
    if (venueIdRef.current === venue.id) return;
    venueIdRef.current = venue.id;
    const pa = parseAddress(venue.address);
    reset({
      name: venue.name ?? '',
      slug: venue.slug ?? '',
      address_name: pa.name,
      address_street: pa.street,
      address_town: pa.town,
      address_postcode: pa.postcode,
      phone: venue.phone ?? '',
      email: venue.email ?? '',
      website_url: venue.website_url ?? '',
      cuisine_type: venue.cuisine_type ?? '',
      price_band: venue.price_band ?? '',
      no_show_grace_minutes: venue.no_show_grace_minutes ?? 15,
      kitchen_email: venue.kitchen_email ?? '',
      timezone: venue.timezone ?? 'Europe/London',
    });
    const parsed = profileSchema.safeParse(getValues());
    if (parsed.success) {
      lastSavedFingerprint.current = payloadFingerprint(parsed.data);
    }
  }, [venue.id, venue, reset, getValues]);

  useLayoutEffect(() => {
    const parsed = profileSchema.safeParse(getValues());
    if (parsed.success && lastSavedFingerprint.current === null) {
      lastSavedFingerprint.current = payloadFingerprint(parsed.data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time fingerprint from initial defaults
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = window.setTimeout(() => {
      const parsed = profileSchema.safeParse(getValues());
      if (!parsed.success) return;
      const next = payloadFingerprint(parsed.data);
      if (next === lastSavedFingerprint.current) return;
      void (async () => {
        report({ status: 'saving', message: null });
        try {
          await persistProfile(parsed.data);
          report({ status: 'saved', message: 'Venue profile saved.' });
        } catch (err) {
          report({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to save profile',
          });
        }
      })();
    }, 850);
    return () => window.clearTimeout(timer);
  }, [watched, isAdmin, persistProfile, report, getValues]);

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
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? 'Upload failed');
        }
        const { url } = await res.json();
        const patchRes = await fetch('/api/venue', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logo_url: url }),
        });
        if (!patchRes.ok) throw new Error('Failed to update logo URL');
        onUpdate({ logo_url: url });
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
      if (!res.ok) throw new Error('Failed to remove logo');
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
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? 'Upload failed');
        }
        const { url } = await res.json();
        const patchRes = await fetch('/api/venue', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cover_photo_url: url }),
        });
        if (!patchRes.ok) throw new Error('Failed to update cover URL');
        onUpdate({ cover_photo_url: url });
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
      if (!res.ok) throw new Error('Failed to remove cover photo');
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
        eyebrow="Venue"
        title={isAppointmentsProduct ? 'Business profile' : 'Venue profile'}
        description={
          isAdmin
            ? 'Edits to these fields save automatically after you pause typing.'
            : 'Only an administrator can change venue-wide details.'
        }
      />
      <SectionCard.Body>
        <div className="mb-6">
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
                    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
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
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                    </svg>
                    {venue.logo_url ? 'Change logo' : 'Upload logo'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onLogoChange} disabled={logoSaving || logoRemoving} className="sr-only" />
                  </label>
                  {venue.logo_url && (
                    <button
                      type="button"
                      onClick={onLogoRemove}
                      disabled={logoSaving || logoRemoving}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                      {logoRemoving ? 'Removing…' : 'Remove logo'}
                    </button>
                  )}
                </div>
                {logoSaving && <p className="text-sm text-amber-700">Uploading…</p>}
                {logoError && <p className="text-sm text-red-600">{logoError}</p>}
                <p className="text-xs text-slate-500">Logo is shown on your booking page and in emails.</p>
              </div>
            )}
          </div>
        </div>

        <div className="mb-6">
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
                  <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                    />
                  </svg>
                  {venue.cover_photo_url ? 'Change photo' : 'Upload photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onCoverChange} disabled={coverSaving || coverRemoving} className="sr-only" />
                </label>
                {venue.cover_photo_url && (
                  <button
                    type="button"
                    onClick={onCoverRemove}
                    disabled={coverSaving || coverRemoving}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
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
          className="space-y-4"
        >
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
              Name
            </label>
            <input id="name" {...register('name')} onBlur={handleNameBlur} disabled={!isAdmin} className={inputClass} />
            {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor="slug" className="mb-1 block text-sm font-medium text-slate-700">
              Slug (URL)
            </label>
            <input id="slug" {...register('slug')} disabled={!isAdmin} className={inputClass} placeholder="my-venue" />
            <p className="mt-1 text-xs text-slate-500">Used in booking URL: /book/[slug]</p>
            {errors.slug && <p className="mt-1 text-sm text-red-600">{errors.slug.message}</p>}
          </div>
          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-slate-700">Address</legend>
            <div className="space-y-3">
              <div>
                <label htmlFor="address_name" className="mb-0.5 block text-xs text-slate-500">
                  Building / venue name
                </label>
                <input id="address_name" {...register('address_name')} disabled={!isAdmin} placeholder="e.g. The Old Mill" className={inputClass} />
              </div>
              <div>
                <label htmlFor="address_street" className="mb-0.5 block text-xs text-slate-500">
                  Street
                </label>
                <input id="address_street" {...register('address_street')} disabled={!isAdmin} placeholder="e.g. 12 Main Street" className={inputClass} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="address_town" className="mb-0.5 block text-xs text-slate-500">
                    Town / city
                  </label>
                  <input id="address_town" {...register('address_town')} disabled={!isAdmin} placeholder="e.g. Belfast" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="address_postcode" className="mb-0.5 block text-xs text-slate-500">
                    Postcode
                  </label>
                  <input id="address_postcode" {...register('address_postcode')} disabled={!isAdmin} placeholder="e.g. BT1 1AA" className={inputClass} />
                </div>
              </div>
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700">
                Phone
              </label>
              <Controller
                name="phone"
                control={control}
                render={({ field }) => (
                  <PhoneWithCountryField
                    id="phone"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    disabled={!isAdmin}
                    inputClassName={`${inputClass} min-w-0`}
                  />
                )}
              />
              {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>}
            </div>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input id="email" type="email" {...register('email')} disabled={!isAdmin} className={inputClass} />
              <p className="mt-1 text-xs text-slate-500">Guest replies to booking confirmations and reminders are sent to this address.</p>
            </div>
          </div>
          <div>
            <label htmlFor="website_url" className="mb-1 block text-sm font-medium text-slate-700">
              Business website
            </label>
            <input
              id="website_url"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="example.com or https://example.com"
              {...register('website_url')}
              disabled={!isAdmin}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-500">
              Shown on your public booking page when set. You can enter a domain without https://; we save a secure link.
            </p>
            {errors.website_url && <p className="mt-1 text-sm text-red-600">{errors.website_url.message}</p>}
          </div>
          {!isAppointmentsProduct && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cuisine_type" className="mb-1 block text-sm font-medium text-slate-700">
                  Cuisine type
                </label>
                <input id="cuisine_type" {...register('cuisine_type')} disabled={!isAdmin} placeholder="e.g. Style or category" className={inputClass} />
              </div>
              <div>
                <label htmlFor="price_band" className="mb-1 block text-sm font-medium text-slate-700">
                  Price band
                </label>
                <select id="price_band" {...register('price_band')} disabled={!isAdmin} className={inputClass}>
                  <option value="">Not set</option>
                  <option value="£">£ (Budget)</option>
                  <option value="££">££ (Mid-range)</option>
                  <option value="£££">£££ (Fine dining)</option>
                </select>
              </div>
            </div>
          )}
          <div className={`grid grid-cols-1 gap-4 ${isAppointmentsProduct ? '' : 'sm:grid-cols-2'}`}>
            <div>
              <label htmlFor="no_show_grace_minutes" className="mb-1 block text-sm font-medium text-slate-700">
                No-show grace period (minutes)
              </label>
              <input
                id="no_show_grace_minutes"
                {...int.inputProps}
                min={10}
                max={60}
                {...register('no_show_grace_minutes', int.registerOptions)}
                disabled={!isAdmin}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-slate-500">
                {isAppointmentsProduct
                  ? 'How long after appointment time before staff can mark no-show (10–60 min)'
                  : 'How long after reservation time before staff can mark no-show (10–60 min)'}
              </p>
              {errors.no_show_grace_minutes && <p className="mt-1 text-sm text-red-600">{errors.no_show_grace_minutes.message}</p>}
            </div>
            {!isAppointmentsProduct && (
              <div>
                <label htmlFor="kitchen_email" className="mb-1 block text-sm font-medium text-slate-700">
                  Kitchen email
                </label>
                <input id="kitchen_email" type="email" {...register('kitchen_email')} disabled={!isAdmin} placeholder="kitchen@venue.com" className={inputClass} />
                <p className="mt-1 text-xs text-slate-500">Receives the daily dietary digest email</p>
              </div>
            )}
          </div>
          <div>
            <label htmlFor="timezone" className="mb-1 block text-sm font-medium text-slate-700">
              Timezone
            </label>
            <input id="timezone" {...register('timezone')} disabled={!isAdmin} className={inputClass} />
          </div>
        </form>
      </SectionCard.Body>
    </SectionCard>
  );
}
