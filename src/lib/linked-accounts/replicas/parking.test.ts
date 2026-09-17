import { describe, expect, it, vi } from 'vitest';
import type { RpcClient } from './crons';
import { isParked, loadBookableServiceIds, parkedServiceRefusal, withoutParked } from './parking';

function client(byVenue: Record<string, unknown>, fail = false) {
  const rpc = vi.fn((_fn: string, args?: Record<string, unknown>) =>
    Promise.resolve(
      fail
        ? { data: null, error: { message: 'boom' } }
        : { data: byVenue[String(args?.p_venue_id)] ?? null, error: null },
    ),
  );
  return { client: { rpc } as RpcClient, rpc };
}

describe('parking', () => {
  it('parks nothing at a venue outside a live collective', async () => {
    const { client: c } = client({});
    const bookable = await loadBookableServiceIds(c, 'v1');
    expect(bookable).toBeNull();
    expect(isParked(bookable, 's1')).toBe(false);
    expect(withoutParked([{ id: 's1' }], bookable, (s) => s.id)).toEqual([{ id: 's1' }]);
  });

  it('keeps only the collective services at a live venue', async () => {
    const { client: c } = client({ v1: ['s1'] });
    const bookable = await loadBookableServiceIds(c, 'v1');
    expect(isParked(bookable, 's1')).toBe(false);
    expect(isParked(bookable, 's2')).toBe(true);
    expect(withoutParked([{ id: 's1' }, { id: 's2' }], bookable, (s) => s.id)).toEqual([{ id: 's1' }]);
  });

  it('fails open when the lookup cannot be read, leaving the database trigger to refuse', async () => {
    const { client: c } = client({}, true);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loadBookableServiceIds(c, 'v1')).toBeNull();
    expect(await parkedServiceRefusal(c, [{ venueId: 'v1', serviceItemId: 's9' }])).toBeNull();
    err.mockRestore();
  });

  it('refuses a parked service with the coded 409, one lookup per venue', async () => {
    const { client: c, rpc } = client({ v1: ['s1'], v2: ['s3'] });
    expect(await parkedServiceRefusal(c, [
      { venueId: 'v1', serviceItemId: 's1' },
      { venueId: 'v1', serviceItemId: 's1' },
      { venueId: 'v2', serviceItemId: 's3' },
    ])).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);

    const refused = await parkedServiceRefusal(c, [{ venueId: 'v2', serviceItemId: 's4' }], { collective: 'Northside' });
    expect(refused?.status).toBe(409);
    expect(refused?.code).toBe('COLLECTIVE_SERVICE_PARKED');
    expect(refused?.body.error).toBe(
      'This service is not on the Northside page, so it cannot take new bookings while your venue is part of Northside. Existing bookings are not affected.',
    );
  });
});
