import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSharedJsonCache, fetchJsonShared, warmStaffBookingSurface } from './staff-surface-warm';

function response(ok: boolean, body: unknown, status = ok ? 200 : 500): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('fetchJsonShared', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    clearSharedJsonCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shares one request between concurrent callers and returns the parsed body to each', async () => {
    fetchMock.mockResolvedValue(response(true, { practitioners: [1] }));
    const [a, b] = await Promise.all([fetchJsonShared('/api/x'), fetchJsonShared('/api/x')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual({ practitioners: [1] });
    expect(b).toBe(a);
  });

  it('refetches once the window has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T10:00:00Z'));
    fetchMock.mockResolvedValue(response(true, {}));
    await fetchJsonShared('/api/x', 1000);
    vi.setSystemTime(new Date('2026-09-05T10:00:02Z'));
    await fetchJsonShared('/api/x', 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failed response', async () => {
    fetchMock.mockResolvedValueOnce(response(false, { error: 'nope' }, 401));
    fetchMock.mockResolvedValueOnce(response(true, { fine: true }));
    const first = await fetchJsonShared('/api/x');
    expect(first.ok).toBe(false);
    const second = await fetchJsonShared('/api/x');
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('warms the collective profile and its staff catalogue with one request each', () => {
    fetchMock.mockResolvedValue(response(true, {}));
    warmStaffBookingSurface({ venueId: 'venue-1', linkedOwnerVenueId: 'coll-1' });
    warmStaffBookingSurface({ venueId: 'venue-1', linkedOwnerVenueId: 'coll-1' });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      '/api/venue/linked-calendar/venue-profile?venueId=coll-1',
      '/api/booking/appointment-catalog?venue_id=coll-1&include_hidden=true',
    ]);
  });

  it('warms the own venue through /api/venue', () => {
    fetchMock.mockResolvedValue(response(true, {}));
    warmStaffBookingSurface({ venueId: 'venue-1' });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(['/api/venue', '/api/booking/appointment-catalog?venue_id=venue-1&include_hidden=true']);
  });
});
