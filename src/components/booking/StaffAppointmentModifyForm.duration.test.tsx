/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// The date/time picker fetches its own availability calendar; this suite is
// about how the form resolves the DURATION, so stub it out.
vi.mock('@/components/booking/StaffAppointmentModifyDateTimePicker', () => ({
  StaffAppointmentModifyDateTimePicker: () => null,
}));

import { StaffAppointmentModifyForm } from './StaffAppointmentModifyForm';
import type { StaffExpandedBookingModifySource } from './StaffExpandedBookingModifyModal';

const SERVICE = {
  id: 's1',
  name: 'Colour and cut',
  duration_minutes: 80,
  variants: [] as Array<{ id: string; name: string; is_active: boolean; duration_minutes: number }>,
};

const fetchMock = vi.fn();

function mockCatalogue() {
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/venue/appointment-services')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          services: [SERVICE],
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
    // validate-appointment-modification
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  });
}

const baseBooking: StaffExpandedBookingModifySource = {
  id: 'b1',
  booking_date: '2026-08-12',
  booking_time: '11:15:00',
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
  booking_end_time: null,
};

function renderForm(over: Partial<StaffExpandedBookingModifySource> = {}) {
  return render(
    <StaffAppointmentModifyForm
      bookingId="b1"
      booking={{ ...baseBooking, ...over }}
      ownerVenueId="v1"
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

function durationInput(): HTMLInputElement {
  return screen.getByLabelText(/Duration \(minutes\)/i) as HTMLInputElement;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  mockCatalogue();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StaffAppointmentModifyForm duration resolution', () => {
  it('uses the booking wall-clock end when the row has one', async () => {
    renderForm({ booking_end_time: '12:35:00' });
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    expect(durationInput().value).toBe('80');
  });

  it('uses estimated_end_time when there is no wall-clock end', async () => {
    renderForm({ estimated_end_time: '2026-08-12T12:15:00.000Z' });
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    expect(durationInput().value).toBe('60');
  });

  it('adopts the catalogue duration when the row carries no end time at all (never 30)', async () => {
    // Regression: this used to fall back to a hardcoded 30 minutes, which
    // silently shrank the appointment on save and made a service with
    // processing time fail validation outright.
    renderForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    expect(durationInput().value).toBe('80');
    expect(durationInput().value).not.toBe('30');
  });

  it('an adopted duration is the baseline, so Save stays disabled until staff edit something', async () => {
    renderForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save changes/i })).toBeDisabled();
    });
  });

  it('shows the catalogue warning rather than spinning forever when the service is gone', async () => {
    // Nothing can resolve the duration for a service that no longer exists, so
    // the form must fall through to the warning instead of waiting on it.
    renderForm({ appointment_service_id: 'deleted-service' });
    await waitFor(() => {
      expect(
        screen.getByText(/service is no longer in the catalogue/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Save changes/i })).toBeDisabled();
  });
});
