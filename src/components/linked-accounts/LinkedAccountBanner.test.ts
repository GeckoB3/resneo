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

import { bannerItemsFromFeed } from './LinkedAccountBanner';

describe('LinkedAccountBanner items (Docs/link-and-collective-setup-wizard-plan.md §4)', () => {
  it('names the collective proposed with a request and points the review at it', () => {
    const items = bannerItemsFromFeed({
      incomingRequests: [
        { id: 'r-1', otherVenueName: 'Bloom', collective: { id: 'c-1', name: 'Northside' } },
        { id: 'r-2', otherVenueName: 'Cedar', collective: null },
      ],
    });
    expect(items[0]).toEqual({
      id: 'request:r-1',
      text: 'Bloom wants to link with your venue and start Northside, a shared booking page.',
      cta: 'Review request',
      href: '/dashboard/settings?tab=linked-accounts&review=r-1',
    });
    expect(items[1]!.text).toBe('Cedar wants to link with your venue.');
  });

  it('asks a host to continue setup, naming who joined', () => {
    const items = bannerItemsFromFeed({ collectiveSetup: [{ collectiveId: 'c-1', name: 'Northside', memberNames: ['Bloom'] }] });
    expect(items).toEqual([
      {
        id: 'setup:c-1',
        text: 'Bloom joined Northside. Two short steps make your shared booking page live.',
        cta: 'Continue setup',
        href: '/dashboard/settings?tab=linked-accounts&setup=c-1',
      },
    ]);
  });
});

describe('LinkedAccountBanner waiting states', () => {
  it('tells the sender the request is with the other venue, naming the collective', () => {
    const items = bannerItemsFromFeed({
      outgoingRequests: [
        { id: 'r-1', otherVenueName: 'Bloom', collective: { id: 'c-1', name: 'Northside' } },
        { id: 'r-2', otherVenueName: 'Cedar', collective: null },
      ],
    });
    expect(items[0]!.text).toBe('Waiting for Bloom to review your link request and join Northside. Once they accept, Continue setup appears here.');
    expect(items[0]!.cta).toBe('View request');
    expect(items[1]!.text).toBe('Waiting for Cedar to review your link request. The link starts as soon as they accept.');
  });

  it('tells a member that the host is still setting the page up', () => {
    const items = bannerItemsFromFeed({ memberWaiting: [{ collectiveId: 'c-1', name: 'Northside', hostName: 'Zen Studio' }] });
    expect(items).toEqual([
      {
        id: 'member-waiting:c-1',
        text: 'You are part of Northside. Zen Studio is setting up the services and the shared booking page, so nothing is needed from you yet.',
        cta: 'View collective',
        href: '/dashboard/settings?tab=linked-accounts',
      },
    ]);
  });
});
