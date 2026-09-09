/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/components/booking/StaffAppointmentModifyDateTimePicker', () => ({
  StaffAppointmentModifyDateTimePicker: () => null,
}));

import { StaffAppointmentModifyForm } from './StaffAppointmentModifyForm';
import type { StaffExpandedBookingModifySource } from './StaffExpandedBookingModifyModal';

/**
 * A booking made with "override availability" (or dragged onto another column)
 * can sit with a person who is not assigned its service. The modify form used
 * to list only the people who offer the service and, finding the booking's own
 * person missing, silently switched the calendar to the first one who does, so
 * saving any other change moved the booking.
 */
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/venue/appointment-services')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          services: [{ id: 's-colour', name: 'Colour', duration_minutes: 90, variants: [] }],
          // Only Ben offers Colour.
          practitioner_services: [{ practitioner_id: 'p-ben', service_id: 's-colour' }],
        }),
      });
    }
    if (url.startsWith('/api/venue/practitioners')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          practitioners: [
            { id: 'p-ada', name: 'Ada', is_active: true },
            { id: 'p-ben', name: 'Ben', is_active: true },
          ],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const booking: StaffExpandedBookingModifySource = {
  id: 'b1',
  booking_date: '2026-09-10',
  booking_time: '07:00:00',
  party_size: 1,
  estimated_end_time: null,
  status: 'Booked',
  deposit_status: 'Not Required',
  dietary_notes: null,
  occasion: null,
  guest_name: 'Sam Guest',
  guest_email: null,
  guest_phone: null,
  // Ada has the Colour, which she does not offer.
  practitioner_id: 'p-ada',
  appointment_service_id: 's-colour',
  booking_end_time: '08:30:00',
};

describe('StaffAppointmentModifyForm on an overridden booking', () => {
  it('keeps the booking’s own person selected even though they do not offer the service', async () => {
    render(
      <StaffAppointmentModifyForm bookingId="b1" booking={booking} ownerVenueId="v1" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    const select = (await screen.findByLabelText(/Staff \/ calendar/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));
    expect(select.value).toBe('p-ada');
    const names = [...select.options].map((o) => o.text);
    expect(names).toEqual(expect.arrayContaining(['Ada', 'Ben']));
  });
});
