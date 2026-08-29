/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * `ManageBookingView`, frozen as it renders (P2-4's second gate).
 *
 * The same reasoning as `characterisation/detail.test.ts`, one layer up. AD9
 * extracts this 1,133-line component so `/manage` and the portal render one
 * surface instead of two, and the copy it renders is the cancellation and
 * refund POLICY the guest is being asked to accept. Moving that with nothing
 * able to say whether a line changed is how a refund promise quietly becomes a
 * different refund promise.
 *
 * So: one snapshot of the rendered text per booking model, plus the states that
 * are not the happy path, taken BEFORE the extraction. The gate is that the
 * extraction lands with zero modified snapshots.
 *
 * Text, not markup. `toMatchSnapshot` over the DOM would churn on every class
 * name and make a real copy change hard to see in the diff; the point here is
 * what the guest READS, and the extraction is expected to move markup around.
 */

const hoisted = vi.hoisted(() => ({
  detail: null as Record<string, unknown> | null,
  status: 200,
  error: 'Invalid link',
}));

vi.mock('@/components/booking/AppointmentBookingFlow', () => ({
  // Mounted only behind "Reschedule"; stubbed so the 5,903-line flow and Stripe
  // do not load into every row of this suite.
  AppointmentBookingFlow: () => null,
}));
vi.mock('@/components/booking/GuestResourceModifySlotPicker', () => ({
  GuestResourceModifySlotPicker: () => null,
}));
vi.mock('@/components/booking/GuestClassModifyInstancePicker', () => ({
  GuestClassModifyInstancePicker: () => null,
}));

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';

/** The DTO shape `GET /api/confirm` returns, which is now the shared payload. */
function baseDetail(overrides: Record<string, unknown> = {}) {
  return {
    booking_id: BOOKING_ID,
    venue_id: '22222222-2222-4222-8222-222222222222',
    venue_name: 'Frozen Venue',
    venue_address: '1 Frozen Street',
    venue_phone: '+44 20 7946 0000',
    booking_date: '2026-06-10',
    booking_time: '14:00',
    party_size: 1,
    deposit_paid: false,
    deposit_amount_pence: null,
    card_hold: null,
    status: 'Booked',
    booking_model: 'unified_scheduling',
    is_appointment: true,
    practitioner_id: '44444444-4444-4444-8444-444444444444',
    appointment_service_id: '55555555-5555-4555-8555-555555555555',
    practitioner_name: 'Alex Practitioner',
    appointment_service_name: 'Consultation',
    event_name: null,
    class_summary: null,
    class_type_name: null,
    resource_id: null,
    class_instance_id: null,
    class_type_id: null,
    resource_name: null,
    booking_end_time: '14:30',
    cancellation_deadline: '2026-06-08T13:00:00+00:00',
    refund_notice_hours: 24,
    guest_attendance_confirmed_at: null,
    venue_public: null,
    manage_booking_url: 'https://rsn.test/b/ABC123',
    compliance_forms: [],
    feature_flags: { resolved: { guest_self_reschedule: true } },
    ...overrides,
  };
}

function installApi() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    void input;
    if (hoisted.status !== 200) {
      return {
        ok: false,
        status: hoisted.status,
        json: async () => ({ error: hoisted.error }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => hoisted.detail } as unknown as Response;
  });
}

/** What the guest reads, with layout whitespace collapsed. */
function visibleText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Typed loosely on purpose: the component may return null while loading. */
let ManageBookingView: (props: {
  bookingId: string;
  token?: string;
  hmac?: string;
}) => React.ReactElement | null;

beforeAll(async () => {
  ({ ManageBookingView } = await import('./ManageBookingView'));
}, 120_000);

