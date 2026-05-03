'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import type { BookingModel } from '@/types/booking-models';
import { NumericInput } from '@/components/ui/NumericInput';

interface BookingDetails {
  booking_id: string;
  venue_id: string;
  venue_name: string;
  venue_address: string | null;
  venue_phone: string | null;
  booking_date: string;
  booking_time: string;
  party_size: number;
  deposit_paid: boolean;
  deposit_amount_pence: number | null;
  status: string;
  is_appointment?: boolean;
  booking_model?: BookingModel;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  practitioner_name?: string | null;
  appointment_service_name?: string | null;
  event_name?: string | null;
  class_summary?: string | null;
  resource_name?: string | null;
  booking_end_time?: string | null;
  refund_notice_hours?: number;
  /** ISO timestamp for optimistic concurrency on guest modify */
  updated_at?: string;
}

function isCdeModel(m: BookingModel): boolean {
  return m === 'event_ticket' || m === 'class_session' || m === 'resource_booking';
}

interface Slot {
  key: string;
  label: string;
  start_time: string;
  available_covers: number;
}

interface AppointmentServiceOption {
  id: string;
  name: string;
  duration_minutes: number;
  price_pence: number | null;
}

interface AppointmentPractitionerDay {
  id: string;
  name: string;
  services: AppointmentServiceOption[];
  slots: Array<{
    practitioner_id: string;
    practitioner_name: string;
    service_id: string;
    service_name: string;
    start_time: string;
    duration_minutes: number;
    price_pence: number | null;
  }>;
}

