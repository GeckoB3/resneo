'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { AppointmentServiceFormFields } from '@/components/dashboard/appointment-services/AppointmentServiceFormFields';
import {
  DEFAULT_APPOINTMENT_SERVICE_FORM_VALUES,
  type AppointmentServiceFormValues,
} from '@/components/dashboard/appointment-services/appointment-service-form-values';
import { appointmentServiceFormToPayload } from '@/components/dashboard/appointment-services/appointment-service-form-to-payload';
import { useAppointmentsFeatureFlag } from '@/components/providers/VenueFeatureFlagsProvider';
import { readResponseJson } from '@/lib/api/read-response-json';
import type { OpeningHours } from '@/types/availability';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';
import type { WorkingHours } from '@/types/booking-models';

export interface ServiceModalCalendar {
  id: string;
  name: string;
  working_hours?: WorkingHours | null;
}

export interface AppointmentServiceModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the created/updated service after a successful save. */
  onSaved: (service: { id: string; name: string }) => void;
  isAdmin: boolean;
  stripeConnected: boolean;
  currencySymbol: string;
  venueOpeningHours: OpeningHours | null;
  venueOpeningExceptions?: VenueOpeningException[] | null;
  /** Bookable calendars/practitioners the service can be linked to. */
  calendars: ServiceModalCalendar[];
  /** Seed values (e.g. import prefills name/duration/price from the booking data). */
  initialForm?: Partial<AppointmentServiceFormValues>;
  title?: string;
  saveLabel?: string;
  /** When editing, the service id (sends PATCH instead of POST). */
  editingId?: string | null;
}

/**
 * Self-contained "Add service" modal that renders the same
 * `AppointmentServiceFormFields` as the dashboard and saves through the same
 * `/api/venue/appointment-services` endpoint (storing to `service_items` or
 * `appointment_services` per the venue booking model). Used by the data-import
 * References step so a service created mid-import is set up properly.
 */
export function AppointmentServiceModal({
  open,
  onClose,
  onSaved,
  isAdmin,
  stripeConnected,
  currencySymbol,
  venueOpeningHours,
  venueOpeningExceptions = null,
  calendars,
  initialForm,
  title = 'Add service',
  saveLabel = 'Create service',
  editingId = null,
}: AppointmentServiceModalProps) {
  const [form, setForm] = useState<AppointmentServiceFormValues>(() => ({
    ...DEFAULT_APPOINTMENT_SERVICE_FORM_VALUES,
    ...initialForm,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Defaults to off outside the dashboard's VenueFeatureFlagsProvider, keeping the form charge-only.
  const cardHoldEnabled = useAppointmentsFeatureFlag('card_hold_deposits');

  // Re-seed the form each time the modal is (re)opened so prefills from the
  // caller (e.g. the service name pulled from the import) take effect.
  useEffect(() => {
    if (open) {
      setForm({ ...DEFAULT_APPOINTMENT_SERVICE_FORM_VALUES, ...initialForm });
      setError(null);
    }
    // initialForm is recreated each render by callers; key off `open` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleCalendarLink(id: string) {
    setForm((f) => ({
      ...f,
      practitioner_ids: f.practitioner_ids.includes(id)
        ? f.practitioner_ids.filter((x) => x !== id)
        : [...f.practitioner_ids, id],
    }));
  }

  async function handleSave() {
    const built = appointmentServiceFormToPayload(form, { isAdmin, editingId });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/appointment-services', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(built.payload),
      });
      if (!res.ok) {
        const data = await readResponseJson<{ error?: string; details?: string }>(res);
        const baseMsg = data.error ?? 'Failed to save service';
        throw new Error(data.details ? `${baseMsg} ${data.details}` : baseMsg);
      }
      const data = await readResponseJson<{ id?: string; name?: string }>(res);
      if (!data.id) throw new Error('Service was saved but no id was returned.');
      onSaved({ id: data.id, name: data.name ?? form.name.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const linkedCalendarsForPreview = calendars
    .filter((c) => form.practitioner_ids.includes(c.id))
    .map((c) => ({ id: c.id, working_hours: c.working_hours ?? null }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
      title={title}
      size="lg"
      contentClassName="max-w-4xl"
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} loading={saving} disabled={saving}>
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </div>
      }
    >
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <AppointmentServiceFormFields
        form={form}
        setForm={setForm}
        isAdmin={isAdmin}
        stripeConnected={stripeConnected}
        cardHoldEnabled={cardHoldEnabled}
        currencySymbol={currencySymbol}
        fieldGroupSuffix={editingId ?? 'import-new-service'}
        venueOpeningHours={venueOpeningHours}
        venueOpeningExceptions={venueOpeningExceptions}
        linkedCalendarsForPreview={linkedCalendarsForPreview}
        calendarsSection={
          calendars.length > 0 ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Calendars that offer this service
              </label>
              <p className="mb-2 text-xs text-slate-500">
                Tick the calendars that should offer this service. You can fine-tune this later under Services.
              </p>
              <div className="space-y-2">
                {calendars.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={form.practitioner_ids.includes(c.id)}
                      onChange={() => toggleCalendarLink(c.id)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-slate-700">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No calendars found for this venue yet — you can link this service to calendars later under Services.
            </p>
          )
        }
      />
    </Dialog>
  );
}