beforeEach(() => {
  hoisted.status = 200;
  hoisted.error = 'Invalid link';
  installApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderDetail(detail: Record<string, unknown> | null, props?: { hmac?: string }) {
  hoisted.detail = detail;
  render(<ManageBookingView bookingId={BOOKING_ID} token="raw-token" {...(props ?? {})} />);
  // Wait for the fetch to resolve; the spinner is what is on screen before it.
  await waitFor(() => expect(document.querySelector('[data-testid="brand-spinner"]')).toBeNull(), {
    timeout: 5000,
  }).catch(() => undefined);
  await waitFor(() => expect(visibleText().length).toBeGreaterThan(20));
  return visibleText();
}

describe('ManageBookingView renders (P2-4 gate)', () => {
  it('an appointment shows its service, staff, and the policy copy', async () => {
    const text = await renderDetail(baseDetail());
    // The fields that decide the whole appointment branch.
    expect(text).toContain('Frozen Venue');
    expect(text).toContain('Consultation');
    expect(text).toContain('Alex Practitioner');
    expect(text).toMatchSnapshot();
  });

  it('a table reservation shows guests rather than a service', async () => {
    const text = await renderDetail(
      baseDetail({
        booking_model: 'table_reservation',
        is_appointment: false,
        practitioner_name: null,
        appointment_service_name: null,
        practitioner_id: null,
        appointment_service_id: null,
        party_size: 4,
      }),
    );
    expect(text).toContain('Frozen Venue');
    expect(text).toMatchSnapshot();
  });

  it('a class session shows its summary', async () => {
    const text = await renderDetail(
      baseDetail({
        booking_model: 'class_session',
        is_appointment: false,
        practitioner_name: null,
        appointment_service_name: null,
        practitioner_id: null,
        appointment_service_id: null,
        class_summary: 'Reformer Pilates · 2026-06-10 18:30',
        class_type_name: 'Reformer Pilates',
        class_instance_id: '99999999-9999-4999-8999-999999999999',
        class_type_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    );
    expect(text).toContain('Reformer Pilates');
    expect(text).toMatchSnapshot();
  });

  it('an event ticket shows the event name', async () => {
    const text = await renderDetail(
      baseDetail({
        booking_model: 'event_ticket',
        is_appointment: false,
        practitioner_name: null,
        appointment_service_name: null,
        practitioner_id: null,
        appointment_service_id: null,
        event_name: 'Wine Tasting',
      }),
    );
    expect(text).toContain('Wine Tasting');
    expect(text).toMatchSnapshot();
  });

  it('a resource booking shows the resource', async () => {
    const text = await renderDetail(
      baseDetail({
        booking_model: 'resource_booking',
        is_appointment: false,
        practitioner_name: null,
        appointment_service_name: null,
        practitioner_id: null,
        appointment_service_id: null,
        resource_name: 'Court 1',
        resource_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    );
    expect(text).toContain('Court 1');
    expect(text).toMatchSnapshot();
  });

  it('outstanding forms are named, with a link each', async () => {
    const text = await renderDetail(
      baseDetail({
        compliance_forms: [{ name: 'Consultation form', url: 'https://forms.test/1' }],
      }),
    );
    expect(text).toContain('Consultation form');
    expect(text).toMatchSnapshot();
  });

  it('a paid deposit is stated with its amount', async () => {
    const text = await renderDetail(baseDetail({ deposit_paid: true, deposit_amount_pence: 2500 }));
    expect(text).toContain('25.00');
    expect(text).toMatchSnapshot();
  });

  it('a held card states the fee and what would charge it', async () => {
    // The policy copy that matters most: a guest is being told what happens to
    // their money. This is the snapshot the extraction must not move.
    const text = await renderDetail(
      baseDetail({
        card_hold: { fee_pence: 1500, state: 'held', charged_pence: null, charged_at: null },
      }),
    );
    expect(text).toMatchSnapshot();
  });

  it('a card awaiting details offers the payment link', async () => {
    const text = await renderDetail(
      baseDetail({
        card_hold: {
          fee_pence: 1500,
          state: 'awaiting_card',
          charged_pence: null,
          charged_at: null,
          payment_link: 'https://rsn.test/p/PAY123',
        },
      }),
    );
    expect(text).toMatchSnapshot();
  });

  it('a venue with self-reschedule off does not offer the change', async () => {
    const text = await renderDetail(
      baseDetail({ feature_flags: { resolved: { guest_self_reschedule: false } } }),
    );
    expect(text).toMatchSnapshot();
  });

  it('a used link explains itself and offers a new one', async () => {
    hoisted.status = 410;
    hoisted.error = 'This link has already been used';
    render(<ManageBookingView bookingId={BOOKING_ID} token="raw-token" />);
    await waitFor(() => expect(screen.getByText(/already used/i)).toBeInTheDocument());
    expect(visibleText()).toMatchSnapshot();
  });

  it('an expired link explains itself', async () => {
    hoisted.status = 400;
    hoisted.error = 'This link has expired';
    render(<ManageBookingView bookingId={BOOKING_ID} token="raw-token" />);
    // `getAllByText`: the card says "expired" in both its heading and its
    // explanation, which is the copy working rather than a duplicate.
    await waitFor(() => expect(screen.getAllByText(/expired/i).length).toBeGreaterThan(0));
    expect(visibleText()).toMatchSnapshot();
  });

  it('a booking that does not exist says so', async () => {
    hoisted.status = 404;
    hoisted.error = 'Booking not found';
    render(<ManageBookingView bookingId={BOOKING_ID} token="raw-token" />);
    await waitFor(() => expect(visibleText().length).toBeGreaterThan(20));
    expect(visibleText()).toMatchSnapshot();
  });

  it('the suite reads real copy, not an empty shell', async () => {
    /*
      Guards the failure that would make every snapshot above meaningless: a
      render that produced nothing would still snapshot cleanly.

      The bar is deliberately low and the content assertions do the real work.
      This started at 200 characters, on a guess, and failed at 163 on a render
      that was entirely correct: a booking with no deposit, no forms and no card
      hold IS that short. The guess was the bug, so the length check is now only
      a floor against an empty shell and the affordances below are what say the
      view actually works.
    */
    const text = await renderDetail(baseDetail());
    expect(text.length, 'the view rendered almost nothing').toBeGreaterThan(100);
    expect(text).toContain('Frozen Venue');
    expect(text, 'no way to cancel').toMatch(/cancel/i);
    expect(text, 'no way to change the booking').toMatch(/change/i);
  });
});
