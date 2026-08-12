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
const SERVICE_2 = { id: 's2', name: 'Olaplex Treatment', duration_minutes: 30, variants: [] };
const SERVICE_3 = { id: 's3', name: 'Toner / Gloss', duration_minutes: 45, variants: [] };
const SERVICE_4 = { id: 's4', name: 'Beard Trim', duration_minutes: 15, variants: [] };
const CATALOGUE = [SERVICE, SERVICE_2, SERVICE_3, SERVICE_4];

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
const VISIT_SERVICES_URL = '/api/venue/visits/g1/services';

const fetchMock = vi.fn();
/** Every visit-endpoint request the form made, in order. */
let visitCalls: Array<Record<string, unknown>> = [];
/** Requests to the SERVICES endpoint specifically. */
let visitServiceCalls: Array<Record<string, unknown>> = [];

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
      { id: 'a', name: 'Cut & Blow Dry', service_id: 's1', booking_time: `${starts[0]}:00`, booking_end_time: `${starts[1]}:00`, duration_minutes: 60 },
      { id: 'b', name: 'Olaplex Treatment', service_id: 's2', booking_time: `${starts[1]}:00`, booking_end_time: `${starts[2]}:00`, duration_minutes: 30 },
      { id: 'c', name: 'Toner / Gloss', service_id: 's3', booking_time: `${starts[2]}:00`, booking_end_time: `${addMinutes(startHm, total)}:00`, duration_minutes: total - 90 },
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
          services: CATALOGUE,
          practitioner_services: CATALOGUE.map((s) => ({ practitioner_id: 'p1', service_id: s.id })),
        }),
      });
    }
    if (url === VISIT_SERVICES_URL) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      visitServiceCalls.push(body);
      const lines = (body.services ?? []) as Array<{ service_id: string }>;
      // Enough of a plan to render: each line at the catalogue length, in order.
      let cursor = 10 * 60;
      const services = lines.map((l, i) => {
        const svc = CATALOGUE.find((s) => s.id === l.service_id)!;
        const start = cursor;
        cursor += svc.duration_minutes;
        const toHm = (m: number) =>
          `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        return {
          id: (l as { booking_id?: string | null }).booking_id ?? null,
          name: svc.name,
          service_id: svc.id,
          kind: i,
          booking_time: `${toHm(start)}:00`,
          booking_end_time: `${toHm(start + svc.duration_minutes)}:00`,
          duration_minutes: svc.duration_minutes,
        };
      });
      const total = cursor - 10 * 60;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, changed: true, total_minutes: total, services }),
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
  visitServiceCalls = [];
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
    await waitFor(() => expect(screen.getByText('10:00 to 11:00')).toBeInTheDocument());
    expect(screen.getByText('11:00 to 11:30')).toBeInTheDocument();
  });

  it('offers one wall-clock duration for the whole visit, not the service’s', async () => {
    renderVisitForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    // 120, the span the resolver lays out, rather than 135 (the rows' own span,
    // hole included) or 30 (the clicked service).
    await waitFor(() => expect(durationInput().value).toBe('120'));
  });

  it('does not offer per-service DURATION editing, which is what left the hole', async () => {
    renderVisitForm();
    await waitFor(() => expect(durationInput()).toBeInTheDocument());
    // One duration for the visit, and no single-booking service/variant pair.
    expect(screen.queryByLabelText(/^Service$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Variant$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Duration \(minutes\)/i)).not.toBeInTheDocument();
  });

  it('lists the services as swappable, once the visit says what they are', async () => {
    renderVisitForm();
    await waitFor(() => expect(screen.getByLabelText(/Service 1/i)).toBeInTheDocument());
    expect((screen.getByLabelText(/Service 1/i) as HTMLSelectElement).value).toBe('s1');
    expect((screen.getByLabelText(/Service 2/i) as HTMLSelectElement).value).toBe('s2');
    expect((screen.getByLabelText(/Service 3/i) as HTMLSelectElement).value).toBe('s3');
  });

  it('a swap goes to the services endpoint, carrying the whole list', async () => {
    renderVisitForm();
    await waitFor(() => expect(screen.getByLabelText(/Service 2/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Service 2/i), { target: { value: 's4' } });
    await waitFor(() => expect(visitServiceCalls.length).toBeGreaterThan(0));
    const sent = visitServiceCalls[visitServiceCalls.length - 1]!;
    expect(sent.dry_run).toBe(true);
    expect(sent.services).toEqual([
      { booking_id: 'a', service_id: 's1', service_variant_id: null },
      { booking_id: 'b', service_id: 's4', service_variant_id: null },
      { booking_id: 'c', service_id: 's3', service_variant_id: null },
    ]);
  });

  it('removing a service leaves it out of the list that is sent', async () => {
    renderVisitForm();
    await waitFor(() => expect(screen.getByLabelText(/Remove Olaplex Treatment/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/Remove Olaplex Treatment/i));
    await waitFor(() => expect(visitServiceCalls.length).toBeGreaterThan(0));
    const sent = visitServiceCalls[visitServiceCalls.length - 1]!;
    expect(sent.services).toEqual([
      { booking_id: 'a', service_id: 's1', service_variant_id: null },
      { booking_id: 'c', service_id: 's3', service_variant_id: null },
    ]);
    /**
     * Leaving a service out is how it is removed, so the request also says which
     * visit it was built against. Without this a form opened on three services
     * would cancel a fourth that appeared while it was open.
     */
    expect(sent.known_booking_ids).toEqual(['a', 'b', 'c']);
  });

  it('an added service goes on the end, with no booking of its own yet', async () => {
    renderVisitForm();
    await waitFor(() => expect(screen.getByLabelText(/Add a service/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Add a service/i), { target: { value: 's4' } });
    await waitFor(() => expect(visitServiceCalls.length).toBeGreaterThan(0));
    const sent = visitServiceCalls[visitServiceCalls.length - 1]!;
    expect((sent.services as unknown[]).length).toBe(4);
    expect((sent.services as Array<Record<string, unknown>>)[3]).toEqual({
      booking_id: null,
      service_id: 's4',
      service_variant_id: null,
    });
  });

  it('lets the services set the visit’s length rather than competing with it', async () => {
    renderVisitForm();
    await waitFor(() => expect(screen.getByLabelText(/Add a service/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Add a service/i), { target: { value: 's4' } });
    await waitFor(() => expect(screen.getByText(/Set by the services in this visit/i)).toBeInTheDocument());
    expect(durationInput()).toHaveAttribute('readonly');
    // 60 + 30 + 45 + 15, the catalogue lengths the stub lays out.
    await waitFor(() => expect(durationInput().value).toBe('150'));
  });

  it('refuses to remove the last service, so a visit cannot be emptied by editing', async () => {
    renderVisitForm();
    await waitFor(() => expect(screen.getByLabelText(/Remove Cut & Blow Dry/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/Remove Olaplex Treatment/i));
    fireEvent.click(screen.getByLabelText(/Remove Toner \/ Gloss/i));
    await waitFor(() =>
      expect(screen.getByLabelText(/Remove Cut & Blow Dry/i)).toBeDisabled(),
    );
  });

  it('saves a service change through the services endpoint', async () => {
    renderVisitForm();
    await waitFor(() => expect(screen.getByLabelText(/Add a service/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Add a service/i), { target: { value: 's4' } });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(visitServiceCalls.some((c) => c.dry_run === undefined)).toBe(true);
    });
    const save = visitServiceCalls.find((c) => c.dry_run === undefined)!;
    expect((save.services as unknown[]).length).toBe(4);
    expect(save.booking_time).toBe('10:00');
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
