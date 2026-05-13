'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BookingModel } from '@/types/booking-models';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import {
  ModifyTableBookingModal,
  expandedRowToEditSnapshot,
} from '@/components/booking/ModifyTableBookingModal';
import { AppointmentBookingFlow } from '@/components/booking/AppointmentBookingFlow';
import { PhoneWithCountryField } from '@/components/phone/PhoneWithCountryField';
import type { CountryCode } from 'libphonenumber-js';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';
import { mapApiVenueToVenuePublic } from '@/lib/booking/map-api-venue-to-public';
import type { VenuePublic } from '@/components/booking/types';

/** Same subset as ExpandedBookingContent + fields needed for appointment modify */
export interface StaffExpandedBookingModifySource {
  id: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  estimated_end_time: string | null;
  status: string;
  deposit_status: string;
  dietary_notes: string | null;
  occasion: string | null;
  guest_name: string;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  inferred_booking_model?: BookingModel;
  booking_model?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  area_id?: string | null;
  table_assignments?: Array<{ id: string; name: string }>;
}

export interface StaffExpandedBookingModifyDetailLite {
  special_requests: string | null;
  internal_notes: string | null;
  guest: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

type ModifyBranch = 'table' | 'appointment' | 'cde_details';

function inferModifyBranch(booking: StaffExpandedBookingModifySource): ModifyBranch {
  const model =
    booking.inferred_booking_model ??
    inferBookingRowModel({
      booking_model: booking.booking_model ?? null,
      experience_event_id: booking.experience_event_id,
      class_instance_id: booking.class_instance_id,
      resource_id: booking.resource_id,
      event_session_id: booking.event_session_id,
      calendar_id: booking.calendar_id,
      service_item_id: booking.service_item_id,
      practitioner_id: booking.practitioner_id,
      appointment_service_id: booking.appointment_service_id,
    });
  if (model === 'table_reservation') return 'table';
  if (model === 'event_ticket' || model === 'class_session' || model === 'resource_booking') {
    return 'cde_details';
  }
  return 'appointment';
}

function practitionerIdFromBooking(booking: StaffExpandedBookingModifySource): string | null {
  return booking.calendar_id ?? booking.practitioner_id ?? null;
}

function serviceIdFromBooking(booking: StaffExpandedBookingModifySource): string | null {
  return booking.appointment_service_id ?? booking.service_item_id ?? null;
}

function CdeDetailsModifyForm({
  bookingId,
  booking,
  detail,
  venueCurrency,
  onSaved,
  onClose,
}: {
  bookingId: string;
  booking: StaffExpandedBookingModifySource;
  detail: StaffExpandedBookingModifyDetailLite | undefined;
  venueCurrency: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const defaultCountry = defaultPhoneCountryForVenueCurrency(venueCurrency) as CountryCode;

  const g = detail?.guest;
  const [firstName, setFirstName] = useState(
    () => g?.first_name ?? booking.guest_first_name ?? booking.guest_name.split(/\s+/)[0] ?? '',
  );
  const [lastName, setLastName] = useState(
    () =>
      g?.last_name ??
      booking.guest_last_name ??
      booking.guest_name.split(/\s+/).slice(1).join(' ') ??
      '',
  );
  const [email, setEmail] = useState(() => g?.email ?? booking.guest_email ?? '');
  const [phone, setPhone] = useState(() => g?.phone ?? booking.guest_phone ?? '');
  const [internalNotes, setInternalNotes] = useState(() => detail?.internal_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baselineFirst = g?.first_name ?? booking.guest_first_name ?? booking.guest_name.split(/\s+/)[0] ?? '';
  const baselineLast =
    g?.last_name ??
    booking.guest_last_name ??
    booking.guest_name.split(/\s+/).slice(1).join(' ') ??
    '';
  const baselineEmail = g?.email ?? booking.guest_email ?? '';
  const baselinePhone = g?.phone ?? booking.guest_phone ?? '';
  const baselineInternal = detail?.internal_notes ?? '';

  const hasChanges =
    firstName.trim() !== baselineFirst.trim() ||
    lastName.trim() !== baselineLast.trim() ||
    email.trim() !== baselineEmail.trim() ||
    phone.trim() !== baselinePhone.trim() ||
    internalNotes.trim() !== baselineInternal.trim();

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_first_name: firstName.trim() || null,
          guest_last_name: lastName.trim() || null,
          guest_email: email.trim() || null,
          guest_phone: phone.trim() || null,
          internal_notes: internalNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Could not save.');
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        For events, classes, and resource bookings, the allocated slot cannot be changed here. Update client contact
        details or internal notes below, or cancel and create a new booking if the slot must move.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-700">
          First name
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Last name
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block text-xs font-semibold text-slate-700">
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>

      <div>
        <p className="text-xs font-semibold text-slate-700">Phone</p>
        <div className="mt-1">
          <PhoneWithCountryField
            value={phone}
            onChange={setPhone}
            defaultCountry={defaultCountry}
            inputClassName="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <label className="block text-xs font-semibold text-slate-700">
        Staff notes (internal)
        <textarea
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>

      {error ? <p className="rounded-lg border border-red-100 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p> : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={saving || !hasChanges}
          onClick={() => void handleSave()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export function StaffExpandedBookingModifyModal({
  open,
  onClose,
  onSaved,
  venueId,
  venueCurrency,
  tableManagementEnabled,
  booking,
  detail,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  venueId: string;
  venueCurrency: string;
  tableManagementEnabled: boolean;
  booking: StaffExpandedBookingModifySource;
  detail: StaffExpandedBookingModifyDetailLite | undefined;
}) {
  const branch = useMemo(() => inferModifyBranch(booking), [booking]);
  const [venue, setVenue] = useState<VenuePublic | null>(null);
  const [venueLoadError, setVenueLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || branch !== 'appointment' || venue) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue');
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          if (!cancelled) setVenueLoadError(typeof data.error === 'string' ? data.error : 'Could not load venue');
          return;
        }
        if (!cancelled) {
          setVenue(mapApiVenueToVenuePublic(data));
          setVenueLoadError(null);
        }
      } catch {
        if (!cancelled) setVenueLoadError('Could not load venue');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branch, open, venue]);

  if (!open) return null;

  if (branch === 'table') {
    const snap = expandedRowToEditSnapshot(
      {
        booking_date: booking.booking_date,
        booking_time: booking.booking_time,
        party_size: booking.party_size,
        area_id: booking.area_id,
        guest_name: booking.guest_name,
        guest_first_name: booking.guest_first_name,
        guest_last_name: booking.guest_last_name,
        guest_phone: booking.guest_phone,
        guest_email: booking.guest_email,
        dietary_notes: booking.dietary_notes,
        occasion: booking.occasion,
        estimated_end_time: booking.estimated_end_time,
        deposit_status: booking.deposit_status,
        table_assignments: booking.table_assignments,
      },
      detail
        ? {
            special_requests: detail.special_requests,
            internal_notes: detail.internal_notes,
            table_assignments: booking.table_assignments,
            guest: detail.guest,
          }
        : null,
    );

    return (
      <ModifyTableBookingModal
        open
        onClose={onClose}
        onSaved={onSaved}
        venueId={venueId}
        currency={venueCurrency}
        advancedMode={tableManagementEnabled}
        bookingId={booking.id}
        editSnapshot={snap}
      />
    );
  }

  const shellTitle = branch === 'appointment' ? 'Modify appointment' : 'Modify booking details';
  const practitionerId = practitionerIdFromBooking(booking);
  const serviceId = serviceIdFromBooking(booking);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-[2px] sm:items-center sm:pb-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-expanded-booking-modify-title"
        className="flex max-h-[min(90dvh,90vh)] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 id="staff-expanded-booking-modify-title" className="text-base font-semibold text-slate-900">
            {shellTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {branch === 'appointment' ? (
            venueLoadError ? (
              <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{venueLoadError}</p>
            ) : !venue ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
              </div>
            ) : !practitionerId || !serviceId ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This appointment is missing calendar or service data, so it cannot be modified here.
              </p>
            ) : (
              <AppointmentBookingFlow
                venue={venue}
                bookingAudience="staff"
                staffBookingSource="phone"
                initialDate={booking.booking_date}
                initialTime={booking.booking_time.slice(0, 5)}
                preselectedPractitionerId={practitionerId}
                onBookingCreated={onSaved}
                editBooking={{
                  id: booking.id,
                  booking_date: booking.booking_date,
                  booking_time: booking.booking_time,
                  party_size: booking.party_size,
                  practitioner_id: practitionerId,
                  service_id: serviceId,
                  guest_first_name:
                    detail?.guest?.first_name ?? booking.guest_first_name ?? booking.guest_name.split(/\s+/)[0] ?? '',
                  guest_last_name:
                    detail?.guest?.last_name ??
                    booking.guest_last_name ??
                    booking.guest_name.split(/\s+/).slice(1).join(' ') ??
                    '',
                  guest_email: detail?.guest?.email ?? booking.guest_email ?? '',
                  guest_phone: detail?.guest?.phone ?? booking.guest_phone ?? '',
                }}
              />
            )
          ) : (
            <CdeDetailsModifyForm
              bookingId={booking.id}
              booking={booking}
              detail={detail}
              venueCurrency={venueCurrency}
              onSaved={onSaved}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
