import { describe, expect, it } from 'vitest';
import { createShortManageLink, resolveShortManageBookingId } from '@/lib/short-manage-link';

describe('short manage links', () => {
  it('creates v2 token that resolves back to booking id', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const url = createShortManageLink(id);
    const segment = new URL(url).pathname.split('/').pop()!;
    expect(resolveShortManageBookingId(segment)).toBe(id);
  });

  it('rejects tampered v2 token', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const url = createShortManageLink(id);
    const segment = new URL(url).pathname.split('/').pop()!;
    const tampered = segment.replace(/a/g, 'f');
    expect(resolveShortManageBookingId(tampered)).toBeNull();
  });
});