export function ManageBookingView({ bookingId, token, hmac }: { bookingId: string; token?: string; hmac?: string }) {
  const [details, setDetails] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [refundMessage, setRefundMessage] = useState<string | null>(null);
  const [showModify, setShowModify] = useState(false);
  const [modifySuccess, setModifySuccess] = useState(false);

  const authParam = hmac
    ? `hmac=${encodeURIComponent(hmac)}`
    : `token=${encodeURIComponent(token ?? '')}`;

  const fetchDetails = useCallback(async () => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const res = await fetch(`${base}/api/confirm?booking_id=${encodeURIComponent(bookingId)}&${authParam}`);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? 'Invalid link');
    }
    setDetails(await res.json());
  }, [bookingId, authParam]);

  useEffect(() => {
    fetchDetails().catch((e) => setError(e instanceof Error ? e.message : 'Invalid link')).finally(() => setLoading(false));
  }, [fetchDetails]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    try {
      const authPayload = hmac ? { hmac } : { token };
      const res = await fetch(`${base}/api/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId, ...authPayload, action: 'cancel' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setCancelled(true);
      if (data.refund_message) setRefundMessage(data.refund_message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setCancelling(false);
    }
  }, [bookingId, token, hmac]);

  const handleModifySaved = useCallback(() => {
    setShowModify(false);
    setModifySuccess(true);
    fetchDetails().catch((e) => console.error('[ManageBookingView] post-modify refresh failed:', e));
    setTimeout(() => setModifySuccess(false), 4000);
  }, [fetchDetails]);

  if (loading) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !details) {
    return (
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
          </div>
          <p className="text-sm text-red-600">{error}</p>
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">Go home</Link>
        </div>
      </div>
    );
  }

  if (cancelled) {
    const appt = details?.is_appointment;
    const cde = details?.booking_model ? isCdeModel(details.booking_model) : false;
    const title =
      appt && !cde ? 'Appointment cancelled' : 'Booking cancelled';
    const subtitle =
      appt && !cde
        ? 'Your appointment has been cancelled.'
        : cde
          ? 'Your booking has been cancelled.'
          : 'Your reservation has been cancelled.';
    return (
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-4">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <svg className="h-6 w-6 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
          {refundMessage && (
            <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-left">
              <p className="text-sm font-medium text-blue-800">Deposit refund</p>
              <p className="mt-1 text-sm text-blue-700">{refundMessage}</p>
            </div>
          )}
          <Link href="/" className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">Go home</Link>
        </div>
      </div>
    );
  }

  if (!details) return null;

  const dateStr = new Date(details.booking_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const canModify = details.status === 'Confirmed' || details.status === 'Booked' || details.status === 'Pending';
  const canCancel = details.status === 'Confirmed' || details.status === 'Booked' || details.status === 'Pending';
  const isAppointment = Boolean(details.is_appointment);
  const bookingModel: BookingModel = details.booking_model ?? 'table_reservation';
  const isCde = isCdeModel(bookingModel);
  const isTableBooking = bookingModel === 'table_reservation';
  const refundHours = details.refund_notice_hours ?? 48;

  const cdeSummary =
    details.event_name ??
    details.class_summary ??
    (details.resource_name
      ? details.booking_end_time
        ? `${details.resource_name} · until ${details.booking_end_time}`
        : details.resource_name
      : null);

  const showGuestModify = canModify && !isCde && (isAppointment || isTableBooking);
  const modifyButtonLabel = isAppointment ? 'Change appointment' : 'Modify booking';
  const cancelButtonLabel = isCde ? 'Cancel booking' : isAppointment ? 'Cancel appointment' : 'Cancel reservation';
  const keepButtonLabel = isCde ? 'Keep booking' : isAppointment ? 'Keep appointment' : 'Keep booking';

  return (
    <div className="w-full max-w-lg">
      <div className="mb-6">
        <img src="/Logo.png" alt="ReserveNI" className="h-8 w-auto" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-5">
          <h2 className="text-lg font-semibold text-white">{details.venue_name}</h2>
          {details.venue_address && <p className="mt-0.5 text-sm text-brand-100">{details.venue_address}</p>}
        </div>

        <div className="p-6 space-y-4">
          {modifySuccess && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 font-medium">
              {isAppointment ? 'Your appointment has been updated.' : 'Your booking has been updated.'}
            </div>
          )}

          {isCde ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                <p className="text-xs font-medium text-slate-500">{bookingModelShortLabel(bookingModel)} booking</p>
                {cdeSummary && <p className="mt-1 text-sm font-semibold text-slate-800 leading-snug">{cdeSummary}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DetailTile label="Date" value={dateStr} />
                <DetailTile label="Time" value={details.booking_time.slice(0, 5)} />
                <DetailTile label="Guests" value={`${details.party_size}`} />
                <DetailTile label="Status" value={details.status} />
              </div>
            </div>
          ) : isAppointment ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailTile label="Service" value={details.appointment_service_name ?? '-'} />
              <DetailTile label="Staff" value={details.practitioner_name ?? '-'} />
              <DetailTile label="Date" value={dateStr} />
              <DetailTile label="Time" value={details.booking_time.slice(0, 5)} />
              {details.party_size > 1 && <DetailTile label="People" value={`${details.party_size}`} />}
              <DetailTile label="Status" value={details.status} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <DetailTile label="Date" value={dateStr} />
              <DetailTile label="Time" value={details.booking_time.slice(0, 5)} />
              <DetailTile label="Guests" value={`${details.party_size}`} />
              <DetailTile label="Status" value={details.status} />
            </div>
          )}

          {details.deposit_paid && details.deposit_amount_pence != null && (
            <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm">
              <span className="font-medium text-emerald-800">Deposit paid:</span>{' '}
              <span className="text-emerald-700">&pound;{(details.deposit_amount_pence / 100).toFixed(2)}</span>
            </div>
          )}

          {showGuestModify && !showModify && !showCancelConfirm && (
            <button
              type="button"
              onClick={() => { setShowModify(true); setShowCancelConfirm(false); }}
              className="w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-sm font-medium text-brand-600 hover:bg-brand-50"
            >
              {modifyButtonLabel}
            </button>
          )}

          {showGuestModify && showModify && isAppointment && details.practitioner_id && details.appointment_service_id && (
            <ModifyAppointmentSection
              bookingId={bookingId}
              venueId={details.venue_id}
              venuePhone={details.venue_phone}
              initialPractitionerId={details.practitioner_id}
              initialServiceId={details.appointment_service_id}
              currentDate={details.booking_date}
              currentTime={details.booking_time}
              partySize={details.party_size}
              authPayload={hmac ? { hmac } : { token }}
              onSaved={handleModifySaved}
              onCancel={() => setShowModify(false)}
            />
          )}

          {canModify && showModify && !isAppointment && (
            <ModifyTableBookingSection
              bookingId={bookingId}
              venueId={details.venue_id}
              venuePhone={details.venue_phone}
              currentDate={details.booking_date}
              currentTime={details.booking_time}
              currentPartySize={details.party_size}
              authPayload={hmac ? { hmac } : { token }}
              onSaved={handleModifySaved}
              onCancel={() => setShowModify(false)}
            />
          )}

          {canCancel && !showCancelConfirm && !showModify && (
            <button
              type="button"
              onClick={() => { setShowCancelConfirm(true); setShowModify(false); }}
              className="w-full rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              {cancelButtonLabel}
            </button>
          )}

          {canCancel && showCancelConfirm && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-sm font-medium text-red-800">Are you sure?</p>
              {details.deposit_paid && details.deposit_amount_pence ? (
                <p className="text-xs text-red-700">
                  {isAppointment
                    ? `Full refund if cancelled ${refundHours}+ hours before your appointment. No refund within ${refundHours} hours or for no-shows.`
                    : `Full refund if cancelled 48+ hours before your reservation. No refund within 48 hours or for no-shows.`}
                </p>
              ) : (
                <p className="text-xs text-red-700">
                  {isAppointment ? 'Are you sure you want to cancel this appointment?' : 'Are you sure you want to cancel your booking?'}
                </p>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={handleCancel} disabled={cancelling} className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                  {cancelling ? 'Cancelling...' : 'Yes, cancel'}
                </button>
                <button type="button" onClick={() => { setShowCancelConfirm(false); setError(null); }} className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  {keepButtonLabel}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        <Link href="/" className="hover:text-brand-600">Powered by ReserveNI</Link>
      </p>
    </div>
  );
}

function ModifyAppointmentSection({
  bookingId,
  venueId,
  venuePhone,
  initialPractitionerId,
  initialServiceId,
  currentDate,
  currentTime,
  partySize,
  authPayload,
  onSaved,
  onCancel,
}: {
  bookingId: string;
  venueId: string;
  venuePhone: string | null;
  initialPractitionerId: string;
  initialServiceId: string;
  currentDate: string;
  currentTime: string;
  partySize: number;
  authPayload: { hmac?: string; token?: string };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(currentDate);
  const [practitionerId, setPractitionerId] = useState(initialPractitionerId);
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [selectedTime, setSelectedTime] = useState(currentTime.slice(0, 5));
  const [dayPractitioners, setDayPractitioners] = useState<AppointmentPractitionerDay[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadDay = useCallback(
    async (dateStr: string) => {
      setLoadingDay(true);
      setError(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      debounceRef.current = setTimeout(async () => {
        try {
          const url = `/api/booking/availability?venue_id=${encodeURIComponent(venueId)}&date=${encodeURIComponent(dateStr)}`;
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error('Failed to load availability');
          const data = (await res.json()) as { practitioners?: AppointmentPractitionerDay[] };
          if (controller.signal.aborted) return;
          setDayPractitioners(data.practitioners ?? []);
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (!controller.signal.aborted) {
            setDayPractitioners([]);
            setError('Could not load available appointments for this date.');
          }
        } finally {
          if (!controller.signal.aborted) setLoadingDay(false);
        }
      }, 200);
    },
    [venueId],
  );

  useEffect(() => {
    loadDay(date);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [date, loadDay]);

  const selectedPractitioner = useMemo(
    () => dayPractitioners.find((p) => p.id === practitionerId),
    [dayPractitioners, practitionerId],
  );

  const serviceOptions = selectedPractitioner?.services ?? [];

  const timeSlots = useMemo(() => {
    if (!selectedPractitioner) return [];
    return selectedPractitioner.slots.filter((s) => s.service_id === serviceId);
  }, [selectedPractitioner, serviceId]);

  useEffect(() => {
    if (dayPractitioners.length === 0) return;
    const stillHasPractitioner = dayPractitioners.some((p) => p.id === practitionerId);
    if (!stillHasPractitioner) {
      const first = dayPractitioners[0];
      if (first) {
        setPractitionerId(first.id);
        const firstSvc = first.services[0];
        if (firstSvc) setServiceId(firstSvc.id);
      }
      return;
    }
    const pr = dayPractitioners.find((p) => p.id === practitionerId);
    if (!pr) return;
    const hasService = pr.services.some((s) => s.id === serviceId);
    if (!hasService && pr.services[0]) {
      setServiceId(pr.services[0].id);
    }
  }, [dayPractitioners, practitionerId, serviceId]);

  useEffect(() => {
    const times = timeSlots.map((s) => s.start_time.slice(0, 5));
    if (times.length === 0) return;
    if (!times.includes(selectedTime)) {
      setSelectedTime(times[0]!);
    }
  }, [timeSlots, selectedTime]);

  const hasChanges =
    date !== currentDate ||
    selectedTime !== currentTime.slice(0, 5) ||
    practitionerId !== initialPractitionerId ||
    serviceId !== initialServiceId;

  const handleSave = useCallback(async () => {
    if (!hasChanges) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${base}/api/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: bookingId,
          ...authPayload,
          action: 'modify',
          booking_date: date,
          booking_time: selectedTime,
          party_size: partySize,
          practitioner_id: practitionerId,
          appointment_service_id: serviceId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg =
          res.status === 412
            ? 'This booking was updated elsewhere. Refresh the page and try again.'
            : ((j as { error?: string }).error ?? 'Failed to update appointment.');
        setError(msg);
        return;
      }
      onSaved();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [
    bookingId,
    authPayload,
    date,
    selectedTime,
    partySize,
    practitionerId,
    serviceId,
    hasChanges,
    onCancel,
    onSaved,
  ]);

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-800">Change your appointment</p>
      <p className="text-xs text-slate-600">
        Choose the service, staff member, date and time. Your selection must be available in real time.
      </p>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
        />
      </div>

      {!loadingDay && dayPractitioners.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No availability could be loaded for this date. Try another date or contact the venue
          {venuePhone ? (
            <>
              {' '}
              on{' '}
              <a href={`tel:${venuePhone}`} className="font-semibold underline">
                {venuePhone}
              </a>
            </>
          ) : null}
          .
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Staff member</label>
        {loadingDay ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            <span className="text-xs text-slate-500">Loading...</span>
          </div>
        ) : (
          <select
            value={practitionerId}
            onChange={(e) => setPractitionerId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          >
            {dayPractitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Service</label>
        <select
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          disabled={!selectedPractitioner || serviceOptions.length === 0}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 disabled:opacity-50"
        >
          {serviceOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.duration_minutes ? ` (${s.duration_minutes} min)` : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Time</label>
        {loadingDay ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            <span className="text-xs text-slate-500">Loading times...</span>
          </div>
        ) : timeSlots.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No available times for this staff member and service on this date.
            {venuePhone ? (
              <span className="mt-1 block">
                Call{' '}
                <a href={`tel:${venuePhone}`} className="font-semibold underline">
                  {venuePhone}
                </a>{' '}
                for help.
              </span>
            ) : null}
          </div>
        ) : (
          <select
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          >
            {timeSlots.map((slot) => (
              <option key={`${slot.start_time}-${slot.service_id}`} value={slot.start_time.slice(0, 5)}>
                {slot.start_time.slice(0, 5)} ({slot.service_name})
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !hasChanges || loadingDay || timeSlots.length === 0}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function ModifyTableBookingSection({
  bookingId,
  venueId,
  venuePhone,
  currentDate,
  currentTime,
  currentPartySize,
  authPayload,
  onSaved,
  onCancel,
}: {
  bookingId: string;
  venueId: string;
  venuePhone: string | null;
  currentDate: string;
  currentTime: string;
  currentPartySize: number;
  authPayload: { hmac?: string; token?: string };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(currentDate);
  const [partySize, setPartySize] = useState(currentPartySize);
  const [selectedTime, setSelectedTime] = useState(currentTime.slice(0, 5));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [largePartyMessage, setLargePartyMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasChanges =
    date !== currentDate ||
    selectedTime !== currentTime.slice(0, 5) ||
    partySize !== currentPartySize;

  useEffect(() => {
    if (!date || partySize < 1) {
      setSlots([]);
      setLargePartyMessage(null);
      return;
    }
    setLoadingSlots(true);
    setError(null);
    setLargePartyMessage(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;

      (async () => {
        try {
          const url = `/api/booking/availability?venue_id=${encodeURIComponent(venueId)}&date=${encodeURIComponent(date)}&party_size=${partySize}`;
          const res = await fetch(url, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!res.ok) throw new Error('Failed to load times');
          const data = await res.json();

          if (data.large_party_redirect) {
            if (!controller.signal.aborted) {
              setSlots([]);
              setLargePartyMessage(data.large_party_message ?? 'Please call the restaurant to book for larger parties.');
            }
            return;
          }

          const rawSlots: Slot[] = (data.slots ?? [])
            .map((s: Record<string, unknown>) => ({
              key: (s.key as string) ?? (s.start_time as string) ?? '',
              label: (s.label as string) ?? (s.start_time as string)?.slice(0, 5) ?? '',
              start_time: (s.start_time as string) ?? '',
              available_covers: (s.available_covers as number) ?? 0,
            }))
            .filter((s: Slot) => s.start_time);

          if (!controller.signal.aborted) {
            setSlots(rawSlots);
            const currentTimeShort = selectedTime.slice(0, 5);
            const match = rawSlots.find((s) => s.start_time.slice(0, 5) === currentTimeShort);
            if (!match && rawSlots.length > 0) {
              setSelectedTime(rawSlots[0].start_time.slice(0, 5));
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (!controller.signal.aborted) setSlots([]);
        } finally {
          if (!controller.signal.aborted) setLoadingSlots(false);
        }
      })();
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, partySize, venueId]);

  const handleSave = useCallback(async () => {
    if (!hasChanges) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${base}/api/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: bookingId,
          ...authPayload,
          action: 'modify',
          booking_date: date,
          booking_time: selectedTime,
          party_size: partySize,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg =
          res.status === 412
            ? 'This booking was updated elsewhere. Refresh the page and try again.'
            : ((j as { error?: string }).error ?? 'Failed to update booking.');
        setError(msg);
        return;
      }

      onSaved();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [bookingId, authPayload, date, selectedTime, partySize, hasChanges, onCancel, onSaved]);

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-800">Modify your booking</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Party size</label>
          <NumericInput
            min={1}
            max={50}
            value={partySize}
            onChange={setPartySize}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Time</label>
        {loadingSlots ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            <span className="text-xs text-slate-500">Loading available times...</span>
          </div>
        ) : largePartyMessage ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
            <p className="font-medium">{largePartyMessage}</p>
            {venuePhone && (
              <p className="mt-1">
                Call us at{' '}
                <a href={`tel:${venuePhone}`} className="font-semibold text-amber-800 underline">
                  {venuePhone}
                </a>
              </p>
            )}
          </div>
        ) : slots.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            No available times for this date and party size.
          </div>
        ) : (
          <select
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          >
            {slots.map((slot) => (
              <option key={slot.key} value={slot.start_time.slice(0, 5)}>
                {slot.label} ({slot.available_covers} cover{slot.available_covers !== 1 ? 's' : ''} available)
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !hasChanges || !!largePartyMessage || (slots.length === 0 && !loadingSlots)}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}
