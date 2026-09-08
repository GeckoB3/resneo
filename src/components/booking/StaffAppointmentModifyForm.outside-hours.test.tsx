/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

// The date/time picker fetches its own availability calendar; this suite is
// about the hours override, so stub it out.
vi.mock('@/components/booking/StaffAppointmentModifyDateTimePicker', () => ({
  StaffAppointmentModifyDateTimePicker: () => null,
}));

import { StaffAppointmentModifyForm } from './StaffAppointmentModifyForm';
import type { StaffExpandedBookingModifySource } from './StaffExpandedBookingModifyModal';

const fetchMock = vi.fn();
const validateCalls: Array<Record<string, unknown>> = [];

function mockApi(validateResponse: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/venue/appointment-services')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          services: [{ id: 's1', name: 'Cut', duration_minutes: 30, variants: [] }],
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
    if (url.includes('validate-appointment-modification')) {
      validateCalls.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return Promise.resolve({ ok: true, json: async () => validateResponse });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

const booking: StaffExpandedBookingModifySource = {
  id: 'b1',
  booking_date: '2026-08-12',
  booking_time: '18:30:00',
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
  booking_end_time: '19:00:00',
};

function renderForm() {
  return render(
    <StaffAppointmentModifyForm
      bookingId="b1"
      booking={booking}
      ownerVenueId="v1"
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

const NOTE = /outside the working hours for this calendar/i;

/** Save is offered only once something has changed; the check runs on the change. */
async function lengthen() {
  const input = await screen.findByLabelText(/Duration \(minutes\)/i);
  fireEvent.change(input, { target: { value: '45' } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  validateCalls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Staff may put a booking outside the calendar's hours from this form, as from
 * the diary. The check is asked with the override on every time, so a time
 * outside hours validates; the server reports that it was the override that
 * let it through, and the form says so rather than refusing.
 */
describe('StaffAppointmentModifyForm outside hours', () => {
  it('asks the check with the hours override, and says so when the time is outside hours', async () => {
    mockApi({ ok: true, outside_hours: true });
    renderForm();
    await lengthen();
    await waitFor(() => expect(validateCalls.length).toBeGreaterThan(0));
    expect(validateCalls.every((c) => c.allow_outside_hours === true)).toBe(true);
    await waitFor(() => expect(screen.getByText(NOTE)).toBeInTheDocument());
    // Said, not refused: the save is still offered.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save changes/i })).toBeEnabled(),
    );
  });

  it('shows no note for a time inside hours', async () => {
    mockApi({ ok: true, outside_hours: false });
    renderForm();
    await lengthen();
    await waitFor(() => expect(validateCalls.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save changes/i })).toBeEnabled(),
    );
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});
