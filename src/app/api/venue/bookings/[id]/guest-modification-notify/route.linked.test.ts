import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })),
}));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/linked-accounts/queries', () => ({ resolveCallerGrantOverVenue: vi.fn() }));
vi.mock('@/lib/booking/send-booking-modification-guest-notification', () => ({
  executeBookingModificationGuestNotification: vi.fn(async () => ({ emailSent: true, smsSent: false, skipped: false })),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { executeBookingModificationGuestNotification } from '@/lib/booking/send-booking-modification-guest-notification';
import { POST } from './route';

const CALLER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const BOOKING = '33333333-3333-4333-8333-333333333333';
const CALENDAR = '44444444-4444-4444-8444-444444444444';

/** The staff client `loadStaffAccessibleBooking` reads the booking through. */
function staffDbWithBooking(venueId: string | null) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: chain,
    eq: chain,
    maybeSingle: async () => ({
      data: venueId
        ? { id: BOOKING, venue_id: venueId, guest_id: 'guest-1', status: 'confirmed', calendar_id: CALENDAR }
        : null,
    }),
  });
  return { from: () => builder };
}

const admin = { tag: 'admin-client' } as unknown as ReturnType<typeof getSupabaseAdminClient>;

function signInAs(db: ReturnType<typeof staffDbWithBooking>) {
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 'staff-1', venue_id: CALLER, email: 'a@b.c', role: 'admin', db } as never);
}

async function call() {
  const res = await POST(
    new NextRequest(`https://resneo.test/api/venue/bookings/${BOOKING}/guest-modification-notify`, { method: 'POST' }),
    { params: Promise.resolve({ id: BOOKING }) },
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSupabaseAdminClient).mockReturnValue(admin);
});

/**
 * R26: the deferred "Notify the customer" after a drag move on a linked venue's column.
 * The PATCH that deferred the message accepts a linked booking through the link's edit
 * grant; this route answered 404 for the same booking, so a linked move never emailed the
 * guest and the follow-up bar's Notify button failed.
 */
describe('POST /api/venue/bookings/[id]/guest-modification-notify across a link', () => {
  it('sends for a partner booking when the link carries an edit grant, as the OWNER venue', async () => {
    signInAs(staffDbWithBooking(OWNER));
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue({
      linkId: 'link-1',
      grant: { calendar: 'full_details', pii: true, act: 'edit_existing' },
    } as never);

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, emailSent: true, smsSent: false, skipped: false });
    // The message is the owner venue's: its templates, channels and sender details.
    expect(vi.mocked(executeBookingModificationGuestNotification)).toHaveBeenCalledWith(admin, OWNER, BOOKING);
  });

  it('refuses a view-only link with the messaging 403, without sending', async () => {
    signInAs(staffDbWithBooking(OWNER));
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue({
      linkId: 'link-1',
      grant: { calendar: 'full_details', pii: true, act: 'none' },
    } as never);

    const { status, body } = await call();
    expect(status).toBe(403);
    expect(body.error).toMatch(/does not allow messaging guests/);
    expect(vi.mocked(executeBookingModificationGuestNotification)).not.toHaveBeenCalled();
  });

  it('refuses when the link is scoped to other calendars', async () => {
    signInAs(staffDbWithBooking(OWNER));
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue({
      linkId: 'link-1',
      grant: { calendar: 'full_details', pii: true, act: 'edit_existing', calendarIds: ['55555555-5555-4555-8555-555555555555'] },
    } as never);

    const { status, body } = await call();
    expect(status).toBe(403);
    expect(body.error).toBe('This link does not include that calendar.');
    expect(vi.mocked(executeBookingModificationGuestNotification)).not.toHaveBeenCalled();
  });

  it('refuses a booking on a venue the caller is not linked with', async () => {
    signInAs(staffDbWithBooking(OWNER));
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(null as never);

    const { status, body } = await call();
    expect(status).toBe(403);
    expect(body.error).toBe('You do not have access to this booking.');
    expect(vi.mocked(executeBookingModificationGuestNotification)).not.toHaveBeenCalled();
  });

  it("still sends the caller's own booking as before, without consulting any link", async () => {
    signInAs(staffDbWithBooking(CALLER));

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, emailSent: true, smsSent: false, skipped: false });
    expect(vi.mocked(executeBookingModificationGuestNotification)).toHaveBeenCalledWith(admin, CALLER, BOOKING);
    expect(vi.mocked(resolveCallerGrantOverVenue)).not.toHaveBeenCalled();
  });

  it('answers 404 for a booking that does not exist', async () => {
    signInAs(staffDbWithBooking(null));

    const { status, body } = await call();
    expect(status).toBe(404);
    expect(body.error).toBe('Booking not found');
    expect(vi.mocked(executeBookingModificationGuestNotification)).not.toHaveBeenCalled();
  });

  it('answers the bare 401 when the request resolves to no staff', async () => {
    vi.mocked(getVenueStaff).mockResolvedValue(null as never);

    const { status, body } = await call();
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorised' });
  });
});
