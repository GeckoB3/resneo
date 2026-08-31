/**
 * P4-1: the difference between "nothing to complete" and "we could not check".
 *
 * `loadOutstandingBookingFormLinks` answers both with `[]`. For the manage page
 * that is a deliberate trade, and it keeps it. For the portal it is not:
 * rendering nothing is a CLAIM that the customer has nothing to do, and a
 * customer who believes that and actually has an unsigned waiver is turned away
 * at the door.
 *
 * So these tests are almost entirely about the failure paths, which is the
 * opposite of the usual balance and is the point of the task.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadOutstandingBookingFormsChecked,
  loadOutstandingBookingFormLinks,
} from './form-links-service';
import type { SupabaseClient } from '@supabase/supabase-js';

const VENUE = 'venue-1';
const BOOKING = 'booking-1';

/** A client whose terminal `.gt()` resolves to whatever the test supplies. */
function client(result: unknown): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gt: () => Promise.resolve(result),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

/** A client that throws rather than resolving, e.g. the network is gone. */
function throwingClient(): SupabaseClient {
  return {
    from: () => {
      throw new Error('connection refused');
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  // The failure paths log, and a passing suite should not print alarm.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadOutstandingBookingFormsChecked', () => {
  it('reports ok with the forms when the query succeeds', async () => {
    const got = await loadOutstandingBookingFormsChecked(
      client({
        data: [{ code: 'abc', compliance_types: { name: 'Consultation waiver' } }],
        error: null,
      }),
      VENUE,
      BOOKING,
    );
    expect(got.ok).toBe(true);
    expect(got.forms).toHaveLength(1);
    expect(got.forms[0].name).toBe('Consultation waiver');
    expect(got.forms[0].url).toContain('abc');
  });

  it('reports ok with NO forms when there genuinely are none', async () => {
    // The other half of the distinction: empty and true is a real answer.
    const got = await loadOutstandingBookingFormsChecked(
      client({ data: [], error: null }),
      VENUE,
      BOOKING,
    );
    expect(got).toEqual({ ok: true, forms: [] });
  });

  it('reports NOT ok when the query errors', async () => {
    const got = await loadOutstandingBookingFormsChecked(
      client({ data: null, error: { message: 'permission denied' } }),
      VENUE,
      BOOKING,
    );
    expect(got.ok).toBe(false);
    expect(got.forms).toEqual([]);
  });

  it('reports NOT ok when data comes back null with no error', async () => {
    // PostgREST can answer this way, and it is exactly the shape that would
    // otherwise be read as "no forms".
    const got = await loadOutstandingBookingFormsChecked(
      client({ data: null, error: null }),
      VENUE,
      BOOKING,
    );
    expect(got.ok).toBe(false);
  });

  it('reports NOT ok when the client throws', async () => {
    const got = await loadOutstandingBookingFormsChecked(throwingClient(), VENUE, BOOKING);
    expect(got.ok).toBe(false);
    expect(got.forms).toEqual([]);
  });

  it('names an unnamed type "Form" rather than dropping the link', () => {
    // A form the customer must sign is worth showing even if its type row has
    // no name; dropping it would hide an obligation over a cosmetic gap.
    return loadOutstandingBookingFormsChecked(
      client({ data: [{ code: 'xyz', compliance_types: null }], error: null }),
      VENUE,
      BOOKING,
    ).then((got) => {
      expect(got.ok).toBe(true);
      expect(got.forms[0].name).toBe('Form');
    });
  });
});

describe('loadOutstandingBookingFormLinks keeps its old contract', () => {
  it('still returns a bare array on success', async () => {
    const got = await loadOutstandingBookingFormLinks(
      client({ data: [{ code: 'abc', compliance_types: { name: 'Waiver' } }], error: null }),
      VENUE,
      BOOKING,
    );
    expect(got).toEqual([{ name: 'Waiver', url: expect.stringContaining('abc') }]);
  });

  it('still swallows a failure into [], because its callers chose that', async () => {
    /*
      Not an oversight being preserved: the manage page and the confirmation
      email would rather render without the forms section than not render. The
      point of P4-1 is that surfaces which state the ABSENCE as fact now have
      somewhere else to call, not that this behaviour was wrong everywhere.
    */
    expect(await loadOutstandingBookingFormLinks(throwingClient(), VENUE, BOOKING)).toEqual([]);
  });
});
