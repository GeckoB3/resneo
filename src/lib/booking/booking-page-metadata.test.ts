/**
 * SEO-01 and SEO-02 (D48, PB-17, SB-37): every booking page has its own metadata, and a collective
 * page served at two addresses has one canonical.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/replicas/page-handover', () => ({ resolveOwnPageHandover: vi.fn(async () => null) }));

import { resolveOwnPageHandover } from '@/lib/linked-accounts/replicas/page-handover';
import {
  calendarPageMetadata,
  collectivePageMetadata,
  metaDescription,
  venuePageMetadata,
} from './booking-page-metadata';

interface World {
  collectiveStatus?: string;
  adoptedBy?: string | null;
  about?: string | null;
}

function db({ collectiveStatus = 'active', adoptedBy = null, about = null }: World = {}) {
  const responder: Responder = (call) => {
    if (call.table === 'venue_collectives') {
      if (call.filters.some((f) => f[1] === 'adopted_venue_id')) return { data: adoptedBy ? { slug: adoptedBy } : null };
      return {
        data: {
          id: 'col-1',
          name: 'Northside',
          slug: 'northside',
          status: collectiveStatus,
          branding: { logo_url: 'https://cdn.test/logo.png' },
          booking_page_config: { cover_photo_url: 'https://cdn.test/cover.jpg', ...(about ? { about } : {}) },
        },
      };
    }
    if (call.table === 'venue_collective_members') return { data: null, count: 3 };
    if (call.table === 'venues') {
      return {
        data: {
          id: 'zen',
          name: 'Zen Studio',
          slug: 'zen',
          address: '1 High Street, Belfast',
          cover_photo_url: null,
          logo_url: 'https://cdn.test/zen.png',
          booking_page_config: {},
        },
      };
    }
    if (call.table === 'unified_calendars') return { data: { name: 'Ada', slug: 'ada', is_active: true } };
    return undefined;
  };
  const recording = makeRecordingDb(responder);
  return { db: recording.db as unknown as SupabaseClient, calls: recording.calls };
}

beforeEach(() => {
  vi.mocked(resolveOwnPageHandover).mockResolvedValue(null);
});

describe('collectivePageMetadata', () => {
  it('gives the collective page a title, description, card, canonical and robots', async () => {
    const meta = await collectivePageMetadata(db().db, 'northside');
    expect(meta.title).toBe('Book with Northside');
    expect(meta.description).toBe('Book online with Northside. 3 venues, one booking page.');
    expect(meta.alternates?.canonical).toBe('/book/c/northside');
    expect(meta.openGraph).toMatchObject({ url: '/book/c/northside', images: [{ url: 'https://cdn.test/cover.jpg' }] });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image' });
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("uses the host's About text when there is one", async () => {
    const meta = await collectivePageMetadata(db({ about: 'Three studios,\n one team.' }).db, 'northside');
    expect(meta.description).toBe('Three studios, one team.');
  });

  it('keeps an ended or unready page out of search, and reads only', async () => {
    const ended = db({ collectiveStatus: 'dissolved' });
    expect((await collectivePageMetadata(ended.db, 'northside')).robots).toEqual({ index: false, follow: true });
    expect((await collectivePageMetadata(db({ collectiveStatus: 'pending' }).db, 'northside')).robots).toEqual({
      index: false,
      follow: true,
    });
    expect(ended.calls.every((c) => c.op === 'select')).toBe(true);
  });
});

describe('venuePageMetadata', () => {
  it("gives a venue's own page its own metadata", async () => {
    const meta = await venuePageMetadata(db().db, 'zen');
    expect(meta.title).toBe('Book with Zen Studio');
    expect(meta.description).toBe('Book online with Zen Studio, 1 High Street, Belfast.');
    expect(meta.alternates?.canonical).toBe('/book/zen');
    expect(meta.openGraph).toMatchObject({ images: [{ url: 'https://cdn.test/zen.png' }] });
  });

  it('points an adopted address at the collective page, so there is one canonical (SEO-02)', async () => {
    const meta = await venuePageMetadata(db({ adoptedBy: 'northside' }).db, 'zen');
    expect(meta.title).toBe('Book with Northside');
    expect(meta.alternates?.canonical).toBe('/book/c/northside');
  });

  it('points a page that hands over at the collective page, but not one that keeps other booking types', async () => {
    vi.mocked(resolveOwnPageHandover).mockResolvedValue({ redirect: true, otherModels: null, collectiveSlug: 'northside' } as never);
    expect((await venuePageMetadata(db().db, 'zen')).alternates?.canonical).toBe('/book/c/northside');
    vi.mocked(resolveOwnPageHandover).mockResolvedValue({ redirect: true, otherModels: 'classes', collectiveSlug: 'northside' } as never);
    expect((await venuePageMetadata(db().db, 'zen')).alternates?.canonical).toBe('/book/zen');
  });
});

describe('calendarPageMetadata', () => {
  it("names the person and the venue, and is canonical for the person's own address", async () => {
    const meta = await calendarPageMetadata(db().db, 'zen', 'ada');
    expect(meta.title).toBe('Book with Ada at Zen Studio');
    expect(meta.alternates?.canonical).toBe('/book/zen/ada');
  });

  it('follows the handover', async () => {
    vi.mocked(resolveOwnPageHandover).mockResolvedValue({ redirect: true, otherModels: 'classes', collectiveSlug: 'northside' } as never);
    expect((await calendarPageMetadata(db().db, 'zen', 'ada')).alternates?.canonical).toBe('/book/c/northside');
  });
});

describe('metaDescription', () => {
  it('keeps a long text to one short line', () => {
    const long = 'word '.repeat(60);
    const out = metaDescription(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/—/);
  });
});
