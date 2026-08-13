/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

// This suite is about the processing blocks the form sends, so stub the picker
// (it fetches its own availability calendar).
vi.mock('@/components/booking/StaffAppointmentModifyDateTimePicker', () => ({
  StaffAppointmentModifyDateTimePicker: () => null,
}));

import { StaffAppointmentModifyForm } from './StaffAppointmentModifyForm';
import type { StaffExpandedBookingModifySource } from './StaffExpandedBookingModifyModal';

/** 80 minute colour with the practitioner free from minute 15 to minute 45. */
const GAP = { id: '5a3c1f7e-0000-4000-8000-000000000001', start_minute: 15, duration_minutes: 30 };

const COLOUR = {
  id: 's1',
  name: 'Colour and cut',
  duration_minutes: 80,
  processing_time_blocks: [GAP],
  variants: [],
};

/** A 30 minute service whose own gap sits somewhere else entirely. */
const TRIM = {
  id: 's2',
  name: 'Fringe trim',
  duration_minutes: 30,
  processing_time_blocks: [{ id: '5a3c1f7e-0000-4000-8000-000000000002', start_minute: 5, duration_minutes: 10 }],
  variants: [],
};

/** No processing time at all. */
const BLOWDRY = { id: 's3', name: 'Blow dry', duration_minutes: 45, processing_time_blocks: [], variants: [] };

const fetchMock = vi.fn();
const validateBodies: Array<Record<string, unknown>> = [];
const patchBodies: Array<Record<string, unknown>> = [];

function mockApi() {
  validateBodies.length = 0;
  patchBodies.length = 0;
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith('/api/venue/appointment-services')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          services: [COLOUR, TRIM, BLOWDRY],
          practitioner_services: [
            { practitioner_id: 'p1', service_id: 's1' },
            { practitioner_id: 'p1', service_id: 's2' },
            { practitioner_id: 'p1', service_id: 's3' },
          ],
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
    validateBodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  });
}

const baseBooking: StaffExpandedBookingModifySource = {
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
  processing_time_blocks: [GAP],
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

/** Render (unless the test already did), then type a new duration. */
async function setDuration(minutes: number) {
  await waitFor(() => expect(durationInput()).toBeInTheDocument(), { timeout: 4000 });
  fireEvent.change(durationInput(), { target: { value: String(minutes) } });
}

/** The blocks on the most recent validate POST. */
function lastValidatedBlocks(): unknown {
  return validateBodies[validateBodies.length - 1]?.processing_time_blocks;
}

async function saveChanges() {
  const save = () => screen.getByRole('button', { name: /Save changes/i });
  await waitFor(() => expect(save()).toBeEnabled(), { timeout: 4000 });
  save().click();
  await waitFor(() => expect(patchBodies).toHaveLength(1), { timeout: 4000 });
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

describe('StaffAppointmentModifyForm processing time', () => {
  it('trims the gap to fit a shorter duration instead of being refused', async () => {
    // Regression: the server validated the booking's stored blocks against the
    // NEW duration, so shortening below the gap's end returned "Processing
    // blocks must lie within the service duration" and staff had no way out.
    renderForm();
    await setDuration(40);
    await waitFor(
      () => expect(lastValidatedBlocks()).toEqual([{ ...GAP, duration_minutes: 25 }]),
      { timeout: 4000 },
    );

    await saveChanges();
    expect(patchBodies[0]!.duration_minutes).toBe(40);
    expect(patchBodies[0]!.processing_time_blocks).toEqual([{ ...GAP, duration_minutes: 25 }]);
  });

  it('drops the gap when the duration leaves no room for it', async () => {
    renderForm();
    await setDuration(18);
    await waitFor(() => expect(lastValidatedBlocks()).toEqual([]), { timeout: 4000 });

    await saveChanges();
    expect(patchBodies[0]!.processing_time_blocks).toEqual([]);
  });

  it('leaves the gap where the practitioner put it when the appointment gets longer', async () => {
    renderForm();
    await setDuration(120);
    await waitFor(() => expect(lastValidatedBlocks()).toEqual([GAP]), { timeout: 4000 });

    await saveChanges();
    expect(patchBodies[0]!.processing_time_blocks).toEqual([GAP]);
  });

  it('adopts the new service pattern when staff switch service', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText(/^Service/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Service/i), { target: { value: 's2' } });

    await waitFor(
      () => expect(lastValidatedBlocks()).toEqual(TRIM.processing_time_blocks),
      { timeout: 4000 },
    );

    await saveChanges();
    // The old service's gap must not survive onto a booking of the new service.
    expect(patchBodies[0]!.processing_time_blocks).toEqual(TRIM.processing_time_blocks);
  });

  it('tells staff what saving will do to the gap', async () => {
    renderForm();
    await setDuration(40);
    await waitFor(() => {
      expect(screen.getByText(/shorten the processing gap/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/15 to 40 minutes/)).toBeInTheDocument();

    await setDuration(18);
    await waitFor(() => {
      expect(screen.getByText(/too short for the processing gap, so saving will remove it/i)).toBeInTheDocument();
    });
  });

  it('warns when the new service has no processing time at all', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText(/^Service/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Service/i), { target: { value: 's3' } });

    await waitFor(() => {
      expect(screen.getByText(/no processing time, so saving will remove/i)).toBeInTheDocument();
    });
    await waitFor(() => expect(lastValidatedBlocks()).toEqual([]), { timeout: 4000 });
  });

  it('says nothing about processing time on a booking that has none', async () => {
    renderForm({ appointment_service_id: 's2', processing_time_blocks: [] });
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    expect(screen.queryByText('Processing time')).not.toBeInTheDocument();
  });

  it('omits the field entirely when the caller never loaded it', async () => {
    // Sending [] here would clear real processing time on a row whose blocks
    // this form simply never saw.
    renderForm({ processing_time_blocks: undefined });
    await setDuration(40);
    await waitFor(() => expect(validateBodies.length).toBeGreaterThan(0), { timeout: 4000 });
    expect(validateBodies[validateBodies.length - 1]).not.toHaveProperty('processing_time_blocks');

    await saveChanges();
    expect(patchBodies[0]).not.toHaveProperty('processing_time_blocks');
  });
});
