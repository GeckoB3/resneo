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
import { readResponseJson } from '@/lib/http/read-response-json';

const profileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
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

function buildRequestBody(data: ProfileForm) {
  const combinedAddress = buildAddress({
    name: data.address_name ?? '',
    street: data.address_street ?? '',
    town: data.address_town ?? '',
    postcode: data.address_postcode ?? '',
  });
  return {
    name: data.name,
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
  const { integerProps } = useNumericField();
  const int = integerProps();
  const { report } = useSettingsSave();
  const lastSavedFingerprint = useRef<string | null>(null);
  const venueIdRef = useRef<string | null>(null);
  const saveInFlight = useRef(false);

  const parsedAddr = parseAddress(venue.address);

  const {
    register,
    control,
    formState: { errors },
    watch,
    getValues,
    reset,
    setError,
    clearErrors,
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: venue.name ?? '',
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

  const watched = useWatch({ control });

  const persistProfile = useCallback(
    async (data: ProfileForm) => {
      const res = await fetch('/api/venue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(data)),
      });
      const body = await readResponseJson<{
        error?: string;
        name?: string;
        slug?: string;
        address?: string | null;
        phone?: string | null;
        email?: string | null;
        reply_to_email?: string | null;
        website_url?: string | null;
        cuisine_type?: string | null;
        price_band?: string | null;
        no_show_grace_minutes?: number;
        kitchen_email?: string | null;
        timezone?: string;
      }>(res);
      if (!res.ok) {
        const apiError = body.error ?? 'Failed to save';
        throw new Error(apiError);
      }
      if (typeof body.name !== 'string') {
        console.error('[VenueProfileSection] PATCH /api/venue: unexpected JSON shape', body);
        throw new Error('Unexpected response from server. Please refresh and try again.');
      }
      const { name: savedName, ...savedFields } = body;
      // IMPORTANT: never write the server response back into the form fields.
      // The form is the single source of truth for what the user typed. Writing
      // the server's normalized echo back (phone → E.164, website → https URL,
      // address re-formatting) would clobber whatever the user has typed or
      // deleted in the meantime — that's the "reverts / skips characters" bug.
      // We only sync the parent venue state (for display elsewhere) and record
      // a fingerprint of what we just sent so we don't re-save unchanged data.
      onUpdate({
        name: savedName,
        address: savedFields.address ?? null,
        phone: savedFields.phone ?? null,
        email: savedFields.email ?? null,
        reply_to_email: savedFields.reply_to_email ?? savedFields.email ?? null,
        website_url: savedFields.website_url ?? null,
        cuisine_type: savedFields.cuisine_type ?? null,
        price_band: savedFields.price_band ?? null,
        no_show_grace_minutes: savedFields.no_show_grace_minutes ?? 15,
        kitchen_email: savedFields.kitchen_email ?? null,
        timezone: savedFields.timezone ?? venue.timezone,
      });
      // Fingerprint exactly what we sent. An unchanged form will produce the
      // same fingerprint next tick (so we don't re-save), while any edit the
      // user made during this request yields a different fingerprint and gets
      // saved on the next debounce — nothing is lost or overwritten.
      lastSavedFingerprint.current = payloadFingerprint(data);
    },
    [onUpdate, venue.timezone],
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

  // Serialized autosave. Only one PATCH is ever in flight at a time, so out-of-
  // order responses can't persist stale data. When a save finishes we re-check
  // the live form against what we just sent; if the user typed more during the
  // request, we save again — so the final typed/deleted state always wins.
  const trySave = useCallback(async () => {
    if (!isAdmin) return;
    if (saveInFlight.current) return; // in-flight save will re-check on completion
    const parsed = profileSchema.safeParse(getValues());
    if (!parsed.success) return;
    if (payloadFingerprint(parsed.data) === lastSavedFingerprint.current) return;
    saveInFlight.current = true;
    report({ status: 'saving', message: null });
    let saved = false;
    try {
      await persistProfile(parsed.data);
      saved = true;
      report({ status: 'saved', message: 'Venue profile saved.' });
    } catch (err) {
      report({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to save profile',
      });
    } finally {
      saveInFlight.current = false;
    }
    // Only re-check after a successful save (lastSavedFingerprint advanced).
    // The form may have changed while the request was in flight — save the
    // latest state too. On error we stop so we don't hot-loop a failing request;
    // the next keystroke (or debounce tick) will retry.
    if (!saved) return;
    const after = profileSchema.safeParse(getValues());
    if (after.success && payloadFingerprint(after.data) !== lastSavedFingerprint.current) {
      void trySave();
    }
  }, [isAdmin, getValues, persistProfile, report]);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = window.setTimeout(() => {
      void trySave();
    }, 850);
    return () => window.clearTimeout(timer);
  }, [watched, isAdmin, trySave]);

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
            <input id="name" {...register('name')} disabled={!isAdmin} className={inputClass} />
            {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
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
