/** @vitest-environment happy-dom */
/**
 * DIARY-03 (D46): a booking stays with the venue it was made at. The modify form lists only that
 * venue's calendars, reads them for that venue, and offers no rebook-then-cancel path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/booking/StaffAppointmentModifyDateTimePicker', () => ({
  StaffAppointmentModifyDateTimePicker: () => null,
}));

import { StaffAppointmentModifyForm } from './StaffAppointmentModifyForm';
import type { StaffExpandedBookingModifySource } from './StaffExpandedBookingModifyModal';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/venue/appointment-services')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          services: [{ id: 's-cut', name: 'Cut', duration_minutes: 30, variants: [] }],
          practitioner_services: [
            { practitioner_id: 'p-host-1', service_id: 's-cut' },
            { practitioner_id: 'p-host-2', service_id: 's-cut' },
          ],
        }),
      });
    }
    if (url.startsWith('/api/venue/practitioners')) {
      // The route answers for the owning venue only, so the member's calendars never arrive.
      return Promise.resolve({
        ok: true,
        json: async () => ({
          practitioners: [
            { id: 'p-host-1', name: 'Ada', is_active: true },
            { id: 'p-host-2', name: 'Ben', is_active: true },
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
  booking_date: '2026-10-10',
  booking_time: '10:00:00',
  party_size: 1,
  estimated_end_time: null,
  status: 'Booked',
  deposit_status: 'Not Required',
  dietary_notes: null,
  occasion: null,
  guest_name: 'Sam Guest',
  guest_email: null,
  guest_phone: null,
  practitioner_id: 'p-host-1',
  appointment_service_id: 's-cut',
  booking_end_time: '10:30:00',
};

describe('StaffAppointmentModifyForm in a collective', () => {
  it("lists only the booking's own venue's calendars, read for that venue", async () => {
    render(
      <StaffAppointmentModifyForm bookingId="b1" booking={booking} ownerVenueId="host" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    const select = (await screen.findByLabelText(/Staff \/ calendar/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    expect([...select.options].map((o) => o.textContent)).toEqual(['Ada', 'Ben']);
    // A venue's own booking: the route answers for the signed-in venue alone.
    const calendarsRead = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/venue/practitioners'))!;
    expect(calendarsRead).not.toContain('owner_venue_id');
  });

  it("reads a partner's booking's calendars for that partner only", async () => {
    render(
      <StaffAppointmentModifyForm
        bookingId="b1"
        booking={booking}
        ownerVenueId="member"
        catalogOwnerVenueId="member"
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await screen.findByLabelText(/Staff \/ calendar/i);
    const calendarsRead = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/venue/practitioners'))!;
    expect(calendarsRead).toContain('owner_venue_id=member');
  });

  it('offers no way to rebook the client elsewhere and cancel this booking', async () => {
    render(
      <StaffAppointmentModifyForm bookingId="b1" booking={booking} ownerVenueId="host" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByLabelText(/Staff \/ calendar/i);
    expect(document.body.textContent ?? '').not.toMatch(/rebook|cancel this one|different ResNeo accounts/i);
  });
});
