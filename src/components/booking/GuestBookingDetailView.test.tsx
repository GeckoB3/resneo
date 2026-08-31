/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { BookingDetailDto } from '@/lib/booking/booking-detail-dto';

/**
 * P2-4's acceptance (AD9).
 *
 * The token surface is pinned by
 * `src/app/manage/[bookingId]/[token]/manage-booking-view.render.test.tsx`,
 * taken before the extraction and unchanged by it. This file covers the half
 * that did not exist before: the same component under a SESSION actor, and the
 * structural claims the acceptance makes about the extraction itself.
 */

vi.mock('@/components/booking/AppointmentBookingFlow', () => ({
  AppointmentBookingFlow: () => null,
}));
vi.mock('@/components/booking/GuestResourceModifySlotPicker', () => ({
  GuestResourceModifySlotPicker: () => null,
}));
vi.mock('@/components/booking/GuestClassModifyInstancePicker', () => ({
  GuestClassModifyInstancePicker: () => null,
}));

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';

function baseDetail(overrides: Partial<BookingDetailDto> = {}): BookingDetailDto {
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
    feature_flags: {
      resolved: {
        waitlist_v2: false,
        guest_self_reschedule: true,
        any_available_practitioner: false,
        class_commerce_enabled: false,
        compliance_records_enabled: false,
        card_hold_deposits: false,
        staff_first_booking_flow: false,
      },
    },
    location: { type: 'venue', address: '1 Frozen Street', map_url: 'https://maps.test/1' },
    notes: [],
    ticket_lines: [],
    duration_minutes: 30,
    pre_appointment_instructions: null,
    venue_email: 'hello@frozen.test',
    deposit_status: null,
    cancelled_by: null,
    timeline: [],
    calendar: { google_url: 'https://calendar.test/add', ics: 'BEGIN:VCALENDAR' },
    paid_with_credit: false,
    ...overrides,
  } as BookingDetailDto;
}

type ViewProps = {
  bookingId: string;
  actor: { kind: 'session' } | { kind: 'token'; token: string };
  initialDetail?: BookingDetailDto | null;
  chrome?: 'standalone' | 'embedded';
};
let GuestBookingDetailView: (props: ViewProps) => React.ReactElement | null;

beforeAll(async () => {
  ({ GuestBookingDetailView } = await import('./GuestBookingDetailView'));
}, 120_000);

