import { describe, expect, it } from 'vitest';
import { createShortManageLink, resolveShortManageBookingId } from '@/lib/short-manage-link';
import { resolveManageBookingToken } from '@/lib/manage-booking-token';

describe('manage-booking-token', () => {
  it('resolves v2 segment to booking id and booking-scoped hmac', () => {
    const bookingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const url = createShortManageLink(bookingId);
    const segment = new URL(url).pathname.split('/').pop()!;
    const resolved = resolveManageBookingToken(segment);
    expect(resolved).not.toBeNull();
    expect(resolved!.bookingId).toBe(bookingId);
    expect(resolved!.hmac.length).toBeGreaterThan(10);
  });

  it('returns null for invalid segment (verify API compatibility)', () => {
    expect(resolveManageBookingToken('not-a-token')).toBeNull();
    expect(resolveManageBookingToken('')).toBeNull();
  });

  it('matches resolveShortManageBookingId for the same segment', () => {
    const bookingId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const url = createShortManageLink(bookingId);
    const segment = new URL(url).pathname.split('/').pop()!;
    const fromShort = resolveShortManageBookingId(segment);
    const fromManage = resolveManageBookingToken(segment);
    expect(fromShort).toBe(bookingId);
    expect(fromManage?.bookingId).toBe(bookingId);
  });
});
