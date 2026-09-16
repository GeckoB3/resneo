/**
 * Contact search across a live collective (D41; contract 16).
 *
 * The search reaches this venue and every live member whose account link shares client details,
 * names the owner on every row, and is refused outside a live collective.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/collective-staff-scope', () => ({
  findStaffCollectiveForVenue: vi.fn(),
  eligibleMemberVenueIds: vi.fn(async () => ['me', 'shares', 'private']),
}));
vi.mock('@/lib/linked-accounts/queries', () => ({
  resolveCallerGrantOverVenue: vi.fn(async (_admin: unknown, _me: string, other: string) =>
    other === 'shares'
      ? { linkId: 'l-1', grant: { calendar: 'full_details', pii: true, act: 'create_edit_cancel', calendarIds: null } }
      : { linkId: 'l-2', grant: { calendar: 'full_details', pii: false, act: 'none', calendarIds: null } },
  ),
}));

import { findStaffCollectiveForVenue } from '@/lib/linked-accounts/collective-staff-scope';
import { collectiveContactVenues, searchCollectiveContacts } from './collective-contact-search';

const live = () =>
  vi.mocked(findStaffCollectiveForVenue).mockResolvedValue({
    collectiveId: 'c-1',
    name: 'Northside',
    hostVenueId: 'me',
    memberVenueIds: ['me', 'shares', 'private'],
  } as never);

beforeEach(() => {
  vi.mocked(findStaffCollectiveForVenue).mockReset();
});

describe('collectiveContactVenues', () => {
  it('reaches only the venues whose link shares client details', async () => {
    live();
    const { db } = makeRecordingDb();
    expect(await collectiveContactVenues(db as unknown as SupabaseClient, 'me')).toEqual({
      collectiveId: 'c-1',
      venueIds: ['me', 'shares'],
    });
  });

  it('is null outside a live collective', async () => {
    vi.mocked(findStaffCollectiveForVenue).mockResolvedValue(null);
    const { db } = makeRecordingDb();
    expect(await collectiveContactVenues(db as unknown as SupabaseClient, 'me')).toBeNull();
  });
});

describe('searchCollectiveContacts', () => {
  it('names the owner of every row', async () => {
    live();
    const recording = makeRecordingDb((call) => {
      if (call.table === 'guests') {
        return {
          data: [
            { id: 'g-1', venue_id: 'shares', first_name: 'Ada', last_name: 'Byron', email: 'ada@x.test', phone: null, created_at: '2026-01-01' },
            { id: 'g-2', venue_id: 'me', first_name: 'Ada', last_name: 'King', email: null, phone: null, created_at: '2026-01-01' },
          ],
        };
      }
      if (call.table === 'venues') return { data: [{ id: 'me', name: 'Zen Studio' }, { id: 'shares', name: 'Bloom' }] };
      return undefined;
    });
    const found = await searchCollectiveContacts(recording.db as unknown as SupabaseClient, 'me', 'ada', 10);
    expect(found).toMatchObject({
      ok: true,
      guests: [
        { id: 'g-1', owner_venue_id: 'shares', owner_venue_name: 'Bloom', owner_is_self: false },
        { id: 'g-2', owner_venue_id: 'me', owner_venue_name: 'Zen Studio', owner_is_self: true },
      ],
    });
    const read = recording.calls.find((c) => c.table === 'guests')!;
    expect(read.filters).toContainEqual(['in', 'venue_id', ['me', 'shares']]);
    expect(read.filters.some((f) => f[0] === 'or')).toBe(true);
    expect(read.filters).toContainEqual(['limit', 10]);
  });

  it('refuses outside a live collective, and reads nothing', async () => {
    vi.mocked(findStaffCollectiveForVenue).mockResolvedValue(null);
    const recording = makeRecordingDb();
    expect(await searchCollectiveContacts(recording.db as unknown as SupabaseClient, 'me', 'ada')).toEqual({ ok: false });
    expect(recording.calls.some((c) => c.table === 'guests')).toBe(false);
  });

  it('caps the result count', async () => {
    live();
    const recording = makeRecordingDb();
    await searchCollectiveContacts(recording.db as unknown as SupabaseClient, 'me', 'ada', 500);
    expect(recording.calls.find((c) => c.table === 'guests')!.filters).toContainEqual(['limit', 25]);
  });
});
