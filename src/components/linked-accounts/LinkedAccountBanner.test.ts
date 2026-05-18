import { describe, expect, it } from 'vitest';

/** Mirrors the 24h dismiss filter in LinkedAccountBanner (accept-flow UX). */
function filterVisible<T extends { id: string }>(
  items: T[],
  dismissed: Record<string, number>,
  now = Date.now(),
): T[] {
  const DISMISS_MS = 24 * 60 * 60 * 1000;
  return items.filter((i) => {
    const at = dismissed[i.id];
    return !at || now - at > DISMISS_MS;
  });
}

describe('LinkedAccountBanner dismiss filter', () => {
  const items = [{ id: 'req-1' }, { id: 'req-2' }];

  it('shows all items when nothing dismissed', () => {
    expect(filterVisible(items, {})).toHaveLength(2);
  });

  it('hides item dismissed within 24h', () => {
    const now = 1_000_000;
    const dismissed = { 'req-1': now - 60_000 };
    expect(filterVisible(items, dismissed, now).map((i) => i.id)).toEqual(['req-2']);
  });

  it('shows item again after 24h dismiss window', () => {
    const now = 1_000_000;
    const dismissed = { 'req-1': now - 25 * 60 * 60 * 1000 };
    expect(filterVisible(items, dismissed, now)).toHaveLength(2);
  });
});
