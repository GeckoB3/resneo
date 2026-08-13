import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCascadingVisitGroupId } from './group-booking-status-sync';

/**
 * `group_booking_id` links two different things, and cascading a status change
 * across the wrong one forfeited real money: marking one child in a family group
 * as a no-show flipped both parents to no-show and forfeited their paid deposits.
 */

function dbReturning(rows: Array<Record<string, unknown>>): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const visitRow = (id: string) => ({
  id,
  status: 'Booked',
  guest_id: 'g1',
  person_label: null,
});

const attendeeRow = (id: string, label: string) => ({
  id,
  status: 'Booked',
  guest_id: 'g1',
  person_label: label,
});

describe('resolveCascadingVisitGroupId', () => {
  it('cascades across a multi-service visit (one guest, no person labels)', async () => {
    const db = dbReturning([visitRow('a'), visitRow('b'), visitRow('c')]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBe('grp-1');
  });

  it('does NOT cascade across a group booking of distinct people', async () => {
    const db = dbReturning([
      attendeeRow('a', 'Mum'),
      attendeeRow('b', 'Dad'),
      attendeeRow('c', 'Child'),
    ]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBeNull();
  });

  it('does not cascade when even one row carries a person label', async () => {
    const db = dbReturning([visitRow('a'), attendeeRow('b', 'Dad')]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBeNull();
  });

  it('treats a blank person label as no label', async () => {
    const db = dbReturning([attendeeRow('a', '   '), attendeeRow('b', '')]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBe('grp-1');
  });

  it('has nothing to cascade for a lone row', async () => {
    const db = dbReturning([visitRow('a')]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBeNull();
  });

  it('returns null without querying when the booking has no group id', async () => {
    const from = vi.fn();
    const db = { from } as unknown as SupabaseClient;
    expect(await resolveCascadingVisitGroupId(db, 'v1', null)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