beforeEach(() => {
  // Nothing should reach the network: a session actor is handed its DTO.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('the session surface must not fetch when handed a detail');
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSession(detail: BookingDetailDto) {
  render(
    <GuestBookingDetailView
      bookingId={BOOKING_ID}
      actor={{ kind: 'session' }}
      initialDetail={detail}
      chrome="embedded"
    />,
  );
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const MODELS: Array<[string, Partial<BookingDetailDto>]> = [
  ['an appointment', {}],
  [
    'a table reservation',
    {
      booking_model: 'table_reservation',
      is_appointment: false,
      practitioner_name: null,
      appointment_service_name: null,
      practitioner_id: null,
      appointment_service_id: null,
      party_size: 4,
    },
  ],
  [
    'a class session',
    {
      booking_model: 'class_session',
      is_appointment: false,
      practitioner_id: null,
      appointment_service_id: null,
      class_summary: 'Reformer Pilates · 2026-06-10 18:30',
      class_type_name: 'Reformer Pilates',
      class_instance_id: '99999999-9999-4999-8999-999999999999',
      class_type_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  ],
  [
    'an event ticket',
    {
      booking_model: 'event_ticket',
      is_appointment: false,
      practitioner_id: null,
      appointment_service_id: null,
      event_name: 'Wine Tasting',
    },
  ],
  [
    'a resource booking',
    {
      booking_model: 'resource_booking',
      is_appointment: false,
      practitioner_id: null,
      appointment_service_id: null,
      resource_name: 'Court 1',
      resource_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    },
  ],
];

describe('the shared view under a session actor', () => {
  for (const [label, overrides] of MODELS) {
    it(`renders ${label}`, () => {
      const text = renderSession(baseDetail(overrides));
      expect(text.length, 'rendered almost nothing').toBeGreaterThan(60);
      expect(text).toContain('Frozen Venue');
      expect(text).toMatchSnapshot();
    });
  }

  it('renders the booking without fetching, because the page already loaded it', () => {
    // The portal resolves ownership server-side and hands the DTO in. A fetch
    // here would mean a spinner on a page that already had the answer, and the
    // stub above turns that into a failure rather than a slow render.
    const text = renderSession(baseDetail());
    expect(text).toContain('Consultation');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('offers both cancel and reschedule', () => {
    /*
      P2-4 left the session actor with no buttons at all, because both posted to
      `/api/confirm` with a token the portal does not hold. P2-2 gave cancel its
      own route and P2-3 gave reschedule one, so both are offered now. This
      assertion has been edited twice, each time as the deliberate change the
      previous task asked for rather than something nobody noticed.
    */
    renderSession(baseDetail());
    expect(screen.getByRole('button', { name: /^cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change appointment/i })).toBeInTheDocument();
  });

  it('offers no reschedule when the venue has turned self-reschedule off', () => {
    // The vacuity guard on the row above, and a real product setting: a venue
    // that switched self-reschedule off must have it off in the portal exactly
    // as it is off on the emailed link.
    renderSession(
      baseDetail({
        feature_flags: { resolved: { guest_self_reschedule: false } },
      } as Partial<BookingDetailDto>),
    );
    expect(screen.queryByRole('button', { name: /change appointment/i })).not.toBeInTheDocument();
  });

  it('says WHY there is no change button when the venue turned it off', () => {
    // Hiding the control on its own leaves a customer hunting for it, deciding
    // the page is broken, and ringing the venue anyway. The point of the flag
    // is that the venue takes the call, not that the page goes quiet.
    const text = renderSession(
      baseDetail({
        feature_flags: { resolved: { guest_self_reschedule: false } },
      } as Partial<BookingDetailDto>),
    );
    expect(text).toMatch(/does not offer changes online/i);
    expect(text).toMatch(/still cancel/i);
  });

  it('warns that changing a course session moves only that session', async () => {
    // A guest who reads "change appointment" as "move my course" and then
    // finds five sessions still in the old slot has been misled by the button.
    renderSession(baseDetail({ part_of_course: true }));
    await userEvent.click(screen.getByRole('button', { name: /change appointment/i }));
    expect(document.body.textContent).toMatch(/only this session/i);
  });

  it('says nothing about courses for a single booking', async () => {
    // The vacuity guard: a warning shown to everyone teaches guests to ignore it.
    renderSession(baseDetail({ part_of_course: false }));
    await userEvent.click(screen.getByRole('button', { name: /change appointment/i }));
    expect(document.body.textContent).not.toMatch(/only this session/i);
  });

  it('attaches every label on the modify form to its control (Register Q-04)', async () => {
    /*
      Three controls had labels that LOOKED right and were not attached, so a
      screen reader announced "edit text, blank" three times. Asserted with
      getByLabelText, which resolves the label the same way assistive tech
      does: a visual check, or querying by placeholder or role, would pass on
      the broken markup.
    */
    renderSession(
      baseDetail({
        booking_model: 'table_reservation',
        is_appointment: false,
        practitioner_id: null,
        appointment_service_id: null,
        party_size: 4,
      }),
    );
    // The time control is a `select` only once slots arrive, so the slots are
    // supplied. Asserting on the label alone would have passed against a `for`
    // pointing at nothing, which is the same silence for a screen reader.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ slots: [{ start_time: '19:00:00', available_covers: 4 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: /modify booking/i }));
    for (const label of ['Date', 'Party size']) {
      expect(screen.getByLabelText(label), `"${label}" is not attached to a control`).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByLabelText('Time')).toBeInTheDocument());
  });

  it('drops the standalone chrome when embedded in the portal', () => {
    renderSession(baseDetail());
    // The portal layout already has a wordmark and a footer; a second of each
    // halfway down the page is what `chrome="embedded"` exists to prevent.
    expect(screen.queryByAltText('ResNeo')).not.toBeInTheDocument();
    expect(screen.queryByText(/powered by resneo/i)).not.toBeInTheDocument();
  });

  it('keeps the standalone chrome by default, which is the token surface', () => {
    render(
      <GuestBookingDetailView
        bookingId={BOOKING_ID}
        actor={{ kind: 'session' }}
        initialDetail={baseDetail()}
      />,
    );
    expect(screen.getByAltText('ResNeo')).toBeInTheDocument();
  });
});

describe('payments on the booking (P4-2)', () => {
  const PAYMENTS = [
    {
      id: 'pay-1',
      booking_id: BOOKING_ID,
      venue_id: 'v-1',
      method: 'card_present',
      status: 'succeeded',
      amount_pence: 4500,
      currency: 'gbp',
      purpose: 'balance',
      created_at: '2026-08-30T10:00:00Z',
    },
  ];

  function renderWith(props: Record<string, unknown>) {
    render(
      <GuestBookingDetailView
        bookingId={BOOKING_ID}
        actor={{ kind: 'session' }}
        initialDetail={baseDetail()}
        chrome="embedded"
        {...props}
      />,
    );
    return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  it('shows the payment in plain words and real money', () => {
    const text = renderWith({ payments: PAYMENTS });
    expect(text).toContain('Payments for this booking');
    expect(text).toContain('Card in person');
    expect(text).toContain('£45.00');
    expect(text, 'the raw enum reached the customer').not.toContain('card_present');
  });

  it('SHOWS NOTHING when the page did not supply payments', () => {
    /*
      The security boundary, asserted from the view's side. The guest
      manage-link page never passes this prop, because that URL is forwardable
      and a payment history is more sensitive than the booking it belongs to.
      A view that invented a fetch of its own would defeat that, so the absence
      of the prop must render nothing at all.
    */
    const text = renderWith({});
    expect(text).not.toContain('Payments for this booking');
    expect(text).not.toContain('£45.00');
  });

  it('names a refund rather than showing it as money paid', () => {
    // A refunded row rendered as a bare figure reads as money the customer
    // handed over and did not get back.
    const text = renderWith({
      payments: [{ ...PAYMENTS[0], status: 'refunded' }],
    });
    expect(text).toContain('Refunded');
  });

  it('says so when the lookup failed, rather than implying nothing was paid', () => {
    const text = renderWith({ payments: [], paymentsFailed: true });
    expect(text).toContain('could not load your payments');
  });

  it('shows the payments rather than the warning when it has both', () => {
    const text = renderWith({ payments: PAYMENTS, paymentsFailed: true });
    expect(text).toContain('£45.00');
    expect(text).not.toContain('could not load your payments');
  });
});

describe('the sections P2-4 completes', () => {
  it('shows what the venue asked the guest to do beforehand (G8a)', () => {
    // The gap: `service_items.pre_appointment_instructions` was written by
    // venues and read by NOTHING in the codebase. A venue typing "please
    // arrive with clean hair" had it stored and shown to nobody.
    const text = renderSession(
      baseDetail({ pre_appointment_instructions: 'Please arrive with clean, dry hair.' }),
    );
    expect(text).toContain('Before your visit');
    expect(text).toContain('Please arrive with clean, dry hair.');
  });

  it('says nothing about preparation when the venue wrote none', () => {
    expect(renderSession(baseDetail())).not.toContain('Before your visit');
  });

  it('tells a venue cancellation apart from the guest’s own (Q-22)', () => {
    // Not cosmetic: the two carry different refund outcomes, and a guest
    // looking at a cancelled booking is living with one of them.
    expect(renderSession(baseDetail({ status: 'Cancelled', cancelled_by: 'venue' }))).toContain(
      'cancelled by the venue',
    );
    cleanup();
    expect(renderSession(baseDetail({ status: 'Cancelled', cancelled_by: 'customer' }))).toContain(
      'You cancelled this booking',
    );
  });

  it('sends a mobile appointment to the customer address, not the venue', () => {
    // The failure this prevents: a page that always printed the venue's
    // address would send a mobile practitioner's client to the wrong place.
    const text = renderSession(
      baseDetail({
        location: {
          type: 'client_address',
          address: '9 Elm Row, Belfast, BT1 1AA',
          map_url: 'https://maps.test/elm',
        },
      }),
    );
    expect(text).toContain('Where (your address)');
    expect(text).toContain('9 Elm Row, Belfast, BT1 1AA');
  });

  it('says an online booking is online rather than printing an address', () => {
    const text = renderSession(
      baseDetail({ location: { type: 'online', address: null, map_url: null } }),
    );
    expect(text).toContain('Online');
    expect(text).not.toContain('Get directions');
  });

  it('does not print the venue address twice', () => {
    // It is already in the card header; a "Where" block repeating it is the
    // same line twice. The directions link is what is actually new.
    const text = renderSession(baseDetail());
    expect(text.match(/1 Frozen Street/g) ?? []).toHaveLength(1);
    expect(text).toContain('Get directions');
  });

  it('breaks down what was bought, and what the guest asked for', () => {
    const text = renderSession(
      baseDetail({
        ticket_lines: [
          { label: 'Adult', quantity: 2, unit_price_pence: 1500 },
          { label: 'Child', quantity: 1, unit_price_pence: 500 },
        ],
        notes: [{ label: 'Special requests', value: 'Window table please' }],
      }),
    );
    expect(text).toContain('2 x Adult');
    expect(text).toContain('30.00');
    expect(text).toContain('Window table please');
  });

  it('offers both calendar formats, built with the venue timezone', () => {
    const text = renderSession(baseDetail());
    expect(text).toContain('Add to Google Calendar');
    expect(text).toContain('Download for other calendars');
  });

  it('offers no calendar entry for a booking that was cancelled', () => {
    const text = renderSession(baseDetail({ status: 'Cancelled', cancelled_by: 'customer' }));
    expect(text).not.toContain('Add to Google Calendar');
  });

  it('gives the guest a way to reach the venue', () => {
    const text = renderSession(baseDetail());
    expect(text).toContain('Contact the venue');
    expect(text).toContain('hello@frozen.test');
  });
});

describe('cancelling from the portal (P2-2)', () => {
  /** Inside the free-cancellation window: the deadline is in the future. */
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  /** Past it: the deadline has gone. */
  const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  /** Opens the dialog and waits for it, since the state update is not sync. */
  async function openCancelDialog(detail: BookingDetailDto) {
    renderSession(detail);
    screen.getByRole('button', { name: /^cancel/i }).click();
    await screen.findByRole('button', { name: 'Yes, cancel' });
    return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  it('offers the action at all, which it did not before P2-2', () => {
    renderSession(baseDetail());
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('states the deadline, and which side of it the guest is on', async () => {
    expect(await openCancelDialog(baseDetail({ cancellation_deadline: future }))).toContain(
      'cancel free of charge until',
    );
    cleanup();
    expect(await openCancelDialog(baseDetail({ cancellation_deadline: past }))).toContain(
      'free cancellation deadline passed',
    );
  });

  it('says whether the deposit comes back, not what the policy is', async () => {
    // The panel this replaced said "full refund if cancelled 24+ hours before"
    // and left the guest to work out whether that was them.
    const inWindow = await openCancelDialog(
      baseDetail({ cancellation_deadline: future, deposit_paid: true, deposit_amount_pence: 2500 }),
    );
    expect(inWindow).toContain('£25.00 deposit will be refunded');
    cleanup();

    const late = await openCancelDialog(
      baseDetail({ cancellation_deadline: past, deposit_paid: true, deposit_amount_pence: 2500 }),
    );
    expect(late).toContain('£25.00 deposit will not be refunded');
  });

  it('states the card-hold fee through the shared formatter', async () => {
    const held = { fee_pence: 1500, state: 'held', charged_pence: null, charged_at: null };
    const late = await openCancelDialog(
      baseDetail({ cancellation_deadline: past, card_hold: held as never }),
    );
    expect(late).toContain('no-show fee of up to £15.00');
    cleanup();

    const inWindow = await openCancelDialog(
      baseDetail({ cancellation_deadline: future, card_hold: held as never }),
    );
    expect(inWindow).toContain('No no-show fee will be charged');
  });

  it('says what happens to a class credit', async () => {
    const asClass = {
      booking_model: 'class_session' as const,
      is_appointment: false,
      paid_with_credit: true,
    };
    expect(await openCancelDialog(baseDetail({ ...asClass, cancellation_deadline: future }))).toContain(
      'class credit will be returned',
    );
    cleanup();
    expect(await openCancelDialog(baseDetail({ ...asClass, cancellation_deadline: past }))).toContain(
      'class credit will not be returned',
    );
  });

  it('says nothing about a credit for a booking no credit paid for', async () => {
    const text = await openCancelDialog(baseDetail({ cancellation_deadline: future }));
    expect(text).not.toContain('class credit');
  });

  it('still says something for a booking with nothing at stake', async () => {
    // No deadline, no deposit, no hold, no credit: the dialog must not be an
    // empty box with a destructive button in it.
    const text = await openCancelDialog(
      baseDetail({ cancellation_deadline: null, deposit_paid: false, card_hold: null }),
    );
    expect(text).toContain('cannot be undone');
  });

  it('posts to the portal route, not to the token surface', async () => {
    // The session actor holds no token, so a post to /api/confirm would be
    // rejected. This is the wiring that makes the shared button work for both.
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(typeof input === 'string' ? input : String(input));
        return { ok: true, status: 200, json: async () => ({ success: true }) } as unknown as Response;
      }),
    );
    renderSession(baseDetail());
    screen.getByRole('button', { name: /^cancel/i }).click();
    // Awaited: opening the dialog is a state update, not a synchronous render.
    (await screen.findByRole('button', { name: 'Yes, cancel' })).click();

    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toContain(`/api/account/bookings/${BOOKING_ID}/cancel`);
    expect(calls[0]).not.toContain('/api/confirm');
  });
});

describe('the extraction itself (P2-4 acceptance)', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

  it('ManageBookingView contains no JSX beyond mounting the shared component', () => {
    const src = read('src/app/manage/[bookingId]/[token]/ManageBookingView.tsx');
    const elements = [...src.matchAll(/<([A-Za-z][\w.]*)[\s/>]/g)].map((m) => m[1]);
    expect(elements, 'the token surface still renders markup of its own').toEqual([
      'GuestBookingDetailView',
    ]);
  });

  it('both surfaces mount the same component', () => {
    for (const file of [
      'src/app/manage/[bookingId]/[token]/ManageBookingView.tsx',
      'src/app/account/bookings/[bookingId]/page.tsx',
    ]) {
      expect(read(file), `${file} should render the shared view`).toContain(
        'GuestBookingDetailView',
      );
    }
  });

  it('the DTO type is declared in exactly one place', () => {
    // The view carried its own `interface BookingDetails` describing the same
    // payload the route returns. Two declarations of one shape is how a field
    // gets added to the route and stays undefined in the view.
    const declarations: string[] = [];
    for (const file of [
      'src/components/booking/GuestBookingDetailView.tsx',
      'src/lib/booking/booking-detail-dto.ts',
      'src/app/account/bookings/[bookingId]/page.tsx',
    ]) {
      const src = read(file);
      for (const m of src.matchAll(/interface\s+(BookingDetail\w*|BookingDetails)\s*\{/g)) {
        declarations.push(`${file}: ${m[1]}`);
      }
    }
    expect(declarations).toEqual([
      'src/lib/booking/booking-detail-dto.ts: BookingDetailDto',
      'src/lib/booking/booking-detail-dto.ts: BookingDetailSourceRow',
    ]);
  });

  it('the account page no longer renders a second telling of the policy', () => {
    // It had 280 lines rendering the cancellation window, the deposit state and
    // the card-hold terms itself. That is the copy AD9 exists to have in one
    // place, so the page should be a loader now, not a renderer.
    const src = read('src/app/account/bookings/[bookingId]/page.tsx');
    expect(src.split('\n').length, 'the page grew a rendering again').toBeLessThan(100);
    for (const gone of ['formatCardHoldFeePence', 'deriveGuestCardHoldSummary', 'SectionCard']) {
      expect(src, `${gone} is policy rendering that belongs in the shared view`).not.toContain(gone);
    }
  });
});
