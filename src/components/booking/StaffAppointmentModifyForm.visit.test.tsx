/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

/**
 * The picker fetches its own availability calendar; this suite is about how the
 * form edits a VISIT, so it is stood in for by two plain inputs wired to the
 * same callbacks. They are the "visit start" controls in visit mode.
 */
vi.mock('@/components/booking/StaffAppointmentModifyDateTimePicker', () => ({
  StaffAppointmentModifyDateTimePicker: (props: {
    bookingDate: string;
    bookingTime: string;
    disabled?: boolean;
    onBookingDateChange: (v: string) => void;
    onBookingTimeChange: (v: string) => void;
  }) => (
    <div>
      <input
        aria-label="Visit start date"
        value={props.bookingDate}
        disabled={props.disabled}
        onChange={(e) => props.onBookingDateChange(e.target.value)}
      />
      <input
        aria-label="Visit start time"
        value={props.bookingTime}
        disabled={props.disabled}
        onChange={(e) => props.onBookingTimeChange(e.target.value)}
      />
    </div>
  ),
}));

import { StaffAppointmentModifyForm, type StaffVisitModifySegment } from './StaffAppointmentModifyForm';
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

/** A three-service visit on David (p1), with a 15 minute gap before Toner that is its to keep. */
const SEGMENTS: StaffVisitModifySegment[] = [
  { id: 'a', booking_date: '2026-08-14', booking_time: '10:00:00', booking_end_time: '11:00:00', calendar_id: 'p1', booking_item_name: 'Cut & Blow Dry' },
  { id: 'b', booking_date: '2026-08-14', booking_time: '11:00:00', booking_end_time: '11:30:00', calendar_id: 'p1', booking_item_name: 'Olaplex Treatment' },
  { id: 'c', booking_date: '2026-08-14', booking_time: '11:45:00', booking_end_time: '12:15:00', calendar_id: 'p1', booking_item_name: 'Toner / Gloss' },
];

const VISIT_URL = '/api/venue/visits/g1/schedule';
const VISIT_SERVICES_URL = '/api/venue/visits/g1/services';

const fetchMock = vi.fn();
/** Every visit-endpoint request the form made, in order. */
let visitCalls: Array<Record<string, unknown>> = [];
/** Requests to the SERVICES endpoint specifically. */
let visitServiceCalls: Array<Record<string, unknown>> = [];

