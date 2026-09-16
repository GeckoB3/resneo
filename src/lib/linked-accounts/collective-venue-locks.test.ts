/**
 * Settings a collective depends on (TERMS-15, BM-02, BM-04): a venue in a collective keeps the
 * collective's timezone and currency, and keeps appointments switched on.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import {
  bookingModelLockRefusal,
  currencyLockRefusal,
  findCollectiveLockForVenue,
  timezoneLockRefusal,
  type VenueCollectiveLock,
} from './collective-venue-locks';
import { currencyMismatchWords, normalCurrency } from './collective-currency';

const LOCK: VenueCollectiveLock = { collectiveId: 'collective-1', collectiveName: 'Northside', hostVenueId: 'host' };

const db = (responder: Responder) => makeRecordingDb(responder).db as unknown as SupabaseClient;

describe('findCollectiveLockForVenue', () => {
  const world = (memberships: unknown[], hosted: unknown[], active: unknown[]): Responder => (call) => {
    if (call.table === 'venue_collective_members') return { data: memberships };
    if (call.table === 'venue_collectives') {
      const byHost = call.filters.some((f) => f[0] === 'eq' && f[1] === 'host_venue_id');
      return { data: byHost ? hosted : active };
    }
    return undefined;
  };

  it('finds the active collective a venue belongs to', async () => {
    const lock = await findCollectiveLockForVenue(
      db(world([{ collective_id: 'collective-1' }], [], [{ id: 'collective-1', name: 'Northside', host_venue_id: 'host' }])),
      'member',
    );
    expect(lock).toEqual(LOCK);
  });

  it('counts hosting too', async () => {
    const lock = await findCollectiveLockForVenue(
      db(world([], [{ id: 'collective-1' }], [{ id: 'collective-1', name: 'Northside', host_venue_id: 'host' }])),
      'host',
    );
    expect(lock?.collectiveId).toBe('collective-1');
  });

  it('is null for a venue in no active collective', async () => {
    expect(await findCollectiveLockForVenue(db(world([], [], [])), 'venue')).toBeNull();
    expect(await findCollectiveLockForVenue(db(world([{ collective_id: 'ended' }], [], [])), 'venue')).toBeNull();
  });
});

describe('timezoneLockRefusal', () => {
  it('lets autosave send the same timezone again', () => {
    expect(timezoneLockRefusal(LOCK, 'Europe/London', 'Europe/London')).toBeNull();
    expect(timezoneLockRefusal(LOCK, null, 'Europe/London')).toBeNull();
    expect(timezoneLockRefusal(LOCK, 'Europe/London', undefined)).toBeNull();
  });

  it('allows any change outside a collective', () => {
    expect(timezoneLockRefusal(null, 'Europe/London', 'Europe/Dublin')).toBeNull();
  });

  it('refuses a change with a code and the way out', async () => {
    const refused = timezoneLockRefusal(LOCK, 'Europe/London', 'Europe/Dublin')!;
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      code: 'COLLECTIVE_TIMEZONE_LOCKED',
      error: 'Your venue is part of Northside, so its timezone cannot change. Leave Northside first.',
    });
  });
});

describe('bookingModelLockRefusal', () => {
  it('refuses switching appointments off, and only that', async () => {
    expect(bookingModelLockRefusal(LOCK, 'Zen Studio', ['class_session'])).toBeNull();
    expect(bookingModelLockRefusal(null, 'Zen Studio', ['unified_scheduling'])).toBeNull();
    const refused = bookingModelLockRefusal(LOCK, 'Zen Studio', ['unified_scheduling'])!;
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: 'COLLECTIVE_BOOKING_MODEL_LOCKED',
      error: expect.stringContaining('while Zen Studio is in a collective'),
    });
  });
});

describe('currencyLockRefusal', () => {
  const hostInGbp = db((call) => (call.table === 'venues' ? { data: { currency: 'GBP' } } : undefined));

  it("names the member's new currency and the host's", async () => {
    const refused = (await currencyLockRefusal(hostInGbp, LOCK, { id: 'member', name: 'Zen Studio', currency: 'GBP' }, 'EUR'))!;
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      code: 'COLLECTIVE_CURRENCY_MISMATCH',
      error:
        'Zen Studio takes payment in EUR and the collective uses GBP. Every venue in a collective has to use the same currency.',
    });
  });

  it("refuses the host too, since the collective's currency is its own", async () => {
    const refused = await currencyLockRefusal(hostInGbp, LOCK, { id: 'host', name: 'Host Venue', currency: 'GBP' }, 'EUR');
    expect(refused?.status).toBe(409);
  });

  it('lets an unchanged currency through, whatever its case', async () => {
    expect(await currencyLockRefusal(hostInGbp, LOCK, { id: 'member', name: 'Zen', currency: 'GBP' }, 'gbp')).toBeNull();
    expect(await currencyLockRefusal(hostInGbp, null, { id: 'member', name: 'Zen', currency: 'GBP' }, 'EUR')).toBeNull();
  });
});

describe('currency words', () => {
  it('treats a missing currency as GBP', () => {
    expect(normalCurrency(null)).toBe('GBP');
    expect(currencyMismatchWords('Bloom', 'eur', null)).toContain('Bloom takes payment in EUR and the collective uses GBP');
  });
});
