'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { compareByVenueServiceOrder } from '@/lib/booking/service-display-order';
import { normalizeToE164 } from '@/lib/phone/e164';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';
import { WaitlistFieldLabel, WaitlistRequiredLegend } from '@/components/booking/WaitlistFormField';

type PreferredWindow = 'all_day' | 'time_range';

interface CatalogService {
  id: string;
  name: string;
  /** Venue-chosen display order (lower first); mirrors the booking flow service picker. */
  sort_order?: number;
}

export interface WaitlistCatalogPractitioner {
  id: string;
  name: string;
  services: CatalogService[];
}

interface AppointmentWaitlistJoinProps {
  venueId: string;
  currency?: string;
  /** Pre-fill from booking flow when the guest reached the waitlist from a specific path. */
  initialServiceId?: string;
  initialDate?: string;
  initialPractitionerId?: string | null;
  /** Reuse catalog from the booking flow when available (avoids a second fetch). */
  catalogStaff?: WaitlistCatalogPractitioner[];
  /** Parent catalog fetch in progress (booking flow). */
  catalogLoading?: boolean;
}

const ANY_PREFERENCE = '';

export function buildServiceOptions(catalogStaff: WaitlistCatalogPractitioner[]): CatalogService[] {
  const byId = new Map<string, CatalogService>();
  for (const practitioner of catalogStaff) {
    for (const service of practitioner.services) {
      if (!byId.has(service.id)) byId.set(service.id, service);
    }
  }
  // Venue-chosen order first (matches the booking flow picker); name breaks ties.
  return [...byId.values()].sort(compareByVenueServiceOrder);
}

