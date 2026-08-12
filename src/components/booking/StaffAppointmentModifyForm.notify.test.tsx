/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

// Stub the date/time picker (it fetches its own availability) but expose a
// control that moves the start time, so the save path can be driven.
vi.mock('@/components/booking/StaffAppointmentModifyDateTimePicker', () => ({
  StaffAppointmentModifyDateTimePicker: ({
    onBookingTimeChange,
  }: {
    onBookingTimeChange: (t: string) => void;
  }) => (
    <button type="button" onClick={() => onBookingTimeChange('14:00')}>
      stub-move-time
    </button>
  ),
}));

import { StaffAppointmentModifyForm } from './StaffAppointmentModifyForm';
import type { StaffExpandedBookingModifySource } from './StaffExpandedBookingModifyModal';

const fetchMock = vi.fn();
const patchBodies: Array<Record<string, unknown>> = [];

function mockApi() {
  patchBodies.length = 0;
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith('/api/venue/appointment-services')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          services: [{ id: 's1', name: 'Colour', duration_minutes: 80, variants: [] }],
          practitioner_services: [{ practitioner_id: 'p1', service_id: 's1' }],
        }),
      });
    }
    if (url.startsWith('/api/venue/practitioners')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ practitioners: [{ id: 'p1', name: 'Adam', is_active: true }] }),
      });
    }
    if (init?.method === 'PATCH') {
      patchBodies.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>);
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    // validate-appointment-modification and the notify POST
    return Promise.resolve({ ok: true, json: async () => ({ ok: true, emailSent: true }) });
  });
}

const booking: StaffExpandedBookingModifySource = {
  id: 'b1',
  booking_date: '2026-08-12',
  booking_time: '11:15:00',
  booking_end_time: '12:35:00',
  party_size: 1,
  estimated_end_time: null,
  status: 'Booked',
  deposit_status: 'Not Required',
  dietary_notes: null,
  occasion: null,
  guest_name: 'Mia Graydon',
  guest_email: null,
  guest_phone: null,
  practitioner_id: 'p1',
  appointment_service_id: 's1',
};

function renderForm(handlers: { onSaved?: () => void; onClose?: () => void } = {}) {
  const onSaved = handlers.onSaved ?? vi.fn();
  const onClose = handlers.onClose ?? vi.fn();
  render(
    <StaffAppointmentModifyForm
      bookingId="b1"
      booking={booking}
      ownerVenueId="v1"
      onSaved={onSaved}
      onClose={onClose}
    />,
  );
  return { onSaved, onClose };
}

/** Move the start time, wait for availability validation, then save. */
async function moveTimeAndSave() {
  await waitFor(() => expect(screen.getByText('stub-move-time')).toBeInTheDocument());
  screen.getByText('stub-move-time').click();
  const save = () => screen.getByRole('button', { name: /Save changes/i });
  await waitFor(() => expect(save()).toBeEnabled(), { timeout: 4000 });
  save().click();
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  mockApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StaffAppointmentModifyForm start-time follow-up', () => {
  it('shows notify / skip / undo after saving a start-time change', async () => {
    // Regression: handleSave used to call onSaved() first, and every caller
    // closes the modal in that callback, so the follow-up never rendered.
    const { onSaved, onClose } = renderForm();
    await moveTimeAndSave();

    await waitFor(() => {
      expect(screen.getByText('Time changed and saved')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Notify now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip notify' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo change' })).toBeInTheDocument();

    // The modal must still be open at this point.
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('defers the guest notification on that save', async () => {
    renderForm();
    await moveTimeAndSave();
    await waitFor(() => expect(patchBodies.length).toBeGreaterThan(0));
    expect(patchBodies[0]).toMatchObject({
      booking_time: '14:00:00',
      defer_modification_guest_notification: true,
    });
  });

  it('refreshes and closes the caller once the follow-up is dismissed', async () => {
    const { onSaved, onClose } = renderForm();
    await moveTimeAndSave();
    await waitFor(() => expect(screen.getByText('Time changed and saved')).toBeInTheDocument());

    screen.getByRole('button', { name: 'Skip notify' }).click();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes immediately, with no follow-up, when the start time did not change', async () => {
    const { onSaved, onClose } = renderForm();
    await waitFor(() => expect(screen.getByLabelText(/Duration \(minutes\)/i)).toBeInTheDocument());

    // Change only the duration, leaving the start where it was. Through
    // fireEvent so React sees it: assigning `.value` and dispatching by hand
    // leaves the form's state on the original duration, and Save only looked
    // enabled because `hasChanges` was comparing two keys that never matched.
    const duration = screen.getByLabelText(/Duration \(minutes\)/i) as HTMLInputElement;
    fireEvent.change(duration, { target: { value: '90' } });

    const save = () => screen.getByRole('button', { name: /Save changes/i });
    await waitFor(() => expect(save()).toBeEnabled(), { timeout: 4000 });
    save().click();

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Time changed and saved')).not.toBeInTheDocument();
    expect(patchBodies[0]).not.toHaveProperty('defer_modification_guest_notification');
  });
});
