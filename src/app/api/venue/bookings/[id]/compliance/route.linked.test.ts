import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })),
}));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/linked-accounts/queries', () => ({ resolveCallerGrantOverVenue: vi.fn() }));
vi.mock('@/lib/linked-accounts/audit', () => ({ recordReadAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/compliance/auth', () => ({ requireCompliancePlanForVenue: vi.fn(async () => ({ ok: true, ctx: {} })) }));
vi.mock('@/lib/compliance/resolve-requirements', () => ({
  bookingDatetime: () => new Date('2026-09-04T09:30:00Z'),
  loadAndResolveServiceRequirements: vi.fn(async () => ({ applicable: true, resolved: [] })),
}));
vi.mock('@/lib/compliance/records-service', () => ({
  listComplianceRecords: vi.fn(async () => [{ id: 'rec-1' }]),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { recordReadAudit } from '@/lib/linked-accounts/audit';
import { requireCompliancePlanForVenue } from '@/lib/compliance/auth';
import { listComplianceRecords } from '@/lib/compliance/records-service';
import { GET } from './route';

const CALLER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const BOOKING = '33333333-3333-4333-8333-333333333333';

function adminWithBooking(venueId: string | null) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: chain,
    eq: chain,
    maybeSingle: async () => ({
      data: venueId
        ? { id: BOOKING, venue_id: venueId, guest_id: 'guest-1', booking_date: '2026-09-04', booking_time: '09:30', appointment_service_id: null, service_item_id: 'svc-1' }
        : null,
    }),
  });
  return { from: () => builder } as unknown as ReturnType<typeof getSupabaseAdminClient>;
}

const staffDb = { tag: 'staff-db' } as unknown as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 'staff-1', venue_id: CALLER, email: 'a@b.c', role: 'admin', db: staffDb } as never);
});

async function call() {
  const res = await GET(new NextRequest(`https://resneo.test/api/venue/bookings/${BOOKING}/compliance`), { params: { id: BOOKING } });
  return { status: res.status, body: await res.json() };
}

/**
 * The reported case: a booking on a linked venue's diary column opened in the
 * detail panel, and its Compliance tab said "Couldn't load compliance details"
 * because this route filtered the booking on the caller's own venue.
 */
describe('GET /api/venue/bookings/[id]/compliance across a link', () => {
  it('serves the owner venue records, read through the link, and audits the read', async () => {
    const admin = adminWithBooking(OWNER);
    vi.mocked(getSupabaseAdminClient).mockReturnValue(admin);
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue({ linkId: 'link-1', grant: { calendar: 'full_details', pii: true, act: 'none' } } as never);

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toMatchObject({ applicable: true, records: [{ id: 'rec-1' }], linked: true });
    // Gated on, and read from, the OWNER venue, with the admin client.
    expect(vi.mocked(requireCompliancePlanForVenue)).toHaveBeenCalledWith(admin, OWNER);
    expect(vi.mocked(listComplianceRecords)).toHaveBeenCalledWith(admin, OWNER, { guestId: 'guest-1' });
    expect(vi.mocked(recordReadAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ linkId: 'link-1', actingVenueId: CALLER, owningVenueId: OWNER, actionType: 'viewed_booking', resourceId: BOOKING }),
    );
  });

  it('refuses when the link does not share personal data, even with full details', async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(adminWithBooking(OWNER));
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue({ linkId: 'link-1', grant: { calendar: 'full_details', pii: false, act: 'none' } } as never);
    const { status, body } = await call();
    expect(status).toBe(403);
    expect(body.code).toBe('linked_no_pii');
    expect(vi.mocked(listComplianceRecords)).not.toHaveBeenCalled();
    expect(vi.mocked(recordReadAudit)).not.toHaveBeenCalled();
  });

  it('refuses when there is no usable link at all', async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(adminWithBooking(OWNER));
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(null);
    expect((await call()).status).toBe(403);
  });

  it('still reads an own-venue booking with the staff client and no audit', async () => {
    const admin = adminWithBooking(CALLER);
    vi.mocked(getSupabaseAdminClient).mockReturnValue(admin);
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.linked).toBe(false);
    expect(vi.mocked(resolveCallerGrantOverVenue)).not.toHaveBeenCalled();
    expect(vi.mocked(recordReadAudit)).not.toHaveBeenCalled();
    expect(vi.mocked(listComplianceRecords)).toHaveBeenCalledWith(staffDb, CALLER, { guestId: 'guest-1' });
  });

  it('is 404 for a booking that does not exist', async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(adminWithBooking(null));
    expect((await call()).status).toBe(404);
  });
});
