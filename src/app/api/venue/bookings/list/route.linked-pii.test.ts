import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * H36 — the linked guest-history and session branches redacted the guest's
 * name, email and phone and stopped there, leaving the booking row's own free
 * text untouched. `special_requests`, `internal_notes`, `dietary_notes` and
 * `occasion` are all in `BOOKING_PII_FIELDS`: the first three are
 * client-authored and routinely carry names, dietary notes carry health and
 * religious information, and `internal_notes` is the host venue's private staff
 * commentary. So a partner holding `full_details` WITHOUT the PII grant read
 * all of it.
 *
 * Same shape as C6 on `/summary`: a derived object redacted while the row it
 * was derived from went out beside it.
 *
 * THREE THINGS THIS ROUTE NEEDS BEFORE THE LINKED BRANCH RUNS AT ALL, each of
 * which silently yields an ordinary own-venue response instead — a test that
 * misses one passes while proving nothing:
 *
 *   1. the guest parameter is `guest`, not `guest_id`;
 *   2. `guest_history=1` is not sufficient on its own; the `guest` uuid must be
 *      present and must satisfy the route's uuid regex (versions 1-5, RFC
 *      variant), so a placeholder like `...g1` is rejected for the `g`;
 *   3. `resolveCallerGrantOverVenue` is exported from
 *      `@/lib/linked-accounts/queries`, not `.../permissions`.
 *
 * The first assertion below checks the row exists before checking its contents,
 * so a future harness slip fails loudly rather than passing vacuously.
 */

const OWN_VENUE = '00000000-0000-4000-8000-00000000aaaa';
const OWNER_VENUE = '00000000-0000-4000-8000-00000000bbbb';
const GUEST_ID = '00000000-0000-4000-8000-0000000000d1';

const BOOKING = {
  id: '00000000-0000-4000-8000-0000000000b9',
  booking_date: '2026-08-09',
  booking_time: '11:00:00',
  booking_end_time: '11:30:00',
  party_size: 1,
  status: 'Confirmed',
  source: 'online',
  deposit_status: 'none',
  deposit_amount_pence: null,
  estimated_end_time: null,
  guest_id: GUEST_ID,
  guest_first_name: 'Ann',
  guest_last_name: 'Lee',
  special_requests: 'Wheelchair access please',
  internal_notes: 'Difficult client, do not rebook',
  dietary_notes: 'Coeliac',
  occasion: 'Birthday',
  booking_model: 'unified_scheduling',
  calendar_id: '00000000-0000-4000-8000-0000000000c1',
};

/** Chainable stub: every filter returns itself, awaiting yields the table's rows. */
function stubDb(rows: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const result = { data: rows[table] ?? [], error: null };
      const b: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      for (const m of ['select', 'eq', 'neq', 'in', 'or', 'gte', 'lte', 'order', 'limit', 'not', 'is']) {
        b[m] = () => b;
      }
      b.maybeSingle = async () => ({ data: null, error: null });
      return b as never;
    },
  };
}

const db = stubDb({ bookings: [BOOKING] });

/** What the caller's link over the owner venue grants; null means no link at all. */
let grant: { calendar: string; pii: boolean; act: string } | null = null;

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: async () => ({}) as never,
}));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: async () => ({
    id: 'staff-1',
    venue_id: OWN_VENUE,
    email: 'staff@example.com',
    role: 'owner',
    db,
  }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => db }));
vi.mock('@/lib/linked-accounts/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/linked-accounts/queries')>()),
  resolveCallerGrantOverVenue: async () => (grant ? { grant, linkId: 'link-1' } : null),
}));

const { GET } = await import('./route');

async function fetchRow(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/venue/bookings/list?${qs}`));
  const json = (await res.json()) as { bookings?: Array<Record<string, unknown>> };
  return { status: res.status, row: (json.bookings ?? []).find((b) => b.id === BOOKING.id) };
}

const LINKED_QS = `date=2026-08-09&owner_venue_id=${OWNER_VENUE}&guest_history=1&guest=${GUEST_ID}`;

describe('GET /api/venue/bookings/list — linked-venue PII (H36)', () => {
  it('withholds the booking row’s free text from a link without the PII grant', async () => {
    grant = { calendar: 'full_details', pii: false, act: 'none' };
    const { status, row } = await fetchRow(LINKED_QS);

    expect(status).toBe(200);
    expect(row, 'linked branch did not run — see the three traps in this file’s header').toBeDefined();

    // The half that already worked.
    expect(row?.guest_first_name).toBeNull();
    expect(row?.guest_last_name).toBeNull();
    // The half that did not: the booking row's own copy of the client's details.
    expect(row?.special_requests).toBeNull();
    expect(row?.internal_notes).toBeNull();
    expect(row?.dietary_notes).toBeNull();
    expect(row?.occasion).toBeNull();

    // Operational fields must survive, or the linked list cannot render at all.
    expect(row?.status).toBe('Confirmed');
    expect(row?.booking_date).toBe('2026-08-09');
  });

  it('serves the free text to a link that does hold the PII grant', async () => {
    grant = { calendar: 'full_details', pii: true, act: 'none' };
    const { row } = await fetchRow(LINKED_QS);

    expect(row?.special_requests).toBe('Wheelchair access please');
    expect(row?.internal_notes).toBe('Difficult client, do not rebook');
    expect(row?.dietary_notes).toBe('Coeliac');
    expect(row?.guest_first_name).toBe('Ann');
  });

  it('refuses a time_only link outright, before any redaction question arises', async () => {
    grant = { calendar: 'time_only', pii: false, act: 'none' };
    const { status } = await fetchRow(LINKED_QS);
    expect(status).toBe(403);
  });

  it('never redacts a venue reading its own bookings', async () => {
    grant = null;
    const { row } = await fetchRow('date=2026-08-09');

    expect(row?.special_requests).toBe('Wheelchair access please');
    expect(row?.internal_notes).toBe('Difficult client, do not rebook');
    expect(row?.guest_first_name).toBe('Ann');
  });
});
