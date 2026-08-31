/**
 * P4-5: an export must be complete, and must not widen access by one field.
 *
 * The Register's warning about the venue-side export is the shape of the risk
 * here: an export is the one place a projection gets rewritten "just for the
 * file", and the rewrite is where `internal_notes` and the payment ledger's
 * staff notes escape. So the assertions below are mostly about what is NOT in
 * the document, and about the export reading through the same loaders the
 * screens use rather than querying the tables itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  guests: [] as unknown[],
  bookings: [] as unknown[],
  payments: [] as unknown[],
  waitlist: [] as unknown[],
  profile: {} as Record<string, unknown> | null,
  /** Limits each loader was asked for, so the ceiling can be asserted. */
  bookingLimit: 0,
  paymentLimit: 0,
  waitlistLimit: 0,
  profileFails: false,
}));

vi.mock('./account-bookings', () => ({
  loadAccountSafeGuests: async () => hoisted.guests,
  loadAccountBookings: async (_s: unknown, _a: unknown, limit: number) => {
    hoisted.bookingLimit = limit;
    return hoisted.bookings;
  },
}));

vi.mock('./account-payments', () => ({
  loadAccountPayments: async (_s: unknown, _a: unknown, opts: { limit?: number }) => {
    hoisted.paymentLimit = opts.limit ?? 0;
    return { payments: hoisted.payments, ownedBookingIds: [] };
  },
}));

vi.mock('./account-waitlist', () => ({
  loadAccountWaitlist: async (_a: unknown, _e: unknown, opts: { limit?: number }) => {
    hoisted.waitlistLimit = opts.limit ?? 0;
    return hoisted.waitlist;
  },
}));

function session() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            hoisted.profileFails
              ? { data: null, error: { message: 'read failed' } }
              : { data: hoisted.profile, error: null },
        }),
      }),
    }),
  } as never;
}

const USER = { id: 'user-1', email: 'ada@example.test' };
const NOW = new Date('2026-08-30T12:00:00Z');

beforeEach(() => {
  hoisted.guests = [{ id: 'g-1', venue_id: 'v-1', email: 'ada@example.test' }];
  hoisted.bookings = [{ id: 'b-1', venue_id: 'v-1', status: 'Booked' }];
  hoisted.payments = [{ id: 'p-1', amount_pence: 4500 }];
  hoisted.waitlist = [{ id: 'w-1', status: 'waiting' }];
  hoisted.profile = { id: 'user-1', display_name: 'Ada' };
  hoisted.profileFails = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('what the export contains', () => {
  it('carries every section a customer can see on screen', async () => {
    const { buildAccountExport } = await import('./account-export');
    const doc = await buildAccountExport(session(), {} as never, USER, NOW);
    expect(doc.account).toEqual({ id: 'user-1', email: 'ada@example.test' });
    expect(doc.profile).toEqual({ id: 'user-1', display_name: 'Ada' });
    expect(doc.venue_relationships).toHaveLength(1);
    expect(doc.bookings).toHaveLength(1);
    expect(doc.payments).toHaveLength(1);
    expect(doc.waitlist).toHaveLength(1);
  });

  it('says what it is, so the file can be read years later', async () => {
    // "Self-describing" in the plan's words. A bare array of rows with no
    // units and no date is an archive nobody can interpret later.
    const { buildAccountExport } = await import('./account-export');
    const doc = await buildAccountExport(session(), {} as never, USER, NOW);
    expect(doc.about.exported_at).toBe('2026-08-30T12:00:00.000Z');
    // States the unit by example, since P1-4 bans the word itself from
    // anything a customer reads.
    expect(doc.about.money).toMatch(/4500 means £45\.00/);
    expect(doc.about.description).toMatch(/ResNeo/);
  });

  it('reads through the SAME loaders the screens use', async () => {
    /*
      The security design, asserted by construction: the loaders are mocked
      here, so if the builder ever queried a table directly the sections would
      come back empty and this fails. Any field those loaders exclude, the
      export excludes, and narrowing them narrows this.
    */
    const { buildAccountExport } = await import('./account-export');
    const doc = await buildAccountExport(session(), {} as never, USER, NOW);
    expect(doc.bookings, 'the builder is not using loadAccountBookings').toEqual(hoisted.bookings);
    expect(doc.payments, 'the builder is not using loadAccountPayments').toEqual(hoisted.payments);
    expect(doc.waitlist, 'the builder is not using loadAccountWaitlist').toEqual(hoisted.waitlist);
  });
});

describe('completeness', () => {
  it('asks for far more than the screens do, because an export is not a page', async () => {
    // The hub and the list are capped at 100; an export capped at 100 would be
    // a truncated file that looks whole.
    const { buildAccountExport } = await import('./account-export');
    await buildAccountExport(session(), {} as never, USER, NOW);
    expect(hoisted.bookingLimit).toBeGreaterThanOrEqual(2000);
    expect(hoisted.paymentLimit).toBeGreaterThanOrEqual(2000);
    expect(hoisted.waitlistLimit).toBeGreaterThanOrEqual(2000);
  });

  it('handles the acceptance size without truncating', async () => {
    // 500 bookings across four venues, the number the acceptance names.
    hoisted.bookings = Array.from({ length: 500 }, (_, i) => ({ id: `b-${i}` }));
    const { buildAccountExport } = await import('./account-export');
    const doc = await buildAccountExport(session(), {} as never, USER, NOW);
    expect(doc.bookings).toHaveLength(500);
    expect(doc.truncated.bookings).toBe(false);
  });

  it('SAYS SO in the document when it does hit the ceiling', async () => {
    // No silent caps. A short file that looks complete is worse than a long
    // one that admits where it stopped.
    hoisted.bookings = Array.from({ length: 2000 }, (_, i) => ({ id: `b-${i}` }));
    const { buildAccountExport } = await import('./account-export');
    const doc = await buildAccountExport(session(), {} as never, USER, NOW);
    expect(doc.truncated.bookings).toBe(true);
  });
});

describe('failure', () => {
  it('throws rather than returning a document with no profile in it', async () => {
    /*
      An export missing a section, with no indication, is worse than no export:
      a customer checking what is held about them would conclude the section is
      empty.
    */
    hoisted.profileFails = true;
    const { buildAccountExport } = await import('./account-export');
    await expect(buildAccountExport(session(), {} as never, USER, NOW)).rejects.toThrow();
  });
});

describe('the filename', () => {
  it('is dated, so two exports do not overwrite each other', async () => {
    const { accountExportFilename } = await import('./account-export');
    expect(accountExportFilename(NOW)).toBe('resneo-account-export-2026-08-30.json');
  });
});