export function buildPreferenceOptions(
  catalogStaff: WaitlistCatalogPractitioner[],
  serviceId: string,
): Array<{ id: string; name: string }> {
  if (!serviceId) return [];
  return catalogStaff
    .filter((p) => p.services.some((s) => s.id === serviceId))
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function AppointmentWaitlistJoin({
  venueId,
  currency,
  initialServiceId,
  initialDate,
  initialPractitionerId,
  catalogStaff: catalogStaffProp,
  catalogLoading: catalogLoadingProp,
}: AppointmentWaitlistJoinProps) {
  const [open, setOpen] = useState(false);
  const [internalCatalogStaff, setInternalCatalogStaff] = useState<WaitlistCatalogPractitioner[]>([]);
  const [internalCatalogLoadState, setInternalCatalogLoadState] = useState<
    'idle' | 'loading' | 'loaded' | 'error'
  >('idle');
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const usesParentCatalog = catalogStaffProp !== undefined;
  const catalogStaff = usesParentCatalog ? catalogStaffProp : internalCatalogStaff;
  const catalogLoading = catalogLoadingProp ?? internalCatalogLoadState === 'loading';
  const catalogReady = usesParentCatalog
    ? !catalogLoading
    : internalCatalogLoadState === 'loaded' || internalCatalogLoadState === 'error';

  const [userServiceId, setUserServiceId] = useState<string | null>(null);
  const [userPreferenceId, setUserPreferenceId] = useState<string | null>(null);
  const [date, setDate] = useState(initialDate ?? '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [preferredWindow, setPreferredWindow] = useState<PreferredWindow>('all_day');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const phoneCountry = defaultPhoneCountryForVenueCurrency(currency);
  const fieldIds = {
    service: useId(),
    date: useId(),
    preference: useId(),
    firstName: useId(),
    lastName: useId(),
    phone: useId(),
    email: useId(),
    rangeStart: useId(),
    rangeEnd: useId(),
  };

  const loadCatalog = useCallback(async () => {
    if (usesParentCatalog) return;
    setInternalCatalogLoadState('loading');
    setCatalogError(null);
    try {
      const res = await fetch(`/api/booking/appointment-catalog?venue_id=${encodeURIComponent(venueId)}`);
      const data = (await res.json()) as { practitioners?: WaitlistCatalogPractitioner[]; error?: string };
      if (!res.ok) {
        setCatalogError(data.error ?? 'Could not load services');
        setInternalCatalogStaff([]);
        setInternalCatalogLoadState('error');
        return;
      }
      setInternalCatalogStaff(data.practitioners ?? []);
      setInternalCatalogLoadState('loaded');
    } catch {
      setCatalogError('Could not load services');
      setInternalCatalogStaff([]);
      setInternalCatalogLoadState('error');
    }
  }, [usesParentCatalog, venueId]);

  const serviceOptions = useMemo(() => buildServiceOptions(catalogStaff), [catalogStaff]);
  const serviceId = useMemo(() => {
    if (userServiceId && serviceOptions.some((service) => service.id === userServiceId)) {
      return userServiceId;
    }
    if (!catalogReady || serviceOptions.length === 0) {
      return initialServiceId ?? '';
    }
    if (serviceOptions.length === 1) {
      return serviceOptions[0].id;
    }
    if (initialServiceId && serviceOptions.some((service) => service.id === initialServiceId)) {
      return initialServiceId;
    }
    return userServiceId ?? '';
  }, [userServiceId, catalogReady, serviceOptions, initialServiceId]);
  const preferenceOptions = useMemo(
    () => buildPreferenceOptions(catalogStaff, serviceId),
    [catalogStaff, serviceId],
  );
  const preferenceId = useMemo(() => {
    if (!serviceId) {
      return ANY_PREFERENCE;
    }
    if (userPreferenceId !== null) {
      if (userPreferenceId === ANY_PREFERENCE) {
        return ANY_PREFERENCE;
      }
      if (preferenceOptions.some((option) => option.id === userPreferenceId)) {
        return userPreferenceId;
      }
    }
    if (
      initialPractitionerId &&
      preferenceOptions.some((option) => option.id === initialPractitionerId)
    ) {
      return initialPractitionerId;
    }
    return ANY_PREFERENCE;
  }, [serviceId, userPreferenceId, preferenceOptions, initialPractitionerId]);

  const preferenceSelectDisabled = !serviceId || catalogLoading;

  function handleOpenForm() {
    if (!usesParentCatalog && internalCatalogLoadState === 'error') {
      setInternalCatalogLoadState('idle');
      void loadCatalog();
      setOpen(true);
      return;
    }
    if (!usesParentCatalog && internalCatalogLoadState === 'idle') {
      void loadCatalog();
    }
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const guestPhone = normalizeToE164(phone, phoneCountry);
    const trimmedEmail = email.trim();
    if (!firstName.trim() || !lastName.trim() || !guestPhone || !serviceId || !date || !trimmedEmail) {
      if (!trimmedEmail) {
        setStatus('error');
        setMessage('Please enter your email address.');
      }
      return;
    }
    if (preferredWindow === 'time_range' && (!rangeStart || !rangeEnd)) {
      setStatus('error');
      setMessage('Please choose a start and end time for your preferred window.');
      return;
    }
    setStatus('submitting');
    try {
      const res = await fetch('/api/booking/appointment-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venueId,
          service_id: serviceId,
          desired_date: date,
          preferred_window: preferredWindow,
          ...(preferredWindow === 'time_range'
            ? { desired_time: rangeStart, desired_time_end: rangeEnd }
            : {}),
          ...(preferenceId ? { practitioner_id: preferenceId } : {}),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          guest_phone: guestPhone,
          guest_email: trimmedEmail,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('success');
        setMessage(data.message ?? 'You have been added to the waitlist.');
      } else {
        setStatus('error');
        setMessage(data.error ?? 'Failed to join waitlist');
      }
    } catch {
      setStatus('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  if (status === 'success') {
    return (
      <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
        {message}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleOpenForm}
        className="mt-4 w-full rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100"
      >
        Join waitlist
      </button>
    );
  }

  const serviceSelectDisabled = catalogLoading;
  const servicePlaceholder = catalogLoading
    ? 'Loading services…'
    : serviceOptions.length === 0
      ? 'No services available'
      : 'Choose a service';

  return (
    <form onSubmit={handleSubmit} className="mt-4 w-full space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-left">
      <p className="text-xs font-medium text-slate-600">
        Tell us what you are looking for. We will contact you if matching availability opens.
      </p>
      <WaitlistRequiredLegend />
      {catalogError ? (
        <div className="space-y-2">
          <p className="text-xs text-red-600">{catalogError}</p>
          {!usesParentCatalog ? (
            <button
              type="button"
              onClick={() => {
                setInternalCatalogLoadState('idle');
                void loadCatalog();
              }}
              className="text-xs font-medium text-brand-700 hover:text-brand-800"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      {status === 'error' ? <p className="text-xs text-red-600">{message}</p> : null}

      <div className="min-w-0">
        <WaitlistFieldLabel htmlFor={fieldIds.service} compact>
          Service
        </WaitlistFieldLabel>
        <select
          id={fieldIds.service}
          required
          value={serviceId}
          disabled={serviceSelectDisabled}
          onChange={(e) => {
            setUserServiceId(e.target.value);
            setUserPreferenceId(ANY_PREFERENCE);
          }}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
        >
          <option value="" disabled={serviceOptions.length > 0}>
            {servicePlaceholder}
          </option>
          {serviceOptions.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <WaitlistFieldLabel htmlFor={fieldIds.date} compact>
          Preferred date
        </WaitlistFieldLabel>
        <input
          id={fieldIds.date}
          required
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <WaitlistFieldLabel htmlFor={fieldIds.preference} compact>
          Who would you like to see?
        </WaitlistFieldLabel>
        <select
          id={fieldIds.preference}
          value={preferenceId}
          disabled={preferenceSelectDisabled}
          onChange={(e) => setUserPreferenceId(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
        >
          <option value={ANY_PREFERENCE}>Anyone available</option>
          {preferenceOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          Choose anyone to be notified when any matching opening appears for this service and time.
        </p>
      </div>

      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <div>
          <WaitlistFieldLabel htmlFor={fieldIds.firstName} required compact>
            First name
          </WaitlistFieldLabel>
          <input
            id={fieldIds.firstName}
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <WaitlistFieldLabel htmlFor={fieldIds.lastName} required compact>
            Last name
          </WaitlistFieldLabel>
          <input
            id={fieldIds.lastName}
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <WaitlistFieldLabel htmlFor={fieldIds.phone} required compact>
          Mobile number
        </WaitlistFieldLabel>
        <input
          id={fieldIds.phone}
          required
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <WaitlistFieldLabel htmlFor={fieldIds.email} required compact>
          Email
        </WaitlistFieldLabel>
        <input
          id={fieldIds.email}
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Preferred time
        </legend>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
          <input
            type="radio"
            name="preferred-window"
            checked={preferredWindow === 'all_day'}
            onChange={() => setPreferredWindow('all_day')}
            className="text-brand-600"
          />
          <span className="font-medium text-slate-800">Any time that day</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
          <input
            type="radio"
            name="preferred-window"
            checked={preferredWindow === 'time_range'}
            onChange={() => setPreferredWindow('time_range')}
            className="mt-0.5 text-brand-600"
          />
          <span className="font-medium text-slate-800">Between specific times</span>
        </label>
        {preferredWindow === 'time_range' ? (
          <div className="grid min-w-0 gap-2 pl-1 sm:grid-cols-2">
            <div>
              <WaitlistFieldLabel htmlFor={fieldIds.rangeStart} required compact>
                From
              </WaitlistFieldLabel>
              <input
                id={fieldIds.rangeStart}
                type="time"
                required
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <WaitlistFieldLabel htmlFor={fieldIds.rangeEnd} required compact>
                Until
              </WaitlistFieldLabel>
              <input
                id={fieldIds.rangeEnd}
                type="time"
                required
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>
        ) : null}
      </fieldset>
      <button
        type="submit"
        disabled={
          status === 'submitting' ||
          catalogLoading ||
          serviceOptions.length === 0 ||
          !firstName.trim() ||
          !lastName.trim() ||
          !email.trim() ||
          !normalizeToE164(phone, phoneCountry)
        }
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {status === 'submitting' ? 'Submitting…' : 'Join waitlist'}
      </button>
    </form>
  );
}
