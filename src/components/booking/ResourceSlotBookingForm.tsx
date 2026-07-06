'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
  DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
} from '@/lib/booking/resource-booking-defaults';
import { resourceDurationCandidatesMinutes } from '@/lib/availability/resource-booking-engine';
import { useToast } from '@/components/ui/Toast';
import { useAppointmentsFeatureFlag } from '@/components/providers/VenueFeatureFlagsProvider';
import { StaffCardHoldToggle } from '@/components/booking/StaffCardHoldToggle';
import {
  resolveStaffEntityCardHold,
  STAFF_CARD_HOLD_CREATED_TOAST,
} from '@/components/booking/staff-card-hold';

interface ResourceInfo {
  id: string;
  name: string;
  resource_type: string | null;
  min_booking_minutes: number;
  max_booking_minutes: number;
  slot_interval_minutes: number;
  price_per_slot_pence: number | null;
  payment_requirement: string;
  deposit_amount_pence: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  venueId: string;
  currency?: string;
  resourceId: string;
  preselectedDate?: string;
  preselectedTime?: string;
}

const INPUT_CLASS =
  'w-full min-h-10 min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500';

function formatCurrency(pence: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(pence / 100);
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function ResourceSlotBookingForm({
  open,
  onClose,
  onCreated,
  venueId,
  currency = 'GBP',
  resourceId,
  preselectedDate,
  preselectedTime,
}: Props) {
  const [resource, setResource] = useState<ResourceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();
  /** Venue's card-hold flag from the dashboard provider (this form renders inside the dashboard). */
  const cardHoldDepositsEnabled = useAppointmentsFeatureFlag('card_hold_deposits');
  /** Card-hold resources only (design doc 7.6): default ON, staff may waive per booking. */
  const [requireCardHold, setRequireCardHold] = useState(true);

  const [date, setDate] = useState(preselectedDate ?? '');
  const [startTime, setStartTime] = useState(preselectedTime ?? '');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  useEffect(() => {
    if (preselectedDate) setDate(preselectedDate);
  }, [preselectedDate]);
  useEffect(() => {
    if (preselectedTime) setStartTime(preselectedTime);
  }, [preselectedTime]);

  useEffect(() => {
    if (!open || !resourceId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/venue/resources/${resourceId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load resource');
        return res.json();
      })
      .then((data) => {
        const r = data.resource;
        setResource({
          id: r.id,
          name: r.name,
          resource_type: r.resource_type,
          min_booking_minutes: r.min_booking_minutes ?? DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
          max_booking_minutes: r.max_booking_minutes ?? 180,
          slot_interval_minutes: r.slot_interval_minutes ?? DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
          price_per_slot_pence: r.price_per_slot_pence ?? null,
          payment_requirement: r.payment_requirement ?? 'none',
          deposit_amount_pence: r.deposit_amount_pence ?? null,
        });
        setDurationMinutes(r.min_booking_minutes ?? DEFAULT_RESOURCE_MIN_BOOKING_MINUTES);
      })
      .catch(() => setError('We couldn’t load this resource. Close and try again.'))
      .finally(() => setLoading(false));
  }, [open, resourceId]);

  useEffect(() => {
    if (!open) {
      setFirstName('');
      setLastName('');
      setGuestEmail('');
      setGuestPhone('');
      setError(null);
      setSubmitting(false);
      setRequireCardHold(true);
    }
  }, [open]);

  /** Card-hold resources (design doc 7.6); fee is per booking. */
  const staffCardHold = useMemo(
    () =>
      resolveStaffEntityCardHold({
        paymentRequirement: resource?.payment_requirement,
        feePerUnitPence: resource?.deposit_amount_pence,
        cardHoldFlagEnabled: cardHoldDepositsEnabled,
      }),
    [resource?.payment_requirement, resource?.deposit_amount_pence, cardHoldDepositsEnabled],
  );

  const durationOptions = useMemo(() => {
    if (!resource) return [];
    return resourceDurationCandidatesMinutes(resource);
  }, [resource]);

  const endTime = useMemo(() => {
    if (!startTime) return '';
    const startMins = timeToMinutes(startTime);
    return minutesToTime(startMins + durationMinutes);
  }, [startTime, durationMinutes]);

  const totalPricePence = useMemo(() => {
    if (!resource?.price_per_slot_pence) return null;
    const slots = Math.ceil(durationMinutes / resource.slot_interval_minutes);
    return Math.round(resource.price_per_slot_pence * slots);
  }, [resource, durationMinutes]);

  const formatDuration = useCallback((mins: number) => {
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!resource || !date || !startTime || !firstName.trim() || !lastName.trim()) return;

      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch('/api/venue/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_date: date,
            booking_time: startTime.length === 5 ? startTime : startTime.slice(0, 5),
            booking_end_time: endTime.length === 5 ? endTime : endTime.slice(0, 5),
            resource_id: resource.id,
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            email: guestEmail.trim() || undefined,
            phone: guestPhone.trim() || undefined,
            // Resources have no capacity model — a slot is the unit booked, so party size is always 1.
            party_size: 1,
            source: 'phone',
            // Card-hold resources (design doc 7.6): send the toggle state explicitly
            // (server defaults to true when omitted; ignored otherwise).
            ...(staffCardHold ? { require_card_hold: requireCardHold } : {}),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Could not create this booking. Check the slot is still free.');
        }
        if (staffCardHold && requireCardHold) {
          addToast(STAFF_CARD_HOLD_CREATED_TOAST, 'success');
        }
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create this booking.');
      } finally {
        setSubmitting(false);
      }
    },
    [resource, date, startTime, endTime, firstName, lastName, guestEmail, guestPhone, venueId, onCreated, staffCardHold, requireCardHold, addToast],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/25 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-booking-title"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 pr-3">
            <h3 id="resource-booking-title" className="text-base font-semibold text-slate-900">
              Book resource
            </h3>
            {resource ? (
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {resource.name}
                {resource.resource_type ? ` · ${resource.resource_type}` : ''}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <div className="space-y-4 py-2" role="status" aria-label="Loading resource">
              <Skeleton.Line className="w-1/2" />
              <Skeleton.Block className="h-10" />
              <Skeleton.Block className="h-10" />
              <Skeleton.Block className="h-24" />
            </div>
          ) : error && !resource ? (
            <div className="py-4 text-center">
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
              <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : resource ? (
            <form onSubmit={handleSubmit} className="min-w-0 max-w-full space-y-4">
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor="resource-booking-date" className="mb-1 block text-xs font-medium text-slate-700">
                    Date
                  </label>
                  <input
                    id="resource-booking-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor="resource-booking-time" className="mb-1 block text-xs font-medium text-slate-700">
                    Start time
                  </label>
                  <input
                    id="resource-booking-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="resource-booking-duration" className="mb-1 block text-xs font-medium text-slate-700">
                  Duration
                </label>
                <select
                  id="resource-booking-duration"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className={INPUT_CLASS}
                >
                  {durationOptions.map((d) => (
                    <option key={d} value={d}>
                      {formatDuration(d)}
                    </option>
                  ))}
                </select>
                {endTime ? (
                  <p className="mt-1.5 text-xs text-slate-500">
                    {startTime.slice(0, 5)} – {endTime.slice(0, 5)}
                    {totalPricePence != null ? (
                      <span className="ml-2 font-medium text-slate-700">
                        {formatCurrency(totalPricePence, currency)}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="resource-booking-first" className="mb-1 block text-xs font-medium text-slate-700">
                    First name
                  </label>
                  <input
                    id="resource-booking-first"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    autoComplete="given-name"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="resource-booking-last" className="mb-1 block text-xs font-medium text-slate-700">
                    Surname
                  </label>
                  <input
                    id="resource-booking-last"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    autoComplete="family-name"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="resource-booking-email" className="mb-1 block text-xs font-medium text-slate-700">
                    Email <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="resource-booking-email"
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    autoComplete="email"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="resource-booking-phone" className="mb-1 block text-xs font-medium text-slate-700">
                    Phone <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="resource-booking-phone"
                    type="tel"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    autoComplete="tel"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              {staffCardHold ? (
                <StaffCardHoldToggle
                  checked={requireCardHold}
                  onChange={setRequireCardHold}
                  feePence={staffCardHold.feePence}
                />
              ) : null}

              {error ? (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={submitting}
                  disabled={!firstName.trim() || !lastName.trim() || !date || !startTime}
                >
                  {submitting ? 'Creating booking…' : 'Create booking'}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
