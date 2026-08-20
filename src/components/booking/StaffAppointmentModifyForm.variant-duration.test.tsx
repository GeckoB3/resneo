/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

// This suite is about the DURATION following a variant switch, so the picker
// (which fetches its own availability calendar) is stubbed out.
vi.mock('@/components/booking/StaffAppointmentModifyDateTimePicker', () => ({
  StaffAppointmentModifyDateTimePicker: () => null,
}));

import { StaffAppointmentModifyForm } from './StaffAppointmentModifyForm';
import type { StaffExpandedBookingModifySource } from './StaffExpandedBookingModifyModal';

/**
 * Regression cover: switching the variant left the duration on the old option's
 * value. The form then posted that stale duration, which the modify route prefers
 * over the variant's own, so a booking switched from Basic (30 min) to Premium
 * (60 min) was saved as Premium, priced as Premium, and given 30 minutes.
 */

const BASIC = { id: 'v-basic', name: 'Basic', is_active: true, duration_minutes: 30 };
const PREMIUM = { id: 'v-premium', name: 'Premium', is_active: true, duration_minutes: 60 };

const SERVICE = {
  id: 's1',
  name: 'Variant service',
  duration_minutes: 30,
  variants: [BASIC, PREMIUM],
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
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  });
}

const baseBooking: StaffExpandedBookingModifySource = {
  id: 'b1',
  booking_date: '2026-08-12',
  booking_time: '20:30:00',
  party_size: 1,
  // Booked as Basic: 20:30 to 21:00.
  estimated_end_time: '2026-08-12T21:00:00.000Z',
  status: 'Booked',
  deposit_status: 'Not Required',
  dietary_notes: null,
  occasion: null,
  guest_name: 'Andrew Courtney',
  guest_email: null,
  guest_phone: null,
  practitioner_id: 'p1',
  appointment_service_id: 's1',
  booking_end_time: '21:00:00',
  service_variant_id: BASIC.id,
} as StaffExpandedBookingModifySource;

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

function variantSelect(): HTMLSelectElement {
  return screen.getByLabelText(/Variant/i) as HTMLSelectElement;
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

describe('StaffAppointmentModifyForm: duration follows the variant', () => {
  it('opens on the booking’s own duration, not the catalogue’s', async () => {
    renderForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    expect(durationInput().value).toBe('30');
  });

  it('adopts the new variant’s duration when the variant is switched', async () => {
    renderForm();
    await waitFor(() => expect(variantSelect()).toBeInTheDocument());
    expect(durationInput().value).toBe('30');

    fireEvent.change(variantSelect(), { target: { value: PREMIUM.id } });

    await waitFor(() => expect(durationInput().value).toBe('60'));
  });

  it('switching back returns the duration to the original option', async () => {
    renderForm();
    await waitFor(() => expect(variantSelect()).toBeInTheDocument());

    fireEvent.change(variantSelect(), { target: { value: PREMIUM.id } });
    await waitFor(() => expect(durationInput().value).toBe('60'));

    fireEvent.change(variantSelect(), { target: { value: BASIC.id } });
    await waitFor(() => expect(durationInput().value).toBe('30'));
  });

  it('leaves a duration staff typed themselves alone when the variant changes', async () => {
    renderForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());

    // Staff deliberately allow 45 minutes for this client.
    fireEvent.change(durationInput(), { target: { value: '45' } });
    await waitFor(() => expect(durationInput().value).toBe('45'));

    fireEvent.change(variantSelect(), { target: { value: PREMIUM.id } });

    // Their figure survives; the switch must not overwrite a deliberate edit.
    await waitFor(() => expect(variantSelect().value).toBe(PREMIUM.id));
    expect(durationInput().value).toBe('45');
  });
});