function addMinutes(hm: string, mins: number): string {
  const [h, m] = hm.split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * A stand-in for the endpoint's planner: a shift moves every row by the delta
 * of the first, a per-service list changes the rows it names. Enough to hand
 * the form the shape it renders from.
 */
function plannedVisit(body: Record<string, unknown>) {
  const rows = SEGMENTS.map((s) => ({
    id: s.id,
    name: s.booking_item_name,
    service_id: CATALOGUE.find((c) => c.name === s.booking_item_name)!.id,
    booking_date: s.booking_date,
    booking_time: s.booking_time.slice(0, 5),
    duration: 0,
    calendar_id: s.calendar_id,
  }));
  rows[0]!.duration = 60;
  rows[1]!.duration = 30;
  rows[2]!.duration = 30;
  let changed = false;
  const shift = body.shift as { booking_date?: string; booking_time?: string; practitioner_id?: string } | undefined;
  if (shift) {
    const from = 10 * 60;
    const [h, m] = (shift.booking_time ?? '10:00').split(':').map(Number);
    const delta = (h ?? 0) * 60 + (m ?? 0) - from;
    for (const r of rows) {
      r.booking_time = addMinutes(r.booking_time, delta);
      if (shift.booking_date) r.booking_date = shift.booking_date;
      if (shift.practitioner_id) r.calendar_id = shift.practitioner_id;
    }
    changed = delta !== 0 || Boolean(shift.booking_date && shift.booking_date !== '2026-08-14') || (shift.practitioner_id != null && shift.practitioner_id !== 'p1');
  }
  const services = body.services as Array<Record<string, unknown>> | undefined;
  if (services) {
    for (const edit of services) {
      const r = rows.find((x) => x.id === edit.booking_id)!;
      if (typeof edit.booking_time === 'string') r.booking_time = edit.booking_time;
      if (typeof edit.booking_date === 'string') r.booking_date = edit.booking_date;
      if (typeof edit.practitioner_id === 'string') r.calendar_id = edit.practitioner_id;
      if (typeof edit.duration_minutes === 'number') r.duration = edit.duration_minutes;
    }
    changed = true;
  }
  const sorted = [...rows].sort((x, y) => `${x.booking_date}T${x.booking_time}`.localeCompare(`${y.booking_date}T${y.booking_time}`));
  return {
    ok: true,
    booking_date: sorted[0]!.booking_date,
    start_time: sorted[0]!.booking_time,
    end_time: addMinutes(sorted[sorted.length - 1]!.booking_time, sorted[sorted.length - 1]!.duration),
    total_minutes: 135,
    changed,
    services: sorted.map((r) => ({
      id: r.id,
      name: r.name,
      service_id: r.service_id,
      booking_date: r.booking_date,
      booking_time: `${r.booking_time}:00`,
      booking_end_time: `${addMinutes(r.booking_time, r.duration)}:00`,
      duration_minutes: r.duration,
      calendar_id: r.calendar_id,
      moved: false,
      changed: false,
    })),
  };
}

function mockApi(
  visitResponse: (body: Record<string, unknown>) => { ok: boolean; json: unknown } = (body) => ({
    ok: true,
    json: plannedVisit(body),
  }),
) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/venue/appointment-services')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          services: CATALOGUE,
          practitioner_services: CATALOGUE.flatMap((s) => [
            { practitioner_id: 'p1', service_id: s.id },
            { practitioner_id: 'p2', service_id: s.id },
          ]),
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
        json: async () => ({
          practitioners: [
            { id: 'p1', name: 'David', is_active: true },
            { id: 'p2', name: 'Priya', is_active: true },
          ],
        }),
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

function renderVisitForm(over: { onSaved?: () => void; onClose?: () => void; segments?: StaffVisitModifySegment[] } = {}) {
  return render(
    <StaffAppointmentModifyForm
      bookingId="b"
      booking={baseBooking}
      ownerVenueId="v1"
      visit={{ groupBookingId: 'g1', segments: over.segments ?? SEGMENTS }}
      onSaved={over.onSaved ?? vi.fn()}
      onClose={over.onClose ?? vi.fn()}
    />,
  );
}

const startTimeInput = () => screen.getByLabelText('Visit start time') as HTMLInputElement;
const startDateInput = () => screen.getByLabelText('Visit start date') as HTMLInputElement;
const visitCalendarSelect = () => screen.getByLabelText(/Staff \/ calendar for the whole visit/i) as HTMLSelectElement;
const editorFor = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /Save changes/i }) as HTMLButtonElement;
const saveCall = () => visitCalls.find((c) => c.dry_run === undefined);

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
  it('opens on the visit start, not the clicked service, and lists every service with its slot', async () => {
    renderVisitForm();
    await waitFor(() => expect(screen.getByText(/3 services in this visit/i)).toBeInTheDocument());
    // The clicked row starts at 11:00; the VISIT starts at 10:00.
    expect(startTimeInput().value).toBe('10:00');
    expect(startDateInput().value).toBe('2026-08-14');
    await waitFor(() => expect(screen.getByText('10:00 to 11:00')).toBeInTheDocument());
    expect(screen.getByText('11:00 to 11:30')).toBeInTheDocument();
    // The 11:30 to 11:45 gap is the visit's to keep: nothing re-lays it.
    expect(screen.getByText('11:45 to 12:15')).toBeInTheDocument();
  });

  it('asks the endpoint to describe the visit as it stands, with an empty shift', async () => {
    renderVisitForm();
    await waitFor(() => expect(visitCalls.length).toBeGreaterThan(0));
    expect(visitCalls[0]).toEqual({ dry_run: true, shift: {} });
  });

  it('offers no total duration and no single-booking service or variant controls', async () => {
    renderVisitForm();
    await waitFor(() => expect(screen.getByLabelText(/Start for Olaplex Treatment/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/Total duration/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Duration \(minutes\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Quick durations/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Service$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Variant$/i)).not.toBeInTheDocument();
  });

  it('gives every service its own date, start, calendar and length, seeded from its row', async () => {
    renderVisitForm();
    await waitFor(() => expect(screen.getByLabelText(/Start for Toner \/ Gloss/i)).toBeInTheDocument());
    expect(editorFor('Date for Toner / Gloss').value).toBe('2026-08-14');
    expect(editorFor('Start for Toner / Gloss').value).toBe('11:45');
    expect((screen.getByLabelText('Calendar for Toner / Gloss') as HTMLSelectElement).value).toBe('p1');
    expect(editorFor('Length for Toner / Gloss').value).toBe('30');
    expect(editorFor('Length for Cut & Blow Dry').value).toBe('60');
  });

  describe('moving the visit start', () => {
    it('is checked as a shift of the whole visit, never through the single-booking validate route', async () => {
      renderVisitForm();
      await waitFor(() => expect(visitCalls.length).toBeGreaterThan(0));
      fireEvent.change(startTimeInput(), { target: { value: '14:00' } });
      await waitFor(() => expect(visitCalls.some((c) => c.dry_run === true && c.shift != null && (c.shift as { booking_time?: string }).booking_time === '14:00')).toBe(true));
      const check = visitCalls.find((c) => c.dry_run === true && (c.shift as { booking_time?: string })?.booking_time === '14:00')!;
      expect(check).toEqual({
        dry_run: true,
        // No practitioner_id: a time shift leaves each service on its own calendar.
        shift: { booking_date: '2026-08-14', booking_time: '14:00' },
        allow_outside_hours: true,
      });
      expect(check.total_duration_minutes).toBeUndefined();
      expect(check.services).toBeUndefined();
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes('validate-appointment-modification')),
      ).toBe(false);
      // The services follow, gap included.
      await waitFor(() => expect(screen.getByText('15:45 to 16:15')).toBeInTheDocument());
    });

    it('locks the per-service editors while the start is being moved', async () => {
      renderVisitForm();
      await waitFor(() => expect(screen.getByLabelText(/Start for Olaplex Treatment/i)).toBeInTheDocument());
      expect(editorFor('Start for Olaplex Treatment')).toBeEnabled();
      fireEvent.change(startTimeInput(), { target: { value: '14:00' } });
      await waitFor(() => expect(editorFor('Start for Olaplex Treatment')).toBeDisabled());
      expect(screen.getByText(/Save that first to change one service on its own/i)).toBeInTheDocument();
    });

    it('a calendar chosen for the whole visit rides on the shift', async () => {
      renderVisitForm();
      await waitFor(() => expect(visitCalendarSelect()).toBeInTheDocument());
      fireEvent.change(visitCalendarSelect(), { target: { value: 'p2' } });
      await waitFor(() =>
        expect(visitCalls.some((c) => (c.shift as { practitioner_id?: string })?.practitioner_id === 'p2')).toBe(true),
      );
    });

    it('saves as one shift, deferring the guest notification, and undo names every row as it was', async () => {
      renderVisitForm();
      await waitFor(() => expect(visitCalls.length).toBeGreaterThan(0));
      fireEvent.change(startTimeInput(), { target: { value: '14:00' } });
      await waitFor(() => expect(saveButton()).toBeEnabled());
      fireEvent.click(saveButton());
      await waitFor(() => expect(saveCall()).toBeTruthy());
      expect(saveCall()).toEqual({
        shift: { booking_date: '2026-08-14', booking_time: '14:00' },
        allow_outside_hours: true,
        defer_modification_guest_notification: true,
      });
      // The follow-up panel replaces the form; Undo puts every service back.
      await waitFor(() => expect(screen.getByRole('button', { name: /Undo change/i })).toBeInTheDocument());
      expect(screen.getByText(/Moved from .*10:00.* to .*14:00/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Undo change/i }));
      await waitFor(() => expect(visitCalls.filter((c) => c.dry_run === undefined).length).toBe(2));
      const undo = visitCalls.filter((c) => c.dry_run === undefined)[1]!;
      expect(undo).toEqual({
        services: [
          { booking_id: 'a', booking_date: '2026-08-14', booking_time: '10:00', practitioner_id: 'p1', duration_minutes: 60 },
          { booking_id: 'b', booking_date: '2026-08-14', booking_time: '11:00', practitioner_id: 'p1', duration_minutes: 30 },
          { booking_id: 'c', booking_date: '2026-08-14', booking_time: '11:45', practitioner_id: 'p1', duration_minutes: 30 },
        ],
        known_booking_ids: ['a', 'b', 'c'],
        allow_outside_hours: true,
        allow_manual_overlap: true,
        skip_booking_modification_guest_notification: true,
      });
    });
  });

  describe('changing one service', () => {
    it('is checked through the per-service mode, naming only the service that changed', async () => {
      renderVisitForm();
      await waitFor(() => expect(screen.getByLabelText(/Length for Olaplex Treatment/i)).toBeInTheDocument());
      fireEvent.change(editorFor('Length for Olaplex Treatment'), { target: { value: '45' } });
      await waitFor(() => expect(visitCalls.some((c) => c.services != null)).toBe(true));
      const check = visitCalls.find((c) => c.services != null)!;
      expect(check).toEqual({
        dry_run: true,
        services: [
          { booking_id: 'b', booking_date: '2026-08-14', booking_time: '11:00', practitioner_id: 'p1', duration_minutes: 45 },
        ],
        known_booking_ids: ['a', 'b', 'c'],
        allow_outside_hours: true,
      });
      await waitFor(() => expect(screen.getByText('11:00 to 11:45')).toBeInTheDocument());
    });

    it('locks the visit-start controls while a service is being changed', async () => {
      renderVisitForm();
      await waitFor(() => expect(screen.getByLabelText(/Start for Toner \/ Gloss/i)).toBeInTheDocument());
      fireEvent.change(editorFor('Start for Toner / Gloss'), { target: { value: '15:00' } });
      await waitFor(() => expect(startTimeInput()).toBeDisabled());
      expect(visitCalendarSelect()).toBeDisabled();
      expect(screen.getByText(/the visit start stays put for this save/i)).toBeInTheDocument();
    });

    it('a length change alone saves without deferring a notification, since nothing moved', async () => {
      const onSaved = vi.fn();
      renderVisitForm({ onSaved });
      await waitFor(() => expect(screen.getByLabelText(/Length for Olaplex Treatment/i)).toBeInTheDocument());
      fireEvent.change(editorFor('Length for Olaplex Treatment'), { target: { value: '45' } });
      await waitFor(() => expect(saveButton()).toBeEnabled());
      fireEvent.click(saveButton());
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(saveCall()).toEqual({
        services: [
          { booking_id: 'b', booking_date: '2026-08-14', booking_time: '11:00', practitioner_id: 'p1', duration_minutes: 45 },
        ],
        known_booking_ids: ['a', 'b', 'c'],
        allow_outside_hours: true,
      });
    });

    it('moving one service to another calendar and day defers the notification and offers undo', async () => {
      renderVisitForm();
      await waitFor(() => expect(screen.getByLabelText(/Date for Toner \/ Gloss/i)).toBeInTheDocument());
      fireEvent.change(editorFor('Date for Toner / Gloss'), { target: { value: '2026-08-15' } });
      fireEvent.change(screen.getByLabelText('Calendar for Toner / Gloss'), { target: { value: 'p2' } });
      await waitFor(() => expect(saveButton()).toBeEnabled());
      fireEvent.click(saveButton());
      await waitFor(() => expect(saveCall()).toBeTruthy());
      expect(saveCall()).toEqual({
        services: [
          { booking_id: 'c', booking_date: '2026-08-15', booking_time: '11:45', practitioner_id: 'p2', duration_minutes: 30 },
        ],
        known_booking_ids: ['a', 'b', 'c'],
        allow_outside_hours: true,
        defer_modification_guest_notification: true,
      });
      await waitFor(() => expect(screen.getByRole('button', { name: /Undo change/i })).toBeInTheDocument());
    });

    it('refuses to check a service left without a start', async () => {
      renderVisitForm();
      await waitFor(() => expect(screen.getByLabelText(/Start for Toner \/ Gloss/i)).toBeInTheDocument());
      fireEvent.change(editorFor('Start for Toner / Gloss'), { target: { value: '' } });
      await waitFor(() =>
        expect(screen.getByText(/Give every service a date, a start, a calendar and a length/i)).toBeInTheDocument(),
      );
      expect(saveButton()).toBeDisabled();
    });
  });

  describe('changing which services the visit has', () => {
    it('lists the services as swappable, once the visit says what they are', async () => {
      renderVisitForm();
      await waitFor(() => expect(screen.getByLabelText(/Service 1/i)).toBeInTheDocument());
      expect((screen.getByLabelText(/Service 1/i) as HTMLSelectElement).value).toBe('s1');
      expect((screen.getByLabelText(/Service 2/i) as HTMLSelectElement).value).toBe('s2');
      expect((screen.getByLabelText(/Service 3/i) as HTMLSelectElement).value).toBe('s3');
    });

    it('a swap goes to the services endpoint, carrying the whole list, and locks the editors', async () => {
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
      await waitFor(() => expect(editorFor('Start for Cut & Blow Dry')).toBeDisabled());
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
      expect(sent.known_booking_ids).toEqual(['a', 'b', 'c']);
    });

    it('an added service goes on the end, with no booking of its own yet, and no editor', async () => {
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
      expect(screen.queryByLabelText(/Start for Beard Trim/i)).not.toBeInTheDocument();
    });

    it('refuses to remove the last service, so a visit cannot be emptied by editing', async () => {
      renderVisitForm();
      await waitFor(() => expect(screen.getByLabelText(/Remove Cut & Blow Dry/i)).toBeInTheDocument());
      fireEvent.click(screen.getByLabelText(/Remove Olaplex Treatment/i));
      fireEvent.click(screen.getByLabelText(/Remove Toner \/ Gloss/i));
      await waitFor(() => expect(screen.getByLabelText(/Remove Cut & Blow Dry/i)).toBeDisabled());
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
      expect(visitCalls.every((c) => c.dry_run === true)).toBe(true);
    });
  });

  it('surfaces the endpoint’s refusal and leaves save blocked', async () => {
    mockApi((body) =>
      body.services
        ? { ok: false, json: { error: 'Toner / Gloss cannot go to 16:10: Blocked time. Nothing on this visit was changed.' } }
        : { ok: true, json: plannedVisit(body) },
    );
    renderVisitForm();
    await waitFor(() => expect(screen.getByLabelText(/Start for Toner \/ Gloss/i)).toBeInTheDocument());
    fireEvent.change(editorFor('Start for Toner / Gloss'), { target: { value: '16:10' } });
    await waitFor(() => expect(screen.getByText(/Toner \/ Gloss cannot go to 16:10/i)).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByLabelText(/Duration \(minutes\)/i)).toBeInTheDocument());
    expect(screen.queryByText(/services in this visit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Visit start/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Staff \/ calendar$/i)).toBeInTheDocument();
    expect(visitCalls).toHaveLength(0);
  });
});

