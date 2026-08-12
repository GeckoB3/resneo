/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

// The picker fetches its own availability calendar; this suite is about how the
// form edits a VISIT, so stub it out.
vi.mock('@/components/booking/StaffAppointmentModifyDateTimePicker', () => ({
  StaffAppointmentModifyDateTimePicker: () => null,
}));

import { StaffAppointmentModifyForm } from './StaffAppointmentModifyForm';
import type { StaffExpandedBookingModifySource } from './StaffExpandedBookingModifyModal';

const SERVICE = {
  id: 's1',
  name: 'Cut & Blow Dry',
  duration_minutes: 60,
  variants: [] as Array<{ id: string; name: string; is_active: boolean; duration_minutes: number }>,
};

/**
 * The reported booking, as its rows stand: a 15 minute hole between Olaplex and
 * Toner that a per-service duration edit left behind.
 */
const SEGMENTS = [
  { id: 'a', booking_time: '10:00:00', booking_end_time: '11:00:00', booking_item_name: 'Cut & Blow Dry' },
  { id: 'b', booking_time: '11:00:00', booking_end_time: '11:30:00', booking_item_name: 'Olaplex Treatment' },
  { id: 'c', booking_time: '11:45:00', booking_end_time: '12:15:00', booking_item_name: 'Toner / Gloss' },
];

const VISIT_URL = '/api/venue/visits/g1/schedule';

const fetchMock = vi.fn();
/** Every visit-endpoint request the form made, in order. */
let visitCalls: Array<Record<string, unknown>> = [];

/** The layout the server would lay out: the hole closed, so 120 minutes not 135. */
function plannedVisit(startHm: string, total: number, changed: boolean) {
  const starts = [startHm, addMinutes(startHm, 60), addMinutes(startHm, 90)];
  return {
    ok: true,
    start_time: startHm,
    end_time: addMinutes(startHm, total),
    total_minutes: total,
    changed,
    services: [
      { id: 'a', name: 'Cut & Blow Dry', booking_time: `${starts[0]}:00`, booking_end_time: `${starts[1]}:00`, duration_minutes: 60 },
      { id: 'b', name: 'Olaplex Treatment', booking_time: `${starts[1]}:00`, booking_end_time: `${starts[2]}:00`, duration_minutes: 30 },
      { id: 'c', name: 'Toner / Gloss', booking_time: `${starts[2]}:00`, booking_end_time: `${addMinutes(startHm, total)}:00`, duration_minutes: total - 90 },
    ],
  };
}

function addMinutes(hm: string, mins: number): string {
  const [h, m] = hm.split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function mockApi(visitResponse: (body: Record<string, unknown>) => { ok: boolean; json: unknown } = () => ({
  ok: true,
  json: plannedVisit('10:00', 120, true),
})) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
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
        json: async () => ({ practitioners: [{ id: 'p1', name: 'David', is_active: true }] }),
      });
    }
    if (url === VISIT_URL) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      visitCalls.push(body);
      const res = visitResponse(body);
      return Promise.resolve({ ok: res.ok, status: res.ok ? 200 : 409, json: async () => res.json });
    }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  });
}

const baseBooking: StaffExpandedBookingModifySource = {
  // The MIDDLE service was clicked, which is the case that used to open the form
  // on one row of the visit.
  id: 'b',
  booking_date: '2026-08-14',
  booking_time: '11:00:00',
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
  booking_end_time: '11:30:00',
};

function renderVisitForm(over: { onSaved?: () => void; onClose?: () => void } = {}) {
  return render(
    <StaffAppointmentModifyForm
      bookingId="b"
      booking={baseBooking}
      ownerVenueId="v1"
      visit={{ groupBookingId: 'g1', segments: SEGMENTS }}
      onSaved={over.onSaved ?? vi.fn()}
      onClose={over.onClose ?? vi.fn()}
    />,
  );
}

function durationInput(): HTMLInputElement {
  return screen.getByLabelText(/Total duration \(minutes\)/i) as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Save changes/i }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  visitCalls = [];
  mockApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StaffAppointmentModifyForm on a multi-service visit', () => {
  it('opens on the visit, not the clicked service', async () => {
    renderVisitForm();
    // The clicked row starts at 11:00; the VISIT starts at 10:00.
    await waitFor(() => expect(screen.getByText(/3 services in this visit/i)).toBeInTheDocument());
    expect(screen.getByText('Cut & Blow Dry')).toBeInTheDocument();
    expect(screen.getByText('Olaplex Treatment')).toBeInTheDocument();
    expect(screen.getByText('Toner / Gloss')).toBeInTheDocument();
  });

  it('offers one wall-clock duration for the whole visit, not the service’s', async () => {
    renderVisitForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    // 120, the span the resolver lays out, rather than 135 (the rows' own span,
    // hole included) or 30 (the clicked service).
    await waitFor(() => expect(durationInput().value).toBe('120'));
  });

  it('does not offer per-service editing, which is what left the hole', async () => {
    renderVisitForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    expect(screen.queryByLabelText(/^Service$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Variant/i)).not.toBeInTheDocument();
  });

  it('says what saving will do to dead time the rows carry, and lets staff save it', async () => {
    renderVisitForm();
    await waitFor(() =>
      expect(screen.getByText(/15 minutes of dead time/i)).toBeInTheDocument(),
    );
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it('checks the whole visit through the visit endpoint, not one service', async () => {
    renderVisitForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    fireEvent.change(durationInput(), { target: { value: '150' } });
    await waitFor(() => {
      expect(visitCalls.some((c) => c.dry_run === true && c.total_duration_minutes === 150)).toBe(true);
    });
    // Never the single-booking validate route.
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('validate-appointment-modification')),
    ).toBe(false);
  });

  it('saves the visit as one write, deferring the guest notification when the start moves', async () => {
    mockApi((body) => ({ ok: true, json: plannedVisit(String(body.booking_time ?? '10:00'), 120, true) }));
    renderVisitForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    fireEvent.change(durationInput(), { target: { value: '150' } });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());

    await waitFor(() => {
      const save = visitCalls.find((c) => c.dry_run === undefined);
      expect(save).toBeTruthy();
      expect(save!.total_duration_minutes).toBe(150);
      expect(save!.booking_time).toBe('10:00');
    });
    // Duration only: the start did not move, so nothing is deferred and no
    // follow-up panel appears.
    const save = visitCalls.find((c) => c.dry_run === undefined)!;
    expect(save.defer_modification_guest_notification).toBeUndefined();
  });

  it('surfaces the endpoint’s refusal and leaves save blocked', async () => {
    mockApi(() => ({
      ok: false,
      json: { error: 'Toner / Gloss cannot go to 16:10: Blocked time. The visit was not moved.' },
    }));
    renderVisitForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    fireEvent.change(durationInput(), { target: { value: '300' } });
    await waitFor(() =>
      expect(screen.getByText(/Toner \/ Gloss cannot go to 16:10/i)).toBeInTheDocument(),
    );
    expect(saveButton()).toBeDisabled();
  });

  it('a single-service booking is untouched by any of this', async () => {
    render(
      <StaffAppointmentModifyForm
        bookingId="b1"
        booking={{ ...baseBooking, id: 'b1' }}
        ownerVenueId="v1"
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/Duration \(minutes\)/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/services in this visit/i)).not.toBeInTheDocument();
    expect(visitCalls).toHaveLength(0);
  });
});
