/**
 * PUB-02 and PUB-05: a venue's own appointment links hand over to the collective page with the
 * guest's place kept, and a venue that also runs other booking types keeps its own page for them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`redirect ${url}`);
  }
}

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('notFound');
  }),
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock('@/lib/booking/get-public-venue-for-book', () => ({ getPublicVenueForBookBySlug: vi.fn() }));
vi.mock('@/lib/booking/load-book-public-layout-data', () => ({
  loadBookPublicLayoutData: vi.fn(async () => ({ services: [], team: [] })),
}));
vi.mock('@/components/booking/BookPublicLayout', () => ({ BookPublicLayout: () => null }));
vi.mock('@/lib/linked-accounts/catalogue', () => ({ resolveCombinedSlugClaim: vi.fn(async () => null) }));
vi.mock('../c/[slug]/collective-page-view', () => ({ loadCollectivePageView: vi.fn(), CollectivePageBody: () => null }));
vi.mock('@/lib/linked-accounts/replicas/page-handover', () => ({
  resolveOwnPageHandover: vi.fn(),
  handoverUrl: vi.fn(async () => '/book/c/northside?service_id=offer-cut&calendar=cal-1'),
}));

import { getPublicVenueForBookBySlug } from '@/lib/booking/get-public-venue-for-book';
import { handoverUrl, resolveOwnPageHandover, type OwnPageHandover } from '@/lib/linked-accounts/replicas/page-handover';
import BookPage from './page';
import BookPractitionerPage from './[practitioner-slug]/page';

const VENUE = { id: 'member', name: 'Zen Studio', slug: 'zen', booking_model: 'unified_scheduling' };

const handover = (over: Partial<OwnPageHandover> = {}): OwnPageHandover => ({
  collectiveId: 'col-1',
  collectiveName: 'Northside',
  collectiveSlug: 'northside',
  hostVenueId: 'host',
  hostName: 'Host Venue',
  isHost: false,
  publicPath: '/book/c/northside',
  redirect: true,
  reason: null,
  otherModels: null,
  ownPath: '/book/zen',
  ...over,
});

async function visit(query: Record<string, string> = {}) {
  try {
    const element = (await BookPage({
      params: Promise.resolve({ 'venue-slug': 'zen' }),
      searchParams: Promise.resolve(query),
    })) as ReactElement<{ venue: Record<string, unknown> }>;
    return { redirectedTo: null, venue: element.props.venue };
  } catch (err) {
    if (err instanceof RedirectSignal) return { redirectedTo: err.url, venue: null };
    throw err;
  }
}

beforeEach(() => {
  vi.mocked(getPublicVenueForBookBySlug).mockResolvedValue(VENUE as never);
  vi.mocked(resolveOwnPageHandover).mockReset();
  vi.mocked(handoverUrl).mockClear();
});

describe('/book/{venue} on a shared-services collective (PUB-02)', () => {
  it('hands over with the guest place kept', async () => {
    vi.mocked(resolveOwnPageHandover).mockResolvedValue(handover());
    const { redirectedTo } = await visit({ service_id: 'replica-cut', start: 'time' });
    expect(redirectedTo).toBe('/book/c/northside?service_id=offer-cut&calendar=cal-1');
    const [, , venueId, query] = vi.mocked(handoverUrl).mock.calls[0]!;
    expect(venueId).toBe('member');
    expect(query.get('service_id')).toBe('replica-cut');
    expect(query.get('start')).toBe('time');
  });

  it('shows the own page when the rule says so', async () => {
    vi.mocked(resolveOwnPageHandover).mockResolvedValue(handover({ redirect: false, reason: 'settingUp' }));
    const { redirectedTo, venue } = await visit();
    expect(redirectedTo).toBeNull();
    expect(venue?.appointments_handover).toBeUndefined();
  });

  it('answers a waitlist offer on the own page, where the offer was made', async () => {
    vi.mocked(resolveOwnPageHandover).mockResolvedValue(handover());
    expect((await visit({ waitlist_offer: 'entry-1' })).redirectedTo).toBeNull();
  });

  it('never redirects an adopted address to itself', async () => {
    vi.mocked(resolveOwnPageHandover).mockResolvedValue(handover({ publicPath: '/book/zen' }));
    expect((await visit()).redirectedTo).toBeNull();
  });

  it('hands a calendar address over to that calendar', async () => {
    vi.mocked(resolveOwnPageHandover).mockResolvedValue(handover());
    const { getSupabaseAdminClient } = await import('@/lib/supabase');
    vi.mocked(getSupabaseAdminClient).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: 'cal-1', name: 'Sam', is_active: true, slug: 'sam' }, error: null }) }),
          }),
        }),
      }),
    } as never);
    await expect(
      BookPractitionerPage({
        params: Promise.resolve({ 'venue-slug': 'zen', 'practitioner-slug': 'sam' }),
        searchParams: Promise.resolve({ date: '2026-10-12' }),
      }),
    ).rejects.toMatchObject({ url: '/book/c/northside?service_id=offer-cut&calendar=cal-1' });
    const call = vi.mocked(handoverUrl).mock.calls[0]!;
    expect(call[4]).toBe('cal-1');
    expect(call[3].get('date')).toBe('2026-10-12');
  });
});

describe('/book/{venue} for a venue with other booking types (PUB-05)', () => {
  it('keeps the own page, with the appointments tab pointing at the collective page', async () => {
    vi.mocked(resolveOwnPageHandover).mockResolvedValue(handover({ otherModels: 'classes' }));
    const { redirectedTo, venue } = await visit({ tab: 'classes' });
    expect(redirectedTo).toBeNull();
    expect(venue?.appointments_handover).toEqual({ collective_name: 'Northside', href: '/book/c/northside' });
  });

  it('still hands an appointment deep link over', async () => {
    vi.mocked(resolveOwnPageHandover).mockResolvedValue(handover({ otherModels: 'classes' }));
    expect((await visit({ service_id: 'replica-cut' })).redirectedTo).toBe('/book/c/northside?service_id=offer-cut&calendar=cal-1');
  });

  it('is the venue own page again after leaving', async () => {
    vi.mocked(resolveOwnPageHandover).mockResolvedValue(null);
    const { redirectedTo, venue } = await visit({ service_id: 'own-cut' });
    expect(redirectedTo).toBeNull();
    expect(venue?.appointments_handover).toBeUndefined();
  });
});