describe('StaffAppointmentModifyForm with a cancelled segment (C10)', () => {
  /** The same visit, but the FIRST service was cancelled. */
  const WITH_CANCELLED_FIRST: StaffVisitModifySegment[] = [
    { ...SEGMENTS[0]!, status: 'Cancelled' },
    { ...SEGMENTS[1]!, status: 'Booked' },
    { ...SEGMENTS[2]!, status: 'Booked' },
  ];

  it('anchors the visit start on the first SCHEDULED segment, not a cancelled one', async () => {
    // fetchGroupVisitBookings sends only the group id and the list route drops
    // cancelled rows only for view=calendar, so the cancelled 10:00 row arrives
    // here. The server plans from its own scheduled-only list, which starts at
    // 11:00, and the form must open on the same visit.
    renderVisitForm({ segments: WITH_CANCELLED_FIRST });
    await waitFor(() => expect(startTimeInput().value).toBe('11:00'));
    // The stubbed endpoint still lists the cancelled row; the form gives it no editor.
    expect(screen.queryByLabelText(/Start for Cut & Blow Dry/i)).not.toBeInTheDocument();
  });

  it('still anchors on 10:00 when every segment is scheduled', async () => {
    renderVisitForm({
      segments: [
        { ...SEGMENTS[0]!, status: 'Booked' },
        { ...SEGMENTS[1]!, status: 'Booked' },
        { ...SEGMENTS[2]!, status: 'Booked' },
      ],
    });
    await waitFor(() => expect(startTimeInput().value).toBe('10:00'));
  });

  it('treats a segment with no status as scheduled, so statusless fixtures are unaffected', async () => {
    renderVisitForm({ segments: SEGMENTS });
    await waitFor(() => expect(startTimeInput().value).toBe('10:00'));
  });
});
